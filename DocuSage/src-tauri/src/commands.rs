use std::path::PathBuf;
use std::sync::atomic::Ordering;

use futures_util::StreamExt as _;
use mistralrs::{
    ChatCompletionChunkResponse, ChunkChoice, Delta, GgufModelBuilder,
    RequestBuilder, Response, StopTokens, TextMessageRole,
};
use tauri::{Emitter, Manager};

use crate::AppState;

// ─────────────────────────────────────────────────────────────────────────────
// Model management types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressPayload {
    filename: String,
    downloaded: u64,
    total: u64,
    percent: f32,
    done: bool,
    error: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedModel {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
}

/// Maximum number of tokens the model may generate per response.
/// This prevents runaway generation when the model fails to produce a stop token.
const MAX_GENERATION_TOKENS: usize = 1024;

/// Stop sequences that cover all common GGUF chat template families.
/// The engine will halt generation as soon as any of these is produced.
const STOP_SEQUENCES: &[&str] = &[
    "<|end|>",
    "<|endoftext|>",
    "<|im_end|>",
    "<|eot_id|>",
    "</s>",
    "<|end_of_turn|>",
    "<|END|>",
];

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResult {
    pub file_name: String,
    pub chunk_count: usize,
    pub char_count: usize,
    pub source_path: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMessage {
    sender: String,
    text: String,
}

/// Payload emitted for each streamed token so the frontend can display
/// partial responses as they arrive.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatTokenPayload {
    request_id: String,
    token: String,
    done: bool,
}

/// Build a [`RequestBuilder`] with sampling parameters tuned for the mode.
///
/// `grounded=true` is used for RAG, where the answer must stay close to the
/// retrieved evidence — we drop the temperature so the model is much less
/// likely to invent details that aren't in the context.
fn build_request(
    system_prompt: &str,
    history: &[HistoryMessage],
    prompt: &str,
    grounded: bool,
) -> RequestBuilder {
    let (temp, top_p, top_k) = if grounded {
        (0.2, 0.9, 30usize)
    } else {
        (0.7, 0.95, 40usize)
    };

    let mut req = RequestBuilder::new()
        .set_sampler_max_len(MAX_GENERATION_TOKENS)
        .set_sampler_stop_toks(StopTokens::Seqs(
            STOP_SEQUENCES.iter().map(|s| s.to_string()).collect(),
        ))
        .set_sampler_temperature(temp)
        .set_sampler_topk(top_k)
        .set_sampler_topp(top_p)
        .set_sampler_frequency_penalty(0.3)
        .add_message(TextMessageRole::System, system_prompt);

    for entry in history {
        let text = entry.text.trim();
        if text.is_empty() {
            continue;
        }
        req = match entry.sender.as_str() {
            "user" => req.add_message(TextMessageRole::User, text),
            "bot" => req.add_message(TextMessageRole::Assistant, text),
            _ => req,
        };
    }

    req.add_message(TextMessageRole::User, prompt)
}

/// Clean a single streamed token of common control-token debris.
///
/// This handles two classes of junk:
/// 1. Literal chat-template markers that leaked through (e.g. `<|end|>`).
/// 2. GGUF hex-byte escapes like `<0x0A>` (newline) that some tokenizers emit.
fn sanitize_token(raw: &str) -> String {
    // Fast path: most tokens have no angle brackets at all.
    if !raw.contains('<') {
        return raw.to_string();
    }

    let mut out = raw.to_string();

    // Strip chat-template control tokens.
    for marker in [
        "<|assistant|>", "<|user|>", "<|system|>", "<|end|>",
        "<|endoftext|>", "<|im_start|>", "<|im_end|>", "<|eot_id|>",
        "<|end_of_turn|>", "</s>", "<s>", "<|END|>",
    ] {
        out = out.replace(marker, "");
    }

    // Decode GGUF hex-byte escapes: <0xNN> → the actual byte.
    // E.g. <0x0A> → '\n',  <0x0D> → '\r'
    while let Some(start) = out.find("<0x") {
        if let Some(end) = out[start..].find('>') {
            let hex_str = &out[start + 3..start + end];
            if let Ok(byte_val) = u8::from_str_radix(hex_str, 16) {
                let replacement = String::from(byte_val as char);
                out = format!("{}{}{}", &out[..start], replacement, &out[start + end + 1..]);
            } else {
                // Malformed — remove the tag entirely to be safe.
                out = format!("{}{}", &out[..start], &out[start + end + 1..]);
            }
        } else {
            break; // No closing '>' — stop.
        }
    }

    out
}

