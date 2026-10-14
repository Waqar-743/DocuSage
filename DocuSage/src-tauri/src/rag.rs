//! RAG ingestion engine for DocuSage.
//!
//! This module implements the full document ingestion pipeline:
//! 1. Extract raw text from a PDF file.
//! 2. Split text into overlapping chunks suitable for embedding.
//! 3. Initialize (or open) a local LanceDB vector store.
//! 4. Generate embeddings via `fastembed` and persist them alongside metadata.
//!
//! All public functions return `Result<_, String>` so callers (Tauri commands)
//! can surface errors directly to the frontend without panicking.

use std::path::Path;
use std::sync::{Arc, OnceLock};

use arrow_array::{
    FixedSizeListArray, Float32Array, Int32Array, RecordBatch, RecordBatchIterator,
    StringArray,
};
use arrow_schema::{DataType, Field, Schema};
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// The embedding model shipped with DocuSage.
/// BAAI/bge-small-en-v1.5 produces 384-dimensional vectors and offers an
/// excellent quality/speed trade-off for local RAG on consumer hardware.
const EMBEDDING_MODEL: EmbeddingModel = EmbeddingModel::BGESmallENV15;

/// Dimensionality of the vectors produced by [`EMBEDDING_MODEL`].
/// This **must** match the model — a mismatch will cause LanceDB schema errors.
const EMBEDDING_DIM: i32 = 384;

/// Name of the LanceDB table that stores document chunks + vectors.
const TABLE_NAME: &str = "documents";

/// Lazily-initialised singleton embedding model.
///
/// Avoids the cost of loading the ONNX model on every request.
static EMBEDDING: OnceLock<TextEmbedding> = OnceLock::new();
static EMBEDDING_INIT: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Return a reference to the shared [`TextEmbedding`] instance, creating it
/// on first access.
pub fn get_embedding() -> Result<&'static TextEmbedding, String> {
    if let Some(m) = EMBEDDING.get() {
        return Ok(m);
    }
    let _guard = EMBEDDING_INIT.lock().map_err(|e| format!("Embedding initialization lock: {e}"))?;
    if let Some(m) = EMBEDDING.get() {
        return Ok(m);
    }
    let cache_dir = dirs::data_local_dir().ok_or("Cannot resolve embedding cache directory")?
        .join("com.docusage.app").join("embeddings");
    let model = TextEmbedding::try_new(
        InitOptions::new(EMBEDDING_MODEL)
            .with_cache_dir(cache_dir)
            .with_show_download_progress(true),
    )
    .map_err(|e| format!("Failed to initialise embedding model: {e}"))?;
    let _ = EMBEDDING.set(model);
    Ok(EMBEDDING.get().expect("just initialised"))
}

