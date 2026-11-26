import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type {
  AiProviderConfig,
  AiProviderConfigInput,
  AssistantSettings,
  AssistantStatus,
  AssistantWindowMode,
  ChatHistoryMessage,
  ContextTelemetry,
  DownloadedModel,
  IndexedDocument,
  IngestResult,
  LocalModelTestResult,
  LocalRuntimeStatus,
  PartialDownload,
  ProviderList,
  ProviderModelInfo,
  ProviderTestResult,
  RagConfig,
} from '../types';

export type {
  AiProviderConfig,
  AiProviderConfigInput,
  AiProviderKind,
  AssistantSettings,
  AssistantStatus,
  AssistantWindowMode,
  ChatHistoryMessage,
  ContextTelemetry,
  DownloadedModel,
  IndexedDocument,
  IngestResult,
  LocalModelTestResult,
  LocalRuntimeStatus,
  PartialDownload,
  ProviderList,
  ProviderModelInfo,
  ProviderTestResult,
  ProviderVerificationStatus,
  RagConfig,
} from '../types';

export const RAG_CONFIG_DEFAULTS: RagConfig = {
  chunkSize: 500,
  chunkOverlap: 80,
  topK: 8,
  showContext: false,
  fullContextThreshold: 12000,
  tokenBudget: 4000,
  forceRagAlways: false,
  embedding: {
    backend: 'auto',
    model: '',
    baseUrl: null,
    providerId: null,
  },
};

export const ASSISTANT_SETTINGS_DEFAULTS: AssistantSettings = {
  launchHidden: false,
  hideOnClose: true,
  hideFromTaskbar: true,
  autoHideOnBlur: true,
  keepModelLoaded: true,
  globalShortcut: 'Alt+Space',
  windowMode: 'spotlight',
  lastMonitorName: null,
  firstOpenDone: false,
  spotlightWidth: 440,
  spotlightHeight: 560,
  dashboardBounds: null,
};

export const DEFAULT_ALLOWED_EXTENSIONS = [
  'pdf', 'txt', 'md', 'rst', 'html', 'htm', 'py', 'js', 'ts', 'tsx', 'jsx',
  'rs', 'java', 'cpp', 'c', 'h', 'hpp', 'go', 'rb', 'php', 'swift', 'kt', 'cs',
  'json', 'yaml', 'yml', 'toml', 'xml', 'csv', 'sh', 'ps1', 'sql', 'log', 'conf', 'ini', 'env',
];

export type ChatSendRequest = {
  prompt: string;
  history: ChatHistoryMessage[];
  requestId: string;
  attachedPaths: string[];
  providerId?: string | null;
  modelOverride?: string | null;
};

export type ChatSendResponse = {
  reply: string;
  stopped: boolean;
  telemetry: ContextTelemetry;
};

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Start native window drag on primary single-click only — deliberately ignores
 * double-clicks so double-clicking a header never maximizes or toggles fullscreen.
 */
export function handleWindowDragMouseDown(e: {
  button: number;
  detail: number;
  target: EventTarget | null;
}): void {
  if (!isTauri() || e.button !== 0 || e.detail > 1) return;
  const el = e.target as HTMLElement | null;
  if (el?.closest('button, input, select, textarea, a, [role="button"], [role="listbox"], [role="option"], [data-no-drag]')) {
    return;
  }
  void getCurrentWindow().startDragging().catch(() => {});
}

function mockDelay(ms = 400): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Unified Smart Chat ──────────────────────────────────────────────────────