pub(crate) struct RequestGuard<'a> { state: &'a AppState, request_id: String }

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.state.active_request_id.lock() {
            if active.as_deref() == Some(self.request_id.as_str()) {
                *active = None;
                self.state.cancel_current_response.store(false, Ordering::Relaxed);
            }
        }
    }
}

pub(crate) fn start_request<'a>(state: &'a AppState, request_id: &str) -> Result<RequestGuard<'a>, String> {
    let mut active = state.active_request_id.lock().map_err(|e| e.to_string())?;
    if active.is_some() { return Err("A response is already running. Stop it before sending another message.".into()); }
    state.cancel_current_response.store(false, Ordering::Relaxed);
    *active = Some(request_id.to_owned());
    Ok(RequestGuard { state, request_id: request_id.to_owned() })
}

pub(crate) async fn wait_for_cancel(state: &AppState) {
    while !state.cancel_current_response.load(Ordering::Relaxed) {
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
}

/// Load a GGUF model from disk using `mistralrs`.
///
/// Scans the resolved model directory for `.gguf` files and initialises the
/// inference engine.  The resulting `Model` is stored in `AppState` for use
/// by `chat_general` and `chat_rag`.
#[tauri::command]
pub async fn load_model(
    state: tauri::State<'_, AppState>,
    path: Option<String>,
) -> Result<String, String> {
    // ── 1. Resolve the target directory ─────────────────────────────────
    let resolved: PathBuf = if let Some(ref p) = path {
        let new_path = PathBuf::from(p);
        let mut model_path = state
            .model_path
            .write()
            .map_err(|e| format!("Failed to acquire model_path write lock: {e}"))?;
        *model_path = new_path.clone();
        new_path
    } else {
        let current_path = state
            .model_path
            .read()
            .map_err(|e| format!("Failed to acquire model_path read lock: {e}"))?
            .clone();

        if current_path.exists() && crate::path_has_gguf(&current_path) {
            current_path
        } else {
            let refreshed_path = crate::resolve_model_path();
            let mut model_path = state
                .model_path
                .write()
                .map_err(|e| format!("Failed to acquire model_path write lock: {e}"))?;
            *model_path = refreshed_path.clone();
            refreshed_path
        }
    };

    if !resolved.exists() {
        return Err(format!(
            "Model path does not exist: {}",
            resolved.display()
        ));
    }

    // ── 2. Discover .gguf files in the directory ────────────────────────
    let mut gguf_files: Vec<String> = std::fs::read_dir(&resolved)
        .map_err(|e| format!("Cannot read model directory: {e}"))?
        .filter_map(|entry| {
            let name = entry.ok()?.file_name().to_string_lossy().to_string();
            if name.to_lowercase().ends_with(".gguf") {
                Some(name)
            } else {
                None
            }
        })
        .collect();

    gguf_files.sort();
    let connected = state.connected_model_file.read().map_err(|e| e.to_string())?.clone();
    if let Some(selected) = connected.filter(|name| gguf_files.contains(name)) {
        gguf_files = vec![selected];
    } else {
        gguf_files.truncate(1);
    }
    if gguf_files.is_empty() {
        return Err(format!(
            "No .gguf files found in: {}",
            resolved.display()
        ));
    }

    // ── 3. Build the model with GgufModelBuilder ────────────────────────
    let model_id = resolved.to_string_lossy().to_string();

    let mut builder = GgufModelBuilder::new(model_id.clone(), gguf_files.clone())
        .with_logging();

    // Force CPU unless USE_GPU=1 is set.
    if std::env::var("USE_GPU").unwrap_or_default() != "1" {
        builder = builder.with_force_cpu();
    }

    // Optional: explicit chat template path or literal Jinja.
    if let Ok(template) = std::env::var("CHAT_TEMPLATE") {
        if !template.is_empty() {
            builder = builder.with_chat_template(template);
        }
    }

    // Optional: HuggingFace tokenizer model ID for chat template / tokenizer.
    if let Ok(tok_id) = std::env::var("TOK_MODEL_ID") {
        if !tok_id.is_empty() {
            builder = builder.with_tok_model_id(tok_id);
        }
    }

    let mut model_guard = state.model.lock().await;
    let model = builder
        .build()
        .await
        .map_err(|e| format!("Failed to load model: {e}"))?;

    // ── 4. Store in AppState ────────────────────────────────────────────
    *model_guard = Some(model);

    // Track which file is connected so the UI can highlight it.
    if let Some(first) = gguf_files.first() {
        if let Ok(mut cf) = state.connected_model_file.write() {
            *cf = Some(first.clone());
        }
    }

    Ok(format!(
        "Model loaded from: {} (files: {})",
        resolved.display(),
        gguf_files.join(", ")
    ))
}

// ─────────────────────────────────────────────────────────────────────────────
// chat_general
// ─────────────────────────────────────────────────────────────────────────────

/// Send a prompt to the LLM in **General Chat** mode (no RAG context).
///
/// Tokens are streamed to the frontend via `chat-token` events so the UI
/// can display partial responses progressively.  The full accumulated text
/// is also returned when inference completes.
#[tauri::command]
pub async fn chat_general(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    prompt: String,
    history: Vec<HistoryMessage>,
    request_id: String,
) -> Result<String, String> {
    let _request = start_request(&state, &request_id)?;

    let model_guard = state.model.lock().await;
    let model = model_guard
        .as_ref()
        .ok_or_else(|| "No model loaded. Call load_model first.".to_string())?;

    let request = build_request(
        "You are DocuSage, a helpful, accurate, and privacy-focused AI \
         assistant running entirely on the user's local machine.\n\
         IMPORTANT RULES:\n\
         - Keep answers clear, direct, and concise.\n\
         - When the user asks for a short answer or specifies a word/line \
           limit, you MUST respect it strictly.\n\
         - Do NOT repeat yourself or generate multiple alternative answers.\n\
         - Produce exactly one answer, then STOP.",
        &history,
        &prompt,
        false,
    );

    // ── Streaming inference ─────────────────────────────────────────────
    let mut stream = model
        .stream_chat_request(request)
        .await
        .map_err(|e| format!("Inference failed: {e}"))?;

    let mut full_reply = String::new();
    let mut stopped = false;

    while let Some(chunk) = tokio::select! {
        chunk = stream.next() => chunk,
        _ = wait_for_cancel(&state) => { stopped = true; None }
    } {
        if state.cancel_current_response.load(Ordering::Relaxed) {
            stopped = true;
            break;
        }

        match chunk {
            Response::Chunk(ChatCompletionChunkResponse { choices, .. }) => {
                if let Some(ChunkChoice {
                    delta: Delta { content: Some(ref content), .. },
                    ..
                }) = choices.first()
                {
                    let clean = sanitize_token(content);
                    if !clean.is_empty() {
                        full_reply.push_str(&clean);
                        let _ = app.emit(
                            "chat-token",
                            ChatTokenPayload {
                                request_id: request_id.clone(),
                                token: clean,
                                done: false,
                            },
                        );
                    }
                }
            }
            Response::Done(_) => break,
            Response::ModelError(msg, _) => {
                return Err(msg);
            }
            Response::InternalError(e) => {
                return Err(e.to_string());
            }
            Response::ValidationError(e) => {
                return Err(e.to_string());
            }
            _ => {}
        }
    }

    let _ = app.emit(
        "chat-token",
        ChatTokenPayload {
            request_id: request_id.clone(),
            token: String::new(),
            done: true,
        },
    );

    let full_reply = full_reply.trim().to_string();

    if full_reply.is_empty() {
        return Ok(if stopped {
            "Generation stopped.".to_string()
        } else {
            "No response generated.".to_string()
        });
    }

    Ok(full_reply)
}

// ─────────────────────────────────────────────────────────────────────────────
// chat_rag
// ─────────────────────────────────────────────────────────────────────────────

/// Send a prompt to the LLM in **RAG Chat** mode.
///
/// 1. Embeds the user query and searches the LanceDB vector store for the
///    most relevant document chunks.
/// 2. Injects the retrieved context into the system prompt.
/// 3. Runs inference with `mistralrs` and returns the answer with citations.
#[tauri::command]
pub async fn chat_rag(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    prompt: String,
    history: Vec<HistoryMessage>,
    request_id: String,
    source_path: String,
) -> Result<String, String> {
    let _request = start_request(&state, &request_id)?;

    // ── 1. Resolve DB path (no model lock needed) ───────────────────────
    let db_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("lancedb"))
        .or_else(|| dirs::data_local_dir().map(|p| p.join("DocuSage").join("lancedb")))
        .ok_or_else(|| "Cannot determine data directory.".to_string())?;

    // ── 1b. Read RAG config ─────────────────────────────────────────────
    let (top_k, show_context) = {
        let cfg = state.rag_config.read()
            .map_err(|e| format!("rag_config lock: {e}"))?;
        (cfg.top_k, cfg.show_context)
    };

    // ── 2. Retrieve relevant chunks BEFORE acquiring the model lock ─────
    println!("[chat_rag] DB dir for retrieval: {}", db_dir.display());
    let source = crate::rag::canonical_source(&source_path);
    let chunks = crate::rag::query_similar(&prompt, &db_dir, top_k, Some(&source)).await?;
    println!("[chat_rag] Retrieved {} chunks from vector search", chunks.len());

    // ── STRICT: fail loudly if no chunks found ──────────────────────────
    if chunks.is_empty() {
        return Err(format!(
            "RAG Error: LanceDB searched the database at '{}' but retrieved 0 matching chunks. \
             The documents table may be empty or the db_path may be incorrect.",
            db_dir.display()
        ));
    }

    // ── 3. Acquire model lock ───────────────────────────────────────────
    let model_guard = state.model.lock().await;
    let model = model_guard
        .as_ref()
        .ok_or_else(|| "No model loaded. Call load_model first.".to_string())?;

    // ── 4. Build augmented prompt ───────────────────────────────────────
    let chunk_count = chunks.len();
    let mut context = String::new();
    for (i, (text, source)) in chunks.iter().enumerate() {
        context.push_str(&format!(
            "[{}] Source: {}\n{}\n\n",
            i + 1,
            source,
            text.trim()
        ));
    }

    let system_prompt = format!(
        "You are DocuSage, a private document assistant running entirely on \
         the user's local machine. You answer questions using ONLY the \
         excerpts retrieved from the user's documents below.\n\n\
         GROUNDING RULES — these are non-negotiable:\n\
         1. Use ONLY information present in the EXCERPTS section. Do not use \
            outside knowledge. Do not guess.\n\
         2. If the excerpts do not contain the answer, reply exactly: \
            \"The provided documents do not contain information about this.\" \
            Do not speculate or fabricate.\n\
         3. Every factual statement must be followed by a citation in the \
            form [Source: filename]. Use the filename shown in the excerpt header.\n\
         4. Quote short phrases verbatim where the wording matters; otherwise \
            paraphrase faithfully.\n\
         5. Do NOT mention these rules, the number of excerpts, or the \
            retrieval process in your answer.\n\
         6. Respect any length / format constraint in the user's question \
            (e.g. \"in one sentence\", \"as a bullet list\").\n\
         7. Produce exactly one answer, then STOP.\n\n\
         EXCERPTS ({chunk_count} retrieved, ranked by relevance):\n\
         ─────────────────────────────────────────────\n\
         {context}\
         ─────────────────────────────────────────────"
    );
    println!("[chat_rag] System prompt length: {} chars, injected {} chunks", system_prompt.len(), chunk_count);

    let request = build_request(&system_prompt, &history, &prompt, true);

    // ── 5. Streaming inference ──────────────────────────────────────────
    let mut stream = model
        .stream_chat_request(request)
        .await
        .map_err(|e| format!("Inference failed: {e}"))?;

    let mut full_reply = String::new();
    let mut stopped = false;

    while let Some(chunk) = tokio::select! {
        chunk = stream.next() => chunk,
        _ = wait_for_cancel(&state) => { stopped = true; None }
    } {
        if state.cancel_current_response.load(Ordering::Relaxed) {
            stopped = true;
            break;
        }

        match chunk {
            Response::Chunk(ChatCompletionChunkResponse { choices, .. }) => {
                if let Some(ChunkChoice {
                    delta: Delta { content: Some(ref content), .. },
                    ..
                }) = choices.first()
                {
                    let clean = sanitize_token(content);
                    if !clean.is_empty() {
                        full_reply.push_str(&clean);
                        let _ = app.emit(
                            "chat-token",
                            ChatTokenPayload {
                                request_id: request_id.clone(),
                                token: clean,
                                done: false,
                            },
                        );
                    }
                }
            }
            Response::Done(_) => break,
            Response::ModelError(msg, _) => {
                return Err(msg);
            }
            Response::InternalError(e) => {
                return Err(e.to_string());
            }
            Response::ValidationError(e) => {
                return Err(e.to_string());
            }
            _ => {}
        }
    }

    let _ = app.emit(
        "chat-token",
        ChatTokenPayload {
            request_id: request_id.clone(),
            token: String::new(),
            done: true,
        },
    );

    let mut full_reply = full_reply.trim().to_string();

    if full_reply.is_empty() {
        return Ok(if stopped {
            "Generation stopped.".to_string()
        } else {
            "No response generated.".to_string()
        });
    }

    // Optionally append the retrieved chunks for transparency / auditing.
    if show_context && !stopped {
        full_reply.push_str(&crate::rag::context_appendix(&chunks));
    }

    Ok(full_reply)
}