/// Build a `FixedSizeList<Float32>` array from a flat `Float32Array`.
///
/// Each row contains exactly [`EMBEDDING_DIM`] floats.  The input length
/// must be an exact multiple of `EMBEDDING_DIM`.
fn make_fslist(values: Float32Array) -> Result<FixedSizeListArray, String> {
    let field = Arc::new(Field::new("item", DataType::Float32, true));
    let len = values.len();
    let dim = EMBEDDING_DIM as usize;
    if dim > 0 && len % dim != 0 {
        return Err(format!(
            "Flat values length ({len}) is not a multiple of embedding dim ({dim})"
        ));
    }
    let row_count = if dim == 0 { 0 } else { len / dim };
    FixedSizeListArray::try_new(field, EMBEDDING_DIM, Arc::new(values), None)
        .map_err(|e| format!("FixedSizeListArray construction failed (rows={row_count}): {e}"))
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PDF text extraction
// ─────────────────────────────────────────────────────────────────────────────

/// Extract all text content from a PDF file.
///
/// Uses `pdf_extract::extract_text` which handles most common PDF encodings.
/// Returns the full concatenated text on success, or a human-readable error
/// string on failure (missing file, corrupt PDF, etc.).
pub fn extract_text_from_pdf(file_path: &Path) -> Result<String, String> {
    if !file_path.exists() {
        return Err(format!("PDF file not found: {}", file_path.display()));
    }

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    if !ext.eq_ignore_ascii_case("pdf") {
        return Err(format!(
            "Expected a .pdf file, got .{ext}: {}",
            file_path.display()
        ));
    }

    let bytes = std::fs::read(file_path)
        .map_err(|e| format!("Failed to read {}: {e}", file_path.display()))?;

    pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| format!("PDF extraction failed for {}: {e}", file_path.display()))
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Text chunking
// ─────────────────────────────────────────────────────────────────────────────

/// Split `text` into overlapping, sentence-aware chunks of roughly
/// `chunk_size` characters with `overlap` characters of overlap between
/// neighbouring chunks.
///
/// # Strategy
/// Recursive-character splitting along natural boundaries (paragraph →
/// sentence → word → char). This keeps semantic units intact, which
/// dramatically improves retrieval quality compared to a fixed char window
/// that splits mid-sentence.
///
/// 1. Normalize whitespace within paragraphs but preserve paragraph breaks.
/// 2. Greedily pack paragraphs/sentences into chunks up to ~`chunk_size`
///    characters.
/// 3. Carry a tail of `overlap` characters (snapped to a sentence boundary
///    where possible) into the next chunk so context isn't lost at boundaries.
pub fn chunk_text(text: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    if text.trim().is_empty() {
        return Vec::new();
    }
    if chunk_size == 0 {
        return vec![text.trim().to_string()];
    }
    let overlap = overlap.min(chunk_size.saturating_sub(1));

    // Split on blank lines first to preserve paragraph structure, then
    // collapse internal whitespace within each paragraph.
    let paragraphs: Vec<String> = text
        .split("\n\n")
        .map(|p| p.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|p| !p.is_empty())
        .collect();

    // Break paragraphs that exceed chunk_size into sentences.
    let mut units: Vec<String> = Vec::new();
    for para in paragraphs {
        if para.chars().count() <= chunk_size {
            units.push(para);
        } else {
            units.extend(split_into_sentences(&para, chunk_size));
        }
    }

    // Greedy pack units into chunks, with a sentence-aligned overlap tail.
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut current_len = 0usize;

    for unit in units {
        let unit_len = unit.chars().count();
        let sep_len = if current.is_empty() { 0 } else { 1 };

        if current_len + sep_len + unit_len > chunk_size && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
            // Seed the next chunk with the overlap tail of the previous one.
            if overlap > 0 {
                let last = chunks.last().unwrap();
                // Leave space for the next unit; overlap must never push a
                // chunk beyond the configured size.
                let tail = take_tail(last, overlap.min(chunk_size.saturating_sub(unit_len + 1)));
                current.push_str(&tail);
                current_len = current.chars().count();
            } else {
                current_len = 0;
            }
        }

        if !current.is_empty() {
            current.push(' ');
            current_len += 1;
        }
        current.push_str(&unit);
        current_len += unit_len;
    }

    if !current.trim().is_empty() {
        chunks.push(current);
    }

    chunks
}

/// Split a long paragraph into sentence-sized fragments, falling back to a
/// hard char-window split for any sentence that itself exceeds `max_len`.
fn split_into_sentences(paragraph: &str, max_len: usize) -> Vec<String> {
    let mut sentences: Vec<String> = Vec::new();
    let mut buf = String::new();
    for ch in paragraph.chars() {
        buf.push(ch);
        if matches!(ch, '.' | '!' | '?') {
            let trimmed = buf.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(trimmed);
            }
            buf.clear();
        }
    }
    let tail = buf.trim().to_string();
    if !tail.is_empty() {
        sentences.push(tail);
    }

    let mut out = Vec::new();
    for s in sentences {
        if s.chars().count() <= max_len {
            out.push(s);
        } else {
            // Hard-split overlong sentences as a last resort.
            let chars: Vec<char> = s.chars().collect();
            for window in chars.chunks(max_len) {
                out.push(window.iter().collect());
            }
        }
    }
    out
}

