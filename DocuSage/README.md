<p align="center">
  <img src="public/logo-light.svg" alt="DocuSage Logo" width="140" />
</p>

<h1 align="center">DocuSage</h1>

<p align="center">
  <strong>100 % offline, privacy-first desktop AI assistant</strong><br/>
  Chat with a local LLM or ask questions about your private documents — no internet, no cloud, no data leaves your machine.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-blue?logo=tauri" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## Features

- **General Chat** — Have free-form conversations with a local LLM powered by [mistral.rs](https://github.com/EricLBuehler/mistral.rs).
- **RAG Chat** — Ingest PDF documents and ask questions. DocuSage retrieves relevant passages and generates answers with source citations.
- **Fully Offline** — Everything runs on your machine: inference, embeddings, vector search. Zero network calls.
- **Privacy First** — Your files and conversations never leave your device.
- **Dark / Light Mode** — Clean, modern UI with one-click theme toggle.
- **Multi-Session** — Create and manage multiple independent chat sessions.
- **Document Management** — Upload, ingest, and manage PDFs through the sidebar.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     React 19 Frontend                    │
│  (Tailwind CSS · Vite · TypeScript · lucide-react)       │
│                                                          │
│   ┌───────────┐   ┌───────────┐   ┌────────────────┐    │
│   │ General   │   │ RAG Chat  │   │ Document Mgmt  │    │
│   │ Chat UI   │   │ UI        │   │ Sidebar        │    │
│   └─────┬─────┘   └─────┬─────┘   └───────┬────────┘    │
│         │               │                  │             │
│         └───────────┬───┘──────────────────┘             │
│                     │  Tauri IPC (invoke)                 │
└─────────────────────┼────────────────────────────────────┘
                      │
┌─────────────────────┼────────────────────────────────────┐
│                     ▼  Rust Backend (Tauri v2)           │
│                                                          │
│   ┌─────────────────────────────────────────────────┐    │
│   │              commands.rs                        │    │
│   │  load_model · chat_general · chat_rag           │    │
│   │  ingest_document                                │    │
│   └──────────┬───────────────────┬──────────────────┘    │
│              │                   │                        │
│   ┌──────────▼──────┐  ┌────────▼───────────────────┐    │
│   │  mistral.rs     │  │       rag.rs               │    │
│   │  (LLM Engine)   │  │  PDF extract → chunk →     │    │
│   │  GGUF models    │  │  embed (fastembed) →        │    │
│   │  CPU / GPU      │  │  store & search (LanceDB)  │    │
│   └─────────────────┘  └────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Key Components

| Layer | Technology | Role |
|-------|-----------|------|
| **UI** | React 19, Tailwind CSS v4, Vite 7 | Chat interface, document sidebar, theme toggle |
| **Desktop Shell** | Tauri v2 | Secure IPC bridge, native file dialogs, windowing |
| **LLM Inference** | mistral.rs 0.7 (GGUF) | Local model loading and chat completion |
| **Embeddings** | fastembed 4 (BAAI/bge-small-en-v1.5) | 384-dim vectors for document chunks |
| **Vector Store** | LanceDB 0.26 + Apache Arrow | Persistent vector search for RAG retrieval |
| **PDF Parsing** | pdf-extract 0.10 | Text extraction from PDF documents |

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and **npm**
- **Rust** toolchain (rustup) — stable channel
- **System dependencies** for Tauri v2 — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Install Dependencies

```bash
cd DocuSage
npm install
```

### Download a GGUF Model

DocuSage needs a GGUF model file. Place it in one of these locations:

| Platform | Default Path |
|----------|-------------|
| **Windows** | `Documents\DocuSage\models\` |
| **macOS** | `~/Documents/DocuSage/models/` |
| **Linux** | `~/Documents/DocuSage/models/` |

Or set the `MODEL_PATH` environment variable (or add it to `src-tauri/.env`):

```env
MODEL_PATH=D:\DocuSage\models
```

Any GGUF model works. Small recommended models:
- [Mistral-7B-Instruct GGUF (Q4_K_M)](https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF)
- [Phi-3-mini GGUF](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf)

### Run in Development

```bash
npm run tauri dev
```

### Browser Preview (no Tauri needed)

```bash
npm run dev
```

Opens at `http://localhost:1420` with mock AI responses — useful for UI development.

### Build for Production

```bash
npm run tauri build
```

The installer is generated in `src-tauri/target/release/bundle/`.

---

## Project Structure

```
DocuSage/
├── src/                    # React frontend
│   ├── App.tsx             # Main app with chat UI, sidebar, themes
│   ├── lib/api.ts          # Tauri IPC wrappers + browser mock mode
│   └── main.tsx            # Entry point
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── lib.rs          # AppState, Tauri builder, command registration
│   │   ├── commands.rs     # load_model, chat_general, chat_rag, ingest_document
│   │   ├── rag.rs          # PDF extraction, chunking, embedding, vector search
│   │   └── main.rs         # Binary entry point
│   ├── Cargo.toml          # Rust dependencies
│   ├── tauri.conf.json     # Tauri app configuration
│   └── icons/              # App icons (all sizes)
├── public/
│   ├── logo-light.svg      # Light mode logo
│   └── logo-dark.svg       # Dark mode logo
└── package.json
```

---

## How It Works

### General Chat
1. User types a message →  frontend calls `chat_general` via Tauri IPC
2. Rust backend builds a conversation with system prompt + chat history
3. mistral.rs runs inference on the local GGUF model
4. Response streams back to the UI

### RAG Chat
1. **Ingest**: Upload a PDF → extract text → split into chunks → embed with fastembed → store in LanceDB
2. **Query**: User asks a question → embed the query → vector search for top-5 similar chunks → build augmented prompt with document excerpts → run inference → return answer with citations

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_PATH` | `~/Documents/DocuSage/models` | Directory containing `.gguf` model files |
| `USE_GPU` | `0` | Set to `1` to enable GPU acceleration |
| `CHAT_TEMPLATE` | *(auto-detected)* | Explicit Jinja chat template path or literal |
| `TOK_MODEL_ID` | *(auto-detected)* | HuggingFace tokenizer model ID |

---

## App Icon

<p align="center">
  <img src="public/logo-dark.svg" alt="DocuSage Dark Mode Icon" width="120" />
</p>

---

## Tech Stack

- [Tauri v2](https://v2.tauri.app/) — Lightweight desktop framework
- [React 19](https://react.dev/) — UI library
- [Tailwind CSS v4](https://tailwindcss.com/) — Utility-first CSS
- [mistral.rs](https://github.com/EricLBuehler/mistral.rs) — Fast local LLM inference
- [LanceDB](https://lancedb.com/) — Embedded vector database
- [fastembed](https://github.com/Anush008/fastembed-rs) — Local embedding generation
- [Vite 7](https://vite.dev/) — Lightning-fast frontend build tool

---

## License

MIT