// ─────────────────────────────────────────────────────────────────────────────
// chat_gemini_rag  –  Hybrid mode: local RAG retrieval + Gemini API for answer
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn stop_chat(
    state: tauri::State<'_, AppState>,
    request_id: String,
) -> Result<(), String> {
    let active_request = state
        .active_request_id
        .lock()
        .map_err(|e| format!("Active request lock failed: {e}"))?;

    if active_request.as_deref() == Some(request_id.as_str()) {
        state.cancel_current_response.store(true, Ordering::Relaxed);
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_document(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
    let db = app.path().app_data_dir().map_err(|e| e.to_string())?.join("lancedb");
    crate::rag::delete_source(&db, &crate::rag::canonical_source(&file_path)).await
}

#[tauri::command]
pub async fn list_indexed_documents(app: tauri::AppHandle) -> Result<Vec<crate::rag::IndexedDocument>, String> {
    let db = app.path().app_data_dir().map_err(|e| e.to_string())?.join("lancedb");
    crate::rag::indexed_documents(&db).await
}

// ─────────────────────────────────────────────────────────────────────────────
// ingest_document
// ─────────────────────────────────────────────────────────────────────────────

/// Ingest a PDF document into the local RAG vector store.
///
/// **Pipeline**: validate path → extract text → chunk → embed → store in LanceDB.
///
/// # Arguments
/// * `app`       — Tauri `AppHandle`, used to resolve `app_data_dir` for the DB.
/// * `state`     — Managed `AppState` used to read current RAG chunk settings.
/// * `file_path` — Absolute or relative path to the PDF file to ingest.
///
/// # Returns
/// A success message containing the number of chunks processed and the
/// directory where the LanceDB database was written.
///
/// # Errors
/// Returns a human-readable `String` error when:
/// - The file does not exist or is not a PDF.
/// - Text extraction fails (corrupt / encrypted PDF).
/// - The DB directory cannot be resolved or created.
/// - Embedding generation or DB insertion fails.
#[tauri::command]
pub async fn ingest_document(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<IngestResult, String> {
    // ── 1. Validate and canonicalize the input path ─────────────────────
    let pdf_path = PathBuf::from(&file_path);
    if !pdf_path.exists() {
        return Err(format!("File not found: {}", pdf_path.display()));
    }
    let pdf_path = pdf_path
        .canonicalize()
        .map_err(|e| format!("Cannot canonicalize path {}: {e}", pdf_path.display()))?;

    let ext = pdf_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    if !ext.eq_ignore_ascii_case("pdf") {
        return Err(format!(
            "Expected a .pdf file, got .{ext}: {}",
            pdf_path.display()
        ));
    }

    // ── 2. Resolve the LanceDB data directory ───────────────────────────
    //   Priority: app_data_dir (Tauri-managed) → dirs::data_local_dir fallback.
    let db_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("lancedb"))
        .or_else(|| dirs::data_local_dir().map(|p| p.join("DocuSage").join("lancedb")))
        .ok_or_else(|| {
            "Cannot determine application data directory. \
             Neither Tauri app_data_dir nor dirs::data_local_dir are available."
                .to_string()
        })?;

    // ── 3. Read chunk params from RAG config ────────────────────────────
    let (chunk_size, chunk_overlap) = {
        let cfg = state.rag_config.read()
            .map_err(|e| format!("rag_config lock: {e}"))?;
        (cfg.chunk_size, cfg.chunk_overlap)
    };

    // ── 4. Offload heavy work to a blocking thread ──────────────────────
    //   PDF parsing and embedding are CPU-bound; running them on the async
    //   executor would starve other Tauri commands.  `spawn_blocking` moves
    //   the closure onto a dedicated thread-pool thread.
    let db_dir_clone = db_dir.clone();
    let pdf_display = pdf_path.display().to_string();

    println!("[ingest] Starting ingestion for: {}", pdf_display);
    println!("[ingest] DB directory: {}", db_dir.display());
    println!("[ingest] Chunk params: size={chunk_size}, overlap={chunk_overlap}");

    let result: Result<(usize, usize), String> = tauri::async_runtime::spawn_blocking(move || {
        // 3a. Extract text
        println!("[ingest] Extracting text from PDF...");
        let text = crate::rag::extract_text_from_pdf(&pdf_path)?;
        let char_count = text.chars().count();
        let trimmed_len = text.trim().len();
        println!("[ingest] Extracted text: {} chars total, {} chars trimmed", char_count, trimmed_len);
        if trimmed_len == 0 {
            println!("[ingest] FAILURE: Extraction failed — 0 characters found.");
            return Err(format!(
                "Extraction failed: 0 characters found in {}. Is this a scanned image?",
                pdf_path.display()
            ));
        }
        println!("SUCCESS: Extracted {} characters from {}", char_count, pdf_path.display());

        // 3b. Chunk — sentence-aware with configurable size and overlap.
        let chunks = crate::rag::chunk_text(&text, chunk_size, chunk_overlap);
        println!("[ingest] Chunking produced {} chunks", chunks.len());
        if chunks.is_empty() {
            return Err("Chunking produced zero chunks.".to_string());
        }

        let chunk_count = chunks.len();

        // 3c–d. Init DB + embed & store (async inside blocking via a one-shot runtime)
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("Failed to create async runtime: {e}"))?;

        rt.block_on(async {
            println!("[ingest] Initializing LanceDB at: {}", db_dir_clone.display());
            let db_conn = crate::rag::init_lancedb(&db_dir_clone).await?;
            println!("[ingest] LanceDB initialized, embedding and storing {} chunks...", chunk_count);
            crate::rag::embed_and_store(
                chunks,
                &pdf_path.display().to_string(),
                &db_conn,
            )
            .await?;
            // Verify rows were written
            let row_count = crate::rag::verify_row_count(&db_conn).await?;
            println!("[ingest] Verification: {} total rows in '{}' table after insertion", row_count, "documents");
            Ok::<(), String>(())
        })?;

        println!("SUCCESS: Vectorized and saved {} chunks to LanceDB", chunk_count);
        Ok((chunk_count, char_count))
    })
    .await
    .map_err(|e| format!("Ingestion task panicked: {e}"))?;

    let (chunk_count, char_count) = result?;

    let file_name = PathBuf::from(&pdf_display)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| pdf_display.clone());

    println!("[ingest] Returning to frontend: file='{}', chunks={}, chars={}", file_name, chunk_count, char_count);
    Ok(IngestResult { file_name, chunk_count, char_count, source_path: pdf_display })
}