/// Take the last `n` characters of `s`, snapping to a sentence boundary
/// when one falls within the tail so the overlap reads cleanly.
fn take_tail(s: &str, n: usize) -> String {
    if n == 0 { return String::new(); }
    let chars: Vec<char> = s.chars().collect();
    let total = chars.len();
    if total <= n {
        return s.to_string();
    }
    let start = total - n;
    let tail: String = chars[start..].iter().collect();
    if let Some(idx) = tail.find(['.', '!', '?']) {
        let trimmed = tail[idx + 1..].trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    tail
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. LanceDB initialisation
// ─────────────────────────────────────────────────────────────────────────────

/// Build the Arrow schema used for the `documents` table.
///
/// Columns:
/// | Name         | Arrow type                         | Purpose                       |
/// |--------------|------------------------------------|-------------------------------|
/// | id           | Int32                              | Monotonic row id              |
/// | source_path  | Utf8                               | Original PDF path (citations) |
/// | chunk_index  | Int32                              | Chunk position in source PDF  |
/// | text         | Utf8                               | Raw chunk body                |
/// | vector       | FixedSizeList\<Float32\>(384)      | Embedding vector              |
fn documents_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Int32, false),
        Field::new("source_path", DataType::Utf8, false),
        Field::new("chunk_index", DataType::Int32, false),
        Field::new("text", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                EMBEDDING_DIM,
            ),
            false,
        ),
    ]))
}

/// Connect to a local LanceDB directory and ensure the `documents` table exists.
///
/// - Creates the parent directory tree if missing.
/// - If the table already exists it is left untouched (data preserved).
/// - If the table does not exist it is created with an empty seed batch so the
///   schema is locked in.
pub async fn init_lancedb(db_path: &Path) -> Result<lancedb::Connection, String> {
    // Ensure the directory tree exists.
    std::fs::create_dir_all(db_path)
        .map_err(|e| format!("Cannot create DB directory {}: {e}", db_path.display()))?;

    let db = lancedb::connect(db_path.to_str().ok_or_else(|| {
        format!(
            "DB path contains invalid UTF-8: {}",
            db_path.display()
        )
    })?)
    .execute()
    .await
    .map_err(|e| format!("LanceDB connection failed: {e}"))?;

    // Check whether the table already exists.
    let tables = db
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("Failed to list tables: {e}"))?;

    if !tables.iter().any(|t| t == TABLE_NAME) {
        // Create an empty seed batch so the schema is established.
        let schema = documents_schema();
        let empty_batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int32Array::from(Vec::<i32>::new())),
                Arc::new(StringArray::from(Vec::<&str>::new())),
                Arc::new(Int32Array::from(Vec::<i32>::new())),
                Arc::new(StringArray::from(Vec::<&str>::new())),
                Arc::new(
                    make_fslist(Float32Array::from(Vec::<f32>::new()))?,
                ),
            ],
        )
        .map_err(|e| format!("Failed to build seed RecordBatch: {e}"))?;

        let batches = RecordBatchIterator::new(vec![Ok(empty_batch)], schema);

        db.create_table(TABLE_NAME, Box::new(batches))
            .execute()
            .await
            .map_err(|e| format!("Failed to create '{TABLE_NAME}' table: {e}"))?;
    }

    Ok(db)
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Embed & store
// ─────────────────────────────────────────────────────────────────────────────

