mod commands;
pub mod rag;

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, RwLock};

use mistralrs::Model;

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
pub struct AppState {
    /// Resolved directory that contains GGUF model files.
    pub model_path: RwLock<PathBuf>,
    /// The loaded LLM model, or `None` if not yet loaded.
    pub model: tokio::sync::Mutex<Option<Model>>,
    /// Request id for the in-flight generation, if any.
    pub active_request_id: Mutex<Option<String>>,
    /// Cancellation flag toggled by the stop button.
    pub cancel_current_response: AtomicBool,
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
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::load_model,
            commands::chat_general,
            commands::chat_rag,
            commands::stop_chat,
            commands::ingest_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
