mod commands;
mod assistant;
mod providers;
pub mod rag;

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, RwLock};

use mistralrs::Model;

/// RAG pipeline tuning parameters, editable at runtime from the Settings UI.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct RagConfig {
    pub chunk_size: usize,
    pub chunk_overlap: usize,
    pub top_k: usize,
    pub show_context: bool,
}

impl RagConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !(200..=2000).contains(&self.chunk_size) {
            return Err("Chunk size must be between 200 and 2000 characters.".into());
        }
        if self.chunk_overlap >= self.chunk_size {
            return Err("Overlap must be smaller than the chunk size.".into());
        }
        if !(1..=20).contains(&self.top_k) {
            return Err("Top-K must be between 1 and 20.".into());
        }
        Ok(())
    }
}

impl Default for RagConfig {
    fn default() -> Self {
        RagConfig {
            chunk_size: 900,
            chunk_overlap: 150,
            top_k: 8,
            show_context: false,
        }
    }
}

/// Global application state shared across all Tauri commands.
///
/// ## Locking strategy
/// - `model_path` → `RwLock` — written once (init / `load_model`), read by
///   every chat request. `RwLock` allows concurrent readers.
/// - `model`      → `tokio::sync::Mutex` — holds the loaded LLM. Uses the
///   async Mutex because `send_chat_request` is async and the guard may
///   be held across await points.
/// - `active_request_id` → `Mutex` — tracks which response can currently be
///   cancelled from the UI.
/// - `cancel_current_response` → `AtomicBool` — low-cost cancellation flag
///   checked between streamed model chunks.
/// - `rag_config` → `RwLock` — RAG pipeline parameters, updated from the UI.
/// - `connected_model_file` → `RwLock` — filename of the currently loaded
///   GGUF model, or `None` if no model is loaded.
pub struct AppState {
    /// Resolved directory that contains GGUF model files.
    pub model_path: RwLock<PathBuf>,
    /// The loaded LLM model, or `None` if not yet loaded.
    pub model: tokio::sync::Mutex<Option<Model>>,
    /// Request id for the in-flight generation, if any.
    pub active_request_id: Mutex<Option<String>>,
    /// Cancellation flag toggled by the stop button.
    pub cancel_current_response: AtomicBool,
    /// Live RAG configuration, updated from the Settings UI.
    pub rag_config: RwLock<RagConfig>,
    /// Filename of the currently connected GGUF model (just the filename, not the full path).
    pub connected_model_file: RwLock<Option<String>>,
}

fn normalize_env_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim().trim_matches('"');
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

pub(crate) fn path_has_gguf(path: &Path) -> bool {
    std::fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| {
            entry
                .path()
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("gguf"))
        })
}

fn model_path_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    for key in ["MODEL_PATH", "DOCUSAGE_MODEL_PATH"] {
        if let Ok(value) = std::env::var(key) {
            if let Some(path) = normalize_env_path(&value) {
                candidates.push(path);
            }
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("models"));
            candidates.push(exe_dir.join("DocuSage").join("models"));
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("models"));
        candidates.push(current_dir.join("DocuSage").join("models"));
    }

    if let Some(doc_dir) = dirs::document_dir() {
        candidates.push(doc_dir.join("DocuSage").join("models"));
    }

    #[cfg(target_os = "windows")]
    {
        for drive in ['D', 'E', 'C'] {
            candidates.push(PathBuf::from(format!("{drive}:\\DocuSage\\models")));
        }
    }

    candidates
}

