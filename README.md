<p align="center">
  <img src="DocuSage/public/logo-light.svg" alt="DocuSage Logo" width="140" />
</p>

<h1 align="center">DocuSage</h1>

<p align="center">
  <strong>Local-first desktop AI for private document intelligence</strong><br/>
  Chat with a local GGUF model, ingest PDFs into a local vector database, summon a hidden desktop assistant with a global shortcut, and optionally use cloud or remote AI providers for stronger answers.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-blue?logo=tauri" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/Release-v0.5.1-brightgreen" alt="Release v0.5.1" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## Why I Built It

Most AI note and document tools make an uncomfortable tradeoff: either your data leaves your machine, or the local experience is too weak to be useful. I built DocuSage to challenge that tradeoff.

DocuSage is a local-first desktop assistant that keeps ingestion, embeddings, retrieval, and storage on-device. It now also runs as a hidden desktop assistant that can stay ready in the background and appear instantly from a global shortcut. For users who want better reasoning quality on document questions, it offers optional cloud and remote provider modes. That gives the project a practical engineering balance: privacy-sensitive retrieval stays local, while answer generation can scale up when quality matters more than strict offline operation.

---

<h2 align="center">Screenshot</h2>

<p align="center">
  <img src="Light-mode (1).png" alt="Light mode screenshot 1" width="48%" />
  <img src="Light-mode (2).png" alt="Light mode screenshot 2" width="48%" />
</p>

## Features

- **Local general chat** with a GGUF model powered by [mistral.rs](https://github.com/EricLBuehler/mistral.rs)
- **Local RAG pipeline** for PDF ingestion, chunking, embeddings, and retrieval
- **Hidden desktop assistant mode** with background startup, system tray controls, and global shortcut activation
- **Compact / medium / full assistant window modes** with smart monitor-aware positioning
- **Cloud and remote provider modes** for OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama remote, LM Studio remote, and custom OpenAI-compatible APIs
- **Source-aware answers** grounded in retrieved document excerpts
- **Settings panels for assistant behavior, local models, RAG tuning, and AI provider credentials**
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
│ Assistant UI  RAG Chat UI  Settings UI  Providers  Session State │
└──────────────────────────────┬───────────────────────────────────┘
                               │ Tauri invoke
┌──────────────────────────────▼───────────────────────────────────┐
│                       Rust Backend (Tauri)                       │
│                                                                  │
│  commands.rs                                                     │
│  assistant.rs                                                    │
│  providers.rs                                                    │
│  - load_model                                                    │
│  - chat_general                                                  │
│  - chat_rag                                                      │
│  - chat_cloud / chat_cloud_rag                                   │
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
                                  │ Optional Cloud/Remote Providers │
                                  │ sends only selected prompt data │
                                  │ and retrieved excerpts for RAG  │
                                  └─────────────────────────────────┘
```

### Key Technical Decisions

| Area | Choice | Reason |
|------|--------|--------|
| Desktop shell | Tauri v2 | Native desktop UX with lower overhead than Electron |
| Local model runtime | mistral.rs | Direct GGUF inference inside Rust backend |
| Embeddings | fastembed + BAAI/bge-small-en-v1.5 | Fast local embedding generation |
| Vector store | LanceDB | Persistent local retrieval with simple Rust integration |
| Hidden assistant lifecycle | Tauri global shortcut + tray APIs | Fast desktop activation without restarting backend services |
| Cloud/remote answering | Provider adapter layer | Extensible higher-quality answers without redesigning local RAG |
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
5. DocuSage answers either with the local model or, if configured, through the selected cloud or remote provider.

### Privacy Model

- Local mode: documents, embeddings, retrieval, and generation all stay on-device.
- Cloud mode: documents are still indexed and searched locally; only the retrieved excerpts, conversation context, and user question are sent to the selected provider for final synthesis.

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
2. Open Settings from the header or tray.
3. Use **AI Providers** to add Gemini, OpenAI, Anthropic, OpenRouter, Ollama remote, LM Studio remote, or a custom OpenAI-compatible endpoint.
4. Save the provider credentials and select the provider.
5. Ask a question in general or document mode to route final answers through the selected provider.

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
│   │   ├── assistant.rs
│   │   ├── providers.rs
│   │   ├── lib.rs
│   │   ├── commands.rs
│   │   ├── rag.rs
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/
├── docs/
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