/// Generate embeddings for `chunks` and insert them into the LanceDB `documents`
/// table together with source metadata.
///
/// # Arguments
/// * `chunks`      — text chunks produced by [`chunk_text`].
/// * `source_path` — original PDF path string, stored alongside each chunk for
///                    citation reconstruction.
/// * `db_conn`     — an open LanceDB connection (from [`init_lancedb`]).
///
/// # Embedding strategy
/// `fastembed::TextEmbedding` is initialised with [`EMBEDDING_MODEL`] on every
/// call.  In a future phase the model should be cached in `AppState` to avoid
/// reload overhead on repeated ingests.
///
/// # Errors
/// Returns a `String` error on embedding failure, schema mismatch, or write
/// failure.
pub async fn embed_and_store(
    chunks: Vec<String>,
    source_path: &str,
    db_conn: &lancedb::Connection,
) -> Result<(), String> {
    if chunks.is_empty() {
        return Ok(());
    }

    // ── 1. Get the cached embedding model ────────────────────────────────
    let model = get_embedding()?;

    // ── 2. Generate embeddings ──────────────────────────────────────────
    // fastembed expects Vec<String>; we already have that.
    let embeddings: Vec<Vec<f32>> = model
        .embed(chunks.clone(), None)
        .map_err(|e| format!("Embedding generation failed: {e}"))?;

    // Sanity-check dimensions.
    if let Some(first) = embeddings.first() {
        if first.len() != EMBEDDING_DIM as usize {
            return Err(format!(
                "Dimension mismatch: model produced {} but schema expects {EMBEDDING_DIM}",
                first.len()
            ));
        }
    }

    let num_chunks = chunks.len() as i32;

    // ── 3. Build an Arrow RecordBatch ───────────────────────────────────
    //
    // Determine a starting id by querying the existing row count so ids stay
    // monotonically increasing across multiple ingests.
    let table = db_conn
        .open_table(TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("Failed to open '{TABLE_NAME}': {e}"))?;

    let existing_rows = table
        .count_rows(None)
        .await
        .map_err(|e| format!("Failed to count rows: {e}"))? as i32;

    let ids: Vec<i32> = (existing_rows..existing_rows + num_chunks).collect();
    let chunk_indices: Vec<i32> = (0..num_chunks).collect();
    let source_paths: Vec<&str> = vec![source_path; chunks.len()];

    // Flatten embeddings into a single Float32Array, then wrap in FixedSizeList.
    let flat_values: Vec<f32> = embeddings.into_iter().flatten().collect();
    let values_array = Float32Array::from(flat_values);
    let vector_array = make_fslist(values_array)?;

    let schema = documents_schema();
    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(Int32Array::from(ids)),
            Arc::new(StringArray::from(source_paths)),
            Arc::new(Int32Array::from(chunk_indices)),
            Arc::new(StringArray::from(chunks)),
            Arc::new(vector_array),
        ],
    )
    .map_err(|e| format!("Failed to build RecordBatch: {e}"))?;

    // Replace all chunks of this source in one transaction. Re-ingestion
    // updates changed PDFs without accumulating stale duplicate evidence.
    let batches = RecordBatchIterator::new(vec![Ok(batch)], schema);

    println!("[rag] Replacing source chunks in '{TABLE_NAME}' ({num_chunks} chunks)");
    let mut merge = table.merge_insert(&["source_path", "chunk_index"]);
    merge.when_matched_update_all(None)
        .when_not_matched_insert_all()
        .when_not_matched_by_source_delete(Some(source_filter(source_path)));
    merge
        .execute(Box::new(batches))
        .await
        .map_err(|e| format!("LanceDB insert failed: {e}"))?;

    let new_total = table
        .count_rows(None)
        .await
        .map_err(|e| format!("Failed to count rows after insert: {e}"))? as i32;
    println!("[rag] Source updated. Row count: {existing_rows} -> {new_total}");

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Vector similarity query
// ─────────────────────────────────────────────────────────────────────────────

