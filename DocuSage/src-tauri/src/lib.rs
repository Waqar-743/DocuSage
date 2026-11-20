pub mod assistant;
pub mod commands;
pub mod error;
pub mod providers;
pub mod services;
pub mod state;

use std::path::{Path, PathBuf};

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

pub use state::{AppState, RagConfig};

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

    // Backwards-compatible default folder: Documents/DocuSage/models
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
    dotenv::dotenv().ok();

    let app_state = AppState::new(resolve_model_path());

    let app = tauri::Builder::default()
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(app_state)
        .setup(|app| {
            let models = app.path().app_data_dir()?.join("models");
            if let Ok(entries) = std::fs::read_dir(&models) {
                for entry in entries.flatten() {
                    if entry
                        .file_name()
                        .to_string_lossy()
                        .to_lowercase()
                        .ends_with(".gguf.part")
                        && entry.file_type().is_ok_and(|kind| kind.is_file())
                    {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
            if path_has_gguf(&models)
                && !path_has_gguf(
                    &app.state::<AppState>()
                        .model_path
                        .read()
                        .map_err(|e| e.to_string())?,
                )
            {
                *app.state::<AppState>()
                    .model_path
                    .write()
                    .map_err(|e| e.to_string())? = models;
            }
            let path = app.path().app_config_dir()?.join("rag-config.json");
            if let Some(config) = std::fs::read_to_string(path)
                .ok()
                .and_then(|raw| serde_json::from_str::<RagConfig>(&raw).ok())
                .filter(|config| config.validate().is_ok())
            {
                *app.state::<AppState>()
                    .rag_config
                    .write()
                    .map_err(|e| e.to_string())? = config;
            }
            assistant::setup(app)
        })
        .on_window_event(assistant::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            assistant::get_assistant_status,
            assistant::save_assistant_settings,
            assistant::set_assistant_pinned,
            assistant::set_assistant_focus_guard,
            assistant::set_autostart_enabled,
            assistant::read_clipboard_text,
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
            providers::fetch_ai_provider_models,
            commands::chat_send,
            commands::chat_general,
            commands::chat_rag,
            commands::chat_cloud,
            commands::chat_cloud_rag,
            commands::stop_chat,
            commands::get_allowed_extensions,
            commands::ingest_document,
            commands::delete_document,
            commands::list_indexed_documents,
            commands::get_local_runtime_status,
            commands::install_local_runtime,
            commands::load_model,
            commands::connect_model,
            commands::connect_embedding_model,
            commands::disconnect_model,
            commands::restart_ai_engine,
            commands::download_model,
            commands::list_downloaded_models,
            commands::delete_model,
            commands::get_models_dir,
            commands::get_connected_model,
            commands::get_rag_config,
            commands::save_rag_config,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = app_handle.state::<AppState>();
            state.cancel_all_requests();
            tauri::async_runtime::block_on(state.local_runtime.stop_all());
        }
    });
}