export async function chatSend(req: ChatSendRequest): Promise<ChatSendResponse> {
  if (!isTauri()) {
    await mockDelay(500);
    const hasDocs = req.attachedPaths.length > 0;
    const telemetry: ContextTelemetry = {
      requestId: req.requestId,
      mode: hasDocs ? 'fts5Offline' : 'none',
      estimatedTokens: hasDocs ? 420 : 0,
      totalChars: hasDocs ? 1680 : 0,
      documentCount: req.attachedPaths.length,
      citations: hasDocs
        ? req.attachedPaths.map((p, idx) => ({
            documentName: p.split(/[\\/]/).pop() ?? p,
            sourcePath: p,
            chunkIndex: idx,
            score: 0.92,
            snippet: 'Preview excerpt retrieved from your attached document via SQLite FTS5 + RRF.',
            matchSource: 'keyword' as const,
          }))
        : [],
    };
    return {
      reply: hasDocs
        ? `**Smart Context (${telemetry.mode})**: Preview answer grounded in ${req.attachedPaths.length} attached document(s) for: _"${req.prompt}"_.`
        : `**DocuSage Preview**: Streaming response for _"${req.prompt}"_. Launch the desktop app to run real offline or cloud inference.`,
      stopped: false,
      telemetry,
    };
  }
  return invoke<ChatSendResponse>('chat_send', { req });
}

export async function stopChat(requestId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('stop_chat', { requestId });
}

// Legacy compatibility wrappers
export async function chatGeneral(prompt: string, history: ChatHistoryMessage[], requestId: string): Promise<string> {
  const res = await chatSend({ prompt, history, requestId, attachedPaths: [], providerId: 'local' });
  return res.reply;
}

export async function chatRag(prompt: string, history: ChatHistoryMessage[], requestId: string, sourcePath: string): Promise<string> {
  const res = await chatSend({ prompt, history, requestId, attachedPaths: [sourcePath], providerId: 'local' });
  return res.reply;
}

// ── Multi-Format Document Pipeline & SQLite Hybrid Store ────────────────────

export async function getAllowedExtensions(): Promise<string[]> {
  if (!isTauri()) return [...DEFAULT_ALLOWED_EXTENSIONS];
  return invoke<string[]>('get_allowed_extensions');
}

export async function ingestDocument(filePath: string): Promise<IngestResult> {
  if (!isTauri()) {
    await mockDelay(450);
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    return {
      fileName,
      chunkCount: 14,
      charCount: 8400,
      sourcePath: filePath,
      hasEmbeddings: false,
      embeddingModel: null,
    };
  }
  return invoke<IngestResult>('ingest_document', { filePath: String(filePath) });
}

export async function deleteDocument(filePath: string): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('delete_document', { filePath });
}

export async function listIndexedDocuments(): Promise<IndexedDocument[]> {
  if (!isTauri()) return [];
  return invoke<IndexedDocument[]>('list_indexed_documents');
}

// ── On-demand Local Runtime (`llama-server`) & GGUF Models ──────────────────

export async function getLocalRuntimeStatus(): Promise<LocalRuntimeStatus> {
  if (!isTauri()) {
    return {
      installed: true,
      binaryPath: 'built-in (llama.cpp)',
      running: true,
      port: null,
      baseUrl: null,
      loadedModel: 'Qwen3.5-2B-Q4_K_M.gguf',
      loadedModelPath: '/mock/models/Qwen3.5-2B-Q4_K_M.gguf',
      embeddingRunning: false,
      embeddingPort: null,
      embeddingModel: null,
      detectedBackend: 'built-in',
      platformSummary: 'browser-preview (16 GB RAM · 4 threads)',
      version: 'llama.cpp (built-in)',
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
      recommendedThreads: 4,
      contextLength: 8192,
    };
  }
  return invoke<LocalRuntimeStatus>('get_local_runtime_status');
}

export async function installLocalRuntime(preferredBackend?: string): Promise<LocalRuntimeStatus> {
  if (!isTauri()) {
    await mockDelay(800);
    return getLocalRuntimeStatus();
  }
  return invoke<LocalRuntimeStatus>('install_local_runtime', { preferredBackend: preferredBackend ?? null });
}

export async function loadModel(path?: string): Promise<string> {
  if (!isTauri()) {
    await mockDelay(300);
    return 'Model loaded (browser preview)';
  }
  return invoke<string>('load_model', { path: path ?? null });
}