/// Embed a natural-language query and retrieve the `top_k` most similar
/// document chunks from the LanceDB `documents` table.
///
/// Returns a `Vec<(text, source_path)>` ordered by descending similarity.
pub async fn query_similar(
    query: &str,
    db_path: &Path,
    top_k: usize,
    source_path: Option<&str>,
) -> Result<Vec<(String, String)>, String> {
    if !(1..=20).contains(&top_k) { return Err("Top-K must be between 1 and 20.".into()); }

    // ── 1. Embed the query ──────────────────────────────────────────────
    // BGE retrieval models are trained with an asymmetric instruction: the
    // query is prefixed, the passages are not. Skipping this prefix is a
    // common silent quality regression — relevance scores drop ~5-10 %.
    let prefixed_query = format!(
        "Represent this sentence for searching relevant passages: {}",
        query
    );
    let embeddings = tauri::async_runtime::spawn_blocking(move || {
        get_embedding()?.embed(vec![prefixed_query], None)
            .map_err(|e| format!("Query embedding failed: {e}"))
    }).await.map_err(|e| format!("Query embedding task failed: {e}"))??;

    let query_vec: Vec<f32> = embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "No embedding produced for query".to_string())?;
    println!("[rag-query] Query vector generated ({} dimensions)", query_vec.len());

    // ── 2. Open DB + table ──────────────────────────────────────────────
    let db_str = db_path.to_str().ok_or_else(|| {
        format!("DB path contains invalid UTF-8: {}", db_path.display())
    })?;

    let db = lancedb::connect(db_str)
        .execute()
        .await
        .map_err(|e| format!("LanceDB connection failed: {e}"))?;

    let tables = db
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("Failed to list tables: {e}"))?;
    println!("[rag-query] Tables found in DB: {:?}", tables);

    if !tables.iter().any(|t| t == TABLE_NAME) {
        println!("[rag-query] ERROR: '{}' table does NOT exist in DB!", TABLE_NAME);
        return Err(format!(
            "RAG Error: The '{}' table does not exist in the database at {}. \
             Have you ingested a document?",
            TABLE_NAME, db_path.display()
        ));
    }

    let table = db
        .open_table(TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("Failed to open table: {e}"))?;

    let total_rows = table
        .count_rows(None)
        .await
        .map_err(|e| format!("Failed to count rows: {e}"))?;
    println!("[rag-query] Table '{}' opened, total rows: {}", TABLE_NAME, total_rows);

    // ── 3. Vector search ────────────────────────────────────────────────
    use lancedb::query::{ExecutableQuery, QueryBase};
    use futures_util::TryStreamExt;

    // Over-fetch so we can dedup near-duplicate chunks (common when the
    // same paragraph appears multiple times due to overlap or boilerplate)
    // before returning the final top_k.
    let fetch_k = (top_k * 3).max(top_k + 5);
    let mut search = table
        .vector_search(query_vec)
        .map_err(|e| format!("Vector search setup failed: {e}"))?
        .limit(fetch_k);
    if let Some(source) = source_path {
        search = search.only_if(source_filter(source));
    }
    let stream = search
        .execute()
        .await
        .map_err(|e| format!("Vector search execution failed: {e}"))?;

    // ── 4. Collect results from the RecordBatch stream ──────────────────
    let mut output: Vec<(String, String)> = Vec::new();

    let batches: Vec<RecordBatch> = stream
        .try_collect()
        .await
        .map_err(|e| format!("Failed to collect search results: {e}"))?;

    for batch in &batches {
        let text_col: &dyn arrow_array::Array = batch
            .column_by_name("text")
            .ok_or_else(|| "Missing 'text' column in results".to_string())?;
        let source_col: &dyn arrow_array::Array = batch
            .column_by_name("source_path")
            .ok_or_else(|| "Missing 'source_path' column in results".to_string())?;

        let text_arr = text_col
            .as_any()
            .downcast_ref::<StringArray>()
            .ok_or_else(|| "Cannot cast 'text' column to StringArray".to_string())?;
        let source_arr = source_col
            .as_any()
            .downcast_ref::<StringArray>()
            .ok_or_else(|| "Cannot cast 'source_path' column to StringArray".to_string())?;

        for i in 0..batch.num_rows() {
            let text = text_arr.value(i).to_string();
            let source = source_arr.value(i).to_string();
            // Extract just the filename from the full path
            let filename = source
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or(&source)
                .to_string();
            output.push((text, filename));
        }
    }

    // Dedup near-duplicate chunks (Jaccard on the first ~80 tokens) — keeps
    // the LLM context diverse so we don't waste budget on copies of the
    // same paragraph from overlapping windows or repeated boilerplate.
    output = dedup_chunks(output, top_k);

    println!("[rag-query] Vector search returned {} chunks", output.len());

    Ok(output)
}