// ─────────────────────────────────────────────────────────────────────────────
// download_model — in-app streaming model downloader
// ─────────────────────────────────────────────────────────────────────────────

/// Download a GGUF model file directly into the app's models directory,
/// emitting `download-progress` events so the UI can show a live progress bar.
struct PartialDownload(PathBuf);
impl Drop for PartialDownload {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
}

#[tauri::command]
pub async fn download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
    filename: String,
) -> Result<String, String> {
    if filename.is_empty() || filename.contains(['/', '\\']) || !filename.to_lowercase().ends_with(".gguf") {
        return Err("Use a plain .gguf filename without directory components.".into());
    }
    let parsed_url = reqwest::Url::parse(&url).map_err(|_| "Invalid download URL")?;
    if !matches!(parsed_url.scheme(), "http" | "https") { return Err("Download URL must use HTTP or HTTPS.".into()); }
    let models_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
    tokio::fs::create_dir_all(&models_dir).await.map_err(|e| e.to_string())?;
    let dest = models_dir.join(&filename);
    if dest.exists() { return Err("This model already exists. Delete it first to download again.".into()); }
    let partial = models_dir.join(format!("{filename}.part"));
    let mut file = tokio::fs::OpenOptions::new().write(true).create_new(true).open(&partial)
        .await.map_err(|e| format!("Cannot start download (another download may be running): {e}"))?;
    let cleanup = PartialDownload(partial.clone());
    let result = async {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let client = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(30))
            .read_timeout(std::time::Duration::from_secs(60)).build().map_err(|e| e.to_string())?;
        let response = client.get(parsed_url).send().await.map_err(|e| format!("Download request failed: {}", e.without_url()))?;
        if !response.status().is_success() { return Err(format!("Download returned HTTP {}", response.status())); }
        let total = response.content_length().unwrap_or(0);
        let mut stream = response.bytes_stream();
        let mut downloaded = 0u64;
        let mut last_event = std::time::Instant::now();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Download interrupted: {}", e.without_url()))?;
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            downloaded += chunk.len() as u64;
            if last_event.elapsed() >= std::time::Duration::from_millis(100) {
                let _ = app.emit("download-progress", DownloadProgressPayload {
                    filename: filename.clone(), downloaded, total,
                    percent: if total > 0 { downloaded as f32 / total as f32 * 100.0 } else { 0.0 },
                    done: false, error: None,
                });
                last_event = std::time::Instant::now();
            }
        }
        if downloaded < 4 || (total > 0 && downloaded != total) { return Err("Model download is incomplete.".into()); }
        file.flush().await.map_err(|e| e.to_string())?;
        file.sync_all().await.map_err(|e| e.to_string())?;
        drop(file);
        let mut header = [0u8; 4];
        tokio::fs::File::open(&partial).await.map_err(|e| e.to_string())?
            .read_exact(&mut header).await.map_err(|e| e.to_string())?;
        if &header != b"GGUF" { return Err("The server response is not a GGUF model.".into()); }
        tokio::fs::rename(&partial, &dest).await.map_err(|e| e.to_string())?;
        let _ = app.emit("download-progress", DownloadProgressPayload {
            filename: filename.clone(), downloaded, total, percent: 100.0, done: true, error: None,
        });
        Ok(dest.to_string_lossy().into_owned())
    }.await;
    drop(cleanup);
    if let Err(ref error) = result {
        let _ = app.emit("download-progress", DownloadProgressPayload {
            filename, downloaded: 0, total: 0, percent: 0.0, done: true, error: Some(error.clone()),
        });
    }
    // Preserve the selected model directory; downloaded files are separately
    // enumerated from the app data directory.
    let _ = state;
    result
}

