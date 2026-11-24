//! Thin Tauri command handlers delegating to modular backend services.

use std::path::PathBuf;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::providers::{api_key_for, resolve_provider, AiProviderKind};
use crate::services::ai_client::{stream_chat_completion, ChatMessage};
use crate::services::context_engine::{
    context_appendix, prepare_context, resolve_vector_db_path, ContextTelemetry,
};
use crate::services::document_pipeline::{
    canonical_source, chunk_text_tokens, estimate_tokens, read_document_text_cached,
    ALLOWED_EXTENSIONS,
};
use crate::services::embedding::embed_texts;
use crate::services::local_runtime::LocalRuntimeStatus;
use crate::services::vector_store::{ChunkInput, IndexedDocument, VectorStore};
use crate::state::{AppState, RagConfig};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressPayload {
    filename: String,
    downloaded: u64,
    total: u64,
    percent: f32,
    speed_bps: u64,
    eta_secs: Option<u64>,
    stage: String,
    done: bool,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedModel {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelTestResult {
    pub ok: bool,
    pub message: String,
    pub reply: Option<String>,
    pub duration_ms: Option<u64>,
    pub model: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResult {
    pub file_name: String,
    pub chunk_count: usize,
    pub char_count: usize,
    pub source_path: String,
    pub has_embeddings: bool,
    pub embedding_model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendRequest {
    pub prompt: String,
    pub history: Vec<ChatMessage>,
    pub request_id: String,
    #[serde(default)]
    pub attached_paths: Vec<String>,
    pub provider_id: Option<String>,
    pub model_override: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendResponse {
    pub reply: String,
    pub stopped: bool,
    pub telemetry: ContextTelemetry,
}

fn vector_store_for(app: &tauri::AppHandle) -> Result<VectorStore, String> {
    let path = resolve_vector_db_path(app.path().app_data_dir().ok())?;
    Ok(VectorStore::new(path))
}

/// Unified Smart Context streaming chat command supporting ALL providers (Built-in Local GGUF,
/// Ollama, LM Studio, Gemini, OpenAI, Anthropic, OpenRouter, Custom OpenAI-compatible)
/// and concurrent Model Compare streams.
#[tauri::command]
pub async fn chat_send(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    req: ChatSendRequest,
) -> Result<ChatSendResponse, String> {
    let handle = state.register_request(&req.request_id)?;
    let provider = resolve_provider(&app, req.provider_id.as_deref())?;
    let api_key = api_key_for(&provider)?;

    let is_local = provider.provider == AiProviderKind::Local;
    if is_local && !state.local_runtime.is_chat_loaded().await {
        // Zero-config auto-start: automatically load a downloaded GGUF model in-process.
        load_model(app.clone(), state.clone(), None).await?;
    }

    let rag_cfg = state
        .rag_config
        .read()
        .map_err(|e| format!("rag_config lock: {e}"))?
        .clone();

    let store = vector_store_for(&app)?;

    // Attempt query embedding only when documents are attached and we may run vector search.
    let (query_vec, embed_model) = if !req.attached_paths.is_empty() {
        let local_embed = state.local_runtime.embedding_base_url().await;
        let query_list = vec![req.prompt.clone()];
        if let Some(res) = embed_texts(
            &state.http,
            &rag_cfg.embedding,
            &query_list,
            local_embed,
            Some(&provider),
            Some(&api_key),
        )
        .await
        {
            (res.vectors.into_iter().next(), Some(res.model_id))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    let prepared = prepare_context(
        &req.request_id,
        &req.prompt,
        &req.attached_paths,
        &rag_cfg,
        &state.doc_cache,
        &store,
        query_vec.as_deref(),
        embed_model.as_deref(),
    )
    .await;

    // Emit live context telemetry immediately so the UI badge updates before the first token arrives.
    let _ = app.emit("chat-context", &prepared.telemetry);

    let grounded = !req.attached_paths.is_empty();
    let (mut reply, stopped) = if is_local {
        state
            .local_runtime
            .stream_chat(
                &app,
                &prepared.system_prompt,
                &req.history,
                &req.prompt,
                &req.request_id,
                provider.temperature,
                grounded,
                handle.token.clone(),
            )
            .await?
    } else {
        stream_chat_completion(
            &app,
            &state.http,
            &provider,
            &api_key,
            None,
            req.model_override.as_deref(),
            &prepared.system_prompt,
            &req.history,
            &req.prompt,
            &req.request_id,
            grounded,
            handle.token.clone(),
        )
        .await?
    };

    if reply.is_empty() {
        reply = if stopped {
            "Generation stopped.".to_string()
        } else {
            "No response generated.".to_string()
        };
    } else if rag_cfg.show_context && !stopped && !prepared.retrieved_chunks.is_empty() {
        reply.push_str(&context_appendix(&prepared.retrieved_chunks));
    }

    Ok(ChatSendResponse {
        reply,
        stopped,
        telemetry: prepared.telemetry,
    })
}

// Backwards-compatible aliases for legacy callers/scripts.
#[tauri::command]
pub async fn chat_general(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    prompt: String,
    history: Vec<ChatMessage>,
    request_id: String,
) -> Result<String, String> {
    let res = chat_send(
        app,
        state,
        ChatSendRequest {
            prompt,
            history,
            request_id,
            attached_paths: Vec::new(),
            provider_id: Some("local".into()),
            model_override: None,
        },
    )
    .await?;
    Ok(res.reply)
}

#[tauri::command]
pub async fn chat_rag(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    prompt: String,
    history: Vec<ChatMessage>,
    request_id: String,
    source_path: String,
) -> Result<String, String> {
    let res = chat_send(
        app,
        state,
        ChatSendRequest {
            prompt,
            history,
            request_id,
            attached_paths: vec![source_path],
            provider_id: Some("local".into()),
            model_override: None,
        },
    )
    .await?;
    Ok(res.reply)
}

#[tauri::command]
pub async fn chat_cloud(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    prompt: String,
    history: Vec<ChatMessage>,
    request_id: String,
) -> Result<String, String> {
    let res = chat_send(
        app,
        state,
        ChatSendRequest {
            prompt,
            history,
            request_id,
            attached_paths: Vec::new(),
            provider_id: None,
            model_override: None,
        },
    )
    .await?;
    Ok(res.reply)
}

#[tauri::command]
pub async fn chat_cloud_rag(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    prompt: String,
    history: Vec<ChatMessage>,
    request_id: String,
    source_path: String,
) -> Result<String, String> {
    let res = chat_send(
        app,
        state,
        ChatSendRequest {
            prompt,
            history,
            request_id,
            attached_paths: vec![source_path],
            provider_id: None,
            model_override: None,
        },
    )
    .await?;
    Ok(res.reply)
}

#[tauri::command]
pub fn stop_chat(state: tauri::State<'_, AppState>, request_id: String) -> Result<(), String> {
    let _ = state.cancel_request(&request_id)?;
    Ok(())
}

#[tauri::command]
pub fn get_allowed_extensions() -> Vec<String> {
    ALLOWED_EXTENSIONS.iter().map(|s| (*s).to_string()).collect()
}

/// Multi-format document ingestion: validate -> cached spawn_blocking extract ->
/// sentence/token-aware chunk -> optional pluggable embeddings -> SQLite FTS5 + Vector upsert.
#[tauri::command]
pub async fn ingest_document(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<IngestResult, String> {
    let (canonical, text_arc) = read_document_text_cached(&state.doc_cache, &file_path).await?;
    let trimmed_len = text_arc.trim().len();
    if trimmed_len == 0 {
        return Err(format!(
            "Extraction failed: 0 readable characters found in {}. If this is a scanned PDF, run OCR first.",
            canonical.display()
        ));
    }

    let char_count = text_arc.chars().count();
    let source_path = canonical.to_string_lossy().into_owned();
    let file_name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| source_path.clone());

    let rag_cfg = state
        .rag_config
        .read()
        .map_err(|e| format!("rag_config lock: {e}"))?
        .clone();

    let text_for_chunking = text_arc.clone();
    let (chunk_size, chunk_overlap) = (rag_cfg.chunk_size, rag_cfg.chunk_overlap);
    let raw_chunks = tokio::task::spawn_blocking(move || {
        chunk_text_tokens(&text_for_chunking, chunk_size, chunk_overlap)
    })
    .await
    .map_err(|e| format!("Chunking task failed: {e}"))?;

    if raw_chunks.is_empty() {
        return Err("Chunking produced zero chunks.".into());
    }

    // Try pluggable embeddings (local llama-server / Ollama / Gemini / OpenAI).
    // If unavailable or offline, seamlessly store FTS5-only chunks with zero error!
    let active_provider = resolve_provider(&app, None).ok();
    let active_key = active_provider
        .as_ref()
        .and_then(|p| api_key_for(p).ok());
    let local_embed = state.local_runtime.embedding_base_url().await;

    let embed_result = embed_texts(
        &state.http,
        &rag_cfg.embedding,
        &raw_chunks,
        local_embed,
        active_provider.as_ref(),
        active_key.as_deref(),
    )
    .await;

    let (embedding_model, vectors): (Option<String>, Option<Vec<Vec<f32>>>) = match embed_result {
        Some(res) => (Some(res.model_id), Some(res.vectors)),
        None => (None, None),
    };
    let has_embeddings = vectors.is_some();

    let chunk_inputs: Vec<ChunkInput> = raw_chunks
        .into_iter()
        .enumerate()
        .map(|(idx, content)| {
            let token_count = estimate_tokens(&content).max(1);
            let embedding = vectors
                .as_ref()
                .and_then(|v| v.get(idx))
                .cloned();
            ChunkInput {
                content,
                chunk_index: idx,
                token_count,
                embedding,
            }
        })
        .collect();
    let chunk_count = chunk_inputs.len();

    let store = vector_store_for(&app)?;
    let src_clone = source_path.clone();
    let name_clone = file_name.clone();
    let emb_clone = embedding_model.clone();
    tokio::task::spawn_blocking(move || {
        store.upsert_document(
            &src_clone,
            &name_clone,
            char_count,
            emb_clone.as_deref(),
            &chunk_inputs,
        )
    })
    .await
    .map_err(|e| format!("Database write task failed: {e}"))??;

    Ok(IngestResult {
        file_name,
        chunk_count,
        char_count,
        source_path,
        has_embeddings,
        embedding_model,
    })
}

#[tauri::command]
pub async fn delete_document(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<(), String> {
    let canonical = canonical_source(&file_path);
    state.doc_cache.invalidate(std::path::Path::new(&canonical));
    let store = vector_store_for(&app)?;
    tokio::task::spawn_blocking(move || store.delete_document(&canonical))
        .await
        .map_err(|e| format!("Delete document task failed: {e}"))?
}

#[tauri::command]
pub async fn list_indexed_documents(
    app: tauri::AppHandle,
) -> Result<Vec<IndexedDocument>, String> {
    let store = vector_store_for(&app)?;
    tokio::task::spawn_blocking(move || store.list_documents())
        .await
        .map_err(|e| format!("List documents task failed: {e}"))?
}

// ─────────────────────────────────────────────────────────────────────────────
// On-demand Local Runtime (`llama-server`) & GGUF Model Management
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_local_runtime_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<LocalRuntimeStatus, String> {
    Ok(state.local_runtime.status(&app).await)
}

#[tauri::command]
pub async fn install_local_runtime(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    preferred_backend: Option<String>,
) -> Result<LocalRuntimeStatus, String> {
    state
        .local_runtime
        .install_runtime(&app, preferred_backend)
        .await
}

#[tauri::command]
pub async fn load_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    path: Option<String>,
) -> Result<String, String> {
    let mut gguf_files: Vec<PathBuf> = Vec::new();
    let mut dirs_to_scan: Vec<PathBuf> = Vec::new();

    if let Some(ref p) = path {
        let new_path = PathBuf::from(p);
        if new_path.is_file() {
            return connect_model(app, state, new_path.to_string_lossy().into_owned()).await;
        }
        *state
            .model_path
            .write()
            .map_err(|e| format!("model_path lock: {e}"))? = new_path.clone();
        dirs_to_scan.push(new_path);
    } else {
        // Automatically check managed app_data_dir/models first, then configured path & Documents.
        if let Ok(app_models) = app.path().app_data_dir().map(|d| d.join("models")) {
            dirs_to_scan.push(app_models);
        }
        let current = state
            .model_path
            .read()
            .map_err(|e| format!("model_path lock: {e}"))?
            .clone();
        if !dirs_to_scan.contains(&current) {
            dirs_to_scan.push(current);
        }
        if let Some(docs) = dirs::document_dir().map(|d| d.join("DocuSage").join("models")) {
            if !dirs_to_scan.contains(&docs) {
                dirs_to_scan.push(docs);
            }
        }
    }

    let mut seen = std::collections::HashSet::new();
    for dir in &dirs_to_scan {
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension()
                    .and_then(|x| x.to_str())
                    .is_some_and(|x| x.eq_ignore_ascii_case("gguf"))
                {
                    let name = p
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    if seen.insert(name) {
                        gguf_files.push(p);
                    }
                }
            }
        }
    }
    gguf_files.sort();

    let connected = state
        .connected_model_file
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    let target = connected
        .and_then(|name| {
            gguf_files
                .iter()
                .find(|p| p.file_name().and_then(|n| n.to_str()) == Some(name.as_str()))
                .cloned()
        })
        .or_else(|| {
            // Prefer a chat model over an embedding model when auto-selecting.
            gguf_files
                .iter()
                .find(|p| {
                    let lower = p
                        .file_name()
                        .map(|n| n.to_string_lossy().to_ascii_lowercase())
                        .unwrap_or_default();
                    !lower.contains("embed") && !lower.contains("bge-")
                })
                .cloned()
        })
        .or_else(|| gguf_files.into_iter().next())
        .ok_or_else(|| {
            "No downloaded GGUF models found yet. Download a model in Settings -> Local AI & GGUF."
                .to_string()
        })?;

    connect_model(app, state, target.to_string_lossy().into_owned()).await
}

#[tauri::command]
pub async fn connect_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<String, String> {
    let path = PathBuf::from(&file_path);
    if !path.is_file() {
        return Err(format!("Model file not found: {}", path.display()));
    }
    let status = state
        .local_runtime
        .start_chat_model(&app, &path, None)
        .await?;

    if let Some(parent) = path.parent() {
        if let Ok(mut mp) = state.model_path.write() {
            *mp = parent.to_path_buf();
        }
    }
    let filename = status
        .loaded_model
        .clone()
        .unwrap_or_else(|| path.file_name().unwrap().to_string_lossy().into_owned());
    if let Ok(mut cf) = state.connected_model_file.write() {
        *cf = Some(filename.clone());
    }
    Ok(format!("Connected to: {filename}"))
}

#[tauri::command]
pub async fn connect_embedding_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<LocalRuntimeStatus, String> {
    let path = PathBuf::from(&file_path);
    state
        .local_runtime
        .start_embedding_model(&app, &path)
        .await
}

#[tauri::command]
pub async fn disconnect_model(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.local_runtime.stop_chat().await;
    if let Ok(mut cf) = state.connected_model_file.write() {
        *cf = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn restart_ai_engine(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    state.cancel_all_requests();
    state.local_runtime.stop_chat().await;
    let res = load_model(app, state.clone(), None).await;
    if res.is_err() {
        if let Ok(mut cf) = state.connected_model_file.write() {
            *cf = None;
        }
    }
    res
}

fn sha256_from_header(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_start_matches("W/").trim_matches('"');
    if trimmed.len() == 64 && trimmed.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(trimmed.to_ascii_lowercase())
    } else {
        None
    }
}

fn expected_sha256_from_response(response: &reqwest::Response) -> Option<String> {
    ["x-linked-etag", "etag"].iter().find_map(|name| {
        response
            .headers()
            .get(*name)
            .and_then(|v| v.to_str().ok())
            .and_then(sha256_from_header)
    })
}

fn content_range_start(value: &str) -> Option<u64> {
    let range = value.trim().strip_prefix("bytes ")?;
    let (start, _) = range.split_once('-')?;
    start.trim().parse().ok()
}

async fn compute_file_sha256(path: PathBuf) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        use sha2::{Digest, Sha256};
        use std::io::Read;
        let mut file = std::fs::File::open(&path)
            .map_err(|e| format!("Cannot read downloaded file: {e}"))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1024 * 1024];
        loop {
            let n = file
                .read(&mut buf)
                .map_err(|e| format!("Cannot read downloaded file: {e}"))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        Ok(hex::encode(hasher.finalize()))
    })
    .await
    .map_err(|e| format!("SHA-256 verification task failed: {e}"))?
}

#[tauri::command]
pub fn cancel_download(
    state: tauri::State<'_, AppState>,
    filename: String,
) -> Result<bool, String> {
    state.cancel_download(&filename)
}

#[tauri::command]
pub async fn download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
    filename: String,
    expected_sha256: Option<String>,
) -> Result<String, String> {
    if filename.is_empty()
        || filename.contains(['/', '\\'])
        || !filename.to_lowercase().ends_with(".gguf")
    {
        return Err("Use a plain .gguf filename without directory components.".into());
    }
    let parsed_url = reqwest::Url::parse(&url).map_err(|_| "Invalid download URL")?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("Download URL must use HTTP or HTTPS.".into());
    }

    let dl_handle = state.register_download(&filename)?;
    let cancel_token = dl_handle.token.clone();

    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    tokio::fs::create_dir_all(&models_dir)
        .await
        .map_err(|e| e.to_string())?;
    let dest = models_dir.join(&filename);
    if dest.exists() {
        if let Ok(mut f) = tokio::fs::File::open(&dest).await {
            use tokio::io::AsyncReadExt;
            let mut header = [0u8; 4];
            if f.read_exact(&mut header).await.is_ok() && &header == b"GGUF" {
                if let Ok(mut mp) = state.model_path.write() {
                    *mp = models_dir.clone();
                }
                let size = tokio::fs::metadata(&dest).await.map(|m| m.len()).unwrap_or(0);
                let _ = app.emit(
                    "download-progress",
                    DownloadProgressPayload {
                        filename: filename.clone(),
                        downloaded: size,
                        total: size,
                        percent: 100.0,
                        speed_bps: 0,
                        eta_secs: Some(0),
                        stage: "finished".into(),
                        done: true,
                        error: None,
                    },
                );
                return Ok(dest.to_string_lossy().into_owned());
            }
        }
        let _ = tokio::fs::remove_file(&dest).await;
    }

    let partial = models_dir.join(format!("{filename}.part"));
    let mut existing_bytes = tokio::fs::metadata(&partial)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let result = async {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let mut req = state.http.stream_client.get(parsed_url);
        if existing_bytes > 0 {
            req = req.header("Range", format!("bytes={existing_bytes}-"));
        }
        let response = req
            .send()
            .await
            .map_err(|e| format!("Download request failed: {}", e.without_url()))?;

        let status = response.status().as_u16();
        let expected_hash = expected_sha256
            .as_deref()
            .map(|h| h.trim().to_ascii_lowercase())
            .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
            .or_else(|| expected_sha256_from_response(&response));

        let already_complete = status == 416 && existing_bytes > 0;
        if !already_complete && !response.status().is_success() {
            return Err(format!("Download returned HTTP {}", response.status()));
        }

        let is_resumed = status == 206;
        if is_resumed {
            let range_start = response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(content_range_start);
            if range_start != Some(existing_bytes) {
                let _ = tokio::fs::remove_file(&partial).await;
                return Err("Server resumed download at an unexpected offset. Please retry.".into());
            }
        }

        let total = if already_complete {
            existing_bytes
        } else if is_resumed {
            existing_bytes.saturating_add(response.content_length().unwrap_or(0))
        } else {
            existing_bytes = 0;
            response.content_length().unwrap_or(0)
        };

        let mut downloaded = existing_bytes;
        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                filename: filename.clone(),
                downloaded,
                total,
                percent: if total > 0 {
                    (downloaded as f32 / total as f32) * 100.0
                } else {
                    0.0
                },
                speed_bps: 0,
                eta_secs: None,
                stage: "downloading".into(),
                done: false,
                error: None,
            },
        );

        if !already_complete {
            let mut file = if is_resumed && existing_bytes > 0 {
                tokio::fs::OpenOptions::new()
                    .append(true)
                    .open(&partial)
                    .await
                    .map_err(|e| format!("Cannot open partial download: {e}"))?
            } else {
                tokio::fs::File::create(&partial)
                    .await
                    .map_err(|e| format!("Cannot create download file: {e}"))?
            };

            let mut stream = response.bytes_stream();
            let mut last_event = std::time::Instant::now();
            let mut bytes_at_last_event = downloaded;
            let mut speed_bps: f64 = 0.0;

            loop {
                let next_chunk = tokio::select! {
                    _ = cancel_token.cancelled() => {
                        let _ = file.flush().await;
                        drop(file);
                        let _ = app.emit(
                            "download-progress",
                            DownloadProgressPayload {
                                filename: filename.clone(),
                                downloaded,
                                total,
                                percent: if total > 0 { (downloaded as f32 / total as f32) * 100.0 } else { 0.0 },
                                speed_bps: 0,
                                eta_secs: None,
                                stage: "cancelled".into(),
                                done: true,
                                error: Some("Download paused. Click Download again to resume.".into()),
                            },
                        );
                        return Err("Download cancelled.".into());
                    }
                    chunk = stream.next() => chunk,
                };

                let Some(chunk_res) = next_chunk else {
                    break;
                };
                let chunk = chunk_res
                    .map_err(|e| format!("Download interrupted (resume supported): {}", e.without_url()))?;
                file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                downloaded = downloaded.saturating_add(chunk.len() as u64);

                let elapsed = last_event.elapsed();
                if elapsed >= std::time::Duration::from_millis(200) {
                    let instant =
                        (downloaded.saturating_sub(bytes_at_last_event)) as f64 / elapsed.as_secs_f64();
                    speed_bps = if speed_bps == 0.0 {
                        instant
                    } else {
                        speed_bps * 0.7 + instant * 0.3
                    };
                    let speed_u64 = speed_bps as u64;
                    let eta_secs = if total > downloaded && speed_u64 > 0 {
                        Some((total - downloaded) / speed_u64)
                    } else {
                        None
                    };
                    let _ = app.emit(
                        "download-progress",
                        DownloadProgressPayload {
                            filename: filename.clone(),
                            downloaded,
                            total,
                            percent: if total > 0 {
                                (downloaded as f32 / total as f32) * 100.0
                            } else {
                                0.0
                            },
                            speed_bps: speed_u64,
                            eta_secs,
                            stage: "downloading".into(),
                            done: false,
                            error: None,
                        },
                    );
                    last_event = std::time::Instant::now();
                    bytes_at_last_event = downloaded;
                }
            }

            if downloaded < 4 || (total > 0 && downloaded + (total / 100).max(1024) < total) {
                return Err("Model download is incomplete. Click Download again to resume.".into());
            }
            file.flush().await.map_err(|e| e.to_string())?;
            file.sync_all().await.map_err(|e| e.to_string())?;
            drop(file);
        }

        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                filename: filename.clone(),
                downloaded,
                total: total.max(downloaded),
                percent: 100.0,
                speed_bps: 0,
                eta_secs: Some(0),
                stage: "verifying".into(),
                done: false,
                error: None,
            },
        );

        let mut header = [0u8; 4];
        tokio::fs::File::open(&partial)
            .await
            .map_err(|e| e.to_string())?
            .read_exact(&mut header)
            .await
            .map_err(|e| e.to_string())?;
        if &header != b"GGUF" {
            let _ = tokio::fs::remove_file(&partial).await;
            return Err("Downloaded file is not a valid GGUF model (possibly an error page).".into());
        }

        if let Some(expected) = expected_hash {
            let actual = compute_file_sha256(partial.clone()).await?;
            if actual != expected {
                let _ = tokio::fs::remove_file(&partial).await;
                return Err("Downloaded file failed SHA-256 checksum verification. Please download again.".into());
            }
        }

        tokio::fs::rename(&partial, &dest)
            .await
            .map_err(|e| e.to_string())?;
        if let Ok(mut mp) = state.model_path.write() {
            *mp = models_dir.clone();
        }
        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                filename: filename.clone(),
                downloaded,
                total: total.max(downloaded),
                percent: 100.0,
                speed_bps: 0,
                eta_secs: Some(0),
                stage: "finished".into(),
                done: true,
                error: None,
            },
        );
        Ok(dest.to_string_lossy().into_owned())
    }
    .await;

    if let Err(ref error) = result {
        if !cancel_token.is_cancelled() {
            let _ = app.emit(
                "download-progress",
                DownloadProgressPayload {
                    filename,
                    downloaded: 0,
                    total: 0,
                    percent: 0.0,
                    speed_bps: 0,
                    eta_secs: None,
                    stage: "error".into(),
                    done: true,
                    error: Some(error.clone()),
                },
            );
        }
    }
    result
}

