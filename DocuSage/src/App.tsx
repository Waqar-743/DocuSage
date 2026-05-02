import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Moon, Sun, Settings, Database, Plus, FileText, Send, Paperclip, AlertCircle, Trash2, X, MessageSquare, Square, CheckCircle, Key, Download, Cpu, HardDrive, Sliders, Link, Link2Off, FolderOpen, RotateCcw } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  chatGeneral, chatRag, chatGeminiRag, ingestDocument, isTauri, loadModel, stopChat,
  downloadModel, listDownloadedModels, connectModel, disconnectModel, deleteModel,
  getConnectedModel, getRagConfig, saveRagConfig,
  GEMINI_KEY_STORAGE, RAG_CONFIG_DEFAULTS,
  type ChatHistoryMessage, type IngestResult, type DownloadedModel, type RagConfig,
} from './lib/api';
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

type PersistedAppState = {
  theme: 'dark' | 'light';
  mode: 'general' | 'rag';
  documents: Document[];
  generalChats: GeneralChat[];
  selectedDocId: string | null;
  selectedGeneralChatId: string;
};

type DownloadProgress = {
  filename: string;
  downloaded: number;
  total: number;
  percent: number;
  done: boolean;
  error?: string;
};

type SettingsTab = 'models' | 'downloaded' | 'ragTuning' | 'apiKey';

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
      theme: parsed.theme === 'light' ? 'light' : 'dark',
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

