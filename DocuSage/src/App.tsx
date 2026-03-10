import React, { useState, useRef, useEffect } from 'react';
import { Moon, Sun, Settings, Database, Plus, FileText, Send, Paperclip, AlertCircle, Trash2, X, MessageSquare, Square } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { chatGeneral, chatRag, ingestDocument, isTauri, loadModel, stopChat, type ChatHistoryMessage, type IngestResult } from './lib/api';
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

const STORAGE_KEY = 'docusage:app-state:v1';
const DEFAULT_CHAT_ID = 'default';

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
  const [isIngesting, setIsIngesting] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isModelReady, setIsModelReady] = useState(!isTauri());
  const [modelStatus, setModelStatus] = useState<string>(isTauri() ? 'Model not loaded' : 'Browser preview mode');

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
    setTimeout(() => setToastSuccess(null), 4000);
  };

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    try {
      const result: IngestResult = await ingestDocument(filePath);
      setDocuments(prev => prev.map(d =>
        d.id === newDoc.id ? { ...d, status: 'ready' } : d
      ));
      showSuccess(`Successfully vectorized ${result.chunkCount} chunks from "${result.fileName}".`);
    } catch (err) {
      setDocuments(prev => prev.map(d =>
        d.id === newDoc.id ? { ...d, status: 'error' } : d
      ));
      showError(`Failed to ingest ${fileName}: ${String(err)}`);
    } finally {
      setIsIngesting(false);
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

    if (!isModelReady) {
      showError('Model is not loaded yet. Click Retry Model Load in the header.');
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
      const response = mode === 'general'
        ? await chatGeneral(userText, conversationHistory, requestId)
        : await chatRag(userText, conversationHistory, requestId);

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
      {isIngesting && (
        <div className={`fixed right-6 top-1/2 -translate-y-1/2 z-40 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border ${isDark ? 'bg-[#1e1e20] border-[#2a2a2c]' : 'bg-white border-zinc-200'}`}>
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin shrink-0" />
          <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-700'}`}>Chunking &amp; Embedding...</p>
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
                  <h3 className="text-lg font-medium mb-2">Welcome to Your Private Assistant</h3>
                  <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    {mode === 'rag'
                      ? (selectedDocId
                          ? `Ask a question about "${documents.find(d => d.id === selectedDocId)?.name ?? 'this document'}".`
                          : "Ingest a PDF from the sidebar and start asking questions about your documents.")
                      : "Ask any general question to get started."}
                  </p>
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