#[tauri::command]
pub fn list_downloaded_models(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DownloadedModel>, String> {
    let state_dir = state
        .model_path
        .read()
        .map_err(|e| format!("Lock error: {e}"))?
        .clone();
    let app_dir = app.path().app_data_dir().ok().map(|p| p.join("models"));
    let docs_dir = dirs::document_dir().map(|p| p.join("DocuSage").join("models"));

    let mut dirs_to_scan = vec![state_dir];
    for extra in [app_dir, docs_dir].into_iter().flatten() {
        if !dirs_to_scan.contains(&extra) {
            dirs_to_scan.push(extra);
        }
    }

    let mut models = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for dir in &dirs_to_scan {
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("gguf"))
                {
                    continue;
                }
                let filename = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if seen.insert(filename.clone()) {
                    let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    models.push(DownloadedModel {
                        filename,
                        path: path.to_string_lossy().into_owned(),
                        size_bytes,
                    });
                }
            }
        }
    }

    models.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(models)
}

#[tauri::command]
pub fn delete_model(
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    if !path.is_file()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("gguf"))
    {
        return Err("Only a GGUF model file can be deleted.".into());
    }
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let connected = state
        .connected_model_file
        .read()
        .map_err(|e| format!("Lock error: {e}"))?
        .clone();
    if connected.as_deref() == Some(filename.as_str()) {
        return Err(
            "Cannot delete the currently connected model. Click Disconnect first.".to_string(),
        );
    }
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_models_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    if let Ok(app_models) = app.path().app_data_dir().map(|d| d.join("models")) {
        if app_models.is_dir() && crate::path_has_gguf(&app_models) {
            return Ok(app_models.to_string_lossy().into_owned());
        }
    }
    let configured = state
        .model_path
        .read()
        .map_err(|e| format!("Lock error: {e}"))?
        .clone();
    if configured.is_dir() && crate::path_has_gguf(&configured) {
        return Ok(configured.to_string_lossy().into_owned());
    }
    if let Ok(app_models) = app.path().app_data_dir().map(|d| d.join("models")) {
        return Ok(app_models.to_string_lossy().into_owned());
    }
    Ok(configured.to_string_lossy().into_owned())
}

