<p align="center">
  <img src="DocuSage/public/logo-light.svg" alt="DocuSage Logo" width="140" />
</p>

<h1 align="center">DocuSage</h1>

<p align="center">
  <strong>Local-first desktop AI for private document intelligence</strong><br/>
  Chat with a local GGUF model, ingest PDFs into a local vector database, and optionally switch on Gemini hybrid mode for stronger document-grounded answers.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-blue?logo=tauri" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/Release-v0.3.10-brightgreen" alt="Release v0.3.10" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## Why I Built It

Most AI note and document tools make an uncomfortable tradeoff: either your data leaves your machine, or the local experience is too weak to be useful. I built DocuSage to challenge that tradeoff.

DocuSage is a local-first desktop assistant that keeps ingestion, embeddings, retrieval, and storage on-device. Then, for users who want better reasoning quality on document questions, it offers an optional Gemini-powered hybrid mode. That gives the project a practical engineering balance: privacy-sensitive retrieval stays local, while answer generation can scale up when quality matters more than strict offline operation.

---

<h2 align="center">Screenshot</h2>

<p align="center">
  <img src="Light-mode (1).png" alt="Light mode screenshot 1" width="48%" />
  <img src="Light-mode (2).png" alt="Light mode screenshot 2" width="48%" />
</p>

## Features

- **Local general chat** with a GGUF model powered by [mistral.rs](https://github.com/EricLBuehler/mistral.rs)
- **Local RAG pipeline** for PDF ingestion, chunking, embeddings, and retrieval
- **Hybrid Gemini mode** that uses the current free-tier `gemini-2.5-flash` endpoint for higher-quality document Q&A
- **Source-aware answers** grounded in retrieved document excerpts
- **Settings panel for Gemini API key** with local key storage in the desktop client
- **Stop generation and streaming responses** for better UX during long outputs
- **Multi-session chat history** with persistent local conversation state
- **Windows release pipeline** via GitHub Actions for desktop installer generation

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        React 19 Frontend                        │
│                 Vite · TypeScript · Tailwind CSS                │
│                                                                  │
│  General Chat UI   RAG Chat UI   Settings UI   Session Manager   │
└──────────────────────────────┬───────────────────────────────────┘
                               │ Tauri invoke
┌──────────────────────────────▼───────────────────────────────────┐
│                       Rust Backend (Tauri)                       │
│                                                                  │
│  commands.rs                                                     │
│  - load_model                                                    │
│  - chat_general                                                  │
│  - chat_rag                                                      │
│  - chat_gemini_rag                                               │
│  - ingest_document                                               │
└───────────────┬───────────────────────────────┬──────────────────┘
                │                               │
        ┌───────▼────────┐              ┌──────▼─────────────────┐
        │ Local LLM Path │              │ Local RAG Path         │
        │ mistral.rs     │              │ pdf-extract            │
        │ GGUF inference │              │ fastembed              │
        │ general chat   │              │ LanceDB                │
        └────────────────┘              └──────────┬─────────────┘
                                                   │
                                  ┌────────────────▼────────────────┐
                                  │ Optional Hybrid Answer Engine   │
                                  │ Gemini 2.5 Flash generateContent│
                                  │ sends only retrieved excerpts   │
                                  └─────────────────────────────────┘
```

### Key Technical Decisions

| Area | Choice | Reason |
|------|--------|--------|
| Desktop shell | Tauri v2 | Native desktop UX with lower overhead than Electron |
| Local model runtime | mistral.rs | Direct GGUF inference inside Rust backend |
| Embeddings | fastembed + BAAI/bge-small-en-v1.5 | Fast local embedding generation |
| Vector store | LanceDB | Persistent local retrieval with simple Rust integration |
| Hybrid answering | Gemini 2.5 Flash | Better synthesis quality for document-grounded answers |
| Frontend | React 19 + Vite | Fast iteration and responsive chat UI |

---

## How It Works

### General Chat

1. The user sends a prompt from the desktop UI.
2. Tauri invokes the Rust `chat_general` command.
3. The backend builds the prompt with chat history and streams tokens from the local GGUF model.
4. The UI renders the response incrementally.

### Document Q&A

1. A PDF is selected and parsed locally.
2. Text is chunked, embedded, and stored in LanceDB.
3. A user question is embedded and matched against the local vector store.
4. The top chunks are assembled into grounded context.
5. DocuSage answers either with the local model or, if configured, through `chat_gemini_rag` using Gemini 2.5 Flash.

### Privacy Model

- Local mode: documents, embeddings, retrieval, and generation all stay on-device.
- Hybrid mode: documents are still indexed and searched locally; only the retrieved excerpts and user question are sent to Gemini for final synthesis.

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- Rust stable toolchain
- Tauri v2 system prerequisites

### Run Locally

```bash
cd DocuSage
npm install
npm run tauri dev
```

### GGUF Model Location

Place a `.gguf` file in one of these directories:

| Platform | Default Path |
|----------|--------------|
| Windows | `Documents\DocuSage\models\` |
| macOS | `~/Documents/DocuSage/models/` |
| Linux | `~/Documents/DocuSage/models/` |

Or configure `MODEL_PATH` in `DocuSage/src-tauri/.env`:

```env
MODEL_PATH=D:\DocuSage\models
```

### Optional Gemini Hybrid Setup

1. Launch the app.
2. Open the Settings panel from the header.
3. Paste your Gemini API key.
4. Ask a question in document mode to route the final answer through Gemini 2.5 Flash.

### Production Build

```bash
cd DocuSage
npm run tauri build
```

---

## Project Structure

```
DocuSage/
├── src/
│   ├── App.tsx
│   ├── lib/api.ts
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs
│   │   ├── commands.rs
│   │   ├── rag.rs
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/
└── package.json
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_PATH` | `~/Documents/DocuSage/models` | Directory containing `.gguf` files |
| `USE_GPU` | `0` | Enables GPU acceleration where supported |
| `CHAT_TEMPLATE` | auto-detected | Custom chat template override |
| `TOK_MODEL_ID` | auto-detected | Tokenizer model id override |

---



## License

MIT
