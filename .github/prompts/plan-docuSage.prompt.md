# Plan: DocuSage Phase 1 — Backend Scaffold

## TL;DR
Scaffold the Tauri v2 Rust backend for DocuSage: add all dependencies to Cargo.toml, configure filesystem permissions, build the `AppState` with thread-safe locks, wire up Tauri managed state, and implement three mocked Tauri commands (`load_model`, `chat_general`, `chat_rag`) with fully working path resolution (dotenv + dirs fallback).

---

## Phase 1A: Dependencies & Configuration

### Step 1 — Update `src-tauri/Cargo.toml`
Add production dependencies to the existing Cargo.toml. Keep existing `tauri`, `tauri-plugin-opener`, `serde`, `serde_json`. Add:

| Crate | Version | Features/Notes |
|---|---|---|
| `tokio` | `1` | `features = ["full"]` — async runtime for mistralrs + lancedb |
| `mistralrs` | `0.7` | LLM inference engine (GGUF support) |
| `lancedb` | `0.26` | Embedded vector DB |
| `pdf-extract` | `0.10` | PDF text extraction |
| `dotenv` | `0.15` | `.env` file loading |
| `dirs` | `6.0` | Cross-platform OS directory resolution |
| `tauri-plugin-fs` | `2` | Filesystem access plugin for Tauri v2 |
| `lzma-sys` | `*` | `features = ["static"]` — static linking for lancedb transitive dep |

**Decision**: Pin major versions only (e.g. `"0.7"` not `"0.7.0"`) for flexibility within semver.

### Step 2 — Update `src-tauri/tauri.conf.json`
No structural changes needed to tauri.conf.json itself for fs scope in Tauri v2. Filesystem permissions are managed via the capabilities system.

### Step 3 — Update `src-tauri/capabilities/default.json`
Add scoped filesystem permissions for reading PDFs and model files:

```
permissions:
  - core:default
  - opener:default
  - fs:allow-read-file          (read PDFs + model files)
  - fs:allow-read-dir           (browse directories)
  - fs:allow-write-file         (write vector DB data)
  - fs:allow-mkdir              (create data directories)
  - fs:scope with allow paths:
      - $APPDATA/**             (vector DB storage)
      - $DOCUMENT/**            (default model/PDF location)
      - $DOWNLOAD/**            (common PDF source)
      - $HOME/**                (fallback for Linux/Codespace)
```

**Decision**: Use broad scopes (`$HOME/**`) since this is a local-first app that needs to read user-chosen files from anywhere. The model path comes from env var or Documents folder.

### Step 4 — Create `.env.example` at `src-tauri/.env.example`
Document the optional `MODEL_PATH` environment variable:
```
MODEL_PATH=/path/to/your/models
```

---

## Phase 1B: Core Rust Scaffolding

### Step 5 — Rewrite `src-tauri/src/lib.rs` (module exports + AppState + run())
This is the central file. It will:

1. Declare module imports: `mod commands;`
2. Define `AppState` struct containing:
   - `model_path: RwLock<PathBuf>` — resolved model directory path (read-heavy, written once)
   - `model_loaded: Mutex<bool>` — flag for whether LLM is in memory (mocked for Phase 1)
   - `chat_history: Mutex<Vec<String>>` — placeholder for chat context
3. Implement path resolution function `resolve_model_path() -> PathBuf`:
   - Check `MODEL_PATH` env var first (for Codespace dev)
   - Fall back to `dirs::document_dir()` + "/DocuSage/models"
   - Final fallback to current working directory if dirs fails
4. Call `dotenv::dotenv().ok()` early (before Tauri builder)
5. Build `AppState` with resolved path
6. Register `.manage(app_state)` on the Tauri Builder
7. Register `.plugin(tauri_plugin_fs::init())`
8. Register all commands via `tauri::generate_handler![...]`

