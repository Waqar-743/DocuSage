//! Built-in in-process `llama.cpp` runtime manager (Neurix architecture).
//!
//! Runs GGUF models directly inside the DocuSage process via `llama-cpp-2` —
//! no external `llama-server.exe` download, no localhost sidecar ports, and no
//! Windows Vulkan DLL `0xc0000005` startup crashes.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::services::ai_client::{ChatMessage, ChatTokenPayload};
use crate::services::device;
use crate::services::local_engine::{self, GenerationRequest, LoadOptions, LoadedModel};

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
    pub recommended_threads: u32,
    pub context_length: Option<usize>,
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
    model: LoadedModel,
    model_path: PathBuf,
    model_name: String,
}

#[derive(Clone, Default)]
pub struct LocalRuntimeManager {
    chat: Arc<Mutex<Option<LoadedSlot>>>,
}

pub fn detect_hardware_backend() -> String {
    "built-in".to_string()
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

    pub async fn status(&self, _app: &AppHandle) -> LocalRuntimeStatus {
        let guard = self.chat.lock().await;
        let (running, loaded_model, loaded_model_path, context_length) = match &*guard {
            Some(slot) => (
                true,
                Some(slot.model_name.clone()),
                Some(slot.model_path.to_string_lossy().into_owned()),
                Some(slot.model.context_length),
            ),
            None => (false, None, None, None),
        };

        LocalRuntimeStatus {
            installed: true,
            binary_path: Some("built-in (llama.cpp)".to_string()),
            running,
            port: None,
            base_url: None,
            loaded_model,
            loaded_model_path,
            embedding_running: false,
            embedding_port: None,
            embedding_model: None,
            detected_backend: detect_hardware_backend(),
            platform_summary: platform_summary(),
            version: Some("llama.cpp (built-in)".to_string()),
            total_memory_bytes: device::total_memory_bytes(),
            recommended_threads: device::inference_threads(),
            context_length,
        }
    }

    pub async fn is_chat_loaded(&self) -> bool {
        self.chat.lock().await.is_some()
    }

    pub async fn chat_base_url(&self) -> Option<String> {
        None
    }

    pub async fn embedding_base_url(&self) -> Option<(String, String)> {
        None
    }

    /// The llama.cpp runtime is compiled directly into DocuSage, so this simply
    /// confirms readiness immediately without downloading any external binary.
    pub async fn install_runtime(
        &self,
        app: &AppHandle,
        _preferred_backend: Option<String>,
    ) -> Result<LocalRuntimeStatus, String> {
        let _ = app.emit(
            "runtime-download-progress",
            RuntimeDownloadProgress {
                stage: "ready".into(),
                asset_name: "built-in llama.cpp".into(),
                downloaded: 1,
                total: 1,
                percent: 100.0,
                done: true,
                error: None,
            },
        );
        Ok(self.status(app).await)
    }

    /// Load a `.gguf` chat model directly into memory via `llama-cpp-2`.
    pub async fn start_chat_model(
        &self,
        app: &AppHandle,
        gguf_path: &Path,
        ctx_size: Option<u32>,
    ) -> Result<LocalRuntimeStatus, String> {
        if !gguf_path.is_file() {
            return Err(format!("Model file not found: {}", gguf_path.display()));
        }

        let model_name = gguf_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "local-model.gguf".into());

        // Free any previously loaded model before allocating the new one so peak RAM stays bounded.
        self.stop_chat().await;

        let path_owned = gguf_path.to_path_buf();
        let name_owned = model_name.clone();
        let mut options = LoadOptions::default();
        if let Some(ctx) = ctx_size {
            options.context_length = ctx;
        }

        let loaded = tokio::task::spawn_blocking(move || {
            local_engine::load_model_from_disk(&name_owned, &path_owned, options)
        })
        .await
        .map_err(|e| format!("Local model loader task failed: {e}"))??;

        {
            let mut guard = self.chat.lock().await;
            *guard = Some(LoadedSlot {
                model: loaded,
                model_path: gguf_path.to_path_buf(),
                model_name,
            });
        }

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

    pub async fn stop_chat(&self) {
        let old = {
            let mut guard = self.chat.lock().await;
            guard.take()
        };
        if let Some(slot) = old {
            let _ = tokio::task::spawn_blocking(move || drop(slot)).await;
        }
    }

    pub async fn stop_all(&self) {
        self.stop_chat().await;
    }

    /// Stream a chat completion directly from the in-process loaded GGUF model.
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

        // Take the slot out of the mutex while generating so we don't block status checks,
        // then return it cleanly when generation completes.
        let mut slot = {
            let mut guard = self.chat.lock().await;
            guard.take().ok_or_else(|| {
                "No local GGUF model is loaded yet. Download or load a model in Settings -> Local AI & GGUF."
                    .to_string()
            })?
        };

        let app_clone = app.clone();
        let req_id_owned = request_id.to_string();
        let cancel_clone = cancel_token.clone();

        let join_res = tokio::task::spawn_blocking(move || {
            let res = slot.model.generate_streaming(&req, &cancel_clone, |tok| {
                let _ = app_clone.emit(
                    "chat-token",
                    ChatTokenPayload {
                        request_id: req_id_owned.clone(),
                        token: tok.to_string(),
                        done: false,
                    },
                );
            });
            (slot, res)
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

        let (slot, gen_res) =
            join_res.map_err(|e| format!("Local inference task failed: {e}"))?;

        {
            let mut guard = self.chat.lock().await;
            if guard.is_none() {
                *guard = Some(slot);
            }
        }

        let output = gen_res?;
        Ok((output.reply, output.stopped))
    }

    /// Run a fast live inference smoke test against the currently loaded local GGUF model.
    pub async fn quick_test_chat(&self) -> Result<(String, String, u64), String> {
        let mut slot = {
            let mut guard = self.chat.lock().await;
            guard
                .take()
                .ok_or_else(|| "No local GGUF model is currently loaded.".to_string())?
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

        let join_res = tokio::task::spawn_blocking(move || {
            let res = slot.model.generate_streaming(&req, &cancel, |_| {});
            (slot, res)
        })
        .await;

        let (slot, gen_res) =
            join_res.map_err(|e| format!("Local model test task failed: {e}"))?;
        {
            let mut guard = self.chat.lock().await;
            if guard.is_none() {
                *guard = Some(slot);
            }
        }

        let output = gen_res?;
        let reply = if output.reply.is_empty() {
            "Local model is ready!".to_string()
        } else {
            output.reply
        };
        Ok((model_name, reply, output.duration_ms))
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
