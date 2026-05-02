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

export type DownloadedModel = {
  filename: string;
  path: string;
  sizeBytes: number;
};

export type RagConfig = {
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  showContext: boolean;
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

/** Point the backend at a model directory and load it into memory. */
export async function loadModel(path?: string): Promise<string> {
  if (!isTauri()) { await mockDelay(); return "Model loaded (browser preview)"; }
  return invoke<string>("load_model", { path: path ?? null });
}

/** Send a prompt to the LLM in General Chat mode (no document context). */
export async function chatGeneral(
  prompt: string,
  history: ChatHistoryMessage[],
  requestId: string,
): Promise<string> {
  if (!isTauri()) { await mockDelay(1200); return nextMock("general"); }
  return invoke<string>("chat_general", { prompt, history, requestId });
}

/** Send a prompt to the LLM in RAG Chat mode. */
export async function chatRag(
  prompt: string,
  history: ChatHistoryMessage[],
  requestId: string,
): Promise<string> {
  if (!isTauri()) { await mockDelay(1200); return nextMock("rag"); }
  return invoke<string>("chat_rag", { prompt, history, requestId });
}

/** Storage key for the Gemini API key. */
export const GEMINI_KEY_STORAGE = 'docusage_gemini_key';

/** Send a prompt to the Gemini API in hybrid RAG mode. */
export async function chatGeminiRag(
  apiKey: string,
  prompt: string,
  history: ChatHistoryMessage[],
): Promise<string> {
  if (!isTauri()) { await mockDelay(1200); return "Gemini RAG preview: In the real app, your question would be answered by the Gemini API using your ingested document chunks."; }
  return invoke<string>("chat_gemini_rag", { apiKey, prompt, history });
}

export async function stopChat(requestId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("stop_chat", { requestId });
}

/**
 * Ingest a PDF document into the local vector store.
 * ONLY the file path is sent over IPC — Rust reads the PDF from disk.
 */
export async function ingestDocument(filePath: string): Promise<IngestResult> {
  if (!isTauri()) {
    await mockDelay(1500);
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
    return { fileName: name, chunkCount: 42, charCount: 12500 };
  }
  return invoke<IngestResult>("ingest_document", { filePath: String(filePath) });
}

// ── Model management ─────────────────────────────────────────────────────────

/**
 * Stream-download a GGUF model to the app's local models directory.
 * Progress is reported via `download-progress` events on the Tauri event bus.
 * Returns the absolute path of the saved file.
 */
export async function downloadModel(url: string, filename: string): Promise<string> {
  if (!isTauri()) {
    await mockDelay(2000);
    return `/mock/models/${filename}`;
  }
  return invoke<string>("download_model", { url, filename });
}

/** List all .gguf files found in the app's models directories. */
export async function listDownloadedModels(): Promise<DownloadedModel[]> {
  if (!isTauri()) {
    return [
      { filename: "Llama-3.2-1B-Instruct-Q4_K_M.gguf", path: "/mock/models/Llama-3.2-1B-Instruct-Q4_K_M.gguf", sizeBytes: 734003200 },
    ];
  }
  return invoke<DownloadedModel[]>("list_downloaded_models");
}

/**
 * Load a specific .gguf file by its absolute path.
 * This replaces any currently loaded model.
 */
export async function connectModel(filePath: string): Promise<string> {
  if (!isTauri()) { await mockDelay(1500); return `Connected to: ${filePath.split(/[\\/]/).pop()}`; }
  return invoke<string>("connect_model", { filePath });
}

/** Unload the current model from memory. */
export async function disconnectModel(): Promise<void> {
  if (!isTauri()) { await mockDelay(400); return; }
  return invoke<void>("disconnect_model");
}

/** Permanently delete a .gguf file from disk by its absolute path. */
export async function deleteModel(filePath: string): Promise<void> {
  if (!isTauri()) { await mockDelay(400); return; }
  return invoke<void>("delete_model", { filePath });
}

/** Returns the resolved models directory path. */
export async function getModelsDir(): Promise<string> {
  if (!isTauri()) return "/mock/models";
  return invoke<string>("get_models_dir");
}

/** Returns the filename of the currently connected model, or null. */
export async function getConnectedModel(): Promise<string | null> {
  if (!isTauri()) return "Llama-3.2-1B-Instruct-Q4_K_M.gguf";
  return invoke<string | null>("get_connected_model");
}

// ── RAG configuration ────────────────────────────────────────────────────────

export const RAG_CONFIG_DEFAULTS: RagConfig = {
  chunkSize: 900,
  chunkOverlap: 150,
  topK: 8,
  showContext: false,
};

/** Retrieve the current RAG pipeline configuration from the backend. */
export async function getRagConfig(): Promise<RagConfig> {
  if (!isTauri()) return { ...RAG_CONFIG_DEFAULTS };
  return invoke<RagConfig>("get_rag_config");
}

/** Persist updated RAG configuration to the backend AppState. */
export async function saveRagConfig(config: RagConfig): Promise<void> {
  if (!isTauri()) { await mockDelay(200); return; }
  return invoke<void>("save_rag_config", { config });
}
