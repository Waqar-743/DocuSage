//! Built-in crash-isolated `llama.cpp` runtime manager.
//!
//! Runs GGUF models inside a supervised isolated child process spawned from the
//! same `docusage` executable (`--local-engine-worker`) — no external server
//! downloads, no localhost ports, and any native `llama.cpp` / `ggml` fault
//! (such as Windows `0xc0000005` or `0xc000001d`) terminates only the worker,
//! leaving the DocuSage UI intact with an actionable diagnostic error + log path.

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::services::ai_client::{ChatMessage, ChatTokenPayload};
use crate::services::device;
use crate::services::local_engine::GenerationRequest;
use crate::services::local_log;
use crate::services::local_worker::{self, SupervisedWorker};

const LOCAL_STATE_FILE: &str = "local-model-state.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelPersistedState {
    pub last_connected_model: Option<String>,
    pub last_connected_path: Option<String>,
    pub loading_in_progress: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRuntimeStatus {
    pub installed: bool,
    pub binary_path: Option<String>,
    pub running: bool,
    pub port: Option<u16>,
    pub base_url: Option<String>,
    pub loaded_model: Option<String>,
    pub loaded_model_path: Option<String>,
    pub embedding_running: bool,
    pub embedding_port: Option<u16>,
    pub embedding_model: Option<String>,
    pub detected_backend: String,
    pub platform_summary: String,
    pub version: Option<String>,
    pub total_memory_bytes: Option<u64>,
    pub available_memory_bytes: Option<u64>,
    pub recommended_threads: u32,
    pub context_length: Option<usize>,
    pub loading: bool,
    pub generating: bool,
    pub last_interrupted_model: Option<String>,
    pub engine_mode: String,
    pub log_path: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDownloadProgress {
    pub stage: String,
    pub asset_name: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: f32,
    pub done: bool,
    pub error: Option<String>,
}

struct LoadedSlot {
    worker: SupervisedWorker,
    model_path: PathBuf,
    model_name: String,
}

#[derive(Debug, Clone, Default)]
struct RuntimeMetadata {
    loaded_model: Option<String>,
    loaded_model_path: Option<PathBuf>,
    context_length: Option<usize>,
    is_loading: bool,
    is_generating: bool,
    last_interrupted_model: Option<String>,
    last_error: Option<String>,
}

#[derive(Clone, Default)]
pub struct LocalRuntimeManager {
    /// Serializes model load / unload / inference operations so two callers never
    /// allocate duplicate copies of a GGUF model in RAM at the same time.
    op_lock: Arc<Mutex<()>>,
    /// The active isolated worker slot, always accessed under `op_lock`.
    chat: Arc<Mutex<Option<LoadedSlot>>>,
    /// Lock-free readable status mirror so `status()`, `is_chat_loaded()`, and
    /// `is_busy()` never block on inference and never falsely report unloaded.
    meta: Arc<RwLock<RuntimeMetadata>>,
}

struct BusyFlagGuard {
    meta: Arc<RwLock<RuntimeMetadata>>,
    loading: bool,
    generating: bool,
}

impl Drop for BusyFlagGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.meta.write() {
            if self.loading {
                guard.is_loading = false;
            }
            if self.generating {
                guard.is_generating = false;
            }
        }
    }
}

fn persisted_state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join(LOCAL_STATE_FILE))
}

pub fn engine_log_path(app: &AppHandle) -> PathBuf {
    let path = app
        .path()
        .app_data_dir()
        .map(|d| d.join("logs").join("local-engine.log"))
        .unwrap_or_else(|_| local_log::resolve_log_path());
    local_log::init_log_path(path.clone());
    path
}

pub fn read_persisted_local_state(app: &AppHandle) -> LocalModelPersistedState {
    let Some(path) = persisted_state_path(app) else {
        return LocalModelPersistedState::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<LocalModelPersistedState>(&raw).ok())
        .unwrap_or_default()
}

pub fn write_persisted_local_state(app: &AppHandle, state: &LocalModelPersistedState) {
    let Some(path) = persisted_state_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = std::fs::write(path, json);
    }
}

pub fn detect_hardware_backend() -> String {
    "isolated-cpu".to_string()
}

