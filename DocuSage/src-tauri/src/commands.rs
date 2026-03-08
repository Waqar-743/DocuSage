use std::path::PathBuf;

use mistralrs::{
    ChatCompletionChunkResponse, ChunkChoice, Delta, GgufModelBuilder, Response,
    TextMessageRole, TextMessages,
};
use tauri::{Emitter, Manager};

use crate::AppState;

/// Payload emitted for each streamed token so the frontend can display
/// partial responses as they arrive.
#[derive(serde::Serialize, Clone)]
struct ChatTokenPayload {
    token: String,
    done: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
// load_model
// ─────────────────────────────────────────────────────────────────────────────

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
    let gguf_files: Vec<String> = std::fs::read_dir(&resolved)
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

    let model = builder
        .build()
        .await
        .map_err(|e| format!("Failed to load model: {e}"))?;

    // ── 4. Store in AppState ────────────────────────────────────────────
    {
        let mut guard = state.model.lock().await;
        *guard = Some(model);
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
) -> Result<String, String> {
    let model_guard = state.model.lock().await;
    let model = model_guard
        .as_ref()
        .ok_or_else(|| "No model loaded. Call load_model first.".to_string())?;

    // Build conversation history.
    let history: Vec<String> = state
        .chat_history
        .lock()
        .map_err(|e| format!("History lock failed: {e}"))?
        .clone();

    let mut messages = TextMessages::new().add_message(
        TextMessageRole::System,
        "You are DocuSage, a helpful, accurate, and privacy-focused AI \
         assistant running entirely on the user's local machine. Keep \
         answers clear and concise.",
    );

    for entry in &history {
        if let Some(text) = entry.strip_prefix("user: ") {
            messages = messages.add_message(TextMessageRole::User, text);
        } else if let Some(text) = entry.strip_prefix("assistant: ") {
            messages = messages.add_message(TextMessageRole::Assistant, text);
        }
    }

    messages = messages.add_message(TextMessageRole::User, &prompt);

    // ── Streaming inference ─────────────────────────────────────────────
    let mut stream = model
        .stream_chat_request(messages)
        .await
        .map_err(|e| format!("Inference failed: {e}"))?;

    let mut full_reply = String::new();

    while let Some(chunk) = stream.next().await {
        match chunk {
            Response::Chunk(ChatCompletionChunkResponse { choices, .. }) => {
                if let Some(ChunkChoice {
                    delta: Delta { content: Some(ref content), .. },
                    ..
                }) = choices.first()
                {
                    full_reply.push_str(content);
                    let _ = app.emit(
                        "chat-token",
                        ChatTokenPayload { token: content.clone(), done: false },
                    );
                }
            }
            Response::Done(_) => break,
            Response::ModelError(msg, _) => return Err(msg),
            Response::InternalError(e) => return Err(e.to_string()),
            Response::ValidationError(e) => return Err(e.to_string()),
            _ => {}
        }
    }

    let _ = app.emit(
        "chat-token",
        ChatTokenPayload { token: String::new(), done: true },
    );

    if full_reply.is_empty() {
        full_reply = "No response generated.".to_string();
    }

    // Persist in history
    {
        let mut h = state
            .chat_history
            .lock()
            .map_err(|e| format!("History lock failed: {e}"))?;
        h.push(format!("user: {prompt}"));
        h.push(format!("assistant: {full_reply}"));
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
) -> Result<String, String> {
    // ── 1. Resolve DB path (no model lock needed) ───────────────────────
    let db_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("lancedb"))
        .or_else(|| dirs::data_local_dir().map(|p| p.join("DocuSage").join("lancedb")))
        .ok_or_else(|| "Cannot determine data directory.".to_string())?;

    // ── 2. Retrieve relevant chunks BEFORE acquiring the model lock ─────
    //   This is the key optimisation: embedding + vector search runs while
    //   the model mutex is free, allowing other requests to proceed.
    let chunks = crate::rag::query_similar(&prompt, &db_dir, 5).await?;

    // ── 3. Acquire model lock ───────────────────────────────────────────
    let model_guard = state.model.lock().await;
    let model = model_guard
        .as_ref()
        .ok_or_else(|| "No model loaded. Call load_model first.".to_string())?;

    // ── 4. Build augmented prompt ───────────────────────────────────────
    let context = if chunks.is_empty() {
        "No relevant documents found. Answer to the best of your knowledge \
         and state that no supporting documents were retrieved."
            .to_string()
    } else {
        let mut ctx = String::from("Use the following document excerpts to answer the user's question. Cite sources using [Source: filename].\n\n");
        for (i, (text, source)) in chunks.iter().enumerate() {
            ctx.push_str(&format!("--- Excerpt {} (Source: {}) ---\n{}\n\n", i + 1, source, text));
        }
        ctx
    };

    let system_prompt = format!(
        "You are DocuSage, a helpful AI assistant that answers questions \
         based on the user's private documents. You are running locally \
         and no data leaves this machine.\n\n{context}"
    );

    let messages = TextMessages::new()
        .add_message(TextMessageRole::System, &system_prompt)
        .add_message(TextMessageRole::User, &prompt);

    // ── 5. Streaming inference ──────────────────────────────────────────
    let mut stream = model
        .stream_chat_request(messages)
        .await
        .map_err(|e| format!("Inference failed: {e}"))?;

    let mut full_reply = String::new();

    while let Some(chunk) = stream.next().await {
        match chunk {
            Response::Chunk(ChatCompletionChunkResponse { choices, .. }) => {
                if let Some(ChunkChoice {
                    delta: Delta { content: Some(ref content), .. },
                    ..
                }) = choices.first()
                {
                    full_reply.push_str(content);
                    let _ = app.emit(
                        "chat-token",
                        ChatTokenPayload { token: content.clone(), done: false },
                    );
                }
            }
            Response::Done(_) => break,
            Response::ModelError(msg, _) => return Err(msg),
            Response::InternalError(e) => return Err(e.to_string()),
            Response::ValidationError(e) => return Err(e.to_string()),
            _ => {}
        }
    }

    let _ = app.emit(
        "chat-token",
        ChatTokenPayload { token: String::new(), done: true },
    );

    if full_reply.is_empty() {
        full_reply = "No response generated.".to_string();
    }

    Ok(full_reply)
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
/// * `state`     — Managed `AppState` (reserved for future use, e.g. caching the
///                 embedding model).
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
    _state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<String, String> {
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

    // ── 3. Offload heavy work to a blocking thread ──────────────────────
    //   PDF parsing and embedding are CPU-bound; running them on the async
    //   executor would starve other Tauri commands.  `spawn_blocking` moves
    //   the closure onto a dedicated thread-pool thread.
    let db_dir_clone = db_dir.clone();
    let pdf_display = pdf_path.display().to_string();

    let result: Result<usize, String> = tauri::async_runtime::spawn_blocking(move || {
        // 3a. Extract text
        let text = crate::rag::extract_text_from_pdf(&pdf_path)?;
        if text.trim().is_empty() {
            return Err(format!(
                "No extractable text found in {}",
                pdf_path.display()
            ));
        }

        // 3b. Chunk (500 chars, 50 overlap — plan defaults)
        let chunks = crate::rag::chunk_text(&text, 500, 50);
        if chunks.is_empty() {
            return Err("Chunking produced zero chunks.".to_string());
        }

        let chunk_count = chunks.len();

        // 3c–d. Init DB + embed & store (async inside blocking via a one-shot runtime)
        //   `init_lancedb` and `embed_and_store` are async (LanceDB operations).
        //   We create a small Tokio runtime here because we are already on a
        //   blocking thread and cannot `.await` directly.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("Failed to create async runtime: {e}"))?;

        rt.block_on(async {
            let db_conn = crate::rag::init_lancedb(&db_dir_clone).await?;
            crate::rag::embed_and_store(
                chunks,
                &pdf_path.display().to_string(),
                &db_conn,
            )
            .await
        })?;

        Ok(chunk_count)
    })
    .await
    .map_err(|e| format!("Ingestion task panicked: {e}"))?;

    let chunk_count = result?;

    Ok(format!(
        "Successfully ingested {chunk_count} chunk(s) from '{pdf_display}' \
         into LanceDB at '{}'.",
        db_dir.display()
    ))
}
