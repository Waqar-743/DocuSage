# Plan: DocuSage Phase 2 RAG Ingestion Pipeline

Implement Phase 2 by adding a dedicated `rag.rs` ingestion engine (`PDF extract -> chunk -> embed -> LanceDB store`), then minimally wiring `commands.rs` and `lib.rs` to expose `ingest_document` without regressing Phase 1 behavior.

**Confirmed decisions**
1. Embedding model: `BAAI/bge-small-en-v1.5`
2. DB path policy: `app_data_dir` first, then `dirs::data_local_dir` fallback
3. Chunking defaults: `chunk_size = 500`, `overlap = 50`

**Steps**
1. Update `/workspaces/DocuSage/DocuSage/src-tauri/Cargo.toml`  
Add `fastembed`, `arrow-array`, and `arrow-schema` (keep all existing Phase 1 deps).

2. Create `/workspaces/DocuSage/DocuSage/src-tauri/src/rag.rs`  
Implement:
- `extract_text_from_pdf(file_path: &Path) -> Result<String, String>`
- `chunk_text(text: &str, chunk_size: usize, overlap: usize) -> Vec<String>`
- `init_lancedb(db_path: &Path) -> Result<lancedb::Connection, String>`
- `embed_and_store(chunks: Vec<String>, db_conn: &lancedb::Connection) -> Result<(), String>`

3. Update `/workspaces/DocuSage/DocuSage/src-tauri/src/commands.rs`  
Add:
- `ingest_document(app: tauri::AppHandle, state: tauri::State<AppState>, file_path: String) -> Result<String, String>`
Flow:
- Validate/resolve input PDF path
- Resolve DB dir via `app_data_dir` -> `data_local_dir`
- Offload heavy work via `tauri::async_runtime::spawn_blocking`
- Run extract -> chunk -> init DB -> embed/store
- Return processed chunk count + DB path

4. Update `/workspaces/DocuSage/DocuSage/src-tauri/src/lib.rs`  
- Add `mod rag;`
- Register `commands::ingest_document` in `tauri::generate_handler![...]`
- Keep existing state/locks unless required for compile compatibility

5. Verify
- `cd /workspaces/DocuSage/DocuSage/src-tauri && cargo check`
- Confirm ingest success for a valid PDF
- Confirm structured `Err(String)` for invalid path/non-PDF
- Confirm LanceDB artifacts under app data path

**Schema choice (for implementation)**
Use a `documents` table with:
- `id` (stable row identifier)
- `source_path` (for citation traceability)
- `chunk_index` (ordering and source reconstruction)
- `text` (raw chunk body)
- `vector` (`FixedSizeList<Float32>`, dimension from pinned embedding model)

This balances retrieval quality, citation support, and future upsert/dedup workflows.