pub fn platform_summary() -> String {
    let threads = device::inference_threads();
    match device::total_memory_bytes() {
        Some(bytes) => {
            let gb = (bytes as f64 / (1024.0 * 1024.0 * 1024.0)).ceil() as u64;
            format!(
                "{}-{} ({gb} GB RAM · {threads} threads)",
                std::env::consts::OS,
                std::env::consts::ARCH
            )
        }
        None => format!(
            "{}-{} ({threads} threads)",
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    }
}

impl LocalRuntimeManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_last_interrupted_model(&self, model: Option<String>) {
        if let Ok(mut meta) = self.meta.write() {
            meta.last_interrupted_model = model;
        }
    }

    pub fn is_busy(&self) -> bool {
        self.meta
            .read()
            .map(|m| m.is_loading || m.is_generating)
            .unwrap_or(false)
    }

    pub fn loaded_model_name(&self) -> Option<String> {
        self.meta
            .read()
            .ok()
            .and_then(|m| m.loaded_model.clone())
    }

    pub async fn status(&self, app: &AppHandle) -> LocalRuntimeStatus {
        let snap = self.meta.read().map(|m| m.clone()).unwrap_or_default();
        let running = snap.loaded_model.is_some();
        let log_path = engine_log_path(app).to_string_lossy().into_owned();

        LocalRuntimeStatus {
            installed: true,
            binary_path: Some("built-in (isolated llama.cpp worker)".to_string()),
            running,
            port: None,
            base_url: None,
            loaded_model: snap.loaded_model,
            loaded_model_path: snap
                .loaded_model_path
                .map(|p| p.to_string_lossy().into_owned()),
            embedding_running: false,
            embedding_port: None,
            embedding_model: None,
            detected_backend: detect_hardware_backend(),
            platform_summary: platform_summary(),
            version: Some("llama.cpp (isolated worker)".to_string()),
            total_memory_bytes: device::total_memory_bytes(),
            available_memory_bytes: device::available_memory_bytes(),
            recommended_threads: device::inference_threads(),
            context_length: snap.context_length,
            loading: snap.is_loading,
            generating: snap.is_generating,
            last_interrupted_model: snap.last_interrupted_model,
            engine_mode: "isolated-worker".to_string(),
            log_path: Some(log_path),
            last_error: snap.last_error,
        }
    }

    pub async fn is_chat_loaded(&self) -> bool {
        self.meta
            .read()
            .map(|m| m.loaded_model.is_some())
            .unwrap_or(false)
    }

    pub async fn chat_base_url(&self) -> Option<String> {
        None
    }

    pub async fn embedding_base_url(&self) -> Option<(String, String)> {
        None
    }

    /// The llama.cpp worker is compiled directly into DocuSage, so this confirms
    /// readiness immediately without downloading any external binary.
    pub async fn install_runtime(
        &self,
        app: &AppHandle,
        _preferred_backend: Option<String>,
    ) -> Result<LocalRuntimeStatus, String> {
        let _ = app.emit(
            "runtime-download-progress",
            RuntimeDownloadProgress {
                stage: "ready".into(),
                asset_name: "built-in llama.cpp worker".into(),
                downloaded: 1,
                total: 1,
                percent: 100.0,
                done: true,
                error: None,
            },
        );
        Ok(self.status(app).await)
    }

    /// Load a `.gguf` chat model inside a supervised isolated worker process.
    pub async fn start_chat_model(
        &self,
        app: &AppHandle,
        gguf_path: &Path,
        ctx_size: Option<u32>,
    ) -> Result<LocalRuntimeStatus, String> {
        if !gguf_path.is_file() {
            return Err(format!("Model file not found: {}", gguf_path.display()));
        }

        // Single-flight guard: reject overlapping load/test clicks instead of queuing duplicate allocations.
        let Ok(_op) = self.op_lock.try_lock() else {
            return Err(
                "Local AI engine is already busy loading or testing a model. Please wait for it to finish."
                    .to_string(),
            );
        };

        // If this exact model file is already loaded in a live worker and no custom ctx_size was requested, reuse it.
        if ctx_size.is_none() {
            let already_loaded = {
                let guard = self.chat.lock().await;
                guard
                    .as_ref()
                    .is_some_and(|slot| slot.model_path == gguf_path && slot.worker.is_alive())
            };
            if already_loaded {
                return Ok(self.status(app).await);
            }
        }

        let log_path = engine_log_path(app);
        let model_name = gguf_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "local-model.gguf".into());

        if let Ok(mut meta) = self.meta.write() {
            meta.is_loading = true;
            meta.last_interrupted_model = None;
            meta.last_error = None;
        }
        let _loading_guard = BusyFlagGuard {
            meta: self.meta.clone(),
            loading: true,
            generating: false,
        };

        // Stop any previously running worker before spawning the next one so peak RAM stays bounded.
        self.unload_chat_locked().await;

        let mut persisted = read_persisted_local_state(app);
        persisted.loading_in_progress = Some(model_name.clone());
        write_persisted_local_state(app, &persisted);

        let load_res =
            local_worker::spawn_and_load_with_fallback(gguf_path, ctx_size, log_path).await;

        persisted.loading_in_progress = None;

        let (worker, outcome) = match load_res {
            Ok(pair) => pair,
            Err(err) => {
                if let Ok(mut meta) = self.meta.write() {
                    meta.loaded_model = None;
                    meta.loaded_model_path = None;
                    meta.context_length = None;
                    meta.last_error = Some(err.clone());
                }
                write_persisted_local_state(app, &persisted);
                return Err(err);
            }
        };

        {
            let mut guard = self.chat.lock().await;
            *guard = Some(LoadedSlot {
                worker,
                model_path: gguf_path.to_path_buf(),
                model_name: outcome.model_name.clone(),
            });
        }
        if let Ok(mut meta) = self.meta.write() {
            meta.loaded_model = Some(outcome.model_name.clone());
            meta.loaded_model_path = Some(gguf_path.to_path_buf());
            meta.context_length = Some(outcome.context_length);
            meta.is_loading = false;
            meta.last_error = None;
        }

        persisted.last_connected_model = Some(outcome.model_name);
        persisted.last_connected_path = Some(gguf_path.to_string_lossy().into_owned());
        write_persisted_local_state(app, &persisted);

        Ok(self.status(app).await)
    }

    pub async fn start_embedding_model(
        &self,
        _app: &AppHandle,
        _gguf_path: &Path,
    ) -> Result<LocalRuntimeStatus, String> {
        Err(
            "Offline document search already uses built-in SQLite FTS5. For dense vector embeddings, configure Ollama or a cloud provider in Settings -> RAG & Context."
                .to_string(),
        )
    }

    async fn unload_chat_locked(&self) {
        let old = {
            let mut guard = self.chat.lock().await;
            guard.take()
        };
        if let Ok(mut meta) = self.meta.write() {
            meta.loaded_model = None;
            meta.loaded_model_path = None;
            meta.context_length = None;
        }
        if let Some(slot) = old {
            slot.worker.shutdown().await;
        }
    }

    pub async fn stop_chat(&self) {
        let _op = self.op_lock.lock().await;
        self.unload_chat_locked().await;
    }

    pub async fn stop_all(&self) {
        self.stop_chat().await;
    }

    /// Stream a chat completion from the isolated local GGUF worker.
    #[allow(clippy::too_many_arguments)]
    pub async fn stream_chat(
        &self,
        app: &AppHandle,
        system_prompt: &str,
        history: &[ChatMessage],
        prompt: &str,
        request_id: &str,
        temperature: f32,
        grounded: bool,
        cancel_token: CancellationToken,
    ) -> Result<(String, bool), String> {
        let _op = self.op_lock.lock().await;

        let pairs = history_to_pairs(history);
        let temp = if grounded {
            temperature.min(0.25)
        } else {
            temperature
        };
        let req = GenerationRequest {
            system_prompt: system_prompt.to_string(),
            history: pairs,
            user_message: prompt.to_string(),
            max_tokens: 1536,
            temperature: temp,
            top_p: 0.95,
            enable_thinking: false,
        };

        let mut slot = {
            let mut guard = self.chat.lock().await;
            guard.take().ok_or_else(|| {
                "No local GGUF model is loaded yet. Download or load a model in Settings -> Local AI & GGUF."
                    .to_string()
            })?
        };

        if let Ok(mut meta) = self.meta.write() {
            meta.is_generating = true;
            meta.last_error = None;
        }
        let _gen_guard = BusyFlagGuard {
            meta: self.meta.clone(),
            loading: false,
            generating: true,
        };

        let app_clone = app.clone();
        let req_id_owned = request_id.to_string();

        let gen_res = slot
            .worker
            .generate_streaming(&req, &cancel_token, |tok| {
                let _ = app_clone.emit(
                    "chat-token",
                    ChatTokenPayload {
                        request_id: req_id_owned.clone(),
                        token: tok.to_string(),
                        done: false,
                    },
                );
            })
            .await;

        let _ = app.emit(
            "chat-token",
            ChatTokenPayload {
                request_id: request_id.to_string(),
                token: String::new(),
                done: true,
            },
        );

        match gen_res {
            Ok(output) => {
                if slot.worker.is_alive() {
                    let mut guard = self.chat.lock().await;
                    *guard = Some(slot);
                } else {
                    self.clear_loaded_meta(None);
                }
                Ok((output.reply, output.stopped))
            }
            Err(err) => {
                if slot.worker.is_alive() {
                    let mut guard = self.chat.lock().await;
                    *guard = Some(slot);
                    if let Ok(mut meta) = self.meta.write() {
                        meta.last_error = Some(err.clone());
                    }
                } else {
                    slot.worker.shutdown().await;
                    self.clear_loaded_meta(Some(err.clone()));
                }
                Err(err)
            }
        }
    }

    /// Run a fast live inference smoke test against the currently loaded local GGUF worker.
    pub async fn quick_test_chat(&self) -> Result<(String, String, u64), String> {
        let Ok(_op) = self.op_lock.try_lock() else {
            return Err(
                "Local AI engine is busy loading or generating. Wait for the current operation to finish."
                    .to_string(),
            );
        };

        let mut slot = {
            let mut guard = self.chat.lock().await;
            guard
                .take()
                .ok_or_else(|| "No local GGUF model is currently loaded.".to_string())?
        };

        if let Ok(mut meta) = self.meta.write() {
            meta.is_generating = true;
            meta.last_error = None;
        }
        let _gen_guard = BusyFlagGuard {
            meta: self.meta.clone(),
            loading: false,
            generating: true,
        };

        let model_name = slot.model_name.clone();
        let req = GenerationRequest {
            system_prompt: "You are a helpful assistant. Answer in one short sentence.".to_string(),
            history: Vec::new(),
            user_message: "Reply with one short sentence confirming you are ready.".to_string(),
            max_tokens: 48,
            temperature: 0.1,
            top_p: 0.95,
            enable_thinking: false,
        };
        let cancel = CancellationToken::new();

        let gen_res = slot.worker.generate_streaming(&req, &cancel, |_| {}).await;

        match gen_res {
            Ok(output) => {
                if slot.worker.is_alive() {
                    let mut guard = self.chat.lock().await;
                    *guard = Some(slot);
                } else {
                    self.clear_loaded_meta(None);
                }
                let reply = if output.reply.is_empty() {
                    "Local model is ready!".to_string()
                } else {
                    output.reply
                };
                Ok((model_name, reply, output.duration_ms))
            }
            Err(err) => {
                if slot.worker.is_alive() {
                    let mut guard = self.chat.lock().await;
                    *guard = Some(slot);
                    if let Ok(mut meta) = self.meta.write() {
                        meta.last_error = Some(err.clone());
                    }
                } else {
                    slot.worker.shutdown().await;
                    self.clear_loaded_meta(Some(err.clone()));
                }
                Err(err)
            }
        }
    }

    fn clear_loaded_meta(&self, last_error: Option<String>) {
        if let Ok(mut meta) = self.meta.write() {
            meta.loaded_model = None;
            meta.loaded_model_path = None;
            meta.context_length = None;
            if last_error.is_some() {
                meta.last_error = last_error;
            }
        }
    }
}