// ─────────────────────────────────────────────────────────────────────────────
// list_downloaded_models — enumerate all local .gguf files
// ─────────────────────────────────────────────────────────────────────────────

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

    let app_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("models"));

    let mut dirs_to_scan: Vec<PathBuf> = vec![state_dir.clone()];
    if let Some(ref ad) = app_dir {
        if *ad != state_dir {
            dirs_to_scan.push(ad.clone());
        }
    }

    let mut models: Vec<DownloadedModel> = Vec::new();
    let mut seen = std::collections::HashSet::<String>::new();

    for dir in &dirs_to_scan {
        if !dir.is_dir() {
            continue;
        }
        let entries = std::fs::read_dir(dir).map_err(|e| format!("Cannot read dir: {e}"))?;
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ext != "gguf" {
                continue;
            }
            let filename = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if seen.contains(&filename) {
                continue;
            }
            seen.insert(filename.clone());
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            models.push(DownloadedModel {
                filename,
                path: path.to_string_lossy().to_string(),
                size_bytes,
            });
        }
    }

    models.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(models)
}

// ─────────────────────────────────────────────────────────────────────────────
// connect_model — load a specific .gguf file by absolute path
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn connect_model(
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<String, String> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err(format!("Model file not found: {}", path.display()));
    }

    let dir = path
        .parent()
        .ok_or("Cannot get parent directory of model file")?
        .to_path_buf();

    let filename = path
        .file_name()
        .ok_or("Invalid model filename")?
        .to_string_lossy()
        .to_string();

    let model_id = dir.to_string_lossy().to_string();
    let mut builder =
        GgufModelBuilder::new(model_id, vec![filename.clone()]).with_logging();

    if std::env::var("USE_GPU").unwrap_or_default() != "1" {
        builder = builder.with_force_cpu();
    }
    if let Ok(t) = std::env::var("CHAT_TEMPLATE") {
        if !t.is_empty() {
            builder = builder.with_chat_template(t);
        }
    }
    if let Ok(tok) = std::env::var("TOK_MODEL_ID") {
        if !tok.is_empty() {
            builder = builder.with_tok_model_id(tok);
        }
    }

    let mut model_guard = state.model.lock().await;
    let model = builder
        .build()
        .await
        .map_err(|e| format!("Failed to load model: {e}"))?;

    *model_guard = Some(model);
    // Point model_path at this directory.
    {
        let mut mp = state
            .model_path
            .write()
            .map_err(|e| format!("model_path lock: {e}"))?;
        *mp = dir.clone();
    }



    {
        let mut cf = state
            .connected_model_file
            .write()
            .map_err(|e| format!("connected_model_file lock: {e}"))?;
        *cf = Some(filename.clone());
    }

    println!("[connect_model] Connected: {filename}");
    Ok(format!("Connected to: {filename}"))
}

