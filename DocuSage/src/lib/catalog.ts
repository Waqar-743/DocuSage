import type { AiProviderKind } from '../types';

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