/// Drop chunks that are near-duplicates of an already-selected chunk so the
/// final context window contains diverse evidence rather than copies of the
/// same paragraph. Order is preserved (highest similarity first).
fn dedup_chunks(
    chunks: Vec<(String, String)>,
    keep: usize,
) -> Vec<(String, String)> {
    if keep == 0 { return Vec::new(); }
    let mut selected_tokens: Vec<std::collections::HashSet<String>> = Vec::new();
    let mut out: Vec<(String, String)> = Vec::new();
    for (text, src) in chunks {
        let toks: std::collections::HashSet<String> = text
            .split_whitespace()
            .take(80)
            .map(|t| t.to_lowercase())
            .collect();
        let dup = selected_tokens.iter().any(|prev| {
            let inter = toks.intersection(prev).count() as f32;
            let union = toks.union(prev).count().max(1) as f32;
            (inter / union) > 0.7
        });
        if !dup {
            selected_tokens.push(toks);
            out.push((text, src));
            if out.len() >= keep {
                break;
            }
        }
    }
    out
}

/// Quote a path as a SQL string literal; apostrophes in filenames are valid.
pub fn source_filter(source: &str) -> String {
    format!("source_path = '{}'", source.replace('\'', "''"))
}

pub fn canonical_source(path: &str) -> String {
    std::fs::canonicalize(path).unwrap_or_else(|_| Path::new(path).to_path_buf())
        .to_string_lossy().into_owned()
}

