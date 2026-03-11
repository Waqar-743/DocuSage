<p align="center">
  <img src="public/logo-light.svg" alt="DocuSage Logo" width="140" />
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

Most AI note and document tools force a bad tradeoff: either everything goes to the cloud, or the local experience is too weak to be dependable. DocuSage was built to close that gap.

The app keeps ingestion, embeddings, retrieval, and storage on-device. Then, for users who want stronger reasoning quality on private documents, it adds an optional Gemini hybrid layer. That means the core knowledge pipeline remains local, while answer generation can scale up when it is actually needed.

---

## Features

- **Local general chat** with a GGUF model powered by [mistral.rs](https://github.com/EricLBuehler/mistral.rs)
- **Local RAG pipeline** for PDF ingestion, chunking, embeddings, and retrieval
- **Hybrid Gemini mode** using the `gemini-2.5-flash` endpoint for stronger document Q&A
- **Grounded answers with sources** based on retrieved document excerpts
- **Settings panel for Gemini API key** stored locally in the app
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
| Desktop shell | Tauri v2 | Native desktop UX with lower memory footprint than Electron |
| Local model runtime | mistral.rs | Direct GGUF inference in Rust |
| Embeddings | fastembed + BAAI/bge-small-en-v1.5 | Fast local vector generation |
| Vector store | LanceDB | Persistent retrieval for document search |
| Hybrid answering | Gemini 2.5 Flash | Better synthesis quality for RAG answers |
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
5. The answer is generated by the local model or, when enabled, by `chat_gemini_rag` using Gemini 2.5 Flash.

### Privacy Model

- Local mode: documents, embeddings, retrieval, and generation remain on-device.
- Hybrid mode: retrieval stays local; only the retrieved excerpts and the user question are sent to Gemini.

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
2. Click the Settings button in the header.
3. Save your Gemini API key.
4. Use document mode to route final answers through Gemini 2.5 Flash.

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
│   │   ├── lib.rs
│   │   ├── commands.rs
│   │   ├── rag.rs
│   │   └── main.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
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
*** Add File: /workspaces/DocuSage/RECRUITER_QA.md
# Recruiter Questions and Answers for DocuSage

## 1. What problem does DocuSage solve?

DocuSage helps users chat with their own documents from a desktop app without forcing them into a cloud-first workflow. It combines local document ingestion, semantic retrieval, and AI-generated answers so private files become searchable and conversational.

## 2. What makes this project technically interesting?

The project is interesting because it is not just a chat UI. It combines a React frontend, a Rust desktop backend with Tauri, local GGUF model inference, local embeddings, a vector database, PDF parsing, and an optional hybrid cloud answer path. The main challenge is getting all of those parts to work together reliably on a user machine.

## 3. Why did you choose Tauri instead of Electron?

I chose Tauri because I wanted a smaller desktop footprint and tighter integration with a Rust backend. Since the retrieval, ingestion, and model orchestration logic already fit well in Rust, Tauri was a better architectural match than adding a separate Node-based desktop runtime.

## 4. Why is the backend written in Rust?

Rust gave me strong control over performance, error handling, and native integration. It was a good fit for model orchestration, file-system access, PDF ingestion, vector search plumbing, and streaming response handling in a desktop app.

## 5. How does the RAG pipeline work?

The pipeline is: parse PDF text, split it into chunks, generate embeddings locally with `fastembed`, store vectors in LanceDB, embed the user question, retrieve the top matching chunks, and then build a grounded prompt from those chunks before answer generation.

## 6. What is the hybrid Gemini mode?

Hybrid mode keeps ingestion, embeddings, and retrieval local, but sends the retrieved excerpts plus the user question to Gemini 2.5 Flash for final answer generation. I added this because local smaller models were retrieving the right context but still underperforming on synthesis quality.

## 7. How do you protect user privacy?

The privacy boundary is explicit. In local mode, everything stays on-device. In hybrid mode, the app still indexes and searches documents locally, and only the retrieved excerpts needed for the answer are sent to Gemini. That is a more defensible design than uploading whole documents by default.

## 8. What was the hardest engineering challenge?

One of the hardest problems was separating retrieval quality from generation quality. Initially, it looked like the RAG system was failing, but deeper debugging showed retrieval was actually working and the local model was the weaker link. That led to the hybrid architecture and better observability in the retrieval path.

## 9. How did you debug hallucination issues?

I made the retrieval path loud instead of silent. I added stronger logging around chunk retrieval, forced the prompt to confirm how many chunks were received, and removed silent fallback behavior when zero chunks were returned. That made it clear whether the problem was retrieval, prompt construction, or model behavior.

## 10. What are the strongest product decisions in this project?

The strongest decisions are the local-first architecture, the optional hybrid fallback instead of a full cloud dependency, and the desktop-first UX. Those choices make the product more practical for users who care about privacy but still want high-quality answers when local models are not enough.

## 11. What would you improve next?

I would improve evaluation and observability further, add structured tests around retrieval quality, support more document types, and make prompt assembly more configurable. I would also improve release automation so installer versioning and release assets stay perfectly aligned.

## 12. What does this project say about your engineering style?

It shows that I like to build end-to-end systems, not isolated demos. I am comfortable moving across product thinking, UX, frontend work, Rust backend logic, debugging model behavior, release engineering, and making tradeoffs between privacy, cost, and answer quality.

## 13. How would you explain this project in one sentence?

DocuSage is a local-first desktop AI assistant that turns private PDFs into a searchable, conversational knowledge base with an optional hybrid reasoning layer for better answer quality.

## 14. What is a good recruiter summary for this project?

This project demonstrates full-stack product engineering across React, Rust, desktop delivery, retrieval-augmented generation, local model inference, API integration, and release automation. It is a strong example of building a real AI product with technical tradeoffs, not just calling an LLM from a web page.