/// Resolve the model directory using the following precedence:
///
/// 1. Environment variables such as `MODEL_PATH`.
/// 2. Common application-relative locations.
/// 3. OS-specific conventional folders.
/// 4. Windows drive-root fallbacks such as `D:\DocuSage\models`.
/// 5. Current working directory as a last-resort fallback.
pub(crate) fn resolve_model_path() -> PathBuf {
    let candidates = model_path_candidates();

    if let Some(path) = candidates
        .iter()
        .find(|path| path.is_dir() && path_has_gguf(path))
        .cloned()
    {
        return path;
    }

    if let Some(path) = candidates.iter().find(|path| path.is_dir()).cloned() {
        return path;
    }

    candidates
        .into_iter()
        .next()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env file *before* anything else reads env vars.
    // `.ok()` intentionally ignores a missing file — it is optional.
    dotenv::dotenv().ok();

    // Optimise CPU threading for inference: use all logical cores minus one
    // (reserving one for the UI / OS).  This is picked up by rayon (used by
    // candle-core inside mistral.rs) and by the ONNX runtime (fastembed).
    // Only set if the user hasn't already specified a value.
    if std::env::var("RAYON_NUM_THREADS").is_err() {
        let n = std::thread::available_parallelism()
            .map(|p| p.get().saturating_sub(1).max(1))
            .unwrap_or(1);
        // SAFETY: called before any threads are spawned so there is no
        // data-race concern.  In edition 2024 set_var is `unsafe fn`.
        #[allow(unused_unsafe)]
        unsafe { std::env::set_var("RAYON_NUM_THREADS", n.to_string()) };
    }

    let app_state = AppState {
        model_path: RwLock::new(resolve_model_path()),
        model: tokio::sync::Mutex::new(None),
        active_request_id: Mutex::new(None),
        cancel_current_response: AtomicBool::new(false),
        rag_config: RwLock::new(RagConfig::default()),
        connected_model_file: RwLock::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = assistant::show_assistant(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = assistant::toggle_assistant(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .setup(|app| {
            use tauri::Manager;
            let models = app.path().app_data_dir()?.join("models");
            // A forced process exit cannot run the download cleanup guard.
            // Single-instance setup has already ensured no other downloader
            // owns these app-created partials, so retries can start normally.
            if let Ok(entries) = std::fs::read_dir(&models) {
                for entry in entries.flatten() {
                    if entry.file_name().to_string_lossy().to_lowercase().ends_with(".gguf.part")
                        && entry.file_type().is_ok_and(|kind| kind.is_file())
                    {
                        if let Err(error) = std::fs::remove_file(entry.path()) {
                            eprintln!("Cannot clean interrupted model download: {error}");
                        }
                    }
                }
            }
            if path_has_gguf(&models) && !path_has_gguf(&app.state::<AppState>().model_path.read().map_err(|e| e.to_string())?) {
                *app.state::<AppState>().model_path.write().map_err(|e| e.to_string())? = models;
            }
            let path = app.path().app_config_dir()?.join("rag-config.json");
            if let Some(config) = std::fs::read_to_string(path).ok()
                .and_then(|raw| serde_json::from_str::<RagConfig>(&raw).ok())
                .filter(|config| config.validate().is_ok())
            {
                *app.state::<AppState>().rag_config.write().map_err(|e| e.to_string())? = config;
            }
            assistant::setup(app)
        })
        .on_window_event(assistant::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            assistant::get_assistant_status,
            assistant::save_assistant_settings,
            assistant::show_assistant_window,
            assistant::hide_assistant_window,
            assistant::toggle_assistant_window,
            assistant::set_assistant_window_mode,
            assistant::cycle_assistant_window_mode,
            assistant::check_for_updates,
            providers::list_ai_provider_configs,
            providers::save_ai_provider_config,
            providers::delete_ai_provider_config,
            providers::set_active_ai_provider,
            providers::test_ai_provider_connection,
            providers::chat_cloud,
            providers::chat_cloud_rag,
            commands::load_model,
            commands::chat_general,
            commands::chat_rag,
            commands::stop_chat,
            commands::ingest_document,
            commands::delete_document,
            commands::list_indexed_documents,
            commands::download_model,
            commands::list_downloaded_models,
            commands::connect_model,
            commands::disconnect_model,
            commands::restart_ai_engine,
            commands::delete_model,
            commands::get_models_dir,
            commands::get_connected_model,
            commands::get_rag_config,
            commands::save_rag_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
