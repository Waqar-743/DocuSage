export type AppearanceTheme = 'dark' | 'light' | 'glass' | 'paper' | 'rose' | 'ocean';
export type AssistantWindowMode = 'spotlight' | 'dashboard';
export type SidebarTab = 'chats' | 'docs';
export type SettingsTab = 'providers' | 'localRuntime' | 'ragContext' | 'appearance' | 'shortcuts' | 'backup';

export type AiProviderKind =
  | 'local'
  | 'openAi'
  | 'anthropic'
  | 'googleGemini'
  | 'openRouter'
  | 'ollamaLocal'
  | 'ollamaRemote'
  | 'lmStudio'
  | 'lmStudioRemote'
  | 'customOpenAiCompatible';

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

export type AiProviderConfigInput = Omit<AiProviderConfig, 'id' | 'apiKeySet'> & {
  id?: string;
  apiKey?: string;
  deleteApiKey: boolean;
};

export type ProviderModelInfo = {
  id: string;
  label: string;
};

export type ProviderList = {
  activeProviderId: string;
  providers: AiProviderConfig[];
  secureStorageAvailable: boolean;
};

export type ProviderTestResult = {
  ok: boolean;
  message: string;
  models: ProviderModelInfo[];
};

export type ContextMode = 'none' | 'full' | 'hybridRag' | 'fts5Offline' | 'truncated';
export type MatchSource = 'hybrid' | 'vector' | 'keyword';

export type ContextCitation = {
  documentName: string;
  sourcePath: string;
  chunkIndex: number;
  score: number;
  snippet: string;
  matchSource: MatchSource;
};

export type ContextTelemetry = {
  requestId: string;
  mode: ContextMode;
  estimatedTokens: number;
  totalChars: number;
  documentCount: number;
  citations: ContextCitation[];
};

export type EmbeddingBackendKind =
  | 'auto'
  | 'none'
  | 'localLlama'
  | 'ollama'
  | 'gemini'
  | 'openAiCompatible';

export type EmbeddingConfig = {
  backend: EmbeddingBackendKind;
  model: string;
  baseUrl: string | null;
  providerId: string | null;
};

export type RagConfig = {
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  showContext: boolean;
  fullContextThreshold: number;
  tokenBudget: number;
  forceRagAlways: boolean;
  embedding: EmbeddingConfig;
};

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
};

export type AssistantSettings = {
  launchHidden: boolean;
  hideOnClose: boolean;
  hideFromTaskbar: boolean;
  autoHideOnBlur: boolean;
  keepModelLoaded: boolean;
  globalShortcut: string;
  windowMode: AssistantWindowMode;
  lastMonitorName: string | null;
  firstOpenDone: boolean;
  spotlightWidth: number;
  spotlightHeight: number;
  dashboardBounds: WindowBounds | null;
};

export type AssistantStatus = {
  isVisible: boolean;
  isPinned: boolean;
  autostartEnabled: boolean;
  settings: AssistantSettings;
  platform: {
    platform: string;
    startupHidden: string;
    taskbarHidden: string;
    altTabHidden: string;
    focusNotes: string;
  };
};

export type LocalRuntimeStatus = {
  installed: boolean;
  binaryPath: string | null;
  running: boolean;
  port: number | null;
  baseUrl: string | null;
  loadedModel: string | null;
  loadedModelPath: string | null;
  embeddingRunning: boolean;
  embeddingPort: number | null;
  embeddingModel: string | null;
  detectedBackend: string;
  platformSummary: string;
  version: string | null;
};

export type RuntimeDownloadProgress = {
  stage: string;
  assetName: string;
  downloaded: number;
  total: number;
  percent: number;
  done: boolean;
  error: string | null;
};

export type DownloadProgress = {
  filename: string;
  downloaded: number;
  total: number;
  percent: number;
  done: boolean;
  error?: string | null;
};

export type DownloadedModel = {
  filename: string;
  path: string;
  sizeBytes: number;
};

export type IndexedDocument = {
  id: string;
  path: string;
  name: string;
  chunkCount: number;
  charCount: number;
  embeddingModel: string | null;
  hasEmbeddings: boolean;
  updatedAt: number;
};

export type IngestResult = {
  fileName: string;
  chunkCount: number;
  charCount: number;
  sourcePath: string;
  hasEmbeddings: boolean;
  embeddingModel: string | null;
};

export type ChatHistoryMessage = {
  sender: 'user' | 'bot';
  text: string;
};

export type ChatMessageItem = {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  createdAt: number;
  isStreaming?: boolean;
  isError?: boolean;
  requestId?: string;
  providerLabel?: string;
  modelLabel?: string;
  telemetry?: ContextTelemetry;
};

export type ChatBranch = {
  id: string;
  name: string;
  parentBranchId: string | null;
  forkedFromMessageId: string | null;
  messages: ChatMessageItem[];
  createdAt: number;
};

export type ChatFolder = {
  id: string;
  name: string;
  collapsed?: boolean;
  createdAt: number;
};

export type ChatSession = {
  id: string;
  name: string;
  folderId: string | null;
  attachedDocPaths: string[];
  branches: ChatBranch[];
  activeBranchId: string;
  createdAt: number;
  updatedAt: number;
};

export type CompareTarget = {
  id: string;
  providerId: string;
  providerName: string;
  model: string;
};

export type CompareColumnResult = {
  targetId: string;
  requestId: string;
  providerName: string;
  model: string;
  text: string;
  isStreaming: boolean;
  isError: boolean;
  durationMs: number | null;
  telemetry?: ContextTelemetry;
};

export type ToastItem = {
  id: string;
  kind: 'info' | 'success' | 'error';
  message: string;
};