export async function downloadModel(
  url: string,
  filename: string,
  expectedSha256?: string,
): Promise<string> {
  if (!isTauri()) {
    await mockDelay(700);
    return `/mock/models/${filename}`;
  }
  return invoke<string>('download_model', {
    url,
    filename,
    expectedSha256: expectedSha256 ?? null,
  });
}

export async function cancelDownload(filename: string): Promise<boolean> {
  if (!isTauri()) return true;
  return invoke<boolean>('cancel_download', { filename });
}

export async function listPartialDownloads(): Promise<PartialDownload[]> {
  if (!isTauri()) return [];
  return invoke<PartialDownload[]>('list_partial_downloads');
}

export async function deletePartialDownload(filename: string): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('delete_partial_download', { filename });
}

export async function listDownloadedModels(): Promise<DownloadedModel[]> {
  if (!isTauri()) {
    return [
      {
        filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
        path: '/mock/models/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
        sizeBytes: 734003200,
      },
    ];
  }
  return invoke<DownloadedModel[]>('list_downloaded_models');
}

export async function connectModel(filePath: string): Promise<string> {
  if (!isTauri()) {
    await mockDelay(400);
    return `Connected to: ${filePath.split(/[\\/]/).pop()}`;
  }
  return invoke<string>('connect_model', { filePath });
}

export async function connectEmbeddingModel(filePath: string): Promise<LocalRuntimeStatus> {
  if (!isTauri()) {
    await mockDelay(400);
    const status = await getLocalRuntimeStatus();
    return { ...status, embeddingRunning: true, embeddingModel: filePath.split(/[\\/]/).pop() ?? filePath };
  }
  return invoke<LocalRuntimeStatus>('connect_embedding_model', { filePath });
}

export async function disconnectModel(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('disconnect_model');
}

export async function restartAiEngine(): Promise<string> {
  if (!isTauri()) return 'AI engine restarted (preview)';
  return invoke<string>('restart_ai_engine');
}

export async function deleteModel(filePath: string): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('delete_model', { filePath });
}

export async function getModelsDir(): Promise<string> {
  if (!isTauri()) return '/mock/models';
  return invoke<string>('get_models_dir');
}

export async function getConnectedModel(): Promise<string | null> {
  if (!isTauri()) return 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';
  return invoke<string | null>('get_connected_model');
}

export async function testLocalModel(): Promise<LocalModelTestResult> {
  if (!isTauri()) {
    await mockDelay(350);
    return {
      ok: true,
      message: 'Local model responded in 0.35s.',
      reply: 'Local model is ready!',
      durationMs: 350,
      model: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    };
  }
  return invoke<LocalModelTestResult>('test_local_model');
}

// ── RAG & Context Config ────────────────────────────────────────────────────

export async function getRagConfig(): Promise<RagConfig> {
  if (!isTauri()) return { ...RAG_CONFIG_DEFAULTS, embedding: { ...RAG_CONFIG_DEFAULTS.embedding } };
  return invoke<RagConfig>('get_rag_config');
}

export async function saveRagConfig(config: RagConfig): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('save_rag_config', { config });
}

// ── Spotlight / Dashboard Window Lifecycle & Clipboard ──────────────────────

export async function getAssistantStatus(): Promise<AssistantStatus> {
  if (!isTauri()) {
    return {
      isVisible: true,
      isPinned: false,
      autostartEnabled: false,
      settings: { ...ASSISTANT_SETTINGS_DEFAULTS, windowMode: 'dashboard' },
      platform: {
        platform: 'browser',
        startupHidden: 'Desktop-only',
        taskbarHidden: 'Desktop-only',
        altTabHidden: 'Desktop-only',
        focusNotes: 'Desktop-only',
      },
    };
  }
  return invoke<AssistantStatus>('get_assistant_status');
}

