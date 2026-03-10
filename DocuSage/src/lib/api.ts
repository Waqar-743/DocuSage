import { invoke } from "@tauri-apps/api/core";

export type ChatHistoryMessage = {
  sender: "user" | "bot";
  text: string;
};

export type IngestResult = {
  fileName: string;
  chunkCount: number;
  charCount: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Type-safe IPC wrappers for every Tauri command.
//
// Each function maps 1-to-1 to a #[tauri::command] on the Rust side.
// Rust `Result<String, String>` becomes a resolved/rejected Promise<string>.
//
// When opened in a plain browser (no Tauri shell), mock responses are returned
// so the UI can be tested for design and interaction without the backend.
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ── Mock helpers for browser-only preview mode ──────────────────────────────

/** Simulate a short network delay. */
function mockDelay(ms = 800): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const MOCK_RESPONSES: Record<string, string[]> = {
  general: [
    "I'm DocuSage running in browser preview mode. The real AI backend is available when you launch with `npm run tauri dev` on your desktop.",
    "This is a simulated response. In the real app, your local LLM would generate an answer here.",
    "Browser preview mode — all UI features work, but AI responses are mocked. Run the desktop app for real inference.",
  ],
  rag: [
    "RAG preview: In the real app, I would search your ingested documents and generate an answer with citations.",
    "This is a simulated RAG response. The real backend retrieves relevant chunks from your PDF before answering.",
    "Browser preview — document retrieval is mocked. Launch the Tauri desktop app for actual RAG queries.",
  ],
};

let mockIdx = { general: 0, rag: 0 };

function nextMock(kind: "general" | "rag"): string {
  const list = MOCK_RESPONSES[kind];
  const msg = list[mockIdx[kind] % list.length];
  mockIdx[kind]++;
  return msg;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Point the backend at a model directory and load it into memory.
 */
export async function loadModel(path?: string): Promise<string> {
  if (!isTauri()) { await mockDelay(); return "Model loaded (browser preview)"; }
  return invoke<string>("load_model", { path: path ?? null });
}

/**
 * Send a prompt to the LLM in General Chat mode (no document context).
 */
export async function chatGeneral(
  prompt: string,
  history: ChatHistoryMessage[],
  requestId: string,
): Promise<string> {
  if (!isTauri()) { await mockDelay(1200); return nextMock("general"); }
  return invoke<string>("chat_general", { prompt, history, requestId });
}

/**
 * Send a prompt to the LLM in RAG Chat mode (retrieves context from
 * ingested documents before generating an answer).
 */
export async function chatRag(
  prompt: string,
  history: ChatHistoryMessage[],
  requestId: string,
): Promise<string> {
  if (!isTauri()) { await mockDelay(1200); return nextMock("rag"); }
  return invoke<string>("chat_rag", { prompt, history, requestId });
}

export async function stopChat(requestId: string): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke<void>("stop_chat", { requestId });
}

/**
 * Ingest a PDF document into the local vector store.
 * The backend will extract text, chunk, embed, and persist it.
 * ONLY the file path is sent over IPC — Rust reads the PDF from disk.
 * @param filePath Absolute path to the PDF file on disk.
 */
export async function ingestDocument(filePath: string): Promise<IngestResult> {
  if (!isTauri()) {
    await mockDelay(1500);
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
    return { fileName: name, chunkCount: 42, charCount: 12500 };
  }
  // Send ONLY the path string — never read or transmit file content via IPC.
  return invoke<IngestResult>("ingest_document", { filePath: String(filePath) });
}