**Decision on locking**: 
- `model_path` uses `RwLock` — written once during init or `load_model`, read by every chat command. RwLock allows concurrent readers.
- `model_loaded` uses `Mutex` — simple boolean, toggled by `load_model`, checked by chat commands. Mutex is simpler and sufficient for a flag that guards exclusive model loading.
- In Phase 2 when the real mistralrs `Model` object is added, it will be `Mutex<Option<MistralModel>>` because LLM inference is inherently sequential (one prompt at a time through the model).

### Step 6 — Keep `src-tauri/src/main.rs` as-is
It already correctly delegates to `docusage_lib::run()`. No changes needed.

### Step 7 — Create `src-tauri/src/commands.rs` (Tauri command handlers)
Three fully-commented Tauri commands, all returning `Result<String, String>`:

#### `load_model`
- Signature: `load_model(state: tauri::State<'_, AppState>, path: Option<String>) -> Result<String, String>`
- If `path` is `Some`, update `state.model_path` via write lock
- If `path` is `None`, use existing resolved path from state
- Validate the path exists on disk (`std::path::Path::exists()`)
- Set `model_loaded = true` (mock — Phase 2 will actually load mistralrs)
- Return success message with the resolved path

#### `chat_general`
- Signature: `chat_general(state: tauri::State<'_, AppState>, prompt: String) -> Result<String, String>`
- Check `model_loaded` — return error if false
- Read `model_path` via read lock (demonstrates RwLock read pattern)
- Return mocked response: echo the prompt with a "[General Mode Mock]" prefix
- Phase 2 will replace mock with actual mistralrs inference

#### `chat_rag`
- Signature: `chat_rag(state: tauri::State<'_, AppState>, prompt: String) -> Result<String, String>`
- Check `model_loaded` — return error if false
- Return mocked response: echo prompt with "[RAG Mode Mock]" prefix + fake citation
- Phase 2 will add PDF ingestion, embedding, vector search, and citation

All commands use `async` for future compatibility with mistralrs/lancedb async APIs.

---

## Relevant Files

| File | Action |
|---|---|
| `src-tauri/Cargo.toml` | **Modify** — add dependencies (tokio, mistralrs, lancedb, pdf-extract, dotenv, dirs, tauri-plugin-fs, lzma-sys) |
| `src-tauri/capabilities/default.json` | **Modify** — add fs permissions with scoped paths |
| `src-tauri/src/lib.rs` | **Rewrite** — AppState struct, resolve_model_path(), run() with managed state |
| `src-tauri/src/commands.rs` | **Create** — three Tauri command handlers (load_model, chat_general, chat_rag) |
| `src-tauri/src/main.rs` | **No change** — already correct |
| `src-tauri/.env.example` | **Create** — document MODEL_PATH env var |

---

## Verification

1. **Compile check**: Run `cd src-tauri && cargo check` — must compile with no errors (note: full build may take time due to mistralrs)
2. **Path resolution**: Verify `resolve_model_path()` reads `MODEL_PATH` from env when set, falls back to Documents dir otherwise
3. **State injection**: Confirm `AppState` is accessible in all three commands via `tauri::State`
4. **Error handling**: All commands return `Result<String, String>` — no `unwrap()` or `panic!()` in command bodies
5. **Frontend invocability**: Commands are registered in `generate_handler![]` and can be invoked from React via `@tauri-apps/api/core` `invoke()`

---

## Decisions & Scope

- **In scope**: Cargo.toml, capabilities, AppState, path resolution, three mocked commands, locking strategy
- **Out of scope**: React UI, actual mistralrs inference, actual lancedb operations, PDF parsing logic, streaming responses
- **Locking strategy**: RwLock for read-heavy state (model_path), Mutex for exclusive-access state (model_loaded, and future model object). Full rationale in Step 5.
- **Path handling**: `dotenv` + `MODEL_PATH` env var for dev; `dirs::document_dir()` fallback for production. No hardcoded Windows paths.
- **Async commands**: Commands are `async` for forward-compatibility even though mocked logic is synchronous.