/// Pair flat `(user, bot)` chat history messages into `(user, assistant)` turns
/// expected by chat templates.
fn history_to_pairs(history: &[ChatMessage]) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let mut pending_user: Option<String> = None;

    for msg in history {
        let text = msg.text.trim();
        if text.is_empty() {
            continue;
        }
        if msg.sender == "user" {
            if let Some(prev) = pending_user.take() {
                pairs.push((prev, String::new()));
            }
            pending_user = Some(text.to_string());
        } else if let Some(user_msg) = pending_user.take() {
            pairs.push((user_msg, text.to_string()));
        }
    }
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairs_flat_chat_history_into_user_assistant_turns() {
        let history = vec![
            ChatMessage {
                sender: "user".into(),
                text: "Hello".into(),
            },
            ChatMessage {
                sender: "bot".into(),
                text: "Hi there!".into(),
            },
            ChatMessage {
                sender: "user".into(),
                text: "What is 2+2?".into(),
            },
            ChatMessage {
                sender: "bot".into(),
                text: "4".into(),
            },
        ];
        let pairs = history_to_pairs(&history);
        assert_eq!(
            pairs,
            vec![
                ("Hello".to_string(), "Hi there!".to_string()),
                ("What is 2+2?".to_string(), "4".to_string()),
            ]
        );
    }

    #[test]
    fn platform_summary_reports_os_arch_and_threads() {
        let summary = platform_summary();
        assert!(summary.contains(std::env::consts::OS));
        assert!(summary.contains(std::env::consts::ARCH));
        assert!(summary.contains("threads"));
    }
}
