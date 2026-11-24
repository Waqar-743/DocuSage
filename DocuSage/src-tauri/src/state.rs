use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, RwLock};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::services::ai_client::AiHttpClient;
use crate::services::document_pipeline::DocumentCache;
use crate::services::embedding::EmbeddingConfig;
use crate::services::local_runtime::LocalRuntimeManager;

/// RAG & Smart Context configuration, persisted in `app_config_dir/rag-config.json`.
/// Backwards-compatible with v1 `rag-config.json` files via `#[serde(default)]`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct RagConfig {
    /// Target chunk size in estimated tokens (default 500; also accepts legacy char sizes smoothly).
    pub chunk_size: usize,
    /// Overlap between adjacent chunks in estimated tokens (default 80).
    pub chunk_overlap: usize,
    /// Maximum retrieved chunks per query (default 8).
    pub top_k: usize,
    /// Whether to append retrieved context directly to replies (legacy toggle, still respected).
    pub show_context: bool,
    /// Total character threshold under which attached documents are injected verbatim (`Full` mode).
    pub full_context_threshold: usize,
    /// Maximum token budget for RAG excerpts (default 4000).
    pub token_budget: usize,
    /// Power-user toggle: force Hybrid/FTS5 RAG even on small documents to save tokens.
    pub force_rag_always: bool,
    /// Embedding backend configuration (auto, none, localLlama, ollama, gemini, openAiCompatible).
    pub embedding: EmbeddingConfig,
}

impl Default for RagConfig {
    fn default() -> Self {
        Self {
            chunk_size: 500,
            chunk_overlap: 80,
            top_k: 8,
            show_context: false,
            full_context_threshold: 12_000,
            token_budget: 4_000,
            force_rag_always: false,
            embedding: EmbeddingConfig::default(),
        }
    }
}

impl RagConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !(100..=4000).contains(&self.chunk_size) {
            return Err("Chunk size must be between 100 and 4000.".into());
        }
        if self.chunk_overlap >= self.chunk_size {
            return Err("Overlap must be smaller than the chunk size.".into());
        }
        if !(1..=30).contains(&self.top_k) {
            return Err("Top-K must be between 1 and 30.".into());
        }
        if !(500..=32_000).contains(&self.token_budget) {
            return Err("Token budget must be between 500 and 32,000.".into());
        }
        if !(1_000..=100_000).contains(&self.full_context_threshold) {
            return Err("Full context threshold must be between 1,000 and 100,000 characters.".into());
        }
        Ok(())
    }
}

/// Global application state shared across all Tauri commands.
pub struct AppState {
    /// Resolved directory that contains user GGUF model files.
    pub model_path: RwLock<PathBuf>,
    /// Filename of the currently connected GGUF model (or `None`).
    pub connected_model_file: RwLock<Option<String>>,
    /// Active streaming requests keyed by `request_id` → `CancellationToken`.
    /// Supports concurrent streams (e.g. Model Compare) and instant cancellation.
    pub active_requests: Mutex<HashMap<String, CancellationToken>>,
    /// Active GGUF model downloads keyed by `filename` → `CancellationToken`.
    pub active_downloads: Mutex<HashMap<String, CancellationToken>>,
    /// Live RAG + Smart Context configuration.
    pub rag_config: RwLock<RagConfig>,
    /// In-memory text cache keyed by file path `(mtime, len, Arc<String>)`.
    pub doc_cache: DocumentCache,
    /// Shared HTTP client pool (warm connections, separate stream vs API timeouts).
    pub http: AiHttpClient,
    /// Managed on-demand `llama-server` local runtime sidecar.
    pub local_runtime: LocalRuntimeManager,
}

impl AppState {
    pub fn new(model_path: PathBuf) -> Self {
        Self {
            model_path: RwLock::new(model_path),
            connected_model_file: RwLock::new(None),
            active_requests: Mutex::new(HashMap::new()),
            active_downloads: Mutex::new(HashMap::new()),
            rag_config: RwLock::new(RagConfig::default()),
            doc_cache: DocumentCache::new(),
            http: AiHttpClient::new(),
            local_runtime: LocalRuntimeManager::new(),
        }
    }

    /// Register a new in-flight request and return a RAII guard + `CancellationToken`.
    pub fn register_request(&self, request_id: &str) -> Result<RequestHandle<'_>, String> {
        let mut map = self
            .active_requests
            .lock()
            .map_err(|e| format!("Active requests lock poisoned: {e}"))?;
        if map.contains_key(request_id) {
            return Err("A request with this ID is already running.".into());
        }
        let token = CancellationToken::new();
        map.insert(request_id.to_string(), token.clone());
        Ok(RequestHandle {
            state: self,
            request_id: request_id.to_string(),
            token,
        })
    }

    /// Cancel a specific request ID, or all running requests if `request_id` is empty.
    pub fn cancel_request(&self, request_id: &str) -> Result<bool, String> {
        let map = self
            .active_requests
            .lock()
            .map_err(|e| format!("Active requests lock poisoned: {e}"))?;
        if request_id.is_empty() {
            for tok in map.values() {
                tok.cancel();
            }
            return Ok(!map.is_empty());
        }
        if let Some(tok) = map.get(request_id) {
            tok.cancel();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Cancel every in-flight request (used on restart / shutdown).
    pub fn cancel_all_requests(&self) {
        if let Ok(map) = self.active_requests.lock() {
            for tok in map.values() {
                tok.cancel();
            }
        }
        if let Ok(map) = self.active_downloads.lock() {
            for tok in map.values() {
                tok.cancel();
            }
        }
    }

    pub fn register_download(&self, filename: &str) -> Result<DownloadHandle<'_>, String> {
        let mut map = self
            .active_downloads
            .lock()
            .map_err(|e| format!("Active downloads lock poisoned: {e}"))?;
        if map.contains_key(filename) {
            return Err("This model is already downloading.".into());
        }
        let token = CancellationToken::new();
        map.insert(filename.to_string(), token.clone());
        Ok(DownloadHandle {
            state: self,
            filename: filename.to_string(),
            token,
        })
    }

    pub fn cancel_download(&self, filename: &str) -> Result<bool, String> {
        let map = self
            .active_downloads
            .lock()
            .map_err(|e| format!("Active downloads lock poisoned: {e}"))?;
        if let Some(tok) = map.get(filename) {
            tok.cancel();
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

pub struct DownloadHandle<'a> {
    state: &'a AppState,
    filename: String,
    pub token: CancellationToken,
}

impl Drop for DownloadHandle<'_> {
    fn drop(&mut self) {
        if let Ok(mut map) = self.state.active_downloads.lock() {
            map.remove(&self.filename);
        }
    }
}

pub struct RequestHandle<'a> {
    state: &'a AppState,
    request_id: String,
    pub token: CancellationToken,
}

impl Drop for RequestHandle<'_> {
    fn drop(&mut self) {
        if let Ok(mut map) = self.state.active_requests.lock() {
            map.remove(&self.request_id);
        }
    }
}
