mod commands;
pub mod rag;

use std::path::PathBuf;
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
/// - `chat_history` → `Mutex` — mutated on every chat turn; exclusive access
///   prevents interleaving.
pub struct AppState {
    /// Resolved directory that contains GGUF model files.
    pub model_path: RwLock<PathBuf>,
    /// The loaded LLM model, or `None` if not yet loaded.
    pub model: tokio::sync::Mutex<Option<Model>>,
    /// Rolling conversation context (alternating "user: …" / "assistant: …").
    pub chat_history: Mutex<Vec<String>>,
}

/// Resolve the model directory using the following precedence:
///
/// 1. `MODEL_PATH` environment variable (ideal for Codespace / CI).
/// 2. `<OS Documents folder>/DocuSage/models` via the `dirs` crate.
/// 3. Current working directory as a last-resort fallback.
fn resolve_model_path() -> PathBuf {
    // 1. Environment variable (loaded from .env by dotenv earlier).
    if let Ok(env_path) = std::env::var("MODEL_PATH") {
        if !env_path.is_empty() {
            return PathBuf::from(env_path);
        }
    }

    // 2. OS Documents directory — works cross-platform (Win/Mac/Linux).
    if let Some(doc_dir) = dirs::document_dir() {
        return doc_dir.join("DocuSage").join("models");
    }

    // 3. Fallback: current working directory.
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env file *before* anything else reads env vars.
    // `.ok()` intentionally ignores a missing file — it is optional.
    dotenv::dotenv().ok();

    let app_state = AppState {
        model_path: RwLock::new(resolve_model_path()),
        model: tokio::sync::Mutex::new(None),
        chat_history: Mutex::new(Vec::new()),
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
            commands::ingest_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
