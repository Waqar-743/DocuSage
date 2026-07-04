<p align="center">
  <img src="src-tauri/icons/app-icon.svg" alt="DocuSage Logo" width="140" />
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
  <img src="https://img.shields.io/badge/Release-v0.5.3-brightgreen" alt="Release v0.5.3" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## Why I Built It

Most AI note and document tools force a bad tradeoff: either everything goes to the cloud, or the local experience is too weak to be dependable. DocuSage was built to close that gap.

The app keeps ingestion, embeddings, retrieval, and storage on-device. It now also runs as a hidden desktop assistant that can stay ready in the background and appear instantly from a global shortcut. Then, for users who want stronger reasoning quality on private documents, it adds optional cloud and remote provider modes. That means the core knowledge pipeline remains local, while answer generation can scale up when it is actually needed.

---

## Features

- **Local general chat** with a GGUF model powered by [mistral.rs](https://github.com/EricLBuehler/mistral.rs)
- **Local RAG pipeline** for PDF ingestion, chunking, embeddings, and retrieval
- **Hidden desktop assistant mode** with background startup, system tray controls, and global shortcut activation
- **Compact / medium / full assistant window modes** with smart monitor-aware positioning
- **Local, cloud, and remote provider modes** for OpenAI, Anthropic Claude, Google Gemini, OpenRouter, Ollama local/remote, LM Studio, and custom OpenAI-compatible APIs
- **Grounded answers with sources** based on retrieved document excerpts
- **Settings panels for assistant behavior, local models, RAG tuning, and AI provider credentials**
- **Streaming responses and stop generation controls**
- **Multi-session chat persistence** for separate conversations
- **Desktop release workflow** for Windows installer generation

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
| Desktop shell | Tauri v2 | Native desktop UX with lower memory footprint than Electron |
| Local model runtime | mistral.rs | Direct GGUF inference in Rust |
| Embeddings | fastembed + BAAI/bge-small-en-v1.5 | Fast local vector generation |
| Vector store | LanceDB | Persistent retrieval for document search |
| Hidden assistant lifecycle | Tauri global shortcut + tray APIs | Fast desktop activation without restarting backend services |
| Cloud/remote answering | Provider adapter layer | Extensible higher-quality answers without redesigning local RAG |
| Frontend | React 19 + Vite | Fast iteration and responsive UI |

---

## How It Works

### General Chat

1. The user sends a message from the UI.
2. The frontend invokes `chat_general` through Tauri.
3. The Rust backend builds the prompt and streams tokens from the local GGUF model.
4. The UI renders the answer progressively.

### Document Q&A

1. A PDF is parsed locally.
2. Text is chunked, embedded, and stored in LanceDB.
3. A question is embedded and matched against the local vector store.
4. The top chunks become the grounded context.
5. The answer is generated by the local model or, when enabled, by the selected cloud or remote provider.

### Privacy Model

- Local mode: documents, embeddings, retrieval, and generation remain on-device.
- Cloud mode: retrieval stays local; only the retrieved excerpts, conversation context, and user question are sent to the selected provider.

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- Rust stable toolchain
- Tauri v2 system prerequisites

### Install and Run

```bash
cd DocuSage
npm install
npm run tauri dev
```

### GGUF Model Location

Place a `.gguf` model file in one of these directories:

| Platform | Default Path |
|----------|--------------|
| Windows | `Documents\DocuSage\models\` |
| macOS | `~/Documents/DocuSage/models/` |
| Linux | `~/Documents/DocuSage/models/` |

Or configure `MODEL_PATH` in `src-tauri/.env`:

```env
MODEL_PATH=D:\DocuSage\models
```

### Optional Gemini Hybrid Setup

1. Open the app.
2. Open Settings from the header or tray.
3. Use **AI Providers** to add Gemini, OpenAI, Anthropic, OpenRouter, Ollama remote, LM Studio remote, or a custom OpenAI-compatible endpoint.
4. Save the provider credentials and select the provider.
5. Ask a question in general or document mode to route final answers through the selected provider.

### Build for Production

```bash
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
│   ├── tauri.conf.json
│   └── icons/
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
