<p align="center">
  <img src="DocuSage/public/logo-light.svg" alt="DocuSage Logo" width="140" />
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

<h2 align="center">Screenshot</h2>

<p align="center">
  <img src="Light-mode (1).png" alt="Light mode screenshot 1" width="48%" />
  <img src="Light-mode (2).png" alt="Light mode screenshot 2" width="48%" />
</p>

## Features

- **General Chat** — Free-form conversations with a local LLM powered by [mistral.rs](https://github.com/EricLBuehler/mistral.rs)
- **RAG Chat** — Ingest PDF documents and ask questions with source citations
- **Fully Offline** — Inference, embeddings, and vector search all run locally
- **Privacy First** — Your files and conversations never leave your device
- **Dark / Light Mode** — Clean, modern UI with one-click theme toggle
- **Multi-Session** — Create and manage multiple independent chat sessions
- **Document Management** — Upload, ingest, and manage PDFs through the sidebar

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

### Install & Run

```bash
cd DocuSage
npm install
npm run tauri dev
```

### Download a GGUF Model

Place a `.gguf` model file in one of these locations:

| Platform | Default Path |
|----------|-------------|
| **Windows** | `Documents\DocuSage\models\` |
| **macOS / Linux** | `~/Documents/DocuSage/models/` |

Or set `MODEL_PATH` env variable (or in `DocuSage/src-tauri/.env`):

```env
MODEL_PATH=D:\DocuSage\models
```

Recommended models:
- [Mistral-7B-Instruct GGUF (Q4_K_M)](https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF)
- [Phi-3-mini GGUF](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf)

### Browser Preview (no backend needed)

```bash
cd DocuSage && npm run dev
```

Opens at `http://localhost:1420` with mock AI responses for UI development.

### Build for Production

```bash
cd DocuSage && npm run tauri build
```

---

## Project Structure

```
DocuSage/
├── src/                    # React frontend
│   ├── App.tsx             # Main app: chat UI, sidebar, themes
│   ├── lib/api.ts          # Tauri IPC wrappers + browser mock
│   └── main.tsx            # Entry point
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── lib.rs          # AppState, Tauri builder setup
│   │   ├── commands.rs     # LLM commands: load, chat, ingest
│   │   ├── rag.rs          # PDF parsing, embedding, vector search
│   │   └── main.rs         # Binary entry
│   ├── Cargo.toml          # Rust dependencies
│   └── icons/              # App icons (all sizes)
└── public/
    ├── logo-light.svg      # Light mode logo
    └── logo-dark.svg       # Dark mode logo
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_PATH` | `~/Documents/DocuSage/models` | Directory containing `.gguf` model files |
| `USE_GPU` | `0` | Set to `1` to enable GPU acceleration |
| `CHAT_TEMPLATE` | *(auto)* | Explicit Jinja chat template |
| `TOK_MODEL_ID` | *(auto)* | HuggingFace tokenizer model ID |

---

## License

MIT

<p align="center"><strong>Build with Headache</strong></p>
