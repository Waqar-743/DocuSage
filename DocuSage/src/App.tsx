import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Settings, Database, Plus, FileText, Send, Paperclip, AlertCircle, Trash2, X, MessageSquare, Square, CheckCircle, Key, Download, Cpu, HardDrive, Sliders, Link, Link2Off, FolderOpen, RotateCcw, Maximize2, Cloud, Keyboard, ShieldCheck, Eye, EyeOff, Monitor, Power, RefreshCw, Menu, Copy, Check, Search, Folder, Command, Palette, Wrench, Minimize2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  chatGeneral, chatRag, chatGeminiRag, ingestDocument, isTauri, loadModel, stopChat,
  downloadModel, listDownloadedModels, connectModel, disconnectModel, deleteModel,
  getConnectedModel, getRagConfig, saveRagConfig,
  chatCloud, chatCloudRag, restartAiEngine,
  getAssistantStatus, saveAssistantSettings, hideAssistantWindow, setAssistantWindowMode, cycleAssistantWindowMode,
  checkForUpdates, listAiProviderConfigs, saveAiProviderConfig, deleteAiProviderConfig,
  setActiveAiProvider, testAiProviderConnection,
  GEMINI_KEY_STORAGE, RAG_CONFIG_DEFAULTS,
  ASSISTANT_SETTINGS_DEFAULTS,
  type ChatHistoryMessage, type IngestResult, type DownloadedModel, type RagConfig,
  type AssistantSettings, type AssistantStatus, type AssistantWindowMode,
  type AiProviderConfig, type AiProviderConfigInput, type AiProviderKind, type ProviderList,
} from './lib/api';
import MarketingSite from './MarketingSite';
import './App.css';

type Message = {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  isStreaming?: boolean;
  isError?: boolean;
};

type Document = {
  id: string;
  name: string;
  path: string;
  status: 'ingesting' | 'ready' | 'error';
  messages: Message[];
};

type GeneralChat = {
  id: string;
  name: string;
  messages: Message[];
};

type AppearanceTheme = 'dark' | 'light' | 'glass' | 'paper' | 'rose' | 'ocean';
type SidebarTab = 'chats' | 'folders' | 'docs';

type PersistedAppState = {
  theme: AppearanceTheme;
  mode: 'general' | 'rag';
  documents: Document[];
  generalChats: GeneralChat[];
  selectedDocId: string | null;
  selectedGeneralChatId: string;
  drafts: Record<string, string>;
  scrollPositions: Record<string, number>;
  assistantWindowMode: AssistantWindowMode;
  sidebarCollapsed: boolean;
  sidebarTab: SidebarTab;
};

type DownloadProgress = {
  filename: string;
  downloaded: number;
  total: number;
  percent: number;
  done: boolean;
  error?: string;
};

type SettingsTab = 'providers' | 'appearance' | 'shortcuts' | 'advanced' | 'models' | 'downloaded' | 'ragTuning';

type ProviderDraft = {
  id?: string;
  name: string;
  provider: AiProviderKind;
  enabled: boolean;
  baseUrl: string;
  model: string;
  organization: string;
  project: string;
  timeoutSecs: number;
  temperature: number;
  apiKey: string;
  deleteApiKey: boolean;
  options: Record<string, unknown>;
};

const STORAGE_KEY = 'docusage:app-state:v1';
const DEFAULT_CHAT_ID = 'default';

type ModelCatalogEntry = {
  id: string;
  name: string;
  size: string;
  description: string;
  downloadUrl: string;
  directDownloadUrl: string;
  filename: string;
  recommended?: boolean;
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// Each entry links to a known-good Q4_K_M GGUF on HuggingFace.
// directDownloadUrl points to the specific file for in-app downloading.
const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen 2.5 0.5B',
    size: '~380 MB',
    description: 'Ultra-fast model for basic tasks. Great for low-end hardware and quick lookups when speed matters more than depth.',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF',
    directDownloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  },
  {
    id: 'llama-3.2-1b',
    name: 'Llama 3.2 1B',
    size: '~700 MB',
    description: "Compact model great for quick tasks and chat. One of Meta's smallest instruction-tuned models with fast responses and reasonable quality.",
    downloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF',
    directDownloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    recommended: true,
  },
  {
    id: 'qwen2.5-1.5b',
    name: 'Qwen 2.5 1.5B',
    size: '~940 MB',
    description: "Strong multilingual support and reasoning ability for its size. A solid balance of speed and capability across many languages.",
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    directDownloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  },
  {
    id: 'smollm2-1.7b',
    name: 'SmolLM2 1.7B',
    size: '~1.0 GB',
    description: "HuggingFace's own small language model, designed for efficiency. Punches above its weight with strong general knowledge and fast inference on mobile devices.",
    downloadUrl: 'https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF',
    directDownloadUrl: 'https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/resolve/main/smollm2-1.7b-instruct-q4_k_m.gguf',
    filename: 'smollm2-1.7b-instruct-q4_k_m.gguf',
  },
  {
    id: 'gemma-2-2b',
    name: 'Gemma 2 2B',
    size: '~1.5 GB',
    description: "Google's lightweight model optimized specifically for on-device deployment. Excellent balance of quality and speed, built with mobile-first design.",
    downloadUrl: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF',
    directDownloadUrl: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
    filename: 'gemma-2-2b-it-Q4_K_M.gguf',
  },
  {
    id: 'qwen2.5-3b',
    name: 'Qwen 2.5 3B',
    size: '~1.8 GB',
    description: 'Capable model for complex tasks. Better reasoning, longer-context understanding, and improved multi-turn dialogue.',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF',
    directDownloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
  },
  {
    id: 'llama-3.2-3b',
    name: 'Llama 3.2 3B',
    size: '~2.0 GB',
    description: "Meta's best small model for mobile. Strong reasoning, creative writing, and conversational ability. Recommended for most users with a modern laptop.",
    downloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF',
    directDownloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'phi-3.5-mini',
    name: 'Phi-3.5 Mini',
    size: '~2.2 GB',
    description: "Microsoft's compact powerhouse, trained on high-quality data including code. Exceptional at programming tasks, debugging, and technical explanations.",
    downloadUrl: 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF',
    directDownloadUrl: 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
    filename: 'Phi-3.5-mini-instruct-Q4_K_M.gguf',
  },
];

const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  local: 'Local',
  openAi: 'OpenAI',
  anthropic: 'Anthropic Claude',
  googleGemini: 'Google Gemini',
  openRouter: 'OpenRouter',
  ollamaLocal: 'Ollama Local',
  ollamaRemote: 'Ollama Remote',
  lmStudio: 'LM Studio',
  lmStudioRemote: 'LM Studio Remote',
  customOpenAiCompatible: 'Custom OpenAI-compatible',
};

const PROVIDER_DEFAULTS: Record<AiProviderKind, { baseUrl: string; model: string; needsKey: boolean }> = {
  local: { baseUrl: '', model: '', needsKey: false },
  openAi: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', needsKey: true },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest', needsKey: true },
  googleGemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', needsKey: true },
  openRouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini', needsKey: true },
  ollamaLocal: { baseUrl: 'http://localhost:11434', model: 'llama3.2', needsKey: false },
  ollamaRemote: { baseUrl: 'http://localhost:11434', model: 'llama3.2', needsKey: false },
  lmStudio: { baseUrl: 'http://localhost:1234/v1', model: 'local-model', needsKey: false },
  lmStudioRemote: { baseUrl: 'http://localhost:1234/v1', model: 'local-model', needsKey: false },
  customOpenAiCompatible: { baseUrl: 'https://example.com/v1', model: '', needsKey: true },
};