export async function saveAssistantSettings(settings: AssistantSettings): Promise<AssistantSettings> {
  if (!isTauri()) return settings;
  return invoke<AssistantSettings>('save_assistant_settings', { settings });
}

export async function setAssistantPinned(pinned: boolean): Promise<boolean> {
  if (!isTauri()) return pinned;
  return invoke<boolean>('set_assistant_pinned', { pinned });
}

export async function setAssistantFocusGuard(guard: {
  dialogOpen?: boolean;
  settingsOpen?: boolean;
  busy?: boolean;
}): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('set_assistant_focus_guard', {
    dialogOpen: guard.dialogOpen ?? null,
    settingsOpen: guard.settingsOpen ?? null,
    busy: guard.busy ?? null,
  });
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (!isTauri()) return enabled;
  return invoke<boolean>('set_autostart_enabled', { enabled });
}

export async function readClipboardText(): Promise<string> {
  if (!isTauri()) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      return navigator.clipboard.readText();
    }
    return '';
  }
  return invoke<string>('read_clipboard_text');
}

export async function hideAssistantWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('hide_assistant_window');
}

export async function showAssistantWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('show_assistant_window');
}

export async function setAssistantWindowMode(windowMode: AssistantWindowMode): Promise<AssistantWindowMode> {
  if (!isTauri()) return windowMode;
  return invoke<AssistantWindowMode>('set_assistant_window_mode', { windowMode });
}

export async function cycleAssistantWindowMode(): Promise<AssistantWindowMode> {
  if (!isTauri()) return 'dashboard';
  return invoke<AssistantWindowMode>('cycle_assistant_window_mode');
}

export async function checkForUpdates(): Promise<string> {
  if (!isTauri()) return 'Updates are checked against GitHub Releases on desktop.';
  return invoke<string>('check_for_updates');
}

// ── Providers & Dynamic Model Listing ───────────────────────────────────────

export async function listAiProviderConfigs(): Promise<ProviderList> {
  if (!isTauri()) {
    return {
      activeProviderId: 'local',
      secureStorageAvailable: true,
      providers: [
        {
          id: 'local',
          name: 'Built-in Local (GGUF)',
          provider: 'local',
          enabled: true,
          baseUrl: null,
          model: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
          organization: null,
          project: null,
          timeoutSecs: 60,
          temperature: 0.3,
          apiKeySet: false,
          options: {},
        },
      ],
    };
  }
  return invoke<ProviderList>('list_ai_provider_configs');
}

export async function saveAiProviderConfig(input: AiProviderConfigInput): Promise<AiProviderConfig> {
  if (!isTauri()) {
    return {
      ...input,
      id: input.id ?? `provider-${Date.now()}`,
      apiKeySet: !!input.apiKey && !input.deleteApiKey,
      baseUrl: input.baseUrl ?? null,
      model: input.model ?? null,
      organization: input.organization ?? null,
      project: input.project ?? null,
    };
  }
  return invoke<AiProviderConfig>('save_ai_provider_config', { input });
}

export async function deleteAiProviderConfig(providerId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('delete_ai_provider_config', { providerId });
}

export async function setActiveAiProvider(providerId: string): Promise<string> {
  if (!isTauri()) return providerId;
  return invoke<string>('set_active_ai_provider', { providerId });
}

export async function testAiProviderConnection(providerId: string): Promise<ProviderTestResult> {
  if (!isTauri()) {
    await mockDelay(350);
    return {
      ok: true,
      status: 'verified',
      message: 'Verified (preview)',
      models: [
        { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' },
        { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
        { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      ],
    };
  }
  return invoke<ProviderTestResult>('test_ai_provider_connection', { providerId });
}

export async function fetchAiProviderModels(providerId: string): Promise<ProviderModelInfo[]> {
  if (!isTauri()) return [];
  return invoke<ProviderModelInfo[]>('fetch_ai_provider_models', { providerId });
}