/// One-click live test for the built-in local GGUF model.
/// Automatically loads a downloaded chat model if none is active yet — no manual path setup required.
#[tauri::command]
pub async fn test_local_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<LocalModelTestResult, String> {
    let status = state.local_runtime.status(&app).await;
    if !status.running {
        if let Err(err) = load_model(app.clone(), state.clone(), None).await {
            return Ok(LocalModelTestResult {
                ok: false,
                message: err,
                reply: None,
                duration_ms: None,
                model: None,
            });
        }
    }

    match state.local_runtime.quick_test_chat().await {
        Ok((model, reply, duration_ms)) => Ok(LocalModelTestResult {
            ok: true,
            message: format!(
                "{} responded in {:.2}s.",
                model,
                duration_ms as f64 / 1000.0
            ),
            reply: Some(reply),
            duration_ms: Some(duration_ms),
            model: Some(model),
        }),
        Err(err) => Ok(LocalModelTestResult {
            ok: false,
            message: err,
            reply: None,
            duration_ms: None,
            model: status.loaded_model,
        }),
    }
}

#[tauri::command]
pub fn get_connected_model(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(state
        .connected_model_file
        .read()
        .map_err(|e| format!("Lock error: {e}"))?
        .clone())
}

#[tauri::command]
pub fn get_rag_config(state: tauri::State<'_, AppState>) -> Result<RagConfig, String> {
    Ok(state
        .rag_config
        .read()
        .map_err(|e| format!("Lock error: {e}"))?
        .clone())
}