export default function App() {
  const initialStateRef = useRef<PersistedAppState>(loadPersistedState());
  const persistedState = initialStateRef.current;

  const [theme, setTheme] = useState<'dark' | 'light'>(persistedState.theme);
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('models');
  const [geminiKey, setGeminiKey] = useState<string>(() => {
    try { return window.localStorage.getItem(GEMINI_KEY_STORAGE) ?? ''; } catch { return ''; }
  });

  // Model manager state
  const [downloadedModels, setDownloadedModels] = useState<DownloadedModel[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>({});
  const [connectedModelFile, setConnectedModelFile] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState<string | null>(null);

  // RAG tuning state
  const [ragConfig, setRagConfig] = useState<RagConfig>({ ...RAG_CONFIG_DEFAULTS });

  // Session State
  const [documents, setDocuments] = useState<Document[]>(persistedState.documents);
  const [generalChats, setGeneralChats] = useState<GeneralChat[]>(persistedState.generalChats);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(persistedState.selectedDocId);
  const [selectedGeneralChatId, setSelectedGeneralChatId] = useState<string>(persistedState.selectedGeneralChatId);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isDark = theme === 'dark';

  // Context ref for stable callbacks
  const contextRef = useRef({ mode, selectedDocId, selectedGeneralChatId });
  useEffect(() => {
    contextRef.current = { mode, selectedDocId, selectedGeneralChatId };
  }, [mode, selectedDocId, selectedGeneralChatId]);

  const activeMessages = mode === 'rag'
    ? documents.find(d => d.id === selectedDocId)?.messages || []
    : generalChats.find(c => c.id === selectedGeneralChatId)?.messages || [];

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
    scrollToBottom();
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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const showError = (msg: string) => {
    setToastError(msg);
    setTimeout(() => setToastError(null), 5000);
  };

  const showSuccess = (msg: string) => {
    setToastSuccess(msg);
    setTimeout(() => setToastSuccess(null), 3000);
  };

  const refreshDownloadedModels = useCallback(async () => {
    try {
      const models = await listDownloadedModels();
      setDownloadedModels(models);
    } catch {
      // Non-fatal — models dir may not exist yet
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
      ensureModelLoaded();
      refreshDownloadedModels();
      // Hydrate RAG config from backend
      getRagConfig().then(setRagConfig).catch(() => {});
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
    } satisfies PersistedAppState));
  }, [theme, mode, documents, generalChats, selectedDocId, selectedGeneralChatId]);

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

    // Allow sending without local model if Gemini key is set in RAG mode
    const useGemini = mode === 'rag' && !!geminiKey.trim();
    if (!isModelReady && !useGemini) {
      showError('Model is not loaded yet. Click Retry Model Load in the header, or set a Gemini API key in Settings.');
      return;
    }

    const userText = inputValue.trim();
    const requestId = createRequestId();
    const conversationHistory = getConversationHistory();
    setInputValue('');
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
      if (mode === 'general') {
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (mode === 'rag' && !selectedDocId) {
        showError("Please select or ingest a document first to use RAG mode.");
        return;
      }
      handleSend();
    }
  };

  return (
    <div className={`flex flex-col h-screen font-sans transition-colors duration-200 relative ${isDark ? 'bg-[#151517] text-zinc-100 selection:bg-white/30' : 'bg-white text-zinc-900 selection:bg-[#0F2854]/30'}`}>

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
      <header className={`flex items-center justify-between px-5 h-14 border-b shrink-0 transition-colors duration-200 ${isDark ? 'border-[#2a2a2c]' : 'border-zinc-200'}`}>
        <div className="flex items-center gap-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={isDark ? 'text-white' : 'text-[#0F2854]'}>
            <path d="M5 4H12C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20H5V4Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M5 8H10C12.2091 8 14 9.79086 14 12C14 14.2091 12.2091 16 10 16H5V8Z" fill="#10b981"/>
          </svg>
          <span className="font-semibold text-lg tracking-wide">DocuSage</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Theme Toggle */}
          <div className={`flex rounded-full p-1 border transition-colors duration-200 ${isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-100 border-zinc-200'}`}>
            <button
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full transition-colors ${isDark ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
              onClick={() => setTheme('dark')}
            >
              <Moon size={14} /> Dark
            </button>
            <button
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full transition-colors ${!isDark ? 'bg-[#0F2854] text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
              onClick={() => setTheme('light')}
            >
              <Sun size={14} /> Light
            </button>
          </div>

          <button
            onClick={() => { setSettingsTab('models'); setShowSettings(true); }}
            className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-[#2a2a2c] text-zinc-400 hover:text-zinc-200 hover:bg-[#232325]' : 'border-zinc-200 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50'} ${geminiKey.trim() ? (isDark ? 'border-emerald-500/50 text-emerald-400' : 'border-emerald-400 text-emerald-600') : ''}`}
            title={geminiKey.trim() ? 'Settings (Gemini key set)' : 'Settings — models & API key'}
          >
            <Settings size={16} />
          </button>

          {isTauri() && (
            <button
              onClick={ensureModelLoaded}
              disabled={isModelLoading}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
                isModelReady
                  ? (isDark ? 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10' : 'border-emerald-300 text-emerald-700 bg-emerald-50')
                  : (isDark ? 'border-amber-500/50 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20' : 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100')
              }`}
              title={modelStatus}
            >
              {isModelLoading ? 'Loading model...' : isModelReady ? 'Model Ready' : 'Retry Model Load'}
            </button>
          )}
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
                  { key: 'models', icon: <Cpu size={13} />, label: 'Model Catalog' },
                  { key: 'downloaded', icon: <HardDrive size={13} />, label: 'Downloaded' },
                  { key: 'ragTuning', icon: <Sliders size={13} />, label: 'RAG Tuning' },
                  { key: 'apiKey', icon: <Key size={13} />, label: 'API Key' },
                ] as const
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

              {/* ── API Key ── */}
              {settingsTab === 'apiKey' && (
                <div className="space-y-4">
                  <div>
                    <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>Gemini API Key</label>
                    <p className={`text-xs mb-2 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      When set, RAG document questions use the Gemini API instead of the local LLM for higher quality answers.
                    </p>
                    <input
                      type="password"
                      value={geminiKey}
                      onChange={e => setGeminiKey(e.target.value)}
                      placeholder="AIzaSy..."
                      className={`w-full px-3 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 ${
                        isDark
                          ? 'bg-[#232325] border-[#2a2a2c] text-zinc-100 placeholder:text-zinc-600 focus:ring-white/30'
                          : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:ring-[#0F2854]/30'
                      }`}
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={() => {
                        try { window.localStorage.setItem(GEMINI_KEY_STORAGE, geminiKey.trim()); } catch {}
                        setShowSettings(false);
                      }}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? 'bg-white text-zinc-900 hover:bg-zinc-200' : 'bg-[#0F2854] text-white hover:bg-[#0a1b38]'}`}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setGeminiKey('');
                        try { window.localStorage.removeItem(GEMINI_KEY_STORAGE); } catch {}
                        setShowSettings(false);
                      }}
                      className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${isDark ? 'border-[#2a2a2c] text-zinc-400 hover:text-zinc-200 hover:bg-[#232325]' : 'border-zinc-200 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50'}`}
                    >
                      Clear Key
                    </button>
                  </div>

                  {geminiKey.trim() && (
                    <p className="text-xs text-emerald-500 flex items-center gap-1.5">
                      <CheckCircle size={14} /> Gemini hybrid mode active for RAG questions.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`w-[280px] flex flex-col border-r shrink-0 transition-colors duration-200 ${isDark ? 'border-[#2a2a2c]' : 'border-zinc-200'}`}>
          <div className="p-4 flex flex-col shrink-0 gap-3">
            <button
              onClick={handleNewChat}
              className={`flex items-center justify-between w-full py-2.5 px-4 rounded-xl transition-colors font-medium text-sm border shadow-sm ${
                isDark ? 'bg-[#232325] border-[#2a2a2c] hover:bg-[#2a2a2c] text-zinc-200' : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700'
              }`}
            >
              <span>New Chat</span>
              <Plus size={16} />
            </button>

            <button
              onClick={handlePickFile}
              className={`flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl transition-colors font-medium text-sm shadow-sm ${isDark ? 'bg-white hover:bg-zinc-200 text-zinc-900' : 'bg-[#0F2854] hover:bg-[#0a1b38] text-white'}`}
            >
              <Plus size={16} /> Ingest PDF
            </button>
          </div>

          {/* Document / Chat List */}
          <div className="flex-1 overflow-y-auto px-2 space-y-1 pb-4">
            <h2 className={`text-[11px] font-semibold tracking-wider mb-3 px-2 mt-2 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
              {mode === 'rag' ? 'DOCUMENTS' : 'CHATS'}
            </h2>

            {mode === 'rag' ? (
              documents.length === 0 ? (
                <div className="flex items-start justify-center pt-4">
                  <p className="text-xs text-zinc-500 text-center px-4">No documents ingested yet. Upload a PDF to get started.</p>
                </div>
              ) : (
                documents.map(doc => (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-colors text-left group ${
                      selectedDocId === doc.id
                        ? (isDark ? 'bg-[#2a2a2c] text-white' : 'bg-zinc-100 text-zinc-900 font-medium')
                        : (isDark ? 'text-zinc-400 hover:bg-[#232325] hover:text-zinc-200' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900')
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
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDoc(doc.id);
                        }}
                        className={`p-1.5 rounded-md transition-colors ${isDark ? 'hover:bg-red-900/30 text-red-400' : 'hover:bg-red-100 text-red-500'}`}
                        title="Delete document"
                      >
                        <Trash2 size={14} />
                      </div>
                    )}
                  </button>
                ))
              )
            ) : (
              generalChats.length === 0 ? (
                <div className="flex items-start justify-center pt-4">
                  <p className="text-xs text-zinc-500 text-center px-4">No chats yet. Start a new conversation.</p>
                </div>
              ) : (
                generalChats.map(chat => (
                  <button
                    key={chat.id}
                    onClick={() => setSelectedGeneralChatId(chat.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-colors text-left group ${
                      selectedGeneralChatId === chat.id
                        ? (isDark ? 'bg-[#2a2a2c] text-white' : 'bg-zinc-100 text-zinc-900 font-medium')
                        : (isDark ? 'text-zinc-400 hover:bg-[#232325] hover:text-zinc-200' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900')
                    }`}
                  >
                    <div className="flex items-center gap-3 truncate pr-2">
                      <MessageSquare size={16} className={`shrink-0 ${selectedGeneralChatId === chat.id ? (isDark ? 'text-white' : 'text-[#0F2854]') : ''}`} />
                      <span className="truncate">{chat.name}</span>
                    </div>
                    {selectedGeneralChatId === chat.id && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteGeneralChat(chat.id);
                        }}
                        className={`p-1.5 rounded-md transition-colors ${isDark ? 'hover:bg-red-900/30 text-red-400' : 'hover:bg-red-100 text-red-500'}`}
                        title="Delete chat"
                      >
                        <Trash2 size={14} />
                      </div>
                    )}
                  </button>
                ))
              )
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col relative min-w-0">
          {/* Main Content Header */}
          <div className={`flex items-center justify-between px-6 py-3 border-b shrink-0 transition-colors duration-200 ${isDark ? 'border-[#2a2a2c]' : 'border-zinc-200'}`}>
            <div className="flex items-center gap-3">
              <h1 className="text-base font-semibold">
                <TypewriterEffect key={`${theme}-${mode}`} text="Your Private Assistant" speed={100} />
              </h1>
              {mode === 'rag' && selectedDocId && (
                <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium ${isDark ? 'bg-[#2a2a2c] text-zinc-300' : 'bg-zinc-100 text-zinc-600'}`}>
                  <span className="truncate max-w-[200px]">Chatting with: {documents.find(d => d.id === selectedDocId)?.name}</span>
                  <button
                    onClick={() => setSelectedDocId(null)}
                    className={`p-0.5 rounded-full transition-colors ${isDark ? 'hover:bg-[#353538] hover:text-white' : 'hover:bg-zinc-200 hover:text-zinc-900'}`}
                    title="Clear selected document"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
              {mode === 'general' && selectedGeneralChatId && (
                <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium ${isDark ? 'bg-[#2a2a2c] text-zinc-300' : 'bg-zinc-100 text-zinc-600'}`}>
                  <span className="truncate max-w-[200px]">{generalChats.find(c => c.id === selectedGeneralChatId)?.name}</span>
                </span>
              )}
            </div>

            {/* Mode Toggle */}
            <div className={`flex rounded-full p-1 border transition-colors duration-200 ${isDark ? 'bg-[#232325] border-[#2a2a2c]' : 'bg-zinc-100 border-zinc-200'}`}>
              <button
                className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${mode === 'general' ? (isDark ? 'bg-white text-zinc-900 shadow-sm' : 'bg-[#0F2854] text-white shadow-sm') : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-700'}`}
                onClick={() => setMode('general')}
              >
                <Settings size={14} /> General
              </button>
              <button
                className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${mode === 'rag' ? (isDark ? 'bg-white text-zinc-900 shadow-sm' : 'bg-[#0F2854] text-white shadow-sm') : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-700'}`}
                onClick={() => setMode('rag')}
              >
                <Database size={14} /> RAG
              </button>
            </div>
          </div>

          {/* Chat Area */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
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
                    className={`px-5 py-3.5 rounded-2xl max-w-[80%] text-sm shadow-sm whitespace-pre-wrap leading-relaxed ${
                      msg.sender === 'user'
                        ? (isDark ? 'bg-white text-zinc-900 rounded-tr-sm' : 'bg-[#0F2854] text-white rounded-tr-sm')
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
                        {msg.text}
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
          <div className="p-4 shrink-0 pb-6">
            <div className="max-w-4xl mx-auto relative">
              <div className={`flex items-end gap-2 p-2 rounded-2xl border transition-all shadow-sm ${
                isDark
                  ? 'bg-[#232325] border-[#2a2a2c] focus-within:border-white focus-within:ring-1 focus-within:ring-white'
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
                  onChange={(e) => setInputValue(e.target.value)}
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
              <div className="text-center mt-2">
                <span className={`text-[10px] ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  Press Enter to send, Shift+Enter for new line, Ctrl+Shift+C to clear chat
                </span>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
