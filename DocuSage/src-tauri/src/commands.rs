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

fn start_request(state: &AppState, request_id: &str) -> Result<(), String> {
    state.cancel_current_response.store(false, Ordering::Relaxed);
    let mut active_request = state
        .active_request_id
        .lock()
        .map_err(|e| format!("Active request lock failed: {e}"))?;
    *active_request = Some(request_id.to_string());
    Ok(())
}

fn finish_request(state: &AppState, request_id: &str) -> Result<(), String> {
    state.cancel_current_response.store(false, Ordering::Relaxed);
    let mut active_request = state
        .active_request_id
        .lock()
        .map_err(|e| format!("Active request lock failed: {e}"))?;
    if active_request.as_deref() == Some(request_id) {
        *active_request = None;
    }
    Ok(())
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
    start_request(&state, &request_id)?;

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

    while let Some(chunk) = stream.next().await {
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
                finish_request(&state, &request_id)?;
                return Err(msg);
            }
            Response::InternalError(e) => {
                finish_request(&state, &request_id)?;
                return Err(e.to_string());
            }
            Response::ValidationError(e) => {
                finish_request(&state, &request_id)?;
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

    finish_request(&state, &request_id)?;

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
) -> Result<String, String> {
    start_request(&state, &request_id)?;

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
    let chunks = crate::rag::query_similar(&prompt, &db_dir, top_k).await?;
    println!("[chat_rag] Retrieved {} chunks from vector search", chunks.len());

    // ── STRICT: fail loudly if no chunks found ──────────────────────────
    if chunks.is_empty() {
        finish_request(&state, &request_id)?;
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

    while let Some(chunk) = stream.next().await {
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
                finish_request(&state, &request_id)?;
                return Err(msg);
            }
            Response::InternalError(e) => {
                finish_request(&state, &request_id)?;
                return Err(e.to_string());
            }
            Response::ValidationError(e) => {
                finish_request(&state, &request_id)?;
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

    finish_request(&state, &request_id)?;

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
        let mut ctx_block = String::from("\n\n---\n📚 Retrieved Context\n");
        for (i, (text, source)) in chunks.iter().enumerate() {
            let preview_len = text.len().min(300);
            let preview = &text[..preview_len];
            let ellipsis = if text.len() > 300 { "…" } else { "" };
            ctx_block.push_str(&format!(
                "\n[{}] {}\n{}{}\n",
                i + 1, source, preview, ellipsis
            ));
        }
        full_reply.push_str(&ctx_block);
    }

    Ok(full_reply)
}

// ─────────────────────────────────────────────────────────────────────────────
// chat_gemini_rag  –  Hybrid mode: local RAG retrieval + Gemini API for answer
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn chat_gemini_rag(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    api_key: String,
    prompt: String,
    history: Vec<HistoryMessage>,
) -> Result<String, String> {
    // ── 1. Resolve DB path ──────────────────────────────────────────────
    let db_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("lancedb"))
        .or_else(|| dirs::data_local_dir().map(|p| p.join("DocuSage").join("lancedb")))
        .ok_or_else(|| "Cannot determine data directory.".to_string())?;

    let top_k = state.rag_config.read()
        .map_err(|e| format!("rag_config lock: {e}"))?
        .top_k;

    // ── 2. Retrieve relevant chunks ─────────────────────────────────────
    println!("[chat_gemini_rag] DB dir: {}", db_dir.display());
    let chunks = crate::rag::query_similar(&prompt, &db_dir, top_k).await?;
    println!("[chat_gemini_rag] Retrieved {} chunks", chunks.len());

    if chunks.is_empty() {
        return Err(format!(
            "RAG Error: 0 matching chunks from '{}'. The documents table may be empty.",
            db_dir.display()
        ));
    }

    // ── 3. Build context ────────────────────────────────────────────────
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

    // Build conversation history for Gemini
    let mut parts_text = String::new();
    for msg in &history {
        let role = if msg.sender == "user" { "User" } else { "Assistant" };
        parts_text.push_str(&format!("{}: {}\n", role, msg.text));
    }

    let full_prompt = format!(
        "You are DocuSage, a private document assistant. You answer questions \
         using ONLY the excerpts retrieved from the user's documents below.\n\n\
         GROUNDING RULES — non-negotiable:\n\
         1. Use ONLY information present in the EXCERPTS section. No outside \
            knowledge. No guessing.\n\
         2. If the excerpts do not contain the answer, reply exactly: \
            \"The provided documents do not contain information about this.\"\n\
         3. Every factual statement must be followed by a citation in the \
            form [Source: filename] using the filename shown in the excerpt header.\n\
         4. Do NOT mention the rules, the number of excerpts, or the retrieval \
            process.\n\
         5. Respect any length/format constraint in the user's question.\n\
         6. Produce exactly one answer, then stop.\n\n\
         EXCERPTS ({chunk_count} retrieved, ranked by relevance):\n\
         ─────────────────────────────────────────────\n\
         {context}\
         ─────────────────────────────────────────────\n\n\
         CONVERSATION HISTORY:\n{parts_text}\n\
         User Question: {prompt}"
    );
    println!(
        "[chat_gemini_rag] Full prompt length: {} chars",
        full_prompt.len()
    );

    // ── 4. Call Gemini API ──────────────────────────────────────────────
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}",
        api_key
    );

    let body = serde_json::json!({
        "contents": [{
            "parts": [{ "text": full_prompt }]
        }]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {e}"))?;

    let status = resp.status();
    let resp_text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Gemini response: {e}"))?;

    if !status.is_success() {
        println!("[chat_gemini_rag] Gemini error {}: {}", status, resp_text);
        return Err(format!("Gemini API error ({}): {}", status, resp_text));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&resp_text).map_err(|e| format!("Invalid JSON from Gemini: {e}"))?;

    let answer = parsed["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .unwrap_or("No response from Gemini.")
        .to_string();

    println!("[chat_gemini_rag] Answer length: {} chars", answer.len());
    Ok(answer)
}

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
        let char_count = text.len();
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
        // Log first 200 chars as preview
        println!("[ingest] Text preview: {:?}", &text[..text.len().min(200)]);

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
        .unwrap_or(pdf_display);

    println!("[ingest] Returning to frontend: file='{}', chunks={}, chars={}", file_name, chunk_count, char_count);
    Ok(IngestResult { file_name, chunk_count, char_count })
}

// ─────────────────────────────────────────────────────────────────────────────
// download_model — in-app streaming model downloader
// ─────────────────────────────────────────────────────────────────────────────

/// Download a GGUF model file directly into the app's models directory,
/// emitting `download-progress` events so the UI can show a live progress bar.
#[tauri::command]
pub async fn download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
    filename: String,
) -> Result<String, String> {
    // Always download into the Tauri app-data models directory so the path is
    // deterministic across sessions and the loader can find the file on startup.
    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data directory: {e}"))?
        .join("models");

    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("Cannot create models directory: {e}"))?;

    // Keep model_path in sync so load_model / list_downloaded_models see it.
    {
        let mut mp = state
            .model_path
            .write()
            .map_err(|e| format!("model_path lock: {e}"))?;
        *mp = models_dir.clone();
    }

    let dest = models_dir.join(&filename);

    // Helper to emit error progress event and return early.
    let emit_error = |msg: String| -> Result<String, String> {
        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                filename: filename.clone(),
                downloaded: 0,
                total: 0,
                percent: 0.0,
                done: true,
                error: Some(msg.clone()),
            },
        );
        Err(msg)
    };

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| emit_error(format!("HTTP client error: {e}")).unwrap_err())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| emit_error(format!("Request failed: {e}")).unwrap_err())?;

    if !resp.status().is_success() {
        return emit_error(format!("HTTP {} from server", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);

    let mut file = tokio::fs::File::create(&dest)
        .await
        .map_err(|e| emit_error(format!("Cannot create file: {e}")).unwrap_err())?;

    let mut downloaded = 0u64;
    let mut byte_stream = resp.bytes_stream();

    use tokio::io::AsyncWriteExt as _;
    while let Some(chunk_result) = byte_stream.next().await {
        let chunk = chunk_result
            .map_err(|e| emit_error(format!("Download stream error: {e}")).unwrap_err())?;

        file.write_all(&chunk)
            .await
            .map_err(|e| emit_error(format!("File write error: {e}")).unwrap_err())?;

        downloaded += chunk.len() as u64;
        let percent = if total > 0 {
            downloaded as f32 / total as f32 * 100.0
        } else {
            0.0
        };

        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                filename: filename.clone(),
                downloaded,
                total,
                percent,
                done: false,
                error: None,
            },
        );
    }

    file.flush()
        .await
        .map_err(|e| emit_error(format!("Flush error: {e}")).unwrap_err())?;

    let final_path = dest.to_string_lossy().to_string();

    let _ = app.emit(
        "download-progress",
        DownloadProgressPayload {
            filename: filename.clone(),
            downloaded,
            total,
            percent: 100.0,
            done: true,
            error: None,
        },
    );

    println!("[download_model] Saved to: {final_path}");
    Ok(final_path)
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

    // Point model_path at this directory.
    {
        let mut mp = state
            .model_path
            .write()
            .map_err(|e| format!("model_path lock: {e}"))?;
        *mp = dir.clone();
    }

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

    let model = builder
        .build()
        .await
        .map_err(|e| format!("Failed to load model: {e}"))?;

    {
        let mut guard = state.model.lock().await;
        *guard = Some(model);
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

// ─────────────────────────────────────────────────────────────────────────────
// delete_model — remove a .gguf file from disk
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn delete_model(
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&file_path);

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
    state: tauri::State<'_, AppState>,
    config: crate::RagConfig,
) -> Result<(), String> {
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