const MODEL_SELECTOR_GROUPS: { provider: AiProviderKind; heading: string; models: string[] }[] = [
  { provider: 'local', heading: 'Local', models: ['Connected local model'] },
  { provider: 'googleGemini', heading: 'Google Gemini', models: ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'] },
  { provider: 'openAi', heading: 'OpenAI', models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'] },
  { provider: 'anthropic', heading: 'Anthropic Claude', models: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest', 'claude-3-opus-latest'] },
  { provider: 'openRouter', heading: 'OpenRouter', models: ['openai/gpt-4.1-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.5-flash'] },
  { provider: 'ollamaLocal', heading: 'Ollama Local', models: ['llama3.2', 'mistral', 'qwen2.5'] },
  { provider: 'ollamaRemote', heading: 'Ollama Remote', models: ['llama3.2', 'mistral', 'qwen2.5'] },
  { provider: 'lmStudio', heading: 'LM Studio', models: ['local-model'] },
  { provider: 'customOpenAiCompatible', heading: 'Custom OpenAI-Compatible API', models: ['custom-model'] },
];

const APPEARANCE_OPTIONS: { key: AppearanceTheme; label: string; description: string }[] = [
  { key: 'dark', label: 'Dark', description: 'Low-glare charcoal interface.' },
  { key: 'light', label: 'Light', description: 'Bright neutral workspace.' },
  { key: 'glass', label: 'Glass', description: 'Transparent assistant overlay.' },
  { key: 'paper', label: 'Paper', description: 'Soft document-first surface.' },
  { key: 'rose', label: 'Rose', description: 'Warm light accent palette.' },
  { key: 'ocean', label: 'Ocean', description: 'Cool dark accent palette.' },
];

const createProviderDraft = (provider: AiProviderKind = 'openAi'): ProviderDraft => {
  const defaults = PROVIDER_DEFAULTS[provider];
  return {
    name: PROVIDER_LABELS[provider],
    provider,
    enabled: true,
    baseUrl: defaults.baseUrl,
    model: defaults.model,
    organization: '',
    project: '',
    timeoutSecs: 60,
    temperature: 0.2,
    apiKey: '',
    deleteApiKey: false,
    options: {},
  };
};

const providerToDraft = (provider: AiProviderConfig): ProviderDraft => ({
  id: provider.id,
  name: provider.name,
  provider: provider.provider,
  enabled: provider.enabled,
  baseUrl: provider.baseUrl ?? PROVIDER_DEFAULTS[provider.provider].baseUrl,
  model: provider.model ?? PROVIDER_DEFAULTS[provider.provider].model,
  organization: provider.organization ?? '',
  project: provider.project ?? '',
  timeoutSecs: provider.timeoutSecs,
  temperature: provider.temperature,
  apiKey: '',
  deleteApiKey: false,
  options: provider.options ?? {},
});

const draftToInput = (draft: ProviderDraft): AiProviderConfigInput => ({
  id: draft.id,
  name: draft.name,
  provider: draft.provider,
  enabled: draft.enabled,
  baseUrl: draft.baseUrl.trim() || null,
  model: draft.model.trim() || null,
  organization: draft.organization.trim() || null,
  project: draft.project.trim() || null,
  timeoutSecs: draft.timeoutSecs,
  temperature: draft.temperature,
  apiKey: draft.apiKey,
  deleteApiKey: draft.deleteApiKey,
  options: draft.options,
});

const conversationKeyFor = (
  currentMode: 'general' | 'rag',
  currentDocId: string | null,
  currentChatId: string,
) => currentMode === 'rag'
  ? `rag:${currentDocId ?? 'none'}`
  : `general:${currentChatId}`;

const createEmptyChat = (id = DEFAULT_CHAT_ID): GeneralChat => ({
  id,
  name: 'New Chat',
  messages: [],
});

const createRequestId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;

const loadPersistedState = (): PersistedAppState => {
  const fallback: PersistedAppState = {
    theme: 'dark',
    mode: 'rag',
    documents: [],
    generalChats: [createEmptyChat()],
    selectedDocId: null,
    selectedGeneralChatId: DEFAULT_CHAT_ID,
    drafts: {},
    scrollPositions: {},
    assistantWindowMode: 'compact',
    sidebarCollapsed: false,
    sidebarTab: 'chats',
  };

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedAppState>;
    const generalChats = Array.isArray(parsed.generalChats) && parsed.generalChats.length > 0
      ? parsed.generalChats
      : [createEmptyChat()];
    const documents: Document[] = Array.isArray(parsed.documents)
      ? parsed.documents.map((doc) => ({
        ...doc,
        status: doc.status === 'error' ? 'error' as const : 'ready' as const,
        messages: Array.isArray(doc.messages) ? doc.messages : [],
      }))
      : [];

    return {
      theme: APPEARANCE_OPTIONS.some(option => option.key === parsed.theme)
        ? parsed.theme as AppearanceTheme
        : 'dark',
      mode: parsed.mode === 'general' ? 'general' : 'rag',
      documents,
      generalChats: generalChats.map((chat) => ({
        ...chat,
        messages: Array.isArray(chat.messages) ? chat.messages : [],
      })),
      selectedDocId: typeof parsed.selectedDocId === 'string' ? parsed.selectedDocId : null,
      selectedGeneralChatId: typeof parsed.selectedGeneralChatId === 'string'
        ? parsed.selectedGeneralChatId
        : generalChats[0].id,
      drafts: parsed.drafts && typeof parsed.drafts === 'object' ? parsed.drafts : {},
      scrollPositions: parsed.scrollPositions && typeof parsed.scrollPositions === 'object'
        ? parsed.scrollPositions
        : {},
      assistantWindowMode: parsed.assistantWindowMode === 'compact' || parsed.assistantWindowMode === 'full'
        ? parsed.assistantWindowMode
        : parsed.assistantWindowMode === 'medium'
          ? 'medium'
          : 'compact',
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      sidebarTab: parsed.sidebarTab === 'folders' || parsed.sidebarTab === 'docs'
        ? parsed.sidebarTab
        : 'chats',
    };
  } catch {
    return fallback;
  }
};

const TypewriterEffect = ({ text, speed = 100 }: { text: string, speed?: number }) => {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    let i = 0;
    setDisplayedText('');
    const timer = setInterval(() => {
      i++;
      setDisplayedText(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(timer);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return <span>{displayedText}</span>;
};

const parseCodeFence = (line: string) => {
  const match = line.match(/^```\s*([A-Za-z0-9_+#.-]*)\s*$/);
  return match ? match[1] || 'text' : null;
};

const renderInlineMarkdown = (text: string, isDark: boolean) => {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={`${part}-${index}`}
          className={`px-1.5 py-0.5 rounded text-[0.86em] font-mono ${isDark ? 'bg-black/30 text-emerald-200' : 'bg-zinc-100 text-[#0F2854]'}`}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });
};

const CodeBlock = ({ language, code, isDark }: { language: string; code: string; isDark: boolean }) => {
  const [copied, setCopied] = useState(false);
  const lines = code.replace(/\n$/, '').split('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code.replace(/\n$/, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={`my-3 overflow-hidden rounded-lg border ${isDark ? 'border-[#343438] bg-[#111113]' : 'border-zinc-200 bg-zinc-950'}`}>
      <div className={`flex items-center justify-between px-3 py-2 border-b ${isDark ? 'border-[#343438] bg-white/5' : 'border-white/10 bg-white/10'}`}>
        <span className="text-[11px] font-medium uppercase tracking-normal text-zinc-400">{language || 'text'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/10"
          title="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto p-0 text-[12px] leading-5 text-zinc-100">
        <code className="block py-3">
          {lines.map((line, index) => (
            <span key={index} className="grid grid-cols-[3rem_1fr] px-3">
              <span className="select-none pr-4 text-right text-zinc-600">{index + 1}</span>
              <span className="whitespace-pre">{line || ' '}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
};

const MarkdownMessage = ({ text, isDark }: { text: string; isDark: boolean }) => {
  const blocks: Array<{ type: 'code'; language: string; code: string } | { type: 'text'; lines: string[] }> = [];
  let currentText: string[] = [];
  let currentCode: string[] | null = null;
  let currentLanguage = 'text';

  for (const line of text.split('\n')) {
    const fenceLanguage = parseCodeFence(line);
    if (fenceLanguage !== null) {
      if (currentCode) {
        blocks.push({ type: 'code', language: currentLanguage, code: currentCode.join('\n') });
        currentCode = null;
        currentLanguage = 'text';
      } else {
        if (currentText.length) {
          blocks.push({ type: 'text', lines: currentText });
          currentText = [];
        }
        currentCode = [];
        currentLanguage = fenceLanguage;
      }
      continue;
    }

    if (currentCode) {
      currentCode.push(line);
    } else {
      currentText.push(line);
    }
  }

  if (currentCode) {
    blocks.push({ type: 'code', language: currentLanguage, code: currentCode.join('\n') });
  }
  if (currentText.length) {
    blocks.push({ type: 'text', lines: currentText });
  }

  return (
    <div className="space-y-2">
      {blocks.map((block, blockIndex) => {
        if (block.type === 'code') {
          return <CodeBlock key={blockIndex} language={block.language} code={block.code} isDark={isDark} />;
        }

        const groups: React.ReactNode[] = [];
        let listItems: string[] = [];
        const flushList = () => {
          if (!listItems.length) return;
          groups.push(
            <ul key={`list-${groups.length}`} className="my-2 list-disc space-y-1 pl-5">
              {listItems.map((item, index) => <li key={index}>{renderInlineMarkdown(item, isDark)}</li>)}
            </ul>
          );
          listItems = [];
        };

        block.lines.forEach((line, lineIndex) => {
          const bullet = line.match(/^\s*[-*]\s+(.+)$/);
          const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
          if (bullet || numbered) {
            listItems.push((bullet?.[1] ?? numbered?.[1] ?? '').trim());
            return;
          }

          flushList();
          if (!line.trim()) {
            groups.push(<div key={`space-${lineIndex}`} className="h-1" />);
          } else {
            groups.push(
              <p key={`line-${lineIndex}`} className="leading-relaxed">
                {renderInlineMarkdown(line, isDark)}
              </p>
            );
          }
        });
        flushList();

        return <React.Fragment key={blockIndex}>{groups}</React.Fragment>;
      })}
    </div>
  );
};

export default function App() {
  if (!isTauri() && import.meta.env.PROD) {
    return <MarketingSite />;
  }

  const initialStateRef = useRef<PersistedAppState>(loadPersistedState());
  const persistedState = initialStateRef.current;

  const [theme, setTheme] = useState<AppearanceTheme>(persistedState.theme);
  const [mode, setMode] = useState<'general' | 'rag'>(persistedState.mode);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const [toastSuccess, setToastSuccess] = useState<string | null>(null);
  const [, setIsIngesting] = useState(false);
  const [, setIngestFileName] = useState<string>('');
  const [ingestWidget, setIngestWidget] = useState<{ type: 'loading' | 'success'; fileName: string; chunkCount: number } | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isModelReady, setIsModelReady] = useState(!isTauri());
  const [modelStatus, setModelStatus] = useState<string>(isTauri() ? 'Model not loaded' : 'Browser preview mode');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers');
  const [geminiKey, setGeminiKey] = useState<string>(() => {
    try { return window.localStorage.getItem(GEMINI_KEY_STORAGE) ?? ''; } catch { return ''; }
  });
  const [assistantSettings, setAssistantSettings] = useState<AssistantSettings>({
    ...ASSISTANT_SETTINGS_DEFAULTS,
    windowMode: persistedState.assistantWindowMode,
  });
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus | null>(null);
  const [assistantShortcutDraft, setAssistantShortcutDraft] = useState(ASSISTANT_SETTINGS_DEFAULTS.globalShortcut);
  const [viewportCompact, setViewportCompact] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 620 : false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(persistedState.sidebarCollapsed);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(persistedState.sidebarTab);
  const [chatSearch, setChatSearch] = useState('');

  // Model manager state
  const [downloadedModels, setDownloadedModels] = useState<DownloadedModel[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>({});
  const [connectedModelFile, setConnectedModelFile] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState<string | null>(null);

  // RAG tuning state
  const [ragConfig, setRagConfig] = useState<RagConfig>({ ...RAG_CONFIG_DEFAULTS });
  const [providerConfigs, setProviderConfigs] = useState<AiProviderConfig[]>([]);
  const [activeProviderId, setActiveProviderId] = useState('local');
  const [secureStorageAvailable, setSecureStorageAvailable] = useState(false);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(() => createProviderDraft('openAi'));
  const [showProviderKey, setShowProviderKey] = useState(false);
  const [providerTestStatus, setProviderTestStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [isProviderBusy, setIsProviderBusy] = useState(false);

  // Session State
  const [documents, setDocuments] = useState<Document[]>(persistedState.documents);
  const [generalChats, setGeneralChats] = useState<GeneralChat[]>(persistedState.generalChats);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(persistedState.selectedDocId);
  const [selectedGeneralChatId, setSelectedGeneralChatId] = useState<string>(persistedState.selectedGeneralChatId);
  const [drafts, setDrafts] = useState<Record<string, string>>(persistedState.drafts);
  const [scrollPositions, setScrollPositions] = useState<Record<string, number>>(persistedState.scrollPositions);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isDark = theme === 'dark' || theme === 'glass' || theme === 'ocean';
  const isCompactMode = assistantSettings.windowMode === 'compact' || viewportCompact;
  const isFullMode = assistantSettings.windowMode === 'full' && !viewportCompact;
  const readyDocumentCount = documents.filter(doc => doc.status === 'ready').length;
  const ingestingDocumentCount = documents.filter(doc => doc.status === 'ingesting').length;

  // Context ref for stable callbacks
  const contextRef = useRef({ mode, selectedDocId, selectedGeneralChatId });
  useEffect(() => {
    contextRef.current = { mode, selectedDocId, selectedGeneralChatId };
  }, [mode, selectedDocId, selectedGeneralChatId]);

  const activeMessages = mode === 'rag'
    ? documents.find(d => d.id === selectedDocId)?.messages || []
    : generalChats.find(c => c.id === selectedGeneralChatId)?.messages || [];
  const activeConversationKey = conversationKeyFor(mode, selectedDocId, selectedGeneralChatId);
  const activeProvider = providerConfigs.find(provider => provider.id === activeProviderId)
    ?? providerConfigs.find(provider => provider.id === 'local')
    ?? null;
  const isCloudMode = !!activeProvider && activeProvider.provider !== 'local';
  const activeModelValue = activeProvider
    ? `${activeProvider.provider}:${activeProvider.provider === 'local' ? 'Connected local model' : activeProvider.model ?? PROVIDER_DEFAULTS[activeProvider.provider].model}`
    : 'local:Connected local model';
  const filteredChats = generalChats.filter(chat => chat.name.toLowerCase().includes(chatSearch.toLowerCase()));
  const filteredDocs = documents.filter(doc => doc.name.toLowerCase().includes(chatSearch.toLowerCase()));

  const updateMessages = (updater: Message[] | ((prev: Message[]) => Message[])) => {
    const { mode: currentMode, selectedDocId: currentDocId, selectedGeneralChatId: currentChatId } = contextRef.current;

    if (currentMode === 'rag' && currentDocId) {
      setDocuments(prev => prev.map(doc => {
        if (doc.id === currentDocId) {
          const newMessages = typeof updater === 'function' ? updater(doc.messages) : updater;
          return { ...doc, messages: newMessages };
        }
        return doc;
      }));
    } else if (currentMode === 'general' && currentChatId) {
      setGeneralChats(prev => prev.map(chat => {
        if (chat.id === currentChatId) {
          const newMessages = typeof updater === 'function' ? updater(chat.messages) : updater;
          let newName = chat.name;
          if (chat.name === 'New Chat' && newMessages.length > 0 && newMessages[0].sender === 'user') {
            newName = newMessages[0].text.slice(0, 30) + (newMessages[0].text.length > 30 ? '...' : '');
          }
          return { ...chat, name: newName, messages: newMessages };
        }
        return chat;
      }));
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    setInputValue(drafts[activeConversationKey] ?? '');
    requestAnimationFrame(() => {
      const el = chatScrollRef.current;
      if (!el) return;
      const saved = scrollPositions[activeConversationKey];
      el.scrollTop = typeof saved === 'number' ? saved : el.scrollHeight;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationKey]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 180 || activeMessages.some(message => message.isStreaming)) {
      scrollToBottom();
    }
  }, [activeMessages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [inputValue]);

  // Global shortcut for clearing chat (Ctrl+Shift+C)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        updateMessages([]);
      } else if (e.key === 'Escape') {
        setShowSettings(false);
        if (isTauri()) {
          e.preventDefault();
          hideAssistantWindow().catch(() => {});
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleNewChat();
      } else if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setSettingsTab('shortcuts');
        setShowSettings(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSettings]);

  useEffect(() => {
    const onResize = () => setViewportCompact(window.innerWidth < 620);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const showError = (msg: string) => {
    setToastError(msg);
    setTimeout(() => setToastError(null), 5000);
  };

  const showSuccess = (msg: string) => {
    setToastSuccess(msg);
    setTimeout(() => setToastSuccess(null), 3000);
  };

  const updateInputValue = (value: string) => {
    setInputValue(value);
    setDrafts(prev => ({ ...prev, [activeConversationKey]: value }));
  };

  const refreshDownloadedModels = useCallback(async () => {
    try {
      const models = await listDownloadedModels();
      setDownloadedModels(models);
    } catch {
      // Non-fatal — models dir may not exist yet
    }
  }, []);

  const refreshProviderConfigs = useCallback(async () => {
    try {
      const list: ProviderList = await listAiProviderConfigs();
      setProviderConfigs(list.providers);
      setActiveProviderId(list.activeProviderId);
      setSecureStorageAvailable(list.secureStorageAvailable);
      const editable = list.providers.find(provider => provider.id !== 'local') ?? list.providers[0];
      if (editable) {
        setProviderDraft(providerToDraft(editable));
      }
    } catch (err) {
      showError(`Failed to load AI providers: ${String(err)}`);
    }
  }, []);

  // Load the local GGUF model once on startup in desktop mode.
  // Browser preview mode uses mocked chat responses and does not need this.
  const ensureModelLoaded = async () => {
    if (!isTauri() || isModelLoading) return;

    setIsModelLoading(true);
    setModelStatus('Loading local model...');

    try {
      const msg = await loadModel();
      setIsModelReady(true);
      setModelStatus(msg || 'Model loaded');
      // Sync which model is currently active
      const connected = await getConnectedModel();
      setConnectedModelFile(connected);
    } catch (err) {
      setIsModelReady(false);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setModelStatus(errorMessage);
      showError(`Model load failed: ${errorMessage}`);
    } finally {
      setIsModelLoading(false);
    }
  };

  useEffect(() => {
    if (isTauri()) {
      refreshDownloadedModels();
      refreshProviderConfigs();
      getAssistantStatus().then(status => {
        setAssistantStatus(status);
        setAssistantSettings(status.settings);
        setAssistantShortcutDraft(status.settings.globalShortcut);
        if (status.settings.keepModelLoaded) {
          ensureModelLoaded();
        }
      }).catch(() => {});
      // Hydrate RAG config from backend
      getRagConfig().then(setRagConfig).catch(() => {});
      if (geminiKey.trim()) {
        const migrated = createProviderDraft('googleGemini');
        migrated.name = 'Gemini';
        migrated.apiKey = geminiKey.trim();
        saveAiProviderConfig(draftToInput(migrated))
          .then(provider => setActiveAiProvider(provider.id))
          .then(() => {
            try { window.localStorage.removeItem(GEMINI_KEY_STORAGE); } catch {}
            setGeminiKey('');
            refreshProviderConfigs();
          })
          .catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for download-progress events emitted by the Rust download_model command.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;

    listen<DownloadProgress>('download-progress', (event) => {
      const p = event.payload;
      setDownloadProgress(prev => ({ ...prev, [p.filename]: p }));

      if (p.done && !p.error) {
        refreshDownloadedModels();
        // Clear progress indicator after a short delay so the user sees 100%.
        setTimeout(() => {
          setDownloadProgress(prev => {
            const { [p.filename]: _, ...rest } = prev;
            return rest;
          });
        }, 2500);
      }
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [refreshDownloadedModels]);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisteners: UnlistenFn[] = [];

    listen('assistant-focus-prompt', () => {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }).then(fn => unlisteners.push(fn));

    listen('assistant-open-settings', () => {
      setSettingsTab('providers');
      setShowSettings(true);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }).then(fn => unlisteners.push(fn));

    listen('assistant-check-updates', async () => {
      try {
        const msg = await checkForUpdates();
        showSuccess(msg);
      } catch (err) {
        showError(`Update check failed: ${String(err)}`);
      }
    }).then(fn => unlisteners.push(fn));

    listen('assistant-restart-ai-engine', async () => {
      try {
        setIsModelLoading(true);
        const msg = await restartAiEngine();
        setIsModelReady(true);
        setModelStatus(msg);
        const connected = await getConnectedModel();
        setConnectedModelFile(connected);
        showSuccess('AI engine restarted');
      } catch (err) {
        setIsModelReady(false);
        showError(`AI engine restart failed: ${String(err)}`);
      } finally {
        setIsModelLoading(false);
      }
    }).then(fn => unlisteners.push(fn));

    listen<{ message: string }>('assistant-shortcut-error', (event) => {
      showError(event.payload.message);
    }).then(fn => unlisteners.push(fn));

    listen<AssistantWindowMode>('assistant-window-mode', (event) => {
      setAssistantSettings(prev => ({ ...prev, windowMode: event.payload }));
    }).then(fn => unlisteners.push(fn));

    return () => {
      unlisteners.forEach(unlisten => unlisten());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh downloaded models list whenever the Downloaded tab is opened.
  useEffect(() => {
    if (showSettings && settingsTab === 'downloaded') {
      refreshDownloadedModels();
    }
  }, [showSettings, settingsTab, refreshDownloadedModels]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme,
      mode,
      documents,
      generalChats,
      selectedDocId,
      selectedGeneralChatId,
      drafts,
      scrollPositions,
      assistantWindowMode: assistantSettings.windowMode,
      sidebarCollapsed,
      sidebarTab,
    } satisfies PersistedAppState));
  }, [theme, mode, documents, generalChats, selectedDocId, selectedGeneralChatId, drafts, scrollPositions, assistantSettings.windowMode, sidebarCollapsed, sidebarTab]);

  const handlePickFile = async () => {
    let filePath: string;
    let fileName: string;

    if (isTauri()) {
      // Real Tauri desktop: native OS file picker — returns only the path string.
      try {
        const selected = await open({
          multiple: false,
          directory: false,
          filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
        });
        if (!selected) return;

        // Guarantee we only have the path string, never file content.
        filePath = typeof selected === 'string' ? selected : String(selected);

        // Safety check: reject if the dialog somehow returned raw file content.
        if (filePath.startsWith('%PDF')) {
          showError('Received file content instead of path. Please update @tauri-apps/plugin-dialog.');
          return;
        }

        fileName = filePath.split(/[\\/]/).pop() ?? filePath;
      } catch (e) {
        showError(`Failed to open file picker: ${String(e)}`);
        return;
      }
    } else {
      // Browser preview: simulate a file pick with a prompt
      const mockPath = window.prompt("Browser preview — enter a PDF path to simulate ingestion:", "C:\\Documents\\sample.pdf");
      if (!mockPath) return;
      filePath = mockPath;
      fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    }

    const newDoc: Document = {
      id: Date.now().toString(),
      name: fileName,
      path: filePath,
      status: 'ingesting',
      messages: []
    };
    setDocuments(prev => [newDoc, ...prev]);
    setSelectedDocId(newDoc.id);
    setMode('rag');

    setIsIngesting(true);
    setIngestFileName(fileName);
    setIngestWidget({ type: 'loading', fileName, chunkCount: 0 });
    try {
      const result: IngestResult = await ingestDocument(filePath);
      setDocuments(prev => prev.map(d =>
        d.id === newDoc.id ? { ...d, status: 'ready' } : d
      ));
      setIngestWidget({ type: 'success', fileName: result.fileName, chunkCount: result.chunkCount });
      setTimeout(() => setIngestWidget(null), 4000);
    } catch (err) {
      setDocuments(prev => prev.map(d =>
        d.id === newDoc.id ? { ...d, status: 'error' } : d
      ));
      setIngestWidget(null);
      showError(`Failed to ingest ${fileName}: ${String(err)}`);
    } finally {
      setIsIngesting(false);
      setIngestFileName('');
    }
  };

  const handleDeleteDoc = (id: string) => {
    const filtered = documents.filter(d => d.id !== id);
    setDocuments(filtered);
    if (selectedDocId === id) {
      setSelectedDocId(null);
    }
  };

  const handleDeleteGeneralChat = (id: string) => {
    const filtered = generalChats.filter(c => c.id !== id);
    if (filtered.length === 0) {
      const newId = createRequestId();
      setGeneralChats([createEmptyChat(newId)]);
      setSelectedGeneralChatId(newId);
    } else {
      setGeneralChats(filtered);
      if (selectedGeneralChatId === id) {
        setSelectedGeneralChatId(filtered[0].id);
      }
    }
  };

  const handleNewChat = () => {
    setMode('general');
    const newChatId = createRequestId();
    setGeneralChats(prev => [createEmptyChat(newChatId), ...prev]);
    setSelectedGeneralChatId(newChatId);
    setInputValue('');
    setDrafts(prev => ({ ...prev, [conversationKeyFor('general', null, newChatId)]: '' }));
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const getConversationHistory = (): ChatHistoryMessage[] => activeMessages
    .filter((message) => message.text.trim() && !message.isError)
    .map((message) => ({
      sender: message.sender,
      text: message.text,
    }));

  const handleStop = async () => {
    if (!activeRequestId || isStopping) {
      return;
    }

    setIsStopping(true);

    try {
      await stopChat(activeRequestId);
    } catch (error) {
      setIsStopping(false);
      showError(`Failed to stop generation: ${String(error)}`);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isTyping) return;

    // Cloud mode does not require a local GGUF model, but local RAG still
    // requires an indexed document selection.
    const useLegacyGemini = mode === 'rag' && !!geminiKey.trim() && !isCloudMode;
    if (!isModelReady && !isCloudMode && !useLegacyGemini) {
      showError('Model is not loaded yet. Click Retry Model Load in the header, or choose a cloud provider in Settings.');
      return;
    }

    const userText = inputValue.trim();
    const requestId = createRequestId();
    const conversationHistory = getConversationHistory();
    updateInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const newUserMsg: Message = { id: `${requestId}-user`, text: userText, sender: 'user' };
    const botMsgId = `${requestId}-assistant`;

    updateMessages(prev => [...prev, newUserMsg, { id: botMsgId, text: '', sender: 'bot', isStreaming: true }]);
    setIsTyping(true);
    setIsStopping(false);
    setActiveRequestId(requestId);

    // Set up streaming token listener before invoking the command so no
    // tokens are missed.  In browser preview mode we skip this entirely.
    let unlistenFn: UnlistenFn | null = null;
    if (isTauri()) {
      try {
        unlistenFn = await listen<{ requestId: string; token: string; done: boolean }>('chat-token', (event) => {
          if (event.payload.requestId !== requestId) {
            return;
          }

          const { token } = event.payload;
          if (token) {
            updateMessages(prev => prev.map(msg =>
              msg.id === botMsgId
                ? { ...msg, text: msg.text + token, isStreaming: true }
                : msg
            ));
          }
        });
      } catch {
        // If event listener setup fails, fall back to non-streaming.
      }
    }

    try {
      let response: string;
      if (isCloudMode && mode === 'general') {
        response = await chatCloud(userText, conversationHistory, requestId);
      } else if (isCloudMode && mode === 'rag') {
        response = await chatCloudRag(userText, conversationHistory, requestId);
      } else if (mode === 'general') {
        response = await chatGeneral(userText, conversationHistory, requestId);
      } else if (geminiKey.trim()) {
        // Hybrid mode: use Gemini API for RAG when key is set
        response = await chatGeminiRag(geminiKey.trim(), userText, conversationHistory);
      } else {
        response = await chatRag(userText, conversationHistory, requestId);
      }

      // Set final text from the invoke return value for consistency.
      updateMessages(prev => prev.map(msg =>
        msg.id === botMsgId
          ? { ...msg, text: response, isStreaming: false }
          : msg
      ));
    } catch (error: unknown) {
      console.error("Error generating response:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      updateMessages(prev => prev.map(msg =>
        msg.id === botMsgId
          ? { ...msg, text: errorMessage, isError: true, isStreaming: false }
          : msg
      ));
      showError("Failed to generate response. Please check your connection.");
    } finally {
      unlistenFn?.();
      setIsTyping(false);
      setIsStopping(false);
      setActiveRequestId(null);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (!e.shiftKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (mode === 'rag' && !selectedDocId) {
        showError("Please select or ingest a document first to use RAG mode.");
        return;
      }
      handleSend();
    }
  };

  const handleCycleWindowMode = async () => {
    try {
      const windowMode = await cycleAssistantWindowMode();
      setAssistantSettings(prev => ({ ...prev, windowMode }));
    } catch (err) {
      showError(`Window resize failed: ${String(err)}`);
    }
  };

  const handleHideAssistant = async () => {
    setShowSettings(false);
    if (isTauri()) {
      try {
        await hideAssistantWindow();
      } catch (err) {
        showError(`Hide failed: ${String(err)}`);
      }
    }
  };

  const handleSelectModel = async (value: string) => {
    const separator = value.indexOf(':');
    if (separator === -1) return;

    const providerKind = value.slice(0, separator) as AiProviderKind;
    const modelName = value.slice(separator + 1);

    if (providerKind === 'local') {
      try {
        await setActiveAiProvider('local');
        setActiveProviderId('local');
        showSuccess('Active provider: Local');
      } catch (err) {
        showError(`Provider switch failed: ${String(err)}`);
      }
      return;
    }

    const existing = providerConfigs.find(provider => provider.provider === providerKind);
    const baseDraft = existing ? providerToDraft(existing) : createProviderDraft(providerKind);
    const nextDraft = { ...baseDraft, model: modelName };

    try {
      const saved = await saveAiProviderConfig(draftToInput(nextDraft));
      await setActiveAiProvider(saved.id);
      setActiveProviderId(saved.id);
      setProviderDraft(providerToDraft(saved));
      await refreshProviderConfigs();
      showSuccess(`Selected model: ${modelName}`);
    } catch (err) {
      showError(`Model selection failed: ${String(err)}`);
    }
  };

  const providerKeyLink = (kind: AiProviderKind): string | null => {
    switch (kind) {
      case 'openAi':
        return 'https://platform.openai.com/api-keys';
      case 'anthropic':
        return 'https://console.anthropic.com/settings/keys';
      case 'googleGemini':
        return 'https://aistudio.google.com/app/apikey';
      case 'openRouter':
        return 'https://openrouter.ai/keys';
      default:
        return null;
    }
  };

  const rootSurfaceClass = isDark
    ? theme === 'glass'
      ? 'bg-[#151517]/80 text-zinc-100 backdrop-blur-xl selection:bg-white/30'
      : theme === 'ocean'
        ? 'bg-[#111827] text-zinc-100 selection:bg-cyan-300/30'
        : 'bg-[#151517] text-zinc-100 selection:bg-white/30'
    : theme === 'paper'
      ? 'bg-[#fbfaf7] text-zinc-900 selection:bg-[#0F2854]/30'
      : theme === 'rose'
        ? 'bg-[#fff7f8] text-zinc-900 selection:bg-rose-300/40'
        : 'bg-white text-zinc-900 selection:bg-[#0F2854]/30';

  const activeModelLabel = activeProvider?.provider === 'local'
    ? connectedModelFile ?? 'Local'
    : activeProvider?.model ?? 'Choose model';

  return (
    <div className={`flex flex-col h-screen overflow-hidden font-sans transition-colors duration-200 relative rounded-[18px] ${rootSurfaceClass}`}>

      {/* Toast Notification for Errors */}
      {toastError && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500 text-white shadow-xl transition-all duration-300 ease-out">
          <AlertCircle size={18} />
          <span className="text-sm font-medium">{toastError}</span>
        </div>
      )}

      {/* Toast Notification for Success */}
      {toastSuccess && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 text-white shadow-xl transition-all duration-300 ease-out">
          <Database size={18} />
          <span className="text-sm font-medium">{toastSuccess}</span>
        </div>
      )}

      {/* Ingestion Status Widget (right side) */}
      {ingestWidget && (
        <div className={`fixed right-6 top-1/2 -translate-y-1/2 z-40 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg border transition-all duration-300 ${isDark ? 'bg-[#1e1e20] border-[#2a2a2c]' : 'bg-white border-zinc-200'}`}>
          {ingestWidget.type === 'loading' ? (
            <>
              <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin shrink-0" />
              <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-700'}`}>Chunking &amp; Embedding "{ingestWidget.fileName}"...</p>
            </>
          ) : (
            <>
              <CheckCircle size={20} className="text-emerald-500 shrink-0" />
              <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-700'}`}>Successfully vectorized {ingestWidget.chunkCount} chunks!</p>
            </>
          )}
        </div>
      )}

      {/* Header */}
      <header
        data-tauri-drag-region
        className={`flex min-h-14 items-center justify-between gap-3 border-b px-3 shrink-0 transition-colors duration-200 ${isDark ? 'border-white/10 bg-white/[0.03]' : 'border-zinc-200/80 bg-white/70'}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {!isCompactMode && (
            <button
              onClick={() => setSidebarCollapsed(prev => !prev)}
              className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-white/10 text-zinc-400 hover:text-zinc-100 hover:bg-white/10' : 'border-zinc-200 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}
              title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            >
              <Menu size={16} />
            </button>
          )}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={`shrink-0 ${isDark ? 'text-white' : 'text-[#0F2854]'}`}>
            <path d="M5 4H12C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20H5V4Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M5 8H10C12.2091 8 14 9.79086 14 12C14 14.2091 12.2091 16 10 16H5V8Z" fill="#10b981"/>
          </svg>
          {!isCompactMode && <span className="font-semibold text-base tracking-normal">DocuSage</span>}
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <select
            value={activeModelValue}
            onChange={e => handleSelectModel(e.target.value)}
            className={`min-w-0 max-w-[220px] rounded-lg border px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 ${
              isDark ? 'bg-[#1d1d20] border-white/10 text-zinc-100 focus:ring-white/20' : 'bg-white border-zinc-200 text-zinc-800 focus:ring-[#0F2854]/20'
            }`}
            title={`Selected model: ${activeModelLabel}`}
          >
            {!MODEL_SELECTOR_GROUPS.some(group => group.models.some(modelName => `${group.provider}:${modelName}` === activeModelValue)) && (
              <option value={activeModelValue}>{activeModelLabel}</option>
            )}
            {MODEL_SELECTOR_GROUPS.map(group => (
              <optgroup key={group.heading} label={group.heading}>
                {group.models.map(modelName => (
                  <option key={`${group.provider}:${modelName}`} value={`${group.provider}:${modelName}`}>
                    {modelName}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <button
            onClick={() => {
              setMode('rag');
              setSidebarTab('docs');
            }}
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
              isDark ? 'border-white/10 text-zinc-300 hover:bg-white/10' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100'
            }`}
            title={`${readyDocumentCount} ready documents`}
          >
            <Database size={14} />
            {readyDocumentCount}
            {ingestingDocumentCount > 0 && <span className="text-amber-400">+{ingestingDocumentCount}</span>}
          </button>

          <button
            onClick={handleCycleWindowMode}
            className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-white/10 text-zinc-400 hover:text-zinc-100 hover:bg-white/10' : 'border-zinc-200 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}
            title={`Cycle assistant size (${assistantSettings.windowMode})`}
          >
            {assistantSettings.windowMode === 'full' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>

          <button
            onClick={() => { setSettingsTab('providers'); setShowSettings(true); }}
            className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-white/10 text-zinc-400 hover:text-zinc-100 hover:bg-white/10' : 'border-zinc-200 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}
            title="Settings"
          >
            <Settings size={16} />
          </button>

          {isTauri() && !isCompactMode && (
            <button
              onClick={ensureModelLoaded}
              disabled={isModelLoading}
              className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
                isModelReady
                  ? (isDark ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : 'border-emerald-300 text-emerald-700 bg-emerald-50')
                  : (isDark ? 'border-amber-500/40 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20' : 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100')
              }`}
              title={modelStatus}
            >
              {isModelLoading ? 'Loading' : isModelReady ? 'Ready' : 'Load'}
            </button>
          )}

          <button
            onClick={handleHideAssistant}
            className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-white/10 text-zinc-400 hover:text-zinc-100 hover:bg-white/10' : 'border-zinc-200 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}
            title="Hide assistant"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowSettings(false)}>
          <div
            className={`w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl shadow-2xl border ${isDark ? 'bg-[#1e1e20] border-[#2a2a2c]' : 'bg-white border-zinc-200'}`}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-6 py-4 border-b shrink-0 ${isDark ? 'border-[#2a2a2c]' : 'border-zinc-200'}`}>
              <h2 className="text-lg font-semibold">Settings</h2>
              <button onClick={() => setShowSettings(false)} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-[#2a2a2c]' : 'hover:bg-zinc-100'}`}><X size={18} /></button>
            </div>

            {/* Tabs */}
            <div className={`flex gap-0.5 px-4 pt-2 border-b shrink-0 overflow-x-auto ${isDark ? 'border-[#2a2a2c]' : 'border-zinc-200'}`}>
              {(
                [
                  { key: 'providers', icon: <Cloud size={13} />, label: 'AI Providers' },
                  { key: 'appearance', icon: <Palette size={13} />, label: 'Appearance' },
                  { key: 'shortcuts', icon: <Keyboard size={13} />, label: 'Shortcuts' },
                  { key: 'advanced', icon: <Wrench size={13} />, label: 'Advanced' },
                  { key: 'models', icon: <Cpu size={13} />, label: 'Model Catalog' },
                  { key: 'downloaded', icon: <HardDrive size={13} />, label: 'Downloaded' },
                  { key: 'ragTuning', icon: <Sliders size={13} />, label: 'RAG Tuning' },
                ] satisfies { key: SettingsTab; icon: React.ReactNode; label: string }[]
              ).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setSettingsTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                    settingsTab === tab.key
                      ? isDark ? 'border-emerald-500 text-emerald-400' : 'border-[#0F2854] text-[#0F2854]'
                      : isDark ? 'border-transparent text-zinc-500 hover:text-zinc-300' : 'border-transparent text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {tab.icon} {tab.label}
                  {tab.key === 'downloaded' && downloadedModels.length > 0 && (
                    <span className={`ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'}`}>
                      {downloadedModels.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="overflow-y-auto p-6 flex-1">

              {/* ── Appearance ── */}
              {settingsTab === 'appearance' && (
                <div className="space-y-5">
                  <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-50 border-zinc-200'}`}>
                    <h3 className={`text-sm font-semibold ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>Appearance</h3>
                    <p className={`text-xs mt-1 leading-relaxed ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                      Choose the assistant surface. The layout and DocuSage identity stay the same across themes.
                    </p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    {APPEARANCE_OPTIONS.map(option => (
                      <button
                        key={option.key}
                        onClick={() => setTheme(option.key)}
                        className={`p-4 rounded-xl border text-left transition-colors ${
                          theme === option.key
                            ? isDark ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-[#0F2854]/40 bg-[#0F2854]/5'
                            : isDark ? 'border-[#2a2a2c] bg-[#232325] hover:border-[#3a3a3c]' : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`h-7 w-7 rounded-full border ${
                            option.key === 'dark' ? 'bg-[#151517] border-zinc-600'
                            : option.key === 'light' ? 'bg-white border-zinc-300'
                            : option.key === 'glass' ? 'bg-[#151517]/60 border-zinc-500'
                            : option.key === 'paper' ? 'bg-[#fbfaf7] border-stone-300'
                            : option.key === 'rose' ? 'bg-rose-100 border-rose-300'
                            : 'bg-cyan-950 border-cyan-700'
                          }`} />
                          <div>
                            <span className={`block text-sm font-medium ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>{option.label}</span>
                            <span className={`block text-xs mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>{option.description}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Shortcuts / Hidden Assistant ── */}
              {settingsTab === 'shortcuts' && (
                <div className="space-y-5">
                  <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-50 border-zinc-200'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className={`text-sm font-semibold ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>Hidden Desktop Assistant</h3>
                        <p className={`text-xs mt-1 leading-relaxed ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                          DocuSage stays loaded in the background and toggles with {assistantSettings.globalShortcut}.
                        </p>
                      </div>
                      <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase ${isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-100 text-emerald-700'}`}>
                        {assistantStatus?.isVisible ? 'Visible' : 'Background'}
                      </span>
                    </div>
                  </div>

                  <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-50 border-zinc-200'}`}>
                    <h3 className={`text-sm font-semibold mb-3 ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>Shortcuts</h3>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {[
                        ['Toggle Window', assistantSettings.globalShortcut],
                        ['Open Settings', 'Ctrl/Cmd + ,'],
                        ['Close/Hide', 'Escape'],
                        ['Send Message', 'Enter'],
                        ['New Line', 'Shift + Enter'],
                        ['New Chat', 'Ctrl/Cmd + N'],
                      ].map(([label, shortcut]) => (
                        <div key={label} className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${isDark ? 'bg-[#1e1e20]' : 'bg-white'}`}>
                          <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>{label}</span>
                          <kbd className={`rounded-md border px-2 py-1 text-[11px] font-medium ${isDark ? 'border-[#3a3a3c] bg-black/20 text-zinc-300' : 'border-zinc-200 bg-zinc-50 text-zinc-700'}`}>
                            {shortcut}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {[
                      ['launchHidden', 'Launch hidden', 'Start with no visible window and wait for the shortcut or tray.'],
                      ['hideOnClose', 'Close hides to tray', 'The window close button preserves backend state instead of quitting.'],
                      ['hideFromTaskbar', 'Hide taskbar entry while hidden', 'Best effort on Windows and Linux; macOS follows Dock activation rules.'],
                      ['keepModelLoaded', 'Keep local model loaded', 'Preserves instant activation when memory allows.'],
                    ].map(([key, label, description]) => (
                      <label
                        key={key}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-50 border-zinc-200'}`}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(assistantSettings[key as keyof AssistantSettings])}
                          onChange={e => setAssistantSettings(prev => ({ ...prev, [key]: e.target.checked }))}
                          className="mt-0.5 accent-emerald-500 w-4 h-4 shrink-0"
                        />
                        <span>
                          <span className={`block text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>{label}</span>
                          <span className={`block text-xs mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>{description}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
                    <div>
                      <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>Global Shortcut</label>
                      <input
                        value={assistantShortcutDraft}
                        onChange={e => setAssistantShortcutDraft(e.target.value)}
                        placeholder="Alt+Space"
                        className={`w-full px-3 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 ${
                          isDark ? 'bg-[#232325] border-[#2a2a2c] text-zinc-100 focus:ring-white/30' : 'bg-zinc-50 border-zinc-200 text-zinc-900 focus:ring-[#0F2854]/30'
                        }`}
                      />
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          const saved = await saveAssistantSettings({ ...assistantSettings, globalShortcut: assistantShortcutDraft.trim() || 'Alt+Space' });
                          setAssistantSettings(saved);
                          showSuccess('Assistant settings saved');
                        } catch (err) {
                          showError(`Shortcut registration failed: ${String(err)}`);
                        }
                      }}
                      className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? 'bg-white text-zinc-900 hover:bg-zinc-200' : 'bg-[#0F2854] text-white hover:bg-[#0a1b38]'}`}
                    >
                      Save
                    </button>
                  </div>

                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>Window Mode</label>
                    <div className={`grid grid-cols-3 gap-1 p-1 rounded-xl border ${isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-100 border-zinc-200'}`}>
                      {(['compact', 'medium', 'full'] as AssistantWindowMode[]).map(windowMode => (
                        <button
                          key={windowMode}
                          onClick={async () => {
                            const next = { ...assistantSettings, windowMode };
                            setAssistantSettings(next);
                            try {
                              await saveAssistantSettings(next);
                              await setAssistantWindowMode(windowMode);
                              showSuccess(`Window mode: ${windowMode}`);
                            } catch (err) {
                              showError(`Failed to set window mode: ${String(err)}`);
                            }
                          }}
                          className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-colors ${
                            assistantSettings.windowMode === windowMode
                              ? isDark ? 'bg-white text-zinc-900' : 'bg-[#0F2854] text-white'
                              : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-600 hover:text-zinc-900'
                          }`}
                        >
                          {windowMode}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={async () => {
                        try {
                          const mode = await cycleAssistantWindowMode();
                          setAssistantSettings(prev => ({ ...prev, windowMode: mode }));
                        } catch (err) {
                          showError(`Resize failed: ${String(err)}`);
                        }
                      }}
                      className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${isDark ? 'border-[#2a2a2c] text-zinc-300 hover:bg-[#232325]' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                    >
                      <Maximize2 size={14} /> Cycle Size
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          setIsModelLoading(true);
                          const msg = await restartAiEngine();
                          setIsModelReady(true);
                          setModelStatus(msg);
                          showSuccess('AI engine restarted');
                        } catch (err) {
                          setIsModelReady(false);
                          showError(`AI engine restart failed: ${String(err)}`);
                        } finally {
                          setIsModelLoading(false);
                        }
                      }}
                      className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${isDark ? 'border-[#2a2a2c] text-zinc-300 hover:bg-[#232325]' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                    >
                      <Power size={14} /> Restart AI Engine
                    </button>
                    <button
                      onClick={async () => {
                        try { showSuccess(await checkForUpdates()); } catch (err) { showError(`Update check failed: ${String(err)}`); }
                      }}
                      className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${isDark ? 'border-[#2a2a2c] text-zinc-300 hover:bg-[#232325]' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                    >
                      <RefreshCw size={14} /> Check Updates
                    </button>
                  </div>

                  {assistantStatus && (
                    <div className={`p-4 rounded-xl border text-xs leading-relaxed space-y-2 ${isDark ? 'bg-[#232325] border-[#2a2a2c] text-zinc-500' : 'bg-zinc-50 border-zinc-200 text-zinc-500'}`}>
                      <p className="flex items-center gap-2"><Monitor size={14} /> Platform: {assistantStatus.platform.platform}</p>
                      <p>{assistantStatus.platform.taskbarHidden}</p>
                      <p>{assistantStatus.platform.altTabHidden}</p>
                      <p>{assistantStatus.platform.focusNotes}</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Developer / Advanced ── */}
              {settingsTab === 'advanced' && (
                <div className="space-y-5">
                  <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-50 border-zinc-200'}`}>
                    <h3 className={`text-sm font-semibold ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>Developer / Advanced</h3>
                    <p className={`text-xs mt-1 leading-relaxed ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                      Runtime controls for the local AI engine, updates, and platform behavior.
                    </p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <button
                      onClick={async () => {
                        try {
                          setIsModelLoading(true);
                          const msg = await restartAiEngine();
                          setIsModelReady(true);
                          setModelStatus(msg);
                          const connected = await getConnectedModel();
                          setConnectedModelFile(connected);
                          showSuccess('AI engine restarted');
                        } catch (err) {
                          setIsModelReady(false);
                          showError(`AI engine restart failed: ${String(err)}`);
                        } finally {
                          setIsModelLoading(false);
                        }
                      }}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${isDark ? 'border-[#2a2a2c] text-zinc-300 hover:bg-[#232325]' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                    >
                      <Power size={15} /> Restart AI Engine
                    </button>
                    <button
                      onClick={async () => {
                        try { showSuccess(await checkForUpdates()); } catch (err) { showError(`Update check failed: ${String(err)}`); }
                      }}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${isDark ? 'border-[#2a2a2c] text-zinc-300 hover:bg-[#232325]' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                    >
                      <RefreshCw size={15} /> Check for Updates
                    </button>
                  </div>

                  <div className={`p-4 rounded-xl border text-xs leading-relaxed space-y-2 ${isDark ? 'bg-[#232325] border-[#2a2a2c] text-zinc-500' : 'bg-zinc-50 border-zinc-200 text-zinc-500'}`}>
                    <p className="flex items-center gap-2"><Monitor size={14} /> Platform: {assistantStatus?.platform.platform ?? 'desktop'}</p>
                    <p>{assistantStatus?.platform.startupHidden ?? 'Startup hidden by native window configuration.'}</p>
                    <p>{assistantStatus?.platform.taskbarHidden ?? 'Taskbar hiding is best effort by platform.'}</p>
                    <p>{assistantStatus?.platform.altTabHidden ?? 'Hidden windows are removed from window switching where the OS supports it.'}</p>
                    <p>{assistantStatus?.platform.focusNotes ?? 'Focus is requested after native show.'}</p>
                  </div>
                </div>
              )}

              {/* ── Model Catalog ── */}
              {settingsTab === 'models' && (
                <div>
                  <p className={`text-xs mb-4 leading-relaxed ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                    Click <strong>Download</strong> to fetch a model directly into DocuSage — no manual file management needed.
                    After downloading, go to the <strong>Downloaded</strong> tab and click <strong>Connect Now</strong>.
                  </p>
                  <div className="space-y-3">
                    {MODEL_CATALOG.map((m) => {
                      const progress = downloadProgress[m.filename];
                      const isDownloading = !!progress && !progress.done;
                      const isAlreadyDownloaded = downloadedModels.some(d => d.filename === m.filename);

                      return (
                        <div
                          key={m.id}
                          className={`flex items-start justify-between gap-4 p-4 rounded-xl border transition-colors ${isDark ? 'bg-[#232325] border-[#2a2a2c] hover:border-[#3a3a3c]' : 'bg-zinc-50 border-zinc-200 hover:border-zinc-300'}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <h3 className={`font-semibold text-sm ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>{m.name}</h3>
                              {m.recommended && (
                                <span className={`text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded ${isDark ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-emerald-100 text-emerald-700 border border-emerald-300'}`}>
                                  RECOMMENDED
                                </span>
                              )}
                              {isAlreadyDownloaded && (
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1 ${isDark ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-blue-50 text-blue-600 border border-blue-200'}`}>
                                  <CheckCircle size={10} /> On disk
                                </span>
                              )}
                            </div>
                            <p className={`text-xs leading-relaxed ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>{m.description}</p>

                            {/* Download progress bar */}
                            {isDownloading && (
                              <div className="mt-2">
                                <div className={`w-full h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-[#3a3a3c]' : 'bg-zinc-200'}`}>
                                  <div
                                    className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                                    style={{ width: `${progress.percent}%` }}
                                  />
                                </div>
                                <p className={`text-[10px] mt-1 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                  {formatBytes(progress.downloaded)}{progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ''} — {Math.round(progress.percent)}%
                                </p>
                              </div>
                            )}
                            {progress?.error && (
                              <p className="text-[10px] mt-1.5 text-red-400">{progress.error}</p>
                            )}
                          </div>

                          <div className="flex flex-col items-end gap-2 shrink-0">
                            <span className={`text-xs font-medium ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>{m.size}</span>
                            <button
                              disabled={isDownloading}
                              onClick={async () => {
                                if (isDownloading) return;
                                if (isTauri()) {
                                  try {
                                    await downloadModel(m.directDownloadUrl, m.filename);
                                  } catch (err) {
                                    showError(`Download failed: ${err}`);
                                  }
                                } else {
                                  try { window.open(m.downloadUrl, '_blank', 'noopener,noreferrer'); } catch {}
                                }
                              }}
                              title={isDownloading ? 'Downloading…' : `Download ${m.name}`}
                              className={`p-2 rounded-lg border transition-colors disabled:cursor-not-allowed ${
                                isDownloading
                                  ? isDark ? 'border-[#3a3a3c] text-zinc-600' : 'border-zinc-200 text-zinc-300'
                                  : isDark ? 'border-[#3a3a3c] text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/50' : 'border-zinc-300 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-400'
                              }`}
                            >
                              {isDownloading
                                ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                : <Download size={16} />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Downloaded Models ── */}
              {settingsTab === 'downloaded' && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                      Models stored on your machine. Use <strong>Connect Now</strong> to load a model into the active chat session.
                    </p>
                    <button
                      onClick={refreshDownloadedModels}
                      className={`p-1.5 rounded-lg transition-colors shrink-0 ${isDark ? 'text-zinc-400 hover:text-zinc-200 hover:bg-[#2a2a2c]' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'}`}
                      title="Refresh list"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>

                  {downloadedModels.length === 0 ? (
                    <div className={`flex flex-col items-center justify-center py-12 gap-3 ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                      <FolderOpen size={36} />
                      <p className="text-sm">No models downloaded yet.</p>
                      <p className="text-xs">Go to Model Catalog to download one.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {downloadedModels.map(model => {
                        const isConnected = connectedModelFile === model.filename;
                        const isThisConnecting = isConnecting === model.filename;
                        const otherConnecting = !!isConnecting && !isThisConnecting;

                        return (
                          <div
                            key={model.filename}
                            className={`flex items-center justify-between gap-4 p-4 rounded-xl border transition-colors ${
                              isConnected
                                ? isDark ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'
                                : isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-50 border-zinc-200'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                {isConnected && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />}
                                <p className={`text-sm font-medium truncate ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>{model.filename}</p>
                              </div>
                              <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>{formatBytes(model.sizeBytes)}</p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {/* Connect / Disconnect */}
                              <button
                                disabled={otherConnecting || isThisConnecting}
                                onClick={async () => {
                                  if (isConnected) {
                                    try {
                                      await disconnectModel();
                                      setConnectedModelFile(null);
                                      setIsModelReady(false);
                                      setModelStatus('Model disconnected');
                                    } catch (err) {
                                      showError(`Disconnect failed: ${err}`);
                                    }
                                  } else {
                                    setIsConnecting(model.filename);
                                    try {
                                      const msg = await connectModel(model.path);
                                      setConnectedModelFile(model.filename);
                                      setIsModelReady(true);
                                      setModelStatus(msg);
                                      showSuccess(`Connected: ${model.filename}`);
                                    } catch (err) {
                                      showError(`Failed to connect: ${err}`);
                                    } finally {
                                      setIsConnecting(null);
                                    }
                                  }
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                  isConnected
                                    ? isDark ? 'border-emerald-500/40 text-emerald-400 hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400' : 'border-emerald-300 text-emerald-700 hover:bg-red-50 hover:border-red-300 hover:text-red-600'
                                    : isDark ? 'border-[#3a3a3c] text-zinc-300 hover:bg-[#2a2a2c]' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'
                                }`}
                              >
                                {isThisConnecting ? (
                                  <>
                                    <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                    Connecting…
                                  </>
                                ) : isConnected ? (
                                  <><Link2Off size={12} /> Disconnect</>
                                ) : (
                                  <><Link size={12} /> Connect Now</>
                                )}
                              </button>

                              {/* Delete */}
                              <button
                                disabled={isConnected}
                                onClick={async () => {
                                  if (!confirm(`Delete ${model.filename}? This cannot be undone.`)) return;
                                  try {
                                    await deleteModel(model.path);
                                    setDownloadedModels(prev => prev.filter(m => m.filename !== model.filename));
                                    showSuccess(`Deleted ${model.filename}`);
                                  } catch (err) {
                                    showError(`Delete failed: ${err}`);
                                  }
                                }}
                                title={isConnected ? 'Disconnect first to delete' : 'Delete model file'}
                                className={`p-1.5 rounded-lg border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? 'border-[#3a3a3c] text-zinc-500 hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10' : 'border-zinc-200 text-zinc-400 hover:text-red-500 hover:border-red-300 hover:bg-red-50'}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── RAG Diagnostics & Tuning ── */}
              {settingsTab === 'ragTuning' && (
                <div className="space-y-6">
                  <p className={`text-xs leading-relaxed ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                    Tune the RAG retrieval pipeline. <strong>Chunk Size / Overlap</strong> affect new document ingestions.
                    <strong> Top-K</strong> and <strong>Show Context</strong> take effect on the next query.
                  </p>

                  {/* Chunk Size */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>Chunk Size</label>
                      <span className={`text-sm font-mono tabular-nums ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{ragConfig.chunkSize} chars</span>
                    </div>
                    <input
                      type="range" min={200} max={2000} step={50}
                      value={ragConfig.chunkSize}
                      onChange={e => setRagConfig(prev => ({ ...prev, chunkSize: +e.target.value }))}
                      className="w-full accent-emerald-500"
                    />
                    <p className={`text-xs mt-1 ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                      Characters per chunk when ingesting PDFs. Larger = richer context per retrieved chunk, but fewer chunks retrieved at the same token budget.
                    </p>
                  </div>

                  {/* Chunk Overlap */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>Chunk Overlap</label>
                      <span className={`text-sm font-mono tabular-nums ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{ragConfig.chunkOverlap} chars</span>
                    </div>
                    <input
                      type="range" min={0} max={500} step={25}
                      value={ragConfig.chunkOverlap}
                      onChange={e => setRagConfig(prev => ({ ...prev, chunkOverlap: +e.target.value }))}
                      className="w-full accent-emerald-500"
                    />
                    <p className={`text-xs mt-1 ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                      Characters repeated between adjacent chunks. Higher overlap ensures facts spanning chunk boundaries are never split irretrievably.
                    </p>
                  </div>

                  {/* Top-K */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>Top-K Retrieval</label>
                      <span className={`text-sm font-mono tabular-nums ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{ragConfig.topK} chunks</span>
                    </div>
                    <input
                      type="range" min={1} max={20} step={1}
                      value={ragConfig.topK}
                      onChange={e => setRagConfig(prev => ({ ...prev, topK: +e.target.value }))}
                      className="w-full accent-emerald-500"
                    />
                    <p className={`text-xs mt-1 ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                      Number of document chunks injected into each prompt. More chunks = more context, but increases prompt length and inference time.
                    </p>
                  </div>

                  {/* Show Retrieved Context */}
                  <div className={`flex items-start gap-3 p-3 rounded-xl border ${isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-50 border-zinc-200'}`}>
                    <input
                      type="checkbox"
                      id="showContext"
                      checked={ragConfig.showContext}
                      onChange={e => setRagConfig(prev => ({ ...prev, showContext: e.target.checked }))}
                      className="mt-0.5 accent-emerald-500 w-4 h-4 shrink-0"
                    />
                    <div>
                      <label htmlFor="showContext" className={`text-sm font-medium cursor-pointer ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                        Show Retrieved Context in Chat
                      </label>
                      <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        Appends the raw retrieved document chunks after each RAG answer, so you can audit exactly what the model was given.
                      </p>
                    </div>
                  </div>

                  {/* Save / Reset buttons */}
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={async () => {
                        try {
                          await saveRagConfig(ragConfig);
                          showSuccess('RAG configuration saved');
                        } catch (err) {
                          showError(`Failed to save: ${err}`);
                        }
                      }}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? 'bg-white text-zinc-900 hover:bg-zinc-200' : 'bg-[#0F2854] text-white hover:bg-[#0a1b38]'}`}
                    >
                      Save Configuration
                    </button>
                    <button
                      onClick={async () => {
                        setRagConfig({ ...RAG_CONFIG_DEFAULTS });
                        try { await saveRagConfig({ ...RAG_CONFIG_DEFAULTS }); } catch {}
                        showSuccess('Reset to defaults');
                      }}
                      className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${isDark ? 'border-[#2a2a2c] text-zinc-400 hover:text-zinc-200 hover:bg-[#232325]' : 'border-zinc-200 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50'}`}
                    >
                      <RotateCcw size={14} /> Reset
                    </button>
                  </div>
                </div>
              )}

              {/* ── AI Providers ── */}
              {settingsTab === 'providers' && (
                <div className="space-y-5">
                  <div className={`flex items-start gap-3 p-4 rounded-xl border ${isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-50 border-zinc-200'}`}>
                    <ShieldCheck size={18} className={secureStorageAvailable ? 'text-emerald-500 shrink-0 mt-0.5' : 'text-amber-500 shrink-0 mt-0.5'} />
                    <div>
                      <h3 className={`text-sm font-semibold ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>AI Provider Mode</h3>
                      <p className={`text-xs mt-1 leading-relaxed ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                        Local mode keeps inference on-device. Cloud mode sends prompts to the selected provider; RAG indexes and vector search remain local.
                      </p>
                      <p className={`text-xs mt-1 ${secureStorageAvailable ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {secureStorageAvailable ? 'API keys are stored with platform secure storage.' : 'Secure storage is not available in this environment.'}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    {providerConfigs.map(provider => {
                      const isActive = provider.id === activeProviderId;
                      return (
                        <div
                          key={provider.id}
                          className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${
                            isActive
                              ? isDark ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'
                              : isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-50 border-zinc-200'
                          }`}
                        >
                          <button
                            onClick={() => {
                              setProviderDraft(providerToDraft(provider));
                              setProviderTestStatus(null);
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-2">
                              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />}
                              <span className={`text-sm font-medium truncate ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>{provider.name}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-[#2a2a2c] text-zinc-400' : 'bg-white text-zinc-500 border border-zinc-200'}`}>
                                {PROVIDER_LABELS[provider.provider]}
                              </span>
                              {provider.apiKeySet && provider.provider !== 'local' && <Key size={12} className="text-emerald-500" />}
                            </div>
                            <p className={`text-xs mt-0.5 truncate ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                              {provider.provider === 'local' ? (connectedModelFile ?? 'No local model connected') : `${provider.model ?? 'No model'} · ${provider.baseUrl ?? 'No base URL'}`}
                            </p>
                          </button>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={async () => {
                                try {
                                  await setActiveAiProvider(provider.id);
                                  setActiveProviderId(provider.id);
                                  showSuccess(`Active provider: ${provider.name}`);
                                } catch (err) {
                                  showError(`Provider switch failed: ${String(err)}`);
                                }
                              }}
                              disabled={isActive}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${isDark ? 'border-[#3a3a3c] text-zinc-300 hover:bg-[#2a2a2c]' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'}`}
                            >
                              Use
                            </button>
                            {provider.id !== 'local' && (
                              <button
                                onClick={async () => {
                                  if (!confirm(`Delete ${provider.name}? Saved credentials will be removed.`)) return;
                                  try {
                                    await deleteAiProviderConfig(provider.id);
                                    await refreshProviderConfigs();
                                    showSuccess('Provider deleted');
                                  } catch (err) {
                                    showError(`Delete failed: ${String(err)}`);
                                  }
                                }}
                                className={`p-1.5 rounded-lg border transition-colors ${isDark ? 'border-[#3a3a3c] text-zinc-500 hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10' : 'border-zinc-200 text-zinc-400 hover:text-red-500 hover:border-red-300 hover:bg-red-50'}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(['openAi', 'anthropic', 'googleGemini', 'openRouter', 'ollamaLocal', 'ollamaRemote', 'lmStudio', 'lmStudioRemote', 'customOpenAiCompatible'] as AiProviderKind[]).map(kind => (
                      <button
                        key={kind}
                        onClick={() => {
                          setProviderDraft(createProviderDraft(kind));
                          setProviderTestStatus(null);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${isDark ? 'border-[#2a2a2c] text-zinc-400 hover:text-zinc-200 hover:bg-[#232325]' : 'border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50'}`}
                      >
                        Add {PROVIDER_LABELS[kind]}
                      </button>
                    ))}
                  </div>

                  <div className={`p-4 rounded-xl border space-y-4 ${isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-50 border-zinc-200'}`}>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>Name</label>
                        <input
                          value={providerDraft.name}
                          onChange={e => setProviderDraft(prev => ({ ...prev, name: e.target.value }))}
                          className={`w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 ${isDark ? 'bg-[#1e1e20] border-[#2a2a2c] text-zinc-100 focus:ring-white/30' : 'bg-white border-zinc-200 text-zinc-900 focus:ring-[#0F2854]/30'}`}
                        />
                      </div>
                      <div>
                        <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>Provider</label>
                        <select
                          value={providerDraft.provider}
                          onChange={e => {
                            const nextKind = e.target.value as AiProviderKind;
                            const defaults = PROVIDER_DEFAULTS[nextKind];
                            setProviderDraft(prev => ({
                              ...prev,
                              provider: nextKind,
                              name: prev.name || PROVIDER_LABELS[nextKind],
                              baseUrl: defaults.baseUrl,
                              model: defaults.model,
                            }));
                          }}
                          className={`w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 ${isDark ? 'bg-[#1e1e20] border-[#2a2a2c] text-zinc-100 focus:ring-white/30' : 'bg-white border-zinc-200 text-zinc-900 focus:ring-[#0F2854]/30'}`}
                        >
                          {(Object.keys(PROVIDER_LABELS) as AiProviderKind[]).map(kind => (
                            <option key={kind} value={kind}>{PROVIDER_LABELS[kind]}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {providerDraft.provider !== 'local' && (
                      <>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div>
                            <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>Base URL</label>
                            <input
                              value={providerDraft.baseUrl}
                              onChange={e => setProviderDraft(prev => ({ ...prev, baseUrl: e.target.value }))}
                              className={`w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 ${isDark ? 'bg-[#1e1e20] border-[#2a2a2c] text-zinc-100 focus:ring-white/30' : 'bg-white border-zinc-200 text-zinc-900 focus:ring-[#0F2854]/30'}`}
                            />
                          </div>
                          <div>
                            <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>Model</label>
                            <input
                              value={providerDraft.model}
                              onChange={e => setProviderDraft(prev => ({ ...prev, model: e.target.value }))}
                              className={`w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 ${isDark ? 'bg-[#1e1e20] border-[#2a2a2c] text-zinc-100 focus:ring-white/30' : 'bg-white border-zinc-200 text-zinc-900 focus:ring-[#0F2854]/30'}`}
                            />
                          </div>
                        </div>

                        <div>
                          <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>API Key</label>
                          <div className="flex gap-2">
                            <input
                              type={showProviderKey ? 'text' : 'password'}
                              value={providerDraft.apiKey}
                              onChange={e => setProviderDraft(prev => ({ ...prev, apiKey: e.target.value, deleteApiKey: false }))}
                              placeholder={providerDraft.id ? 'Leave blank to keep saved key' : 'Enter API key'}
                              className={`flex-1 px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 ${isDark ? 'bg-[#1e1e20] border-[#2a2a2c] text-zinc-100 placeholder:text-zinc-600 focus:ring-white/30' : 'bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:ring-[#0F2854]/30'}`}
                            />
                            <button
                              onClick={() => setShowProviderKey(prev => !prev)}
                              className={`p-2.5 rounded-xl border transition-colors ${isDark ? 'border-[#2a2a2c] text-zinc-400 hover:text-zinc-200' : 'border-zinc-200 text-zinc-500 hover:text-zinc-700'}`}
                              title={showProviderKey ? 'Hide API key' : 'Show API key'}
                            >
                              {showProviderKey ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                          {providerDraft.id && providerConfigs.find(provider => provider.id === providerDraft.id)?.apiKeySet && (
                            <label className={`flex items-center gap-2 mt-2 text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                              <input
                                type="checkbox"
                                checked={providerDraft.deleteApiKey}
                                onChange={e => setProviderDraft(prev => ({ ...prev, deleteApiKey: e.target.checked, apiKey: e.target.checked ? '' : prev.apiKey }))}
                                className="accent-emerald-500"
                              />
                              Delete saved API key on save
                            </label>
                          )}
                          {providerKeyLink(providerDraft.provider) && (
                            <a
                              href={providerKeyLink(providerDraft.provider) ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                              className={`inline-flex mt-2 text-xs font-medium ${isDark ? 'text-emerald-400 hover:text-emerald-300' : 'text-[#0F2854] hover:text-[#0a1b38]'}`}
                            >
                              Get API key
                            </a>
                          )}
                        </div>

                        <div className="grid sm:grid-cols-4 gap-3">
                          <div className="sm:col-span-2">
                            <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>Organization</label>
                            <input
                              value={providerDraft.organization}
                              onChange={e => setProviderDraft(prev => ({ ...prev, organization: e.target.value }))}
                              className={`w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 ${isDark ? 'bg-[#1e1e20] border-[#2a2a2c] text-zinc-100 focus:ring-white/30' : 'bg-white border-zinc-200 text-zinc-900 focus:ring-[#0F2854]/30'}`}
                            />
                          </div>
                          <div>
                            <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>Timeout</label>
                            <input
                              type="number"
                              min={1}
                              max={600}
                              value={providerDraft.timeoutSecs}
                              onChange={e => setProviderDraft(prev => ({ ...prev, timeoutSecs: Number(e.target.value) || 60 }))}
                              className={`w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 ${isDark ? 'bg-[#1e1e20] border-[#2a2a2c] text-zinc-100 focus:ring-white/30' : 'bg-white border-zinc-200 text-zinc-900 focus:ring-[#0F2854]/30'}`}
                            />
                          </div>
                          <div>
                            <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>Temperature</label>
                            <input
                              type="number"
                              min={0}
                              max={2}
                              step={0.1}
                              value={providerDraft.temperature}
                              onChange={e => setProviderDraft(prev => ({ ...prev, temperature: Number(e.target.value) || 0 }))}
                              className={`w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 ${isDark ? 'bg-[#1e1e20] border-[#2a2a2c] text-zinc-100 focus:ring-white/30' : 'bg-white border-zinc-200 text-zinc-900 focus:ring-[#0F2854]/30'}`}
                            />
                          </div>
                        </div>
                      </>
                    )}

                    <label className={`flex items-center gap-2 text-sm ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                      <input
                        type="checkbox"
                        checked={providerDraft.enabled}
                        onChange={e => setProviderDraft(prev => ({ ...prev, enabled: e.target.checked }))}
                        className="accent-emerald-500"
                      />
                      Enabled
                    </label>

                    <div className="flex flex-wrap gap-3">
                      <button
                        disabled={isProviderBusy}
                        onClick={async () => {
                          setIsProviderBusy(true);
                          try {
                            const saved = await saveAiProviderConfig(draftToInput(providerDraft));
                            setProviderDraft(providerToDraft(saved));
                            await refreshProviderConfigs();
                            showSuccess('Provider saved');
                          } catch (err) {
                            showError(`Save failed: ${String(err)}`);
                          } finally {
                            setIsProviderBusy(false);
                          }
                        }}
                        className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${isDark ? 'bg-white text-zinc-900 hover:bg-zinc-200' : 'bg-[#0F2854] text-white hover:bg-[#0a1b38]'}`}
                      >
                        Save Provider
                      </button>
                      {providerDraft.id && (
                        <button
                          disabled={isProviderBusy}
                          onClick={async () => {
                            setIsProviderBusy(true);
                            setProviderTestStatus(null);
                            try {
                              const result = await testAiProviderConnection(providerDraft.id!);
                              setProviderTestStatus(result);
                              if (result.ok) showSuccess(result.message); else showError(result.message);
                            } catch (err) {
                              showError(`Connection test failed: ${String(err)}`);
                            } finally {
                              setIsProviderBusy(false);
                            }
                          }}
                          className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors disabled:opacity-50 ${isDark ? 'border-[#2a2a2c] text-zinc-300 hover:bg-[#1e1e20]' : 'border-zinc-200 text-zinc-700 hover:bg-white'}`}
                        >
                          Test Connection
                        </button>
                      )}
                    </div>

                    {providerTestStatus && (
                      <p className={`text-xs ${providerTestStatus.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                        {providerTestStatus.message}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {!isCompactMode && sidebarCollapsed && (
          <nav className={`flex w-14 shrink-0 flex-col items-center gap-2 border-r py-3 ${isDark ? 'border-white/10' : 'border-zinc-200'}`}>
            {[
              { key: 'chats' as SidebarTab, icon: <MessageSquare size={17} />, title: 'Chats' },
              { key: 'folders' as SidebarTab, icon: <Folder size={17} />, title: 'Folders' },
              { key: 'docs' as SidebarTab, icon: <FileText size={17} />, title: 'Docs' },
            ].map(item => (
              <button
                key={item.key}
                onClick={() => {
                  setSidebarCollapsed(false);
                  setSidebarTab(item.key);
                  if (item.key === 'chats') setMode('general');
                  if (item.key === 'docs') setMode('rag');
                }}
                className={`p-2 rounded-lg transition-colors ${isDark ? 'text-zinc-400 hover:bg-white/10 hover:text-zinc-100' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'}`}
                title={item.title}
              >
                {item.icon}
              </button>
            ))}
          </nav>
        )}

        {!isCompactMode && !sidebarCollapsed && (
          <aside className={`w-[300px] flex flex-col border-r shrink-0 transition-all duration-200 ${isDark ? 'border-white/10' : 'border-zinc-200'}`}>
            <div className="p-4 flex flex-col shrink-0 gap-3">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <button
                  onClick={handleNewChat}
                  className={`flex items-center justify-between w-full py-2.5 px-4 rounded-lg transition-colors font-medium text-sm border shadow-sm ${
                    isDark ? 'bg-[#232325] border-white/10 hover:bg-white/10 text-zinc-200' : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700'
                  }`}
                >
                  <span>New Chat</span>
                  <Plus size={16} />
                </button>
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  className={`p-2.5 rounded-lg border transition-colors ${isDark ? 'border-white/10 text-zinc-400 hover:bg-white/10 hover:text-zinc-100' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'}`}
                  title="Collapse sidebar"
                >
                  <Menu size={16} />
                </button>
              </div>

              <button
                onClick={handlePickFile}
                className={`flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg transition-colors font-medium text-sm shadow-sm ${isDark ? 'bg-white hover:bg-zinc-200 text-zinc-900' : 'bg-[#0F2854] hover:bg-[#0a1b38] text-white'}`}
              >
                <Plus size={16} /> Ingest PDF
              </button>

              <div className={`grid grid-cols-3 gap-1 rounded-lg border p-1 ${isDark ? 'border-white/10 bg-[#1c1c1f]' : 'border-zinc-200 bg-zinc-100'}`}>
                {[
                  { key: 'chats' as SidebarTab, label: 'Chats', icon: <MessageSquare size={13} /> },
                  { key: 'folders' as SidebarTab, label: 'Folders', icon: <Folder size={13} /> },
                  { key: 'docs' as SidebarTab, label: 'Docs', icon: <FileText size={13} /> },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setSidebarTab(tab.key);
                      if (tab.key === 'chats') setMode('general');
                      if (tab.key === 'docs') setMode('rag');
                    }}
                    className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      sidebarTab === tab.key
                        ? isDark ? 'bg-white text-zinc-900' : 'bg-[#0F2854] text-white'
                        : isDark ? 'text-zinc-400 hover:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>

              <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${isDark ? 'border-white/10 bg-[#1c1c1f]' : 'border-zinc-200 bg-white'}`}>
                <Search size={14} className={isDark ? 'text-zinc-500' : 'text-zinc-400'} />
                <input
                  value={chatSearch}
                  onChange={e => setChatSearch(e.target.value)}
                  placeholder="Search"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 space-y-1 pb-4">
              {sidebarTab === 'chats' && (
                <>
                  {filteredChats.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-zinc-500">No chats found.</p>
                  ) : filteredChats.map(chat => (
                    <button
                      key={chat.id}
                      onClick={() => {
                        setMode('general');
                        setSelectedGeneralChatId(chat.id);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors text-left group ${
                        selectedGeneralChatId === chat.id && mode === 'general'
                          ? (isDark ? 'bg-white/10 text-white' : 'bg-zinc-100 text-zinc-900 font-medium')
                          : (isDark ? 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900')
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate pr-2">
                        <MessageSquare size={16} className="shrink-0" />
                        <span className="truncate">{chat.name}</span>
                      </div>
                      {selectedGeneralChatId === chat.id && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteGeneralChat(chat.id);
                          }}
                          className={`p-1.5 rounded-md transition-colors ${isDark ? 'hover:bg-red-900/30 text-red-400' : 'hover:bg-red-100 text-red-500'}`}
                          title="Delete chat"
                        >
                          <Trash2 size={14} />
                        </span>
                      )}
                    </button>
                  ))}
                </>
              )}

              {sidebarTab === 'folders' && (
                <div className="space-y-2 px-2">
                  {['Recent', 'Pinned', 'Research'].map(folder => (
                    <button
                      key={folder}
                      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${isDark ? 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'}`}
                    >
                      <Folder size={16} /> {folder}
                    </button>
                  ))}
                </div>
              )}

              {sidebarTab === 'docs' && (
                <>
                  {filteredDocs.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-zinc-500">No documents found.</p>
                  ) : filteredDocs.map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => {
                        setMode('rag');
                        setSelectedDocId(doc.id);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors text-left group ${
                        selectedDocId === doc.id && mode === 'rag'
                          ? (isDark ? 'bg-white/10 text-white' : 'bg-zinc-100 text-zinc-900 font-medium')
                          : (isDark ? 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900')
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate pr-2">
                        <FileText size={16} className={`shrink-0 ${
                          doc.status === 'ingesting' ? 'animate-pulse text-amber-400'
                          : doc.status === 'error' ? 'text-red-400'
                          : selectedDocId === doc.id ? (isDark ? 'text-white' : 'text-[#0F2854]')
                          : ''
                        }`} />
                        <span className="truncate">{doc.name}</span>
                      </div>
                      {selectedDocId === doc.id && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDoc(doc.id);
                          }}
                          className={`p-1.5 rounded-md transition-colors ${isDark ? 'hover:bg-red-900/30 text-red-400' : 'hover:bg-red-100 text-red-500'}`}
                          title="Delete document"
                        >
                          <Trash2 size={14} />
                        </span>
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>

            <div className={`m-3 rounded-lg border p-3 text-xs ${isDark ? 'border-white/10 bg-white/[0.03] text-zinc-400' : 'border-zinc-200 bg-zinc-50 text-zinc-600'}`}>
              <div className="mb-2 flex items-center justify-between">
                <span>Index status</span>
                <span className={ingestingDocumentCount ? 'text-amber-400' : 'text-emerald-500'}>
                  {ingestingDocumentCount ? 'Indexing' : 'Ready'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Documents</span>
                <span>{readyDocumentCount}/{documents.length}</span>
              </div>
              <button
                onClick={() => { setSettingsTab('advanced'); setShowSettings(true); }}
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${isDark ? 'border-white/10 hover:bg-white/10 text-zinc-300' : 'border-zinc-200 hover:bg-white text-zinc-700'}`}
              >
                <Command size={13} /> Command Palette
              </button>
            </div>
          </aside>
        )}

        {/* Main Content */}
        <main className={`flex-1 flex flex-col relative min-w-0 ${isFullMode ? 'max-w-none' : ''}`}>
          {/* Main Content Header */}
          <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b shrink-0 transition-colors duration-200 ${isDark ? 'border-white/10' : 'border-zinc-200'}`}>
            <div className="flex items-center gap-3 min-w-0">
              <h1 className={`${isCompactMode ? 'text-sm' : 'text-base'} font-semibold`}>
                {isCompactMode ? 'Assistant' : <TypewriterEffect key={`${theme}-${mode}`} text="Your Private Assistant" speed={100} />}
              </h1>
              <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium ${isDark ? 'bg-white/10 text-zinc-300' : 'bg-zinc-100 text-zinc-600'}`}>
                <Database size={12} />
                {readyDocumentCount} docs
              </span>
              {mode === 'rag' && selectedDocId && (
                <span className={`hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium ${isDark ? 'bg-white/10 text-zinc-300' : 'bg-zinc-100 text-zinc-600'}`}>
                  <span className="truncate max-w-[180px]">{documents.find(d => d.id === selectedDocId)?.name}</span>
                  <button
                    onClick={() => setSelectedDocId(null)}
                    className={`p-0.5 rounded-full transition-colors ${isDark ? 'hover:bg-white/10 hover:text-white' : 'hover:bg-zinc-200 hover:text-zinc-900'}`}
                    title="Clear selected document"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
              {mode === 'general' && selectedGeneralChatId && !isCompactMode && (
                <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium ${isDark ? 'bg-white/10 text-zinc-300' : 'bg-zinc-100 text-zinc-600'}`}>
                  <span className="truncate max-w-[200px]">{generalChats.find(c => c.id === selectedGeneralChatId)?.name}</span>
                </span>
              )}
            </div>

            {isCompactMode && (
              <div className="order-3 w-full grid grid-cols-[auto_auto_auto_1fr] gap-2">
                <button
                  onClick={() => setMode(mode === 'general' ? 'rag' : 'general')}
                  className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-white/10 text-zinc-300 hover:bg-white/10' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                  title={mode === 'general' ? 'Switch to documents' : 'Switch to chat'}
                >
                  {mode === 'general' ? <Database size={16} /> : <MessageSquare size={16} />}
                </button>
                <button
                  onClick={handleNewChat}
                  className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-white/10 text-zinc-300 hover:bg-white/10' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                  title="New Chat"
                >
                  <Plus size={16} />
                </button>
                <button
                  onClick={handlePickFile}
                  className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-white/10 text-zinc-300 hover:bg-white/10' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                  title="Ingest PDF"
                >
                  <Paperclip size={16} />
                </button>
                <select
                  value={mode === 'rag' ? (selectedDocId ?? '') : selectedGeneralChatId}
                  onChange={e => {
                    if (mode === 'rag') setSelectedDocId(e.target.value || null);
                    else setSelectedGeneralChatId(e.target.value);
                  }}
                  className={`min-w-0 px-2 py-2 rounded-lg border text-xs focus:outline-none ${isDark ? 'bg-[#232325] border-white/10 text-zinc-200' : 'bg-white border-zinc-200 text-zinc-700'}`}
                >
                  {mode === 'rag' ? (
                    <>
                      <option value="">No document selected</option>
                      {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                    </>
                  ) : (
                    generalChats.map(chat => <option key={chat.id} value={chat.id}>{chat.name}</option>)
                  )}
                </select>
              </div>
            )}

            {!isCompactMode && (
              <div className={`flex rounded-full p-1 border transition-colors duration-200 ${isDark ? 'bg-[#232325] border-white/10' : 'bg-zinc-100 border-zinc-200'}`}>
                <button
                  className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${mode === 'general' ? (isDark ? 'bg-white text-zinc-900 shadow-sm' : 'bg-[#0F2854] text-white shadow-sm') : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-700'}`}
                  onClick={() => setMode('general')}
                >
                  <MessageSquare size={14} /> General
                </button>
                <button
                  className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${mode === 'rag' ? (isDark ? 'bg-white text-zinc-900 shadow-sm' : 'bg-[#0F2854] text-white shadow-sm') : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-700'}`}
                  onClick={() => setMode('rag')}
                >
                  <Database size={14} /> RAG
                </button>
              </div>
            )}
          </div>

          {/* Chat Area */}
          <div
            ref={chatScrollRef}
            onScroll={e => {
              const top = e.currentTarget.scrollTop;
              setScrollPositions(prev => ({ ...prev, [activeConversationKey]: top }));
            }}
            className={`${isCompactMode ? 'p-4 gap-4' : 'p-6 gap-6'} flex-1 overflow-y-auto flex flex-col`}
          >
            {activeMessages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center max-w-md">
                  <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full mb-4 ${isDark ? 'bg-[#232325]' : 'bg-zinc-100'}`}>
                    {mode === 'rag' ? <Database size={24} className={isDark ? 'text-white' : 'text-[#0F2854]'} /> : <MessageSquare size={24} className={isDark ? 'text-white' : 'text-[#0F2854]'} />}
                  </div>
                  <h3 className="text-lg font-medium mb-2">Welcome to Your Private Assistant.</h3>
                  {mode === 'rag' && selectedDocId ? (
                    <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                      Ask a question about <span className="font-semibold">{documents.find(d => d.id === selectedDocId)?.name ?? 'this document'}</span>
                    </p>
                  ) : (
                    <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                      {mode === 'rag'
                        ? "Ingest a PDF from the sidebar and start asking questions about your documents."
                        : "Ask any general question to get started."}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              activeMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`px-5 py-3.5 rounded-2xl ${isCompactMode ? 'max-w-[92%]' : 'max-w-[86%]'} text-sm shadow-sm leading-relaxed ${
                      msg.sender === 'user'
                        ? (isDark ? 'bg-white text-zinc-900 rounded-tr-sm whitespace-pre-wrap' : 'bg-[#0F2854] text-white rounded-tr-sm whitespace-pre-wrap')
                        : msg.isError
                          ? isDark
                            ? 'bg-red-900/20 border border-red-900/50 text-red-400 rounded-tl-sm'
                            : 'bg-red-50 border border-red-200 text-red-600 rounded-tl-sm'
                          : isDark
                            ? 'bg-[#232325] border border-[#2a2a2c] text-zinc-100 rounded-tl-sm'
                            : 'bg-white border border-zinc-200 text-zinc-900 rounded-tl-sm'
                    }`}
                  >
                    {msg.text === '' && msg.isStreaming ? (
                      <div className="flex space-x-1.5 items-center h-5 px-1">
                        <div className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    ) : (
                      <>
                        {msg.sender === 'bot'
                          ? <MarkdownMessage text={msg.text} isDark={isDark} />
                          : msg.text}
                        {msg.isStreaming && (
                          <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-current animate-pulse rounded-full" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className={`${isCompactMode ? 'p-3 pb-4' : 'p-4 pb-6'} shrink-0`}>
            <div className="max-w-4xl mx-auto relative">
              <div className={`flex items-end gap-2 p-2 rounded-2xl border transition-all shadow-sm ${
                isDark
                  ? 'bg-[#232325] border-white/10 focus-within:border-white focus-within:ring-1 focus-within:ring-white'
                  : 'bg-white border-zinc-200 focus-within:border-[#0F2854] focus-within:ring-1 focus-within:ring-[#0F2854]'
              }`}>
                <button
                  onClick={handlePickFile}
                  className={`p-2.5 rounded-xl transition-colors shrink-0 mb-0.5 ${
                    isDark ? 'text-zinc-400 hover:text-zinc-200 hover:bg-[#2a2a2c]' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
                  }`}
                  title="Attach file"
                >
                  <Paperclip size={20} />
                </button>

                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => updateInputValue(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  disabled={isTyping || (mode === 'rag' && !selectedDocId)}
                  placeholder={mode === 'rag' ? (selectedDocId ? "Ask about this document..." : "Select or ingest a document first...") : "Ask a general question..."}
                  className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-3 px-2 text-sm placeholder:text-zinc-500 disabled:opacity-50 max-h-[200px] overflow-y-auto focus:outline-none"
                  rows={1}
                />

                <button
                  onClick={isTyping ? handleStop : handleSend}
                  disabled={isTyping ? isStopping : (!inputValue.trim() || (mode === 'rag' && !selectedDocId))}
                  className={`p-2.5 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors shrink-0 mb-0.5 ${isDark ? 'bg-white hover:bg-zinc-200 text-zinc-900' : 'bg-[#0F2854] hover:bg-[#0a1b38] text-white'}`}
                  title={isTyping ? (isStopping ? 'Stopping response...' : 'Stop response') : 'Send message'}
                >
                  {isTyping ? <Square size={20} /> : <Send size={20} />}
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