#[tauri::command]
pub fn save_rag_config(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    config: RagConfig,
) -> Result<(), String> {
    config.validate()?;
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("rag-config.json");
    std::fs::create_dir_all(path.parent().ok_or("Invalid config directory")?)
        .map_err(|e| e.to_string())?;
    std::fs::write(
        path,
        serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    *state
        .rag_config
        .write()
        .map_err(|e| format!("Lock error: {e}"))? = config;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_request_registration_and_cancellation_work() {
        let state = AppState::new(PathBuf::new());
        let h1 = state.register_request("req-1").unwrap();
        let h2 = state.register_request("req-2").unwrap();
        // Duplicate ID is rejected, distinct IDs (Model Compare) run in parallel.
        assert!(state.register_request("req-1").is_err());

        assert!(state.cancel_request("req-1").unwrap());
        assert!(h1.token.is_cancelled());
        assert!(!h2.token.is_cancelled());

        drop(h1);
        drop(h2);
        assert!(state.register_request("req-1").is_ok());
    }

    #[test]
    fn rag_config_rejects_invalid_ranges() {
        let mut cfg = RagConfig::default();
        cfg.top_k = 0;
        assert!(cfg.validate().is_err());
        cfg.top_k = 8;
        cfg.chunk_overlap = cfg.chunk_size;
        assert!(cfg.validate().is_err());
        cfg.chunk_overlap = 50;
        cfg.token_budget = 100;
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn download_helpers_parse_sha256_and_content_range() {
        let hash = "a".repeat(64);
        assert_eq!(sha256_from_header(&format!("\"{hash}\"")), Some(hash.clone()));
        assert_eq!(sha256_from_header(&format!("W/\"{hash}\"")), Some(hash));
        assert_eq!(sha256_from_header("\"abc123\""), None);

        assert_eq!(content_range_start("bytes 1024-4095/4096"), Some(1024));
        assert_eq!(content_range_start("bytes 0-0/1"), Some(0));
        assert_eq!(content_range_start("bytes */1000"), None);
    }

    #[test]
    fn download_registration_and_cancellation_work() {
        let state = AppState::new(PathBuf::new());
        let handle = state.register_download("model.gguf").unwrap();
        assert!(state.register_download("model.gguf").is_err());
        assert!(state.cancel_download("model.gguf").unwrap());
        assert!(handle.token.is_cancelled());
        drop(handle);
        assert!(state.register_download("model.gguf").is_ok());
    }
}