// ─────────────────────────────────────────────────────────────────────────────
// disconnect_model — unload the current model
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn disconnect_model(state: tauri::State<'_, AppState>) -> Result<(), String> {
    {
        let mut guard = state.model.lock().await;
        *guard = None;
    }
    {
        let mut cf = state
            .connected_model_file
            .write()
            .map_err(|e| format!("Lock error: {e}"))?;
        *cf = None;
    }
    println!("[disconnect_model] Model unloaded");
    Ok(())
}

#[tauri::command]
pub async fn restart_ai_engine(state: tauri::State<'_, AppState>) -> Result<String, String> {
    state.cancel_current_response.store(true, Ordering::Relaxed);
    // Let the request release its own slot before unloading its model. In
    // particular, a remote request does not hold the local model mutex.
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if state.active_request_id.lock().map_err(|e| e.to_string())?.is_none() {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("The response is still stopping. Try restarting again shortly.".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    let _restart = start_request(&state, "engine-restart")?;
    {
        let mut guard = state.model.lock().await;
        *guard = None;
    }
    // load_model uses the connected filename to preserve the user's choice
    // when the directory contains several models.
    let result = load_model(state.clone(), None).await;
    if result.is_err() {
        *state.connected_model_file.write().map_err(|e| e.to_string())? = None;
    }
    result
}

// ─────────────────────────────────────────────────────────────────────────────
// delete_model — remove a .gguf file from disk
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn delete_model(
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&file_path);

    if !path.is_file() || !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("gguf")) {
        return Err("Only a GGUF model file can be deleted.".into());
    }
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    // Refuse to delete the currently loaded model.
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

    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }

    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete: {e}"))?;
    println!("[delete_model] Deleted: {}", path.display());
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// get_models_dir / get_connected_model — status queries
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_models_dir(state: tauri::State<'_, AppState>) -> Result<String, String> {
    Ok(state
        .model_path
        .read()
        .map_err(|e| format!("Lock error: {e}"))?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub fn get_connected_model(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(state
        .connected_model_file
        .read()
        .map_err(|e| format!("Lock error: {e}"))?
        .clone())
}

// ─────────────────────────────────────────────────────────────────────────────
// get_rag_config / save_rag_config — RAG pipeline tuning
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_rag_config(state: tauri::State<'_, AppState>) -> Result<crate::RagConfig, String> {
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
    config: crate::RagConfig,
) -> Result<(), String> {
    config.validate()?;
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("rag-config.json");
    std::fs::create_dir_all(path.parent().ok_or("Invalid config directory")?).map_err(|e| e.to_string())?;
    std::fs::write(path, serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut cfg = state
        .rag_config
        .write()
        .map_err(|e| format!("Lock error: {e}"))?;
    *cfg = config;
    println!(
        "[save_rag_config] chunk_size={}, overlap={}, top_k={}, show_context={}",
        cfg.chunk_size, cfg.chunk_overlap, cfg.top_k, cfg.show_context
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state() -> AppState {
        AppState {
            model_path: std::sync::RwLock::new(PathBuf::new()), model: tokio::sync::Mutex::new(None),
            active_request_id: std::sync::Mutex::new(None), cancel_current_response: std::sync::atomic::AtomicBool::new(false),
            rag_config: std::sync::RwLock::new(crate::RagConfig::default()),
            connected_model_file: std::sync::RwLock::new(None),
        }
    }
    #[test]
    fn failed_requests_release_the_slot_and_duplicate_requests_are_rejected() {
        let state = state();
        let request = start_request(&state, "first").unwrap();
        assert!(start_request(&state, "second").is_err());
        state.cancel_current_response.store(true, Ordering::Relaxed);
        drop(request);
        assert!(state.active_request_id.lock().unwrap().is_none());
        assert!(!state.cancel_current_response.load(Ordering::Relaxed));
        assert!(start_request(&state, "third").is_ok());
    }
    #[test]
    fn rag_config_rejects_settings_that_can_overflow_or_stall_chunking() {
        let mut config = crate::RagConfig::default();
        config.top_k = 0;
        assert!(config.validate().is_err());
        config.top_k = 8; config.chunk_overlap = config.chunk_size;
        assert!(config.validate().is_err());
        config.chunk_size = usize::MAX;
        assert!(config.validate().is_err());
    }
}
