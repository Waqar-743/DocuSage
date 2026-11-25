// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Isolated local inference worker mode: runs before Tauri / single-instance
    // initialization so native llama.cpp crashes can never terminate the desktop UI.
    if args.iter().any(|a| a == docusage_lib::services::local_worker::WORKER_ARG) {
        let code = docusage_lib::services::local_worker::run_worker_from_env();
        std::process::exit(code);
    }

    // End-to-end CLI self-test mode for verifying real GGUF loading & generation
    // through the exact supervised worker path used by DocuSage.
    if let Some(pos) = args
        .iter()
        .position(|a| a == docusage_lib::services::local_worker::SELFTEST_ARG)
    {
        let Some(model_arg) = args.get(pos + 1) else {
            eprintln!("Usage: docusage --local-engine-selftest <path-to-model.gguf>");
            std::process::exit(2);
        };
        let code = docusage_lib::services::local_worker::run_selftest_cli(&PathBuf::from(model_arg));
        std::process::exit(code);
    }

    docusage_lib::run()
}
