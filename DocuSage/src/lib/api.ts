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

export type AssistantWindowMode = "compact" | "medium" | "full";

export type AssistantSettings = {
  launchHidden: boolean;
  hideOnClose: boolean;
  hideFromTaskbar: boolean;
  keepModelLoaded: boolean;
  globalShortcut: string;
  windowMode: AssistantWindowMode;
  lastMonitorName: string | null;
};

export type AssistantStatus = {
  isVisible: boolean;
  settings: AssistantSettings;
  platform: {
    platform: string;
    startupHidden: string;
    taskbarHidden: string;
    altTabHidden: string;
    focusNotes: string;
  };
};

export type AiProviderKind =
  | "local"
  | "openAi"
  | "anthropic"
  | "googleGemini"
  | "openRouter"
  | "ollamaRemote"
  | "lmStudioRemote"
  | "customOpenAiCompatible";

export type AiProviderConfig = {
  id: string;
  name: string;
  provider: AiProviderKind;
  enabled: boolean;
  baseUrl: string | null;
  model: string | null;
  organization: string | null;
  project: string | null;
  timeoutSecs: number;
  temperature: number;
  apiKeySet: boolean;
  options: Record<string, unknown>;
};

export type AiProviderConfigInput = Omit<AiProviderConfig, "id" | "apiKeySet"> & {
  id?: string;
  apiKey?: string;
  deleteApiKey: boolean;
};

export type ProviderList = {
  activeProviderId: string;
  providers: AiProviderConfig[];
  secureStorageAvailable: boolean;
};

export type ProviderTestResult = {
  ok: boolean;
  message: string;
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

export async function chatCloud(
  prompt: string,
  history: ChatHistoryMessage[],
  requestId: string,
): Promise<string> {
  if (!isTauri()) { await mockDelay(1200); return "Cloud preview: the desktop app will send this request to the selected provider."; }
  return invoke<string>("chat_cloud", { prompt, history, requestId });
}

export async function chatCloudRag(
  prompt: string,
  history: ChatHistoryMessage[],
  requestId: string,
): Promise<string> {
  if (!isTauri()) { await mockDelay(1200); return "Cloud RAG preview: DocuSage will retrieve local document chunks, then send only the prompt context to the selected provider."; }
  return invoke<string>("chat_cloud_rag", { prompt, history, requestId });
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

/** Restart the local model engine without restarting the desktop app. */
export async function restartAiEngine(): Promise<string> {
  if (!isTauri()) { await mockDelay(500); return "AI engine restarted (browser preview)"; }
  return invoke<string>("restart_ai_engine");
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

// ── Hidden desktop assistant lifecycle ──────────────────────────────────────

export const ASSISTANT_SETTINGS_DEFAULTS: AssistantSettings = {
  launchHidden: true,
  hideOnClose: true,
  hideFromTaskbar: true,
  keepModelLoaded: true,
  globalShortcut: "Alt+Space",
  windowMode: "medium",
  lastMonitorName: null,
};

export async function getAssistantStatus(): Promise<AssistantStatus> {
  if (!isTauri()) {
    return {
      isVisible: true,
      settings: { ...ASSISTANT_SETTINGS_DEFAULTS },
      platform: {
        platform: "browser",
        startupHidden: "Desktop-only",
        taskbarHidden: "Desktop-only",
        altTabHidden: "Desktop-only",
        focusNotes: "Desktop-only",
      },
    };
  }
  return invoke<AssistantStatus>("get_assistant_status");
}

export async function saveAssistantSettings(settings: AssistantSettings): Promise<AssistantSettings> {
  if (!isTauri()) { await mockDelay(200); return settings; }
  return invoke<AssistantSettings>("save_assistant_settings", { settings });
}

export async function hideAssistantWindow(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("hide_assistant_window");
}

export async function showAssistantWindow(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("show_assistant_window");
}

export async function toggleAssistantWindow(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("toggle_assistant_window");
}

export async function setAssistantWindowMode(windowMode: AssistantWindowMode): Promise<AssistantWindowMode> {
  if (!isTauri()) return windowMode;
  return invoke<AssistantWindowMode>("set_assistant_window_mode", { windowMode });
}

export async function cycleAssistantWindowMode(): Promise<AssistantWindowMode> {
  if (!isTauri()) return "medium";
  return invoke<AssistantWindowMode>("cycle_assistant_window_mode");
}

export async function checkForUpdates(): Promise<string> {
  if (!isTauri()) return "No updater plugin is configured for browser preview.";
  return invoke<string>("check_for_updates");
}

// ── Cloud and remote provider settings ──────────────────────────────────────

export async function listAiProviderConfigs(): Promise<ProviderList> {
  if (!isTauri()) {
    return {
      activeProviderId: "local",
      secureStorageAvailable: false,
      providers: [{
        id: "local",
        name: "Local",
        provider: "local",
        enabled: true,
        baseUrl: null,
        model: null,
        organization: null,
        project: null,
        timeoutSecs: 60,
        temperature: 0.2,
        apiKeySet: false,
        options: {},
      }],
    };
  }
  return invoke<ProviderList>("list_ai_provider_configs");
}

export async function saveAiProviderConfig(input: AiProviderConfigInput): Promise<AiProviderConfig> {
  if (!isTauri()) {
    await mockDelay(250);
    return {
      ...input,
      id: input.id ?? `provider-${Date.now()}`,
      apiKeySet: !!input.apiKey,
      baseUrl: input.baseUrl ?? null,
      model: input.model ?? null,
      organization: input.organization ?? null,
      project: input.project ?? null,
    };
  }
  return invoke<AiProviderConfig>("save_ai_provider_config", { input });
}

export async function deleteAiProviderConfig(providerId: string): Promise<void> {
  if (!isTauri()) { await mockDelay(200); return; }
  return invoke<void>("delete_ai_provider_config", { providerId });
}

export async function setActiveAiProvider(providerId: string): Promise<string> {
  if (!isTauri()) { await mockDelay(150); return providerId; }
  return invoke<string>("set_active_ai_provider", { providerId });
}

export async function testAiProviderConnection(providerId: string): Promise<ProviderTestResult> {
  if (!isTauri()) { await mockDelay(700); return { ok: true, message: "Preview connection succeeded." }; }
  return invoke<ProviderTestResult>("test_ai_provider_connection", { providerId });
}