pub async fn delete_source(db_path: &Path, source: &str) -> Result<(), String> {
    let db = init_lancedb(db_path).await?;
    db.open_table(TABLE_NAME).execute().await.map_err(|e| e.to_string())?
        .delete(&source_filter(source)).await.map(|_| ()).map_err(|e| format!("Cannot remove document from index: {e}"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedDocument {
    pub path: String,
    pub chunk_count: usize,
}

pub async fn indexed_documents(db_path: &Path) -> Result<Vec<IndexedDocument>, String> {
    use futures_util::TryStreamExt;
    use lancedb::query::{ExecutableQuery, QueryBase, Select};
    if !db_path.exists() { return Ok(Vec::new()); }
    let db = init_lancedb(db_path).await?;
    let table = db.open_table(TABLE_NAME).execute().await.map_err(|e| e.to_string())?;
    let batches: Vec<RecordBatch> = table.query().select(Select::columns(&["source_path"]))
        .execute().await.map_err(|e| e.to_string())?
        .try_collect().await.map_err(|e| e.to_string())?;
    let mut counts = std::collections::BTreeMap::new();
    for batch in batches {
        let paths = batch.column_by_name("source_path").and_then(|c| c.as_any().downcast_ref::<StringArray>())
            .ok_or("Invalid source_path column")?;
        for path in paths.iter().flatten() { *counts.entry(path.to_owned()).or_insert(0) += 1; }
    }
    Ok(counts.into_iter().map(|(path, chunk_count)| IndexedDocument { path, chunk_count }).collect())
}

pub fn context_appendix(chunks: &[(String, String)]) -> String {
    let mut text = String::from("\n\n---\nRetrieved Context\n");
    for (i, (chunk, source)) in chunks.iter().enumerate() {
        text.push_str(&format!("\n[{}] {}\n{}\n", i + 1, source, chunk));
    }
    text
}

/// Count the total number of rows in the `documents` table.
/// Used for post-insertion verification.
pub async fn verify_row_count(db_conn: &lancedb::Connection) -> Result<usize, String> {
    let tables = db_conn
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("Failed to list tables: {e}"))?;

    if !tables.iter().any(|t| t == TABLE_NAME) {
        return Ok(0);
    }

    let table = db_conn
        .open_table(TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("Failed to open '{TABLE_NAME}': {e}"))?;

    table
        .count_rows(None)
        .await
        .map_err(|e| format!("Failed to count rows: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use arrow_array::Array;

    #[test]
    fn unicode_chunks_are_bounded_and_keep_the_last_passage() {
        let text = format!("{}\n\nA final sentence.", "你好🌿. ".repeat(100));
        let chunks = chunk_text(&text, 40, 35);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 40));
        assert!(chunks.last().unwrap().contains("A final sentence."));
        assert!(chunks.len() < 200);
    }

    #[test]
    fn chunking_handles_empty_text_and_extreme_overlap() {
        assert!(chunk_text(" \n\t", 20, 10).is_empty());
        assert_eq!(chunk_text("  hello  ", 0, 10), vec!["hello"]);
        let chunks = chunk_text(&"x".repeat(101), 20, usize::MAX);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 20));
        // Overlap intentionally repeats characters in the last short chunk.
        assert!(chunks.iter().map(|chunk| chunk.matches('x').count()).sum::<usize>() >= 101);
        assert_eq!(chunks.len(), 6);
    }

    #[test]
    fn filters_escape_apostrophes_in_valid_filenames() {
        assert_eq!(source_filter("/tmp/O'Brien.pdf"), "source_path = '/tmp/O''Brien.pdf'");
    }

    #[test]
    fn malformed_embedding_dimensions_fail_without_panicking() {
        assert!(make_fslist(Float32Array::from(vec![0.0; 383])).is_err());
        assert_eq!(make_fslist(Float32Array::from(vec![0.0; 384])).unwrap().len(), 1);
    }

    #[test]
    fn duplicate_context_does_not_fill_the_retrieval_budget() {
        let chunks = vec![("The safety review is on Friday.".into(), "a.pdf".into()),
            ("The safety review is on Friday.".into(), "a.pdf".into()),
            ("The calibration interval is six months.".into(), "b.pdf".into())];
        assert_eq!(dedup_chunks(chunks.clone(), 2).len(), 2);
        assert!(dedup_chunks(chunks, 0).is_empty());
    }

    #[tokio::test]
    async fn deleting_one_source_preserves_other_indexed_documents() {
        let path = std::env::temp_dir().join(format!("docusage-index-test-{}", std::process::id()));
        let db = init_lancedb(&path).await.unwrap();
        let schema = documents_schema();
        let batch = RecordBatch::try_new(schema.clone(), vec![
            Arc::new(Int32Array::from(vec![0, 1])),
            Arc::new(StringArray::from(vec!["/tmp/O'Brien.pdf", "/tmp/other.pdf"])),
            Arc::new(Int32Array::from(vec![0, 0])),
            Arc::new(StringArray::from(vec!["First document", "Other document"])),
            Arc::new(make_fslist(Float32Array::from(vec![0.0; 768])).unwrap()),
        ]).unwrap();
        db.open_table(TABLE_NAME).execute().await.unwrap()
            .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute().await.unwrap();
        assert_eq!(indexed_documents(&path).await.unwrap().len(), 2);
        delete_source(&path, "/tmp/O'Brien.pdf").await.unwrap();
        let remaining = indexed_documents(&path).await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].path, "/tmp/other.pdf");
        assert_eq!(remaining[0].chunk_count, 1);
        drop(db);
        std::fs::remove_dir_all(path).unwrap();
    }
}
