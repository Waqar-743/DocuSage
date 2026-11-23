import type { AiProviderKind, ProviderModelInfo } from '../types';

export type MajorCloudProviderKind = 'anthropic' | 'openAi' | 'googleGemini';

export type MajorCloudProviderMeta = {
  kind: MajorCloudProviderKind;
  canonicalId: string;
  name: string;
  shortLabel: string;
  keyPlaceholder: string;
  docsHint: string;
  defaultBaseUrl: string;
  defaultModel: string;
};

export const MAJOR_CLOUD_PROVIDERS: MajorCloudProviderMeta[] = [
  {
    kind: 'anthropic',
    canonicalId: 'anthropic',
    name: 'Anthropic',
    shortLabel: 'Claude',
    keyPlaceholder: 'sk-ant-api03-…',
    docsHint: 'console.anthropic.com',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5-20250929',
  },
  {
    kind: 'openAi',
    canonicalId: 'openai',
    name: 'OpenAI',
    shortLabel: 'OpenAI',
    keyPlaceholder: 'sk-proj-…',
    docsHint: 'platform.openai.com',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
  },
  {
    kind: 'googleGemini',
    canonicalId: 'google-gemini',
    name: 'Google Gemini',
    shortLabel: 'Gemini',
    keyPlaceholder: 'AIzaSy…',
    docsHint: 'aistudio.google.com',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
  },
];

export const CURATED_PROVIDER_MODELS: Record<MajorCloudProviderKind, ProviderModelInfo[]> = {
  anthropic: [
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1' },
    { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
  ],
  openAi: [
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'o4-mini', label: 'o4-mini' },
  ],
  googleGemini: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  ],
};

export function isMajorCloudKind(kind: AiProviderKind): kind is MajorCloudProviderKind {
  return kind === 'anthropic' || kind === 'openAi' || kind === 'googleGemini';
}

export function getMergedProviderModels(
  kind: MajorCloudProviderKind,
  fetched?: ProviderModelInfo[],
): ProviderModelInfo[] {
  const curated = CURATED_PROVIDER_MODELS[kind];
  if (!fetched || fetched.length === 0) return curated;
  const byId = new Map<string, ProviderModelInfo>();
  for (const m of curated) byId.set(m.id, m);
  for (const m of fetched) {
    if (!byId.has(m.id)) {
      byId.set(m.id, m);
    }
  }
  return Array.from(byId.values());
}

export function getModelDisplayName(
  kind: AiProviderKind,
  modelId: string | null | undefined,
  fetched?: ProviderModelInfo[],
): string {
  if (!modelId) return '';
  if (kind === 'local') {
    const match = MODEL_CATALOG.find((m) => m.filename.toLowerCase() === modelId.toLowerCase());
    return match ? match.name : modelId.replace(/\.gguf$/i, '');
  }
  if (isMajorCloudKind(kind)) {
    const curated = CURATED_PROVIDER_MODELS[kind].find((m) => m.id === modelId);
    if (curated) return curated.label;
  }
  const live = fetched?.find((m) => m.id === modelId);
  return live ? live.label : modelId;
}

export type ModelCatalogEntry = {
  id: string;
  name: string;
  size: string;
  kind: 'chat' | 'embedding';
  description: string;
  downloadUrl: string;
  directDownloadUrl: string;
  filename: string;
  recommended?: boolean;
};

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: 'llama-3.2-1b',
    name: 'Llama 3.2 1B Instruct',
    size: '~700 MB',
    kind: 'chat',
    description: 'Fast, compact Meta instruction model — great everyday offline assistant.',
    downloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF',
    directDownloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    recommended: true,
  },
  {
    id: 'qwen2.5-1.5b',
    name: 'Qwen 2.5 1.5B Instruct',
    size: '~940 MB',
    kind: 'chat',
    description: 'Strong multilingual reasoning and document Q&A quality for its footprint.',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    directDownloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  },
  {
    id: 'qwen2.5-3b',
    name: 'Qwen 2.5 3B Instruct',
    size: '~1.8 GB',
    kind: 'chat',
    description: 'Sharp technical synthesis, coding, and multi-document RAG groundedness.',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF',
    directDownloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
  },
  {
    id: 'llama-3.2-3b',
    name: 'Llama 3.2 3B Instruct',
    size: '~2.0 GB',
    kind: 'chat',
    description: 'Balanced 3B Meta model for deeper offline analysis and structured writing.',
    downloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF',
    directDownloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'gemma-2-2b',
    name: 'Gemma 2 2B IT',
    size: '~1.5 GB',
    kind: 'chat',
    description: 'Google 2B instruction model with crisp summaries and clean tone.',
    downloadUrl: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF',
    directDownloadUrl: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
    filename: 'gemma-2-2b-it-Q4_K_M.gguf',
  },
  {
    id: 'phi-3.5-mini',
    name: 'Phi-3.5 Mini Instruct',
    size: '~2.2 GB',
    kind: 'chat',
    description: 'Microsoft small reasoning & code model with strong logical fidelity.',
    downloadUrl: 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF',
    directDownloadUrl: 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
    filename: 'Phi-3.5-mini-instruct-Q4_K_M.gguf',
  },
  {
    id: 'bge-small-en',
    name: 'BGE Small EN v1.5 (Embeddings)',
    size: '~33 MB',
    kind: 'embedding',
    description: 'Ultra-lightweight 384-dim offline GGUF embedding model for Hybrid Vector + FTS5 RAG.',
    downloadUrl: 'https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf',
    directDownloadUrl: 'https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf',
    filename: 'bge-small-en-v1.5-q8_0.gguf',
    recommended: true,
  },
  {
    id: 'nomic-embed-text',
    name: 'Nomic Embed Text v1.5 (Embeddings)',
    size: '~84 MB',
    kind: 'embedding',
    description: 'High-accuracy 768-dim long-context offline embedding GGUF for semantic retrieval.',
    downloadUrl: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF',
    directDownloadUrl: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf',
    filename: 'nomic-embed-text-v1.5.Q4_K_M.gguf',
  },
];

export const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  local: 'Built-in Local (GGUF)',
  openAi: 'OpenAI',
  anthropic: 'Anthropic Claude',
  googleGemini: 'Google Gemini',
  openRouter: 'OpenRouter',
  ollamaLocal: 'Ollama (Local)',
  ollamaRemote: 'Ollama (Remote)',
  lmStudio: 'LM Studio (Local)',
  lmStudioRemote: 'LM Studio (Remote)',
  customOpenAiCompatible: 'Custom OpenAI-Compatible',
};

export const PROVIDER_DEFAULTS: Record<AiProviderKind, { baseUrl: string; model: string; needsKey: boolean }> = {
  local: { baseUrl: '', model: '', needsKey: false },
  openAi: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', needsKey: true },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5-20251001', needsKey: true },
  googleGemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', needsKey: true },
  openRouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini', needsKey: true },
  ollamaLocal: { baseUrl: 'http://localhost:11434', model: 'llama3.2', needsKey: false },
  ollamaRemote: { baseUrl: 'http://localhost:11434', model: 'llama3.2', needsKey: false },
  lmStudio: { baseUrl: 'http://localhost:1234/v1', model: 'local-model', needsKey: false },
  lmStudioRemote: { baseUrl: 'http://localhost:1234/v1', model: 'local-model', needsKey: false },
  customOpenAiCompatible: { baseUrl: 'https://example.com/v1', model: '', needsKey: true },
};

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
