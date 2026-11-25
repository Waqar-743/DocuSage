import React, { useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  Command,
  Database,
  FileText,
  FileUp,
  Folder,
  FolderPlus,
  MessageSquare,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import * as api from '../../lib/api';
import { THEMES } from '../../lib/themes';
import { useChatStore } from '../../stores/useChatStore';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { useUiStore } from '../../stores/useUiStore';
import { ChatComposer } from '../chat/ChatComposer';
import { ContextBadge } from '../chat/ContextBadge';
import { MessageList } from '../chat/MessageList';
import { BranchSelector } from '../common/BranchSelector';
import { LocalSetupBanner } from '../common/LocalSetupBanner';
import { ModelSelector } from '../common/ModelSelector';
import { RagDebugPanel } from '../common/RagDebugPanel';

export const DashboardView: React.FC<{
  focusSignal: number;
  onFocusComposer?: () => void;
}> = ({ focusSignal, onFocusComposer }) => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const sidebarTab = useUiStore((s) => s.sidebarTab);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const toggleWindowMode = useUiStore((s) => s.toggleWindowMode);
  const openSettings = useUiStore((s) => s.openSettings);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setCompareOpen = useUiStore((s) => s.setCompareOpen);
  const ragDebugOpen = useUiStore((s) => s.ragDebugOpen);
  const setRagDebugOpen = useUiStore((s) => s.setRagDebugOpen);
  const isDraggingFiles = useUiStore((s) => s.isDraggingFiles);
  const pushToast = useUiStore((s) => s.pushToast);

  const chats = useChatStore((s) => s.chats);
  const folders = useChatStore((s) => s.folders);
  const activeChat = useChatStore((s) => s.getActiveChat());
  const activeBranch = useChatStore((s) => s.getActiveBranch(activeChat));
  const setActiveChat = useChatStore((s) => s.setActiveChat);
  const createChat = useChatStore((s) => s.createChat);
  const deleteChat = useChatStore((s) => s.deleteChat);
  const createFolder = useChatStore((s) => s.createFolder);
  const toggleFolderCollapsed = useChatStore((s) => s.toggleFolderCollapsed);
  const deleteFolder = useChatStore((s) => s.deleteFolder);
  const moveChatToFolder = useChatStore((s) => s.moveChatToFolder);
  const attachDocToChat = useChatStore((s) => s.attachDocToChat);
  const detachDocFromChat = useChatStore((s) => s.detachDocFromChat);
  const branchFromMessage = useChatStore((s) => s.branchFromMessage);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const searchQuery = useChatStore((s) => s.searchQuery);
  const setSearchQuery = useChatStore((s) => s.setSearchQuery);
  const searchAllChats = useChatStore((s) => s.searchAllChats);

  const documents = useDocumentStore((s) => s.documents);
  const allowedExtensions = useDocumentStore((s) => s.allowedExtensions);
  const ingestFile = useDocumentStore((s) => s.ingestFile);
  const removeDocument = useDocumentStore((s) => s.removeDocument);
  const latestTelemetry = useDocumentStore((s) => s.latestTelemetry);

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const resizingRef = useRef(false);

  const searchMatches = searchQuery.trim() ? searchAllChats(searchQuery) : [];
  const unfiledChats = chats.filter((c) => !c.folderId);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (resizingRef.current) setSidebarWidth(ev.clientX);
    };
    const onUp = () => {
      resizingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleIngestDocument = async () => {
    await api.setAssistantFocusGuard({ dialogOpen: true });
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Supported Documents & Code', extensions: allowedExtensions }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) {
        const doc = await ingestFile(p);
        if (doc) attachDocToChat(activeChat.id, doc.path);
      }
    } catch (err) {
      pushToast('error', String(err));
    } finally {
      await api.setAssistantFocusGuard({ dialogOpen: false });
    }
  };

  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    createFolder(newFolderName.trim());
    setNewFolderName('');
    setCreatingFolder(false);
  };

  const renderChatRow = (chat: (typeof chats)[number]) => {
    const selected = chat.id === activeChat.id;
    return (
      <div
        key={chat.id}
        className={`group flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition-colors border ${
          selected ? theme.accentSoft : `border-transparent ${theme.hoverBg}`
        }`}
      >
        <button
          type="button"
          onClick={() => setActiveChat(chat.id)}
          className="flex-1 min-w-0 text-left flex items-center gap-2"
        >
          <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-75" />
          <span className="truncate font-medium">{chat.name}</span>
          {chat.attachedDocPaths.length > 0 && (
            <span className={`text-[10px] px-1 rounded border shrink-0 ${theme.accentSoft}`}>
              {chat.attachedDocPaths.length}
            </span>
          )}
        </button>

        <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
          {folders.length > 0 && (
            <select
              aria-label={`Move ${chat.name} to folder`}
              value={chat.folderId ?? ''}
              onChange={(e) => moveChatToFolder(chat.id, e.target.value || null)}
              className="w-4 h-4 opacity-70 hover:opacity-100 bg-transparent cursor-pointer"
              title="Move to folder"
            >
              <option value="" className={theme.selectOption}>No Folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id} className={theme.selectOption}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              deleteChat(chat.id);
            }}
            aria-label={`Delete chat ${chat.name}`}
            title="Delete conversation"
            className="p-1 rounded hover:text-rose-400"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={`relative h-full w-full flex overflow-hidden border ${theme.appBg} ${theme.border}`}>
      {/* Resizable Sidebar */}
      {!sidebarCollapsed && (
        <>
          <aside
            style={{ width: sidebarWidth }}
            className={`shrink-0 flex flex-col border-r overflow-hidden ${theme.sidebarBg} ${theme.border}`}
          >
            {/* Brand + Quick Create */}
            <div data-tauri-drag-region className={`px-3 py-3 border-b flex items-center justify-between gap-2 ${theme.border}`}>
              <div className="flex items-center gap-2 font-semibold text-sm tracking-tight">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span>DocuSage</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${theme.accentSoft}`}>
                  v2
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCreatingFolder((v) => !v)}
                  aria-label="New Folder"
                  title="New Folder"
                  className={`p-1.5 rounded-lg ${theme.hoverBg}`}
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => createChat()}
                  aria-label="New Chat"
                  title="New Chat (Ctrl+N)"
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${theme.accent}`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New</span>
                </button>
              </div>
            </div>

            {/* Sidebar Tabs: Chats vs Docs */}
            <div className={`p-2 border-b grid grid-cols-2 gap-1 ${theme.border}`}>
              <button
                type="button"
                onClick={() => setSidebarTab('chats')}
                className={`py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  sidebarTab === 'chats' ? theme.accentSoft : `border-transparent ${theme.hoverBg}`
                }`}
              >
                Chats ({chats.length})
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('docs')}
                className={`py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  sidebarTab === 'docs' ? theme.accentSoft : `border-transparent ${theme.hoverBg}`
                }`}
              >
                Docs ({documents.length})
              </button>
            </div>

            {sidebarTab === 'chats' ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Full-Text Search across all chats */}
                <div className="p-2">
                  <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs ${theme.inputBg} ${theme.border}`}>
                    <Search className="w-3.5 h-3.5 opacity-60 shrink-0" />
                    <input
                      aria-label="Search chats"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Full-text search chats…"
                      className="flex-1 bg-transparent outline-none min-w-0"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        aria-label="Clear search"
                      >
                        <X className="w-3 h-3 opacity-60" />
                      </button>
                    )}
                  </div>
                </div>

                {creatingFolder && (
                  <form onSubmit={handleCreateFolder} className="px-2 pb-2 flex gap-1">
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="Folder name…"
                      className={`flex-1 rounded-lg border px-2 py-1 text-xs outline-none ${theme.inputBg} ${theme.border}`}
                    />
                    <button type="submit" className={`px-2 py-1 rounded-lg text-xs font-medium ${theme.accent}`}>
                      Add
                    </button>
                  </form>
                )}

                <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-2">
                  {searchQuery.trim() ? (
                    searchMatches.length === 0 ? (
                      <p className={`text-center text-xs py-6 ${theme.textMuted}`}>
                        No messages match "{searchQuery}".
                      </p>
                    ) : (
                      searchMatches.map((hit) => (
                        <button
                          key={`${hit.chatId}-${hit.branchId}`}
                          type="button"
                          onClick={() => {
                            setActiveChat(hit.chatId);
                            setSearchQuery('');
                          }}
                          className={`w-full text-left p-2.5 rounded-xl border text-xs hover:border-emerald-500/50 ${theme.surfaceBg} ${theme.border}`}
                        >
                          <div className="font-semibold truncate">{hit.chatName}</div>
                          <div className={`text-[11px] mt-0.5 line-clamp-2 ${theme.textMuted}`}>
                            {hit.snippet}
                          </div>
                        </button>
                      ))
                    )
                  ) : (
                    <>
                      {folders.map((folder) => {
                        const folderChats = chats.filter((c) => c.folderId === folder.id);
                        return (
                          <div key={folder.id} className="space-y-0.5">
                            <div className="group flex items-center justify-between px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider opacity-80">
                              <button
                                type="button"
                                onClick={() => toggleFolderCollapsed(folder.id)}
                                className="flex items-center gap-1.5 truncate"
                              >
                                {folder.collapsed ? (
                                  <ChevronRight className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                                <Folder className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="truncate">{folder.name}</span>
                                <span className="opacity-60">({folderChats.length})</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteFolder(folder.id)}
                                aria-label={`Delete folder ${folder.name}`}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-400"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                            {!folder.collapsed && (
                              <div className="pl-2 space-y-0.5">{folderChats.map(renderChatRow)}</div>
                            )}
                          </div>
                        );
                      })}

                      <div className="space-y-0.5">{unfiledChats.map(renderChatRow)}</div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden p-2 space-y-2">
                <button
                  type="button"
                  onClick={() => void handleIngestDocument()}
                  className={`w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium ${theme.accent}`}
                >
                  <FileUp className="w-3.5 h-3.5" />
                  <span>Index Documents</span>
                </button>

                <div className="flex-1 overflow-y-auto space-y-1.5">
                  {documents.length === 0 ? (
                    <div className={`text-center text-xs py-8 px-2 ${theme.textMuted}`}>
                      Drop PDFs, Markdown, code, or config files anywhere to index into SQLite FTS5 + Vector Store.
                    </div>
                  ) : (
                    documents.map((doc) => {
                      const attached = activeChat.attachedDocPaths.includes(doc.path);
                      return (
                        <div
                          key={doc.path}
                          className={`rounded-xl border p-2.5 text-xs space-y-1.5 ${theme.surfaceBg} ${
                            attached ? 'border-emerald-500/60' : theme.border
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <div className="min-w-0">
                              <div className="font-medium truncate flex items-center gap-1.5" title={doc.path}>
                                <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                <span className="truncate">{doc.name}</span>
                              </div>
                              <div className={`text-[10.5px] mt-0.5 ${theme.textMuted}`}>
                                {doc.chunkCount} chunks · {doc.hasEmbeddings ? 'Hybrid' : 'FTS5'}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                detachDocFromChat(activeChat.id, doc.path);
                                void removeDocument(doc.path);
                              }}
                              aria-label={`Delete document ${doc.name}`}
                              className="p-1 rounded hover:text-rose-400 shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              attached
                                ? detachDocFromChat(activeChat.id, doc.path)
                                : attachDocToChat(activeChat.id, doc.path)
                            }
                            className={`w-full inline-flex items-center justify-center gap-1 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                              attached ? theme.accentSoft : theme.border
                            }`}
                          >
                            <Paperclip className="w-3 h-3" />
                            <span>{attached ? 'Attached to Chat' : 'Attach to Chat'}</span>
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </aside>

          {/* Drag-resize handle */}
          <div
            onMouseDown={startResize}
            className="w-1 cursor-col-resize hover:bg-emerald-500/50 transition-colors shrink-0"
            title="Drag to resize sidebar"
          />
        </>
      )}

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header
          data-tauri-drag-region
          onDoubleClick={() => void toggleWindowMode()}
          className={`flex items-center justify-between gap-2 px-4 py-2.5 border-b select-none ${theme.surfaceBg} ${theme.border}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={`p-1.5 rounded-lg ${theme.hoverBg}`}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
            <ModelSelector />
            <ContextBadge telemetry={latestTelemetry} onClick={() => setRagDebugOpen(!ragDebugOpen)} />
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => deleteChat(activeChat.id)}
              aria-label="Delete conversation"
              title="Delete current conversation"
              className={`p-1.5 rounded-lg hover:text-rose-400 ${theme.hoverBg}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              aria-label="Compare Models"
              title="Model Compare (Side-by-Side)"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs ${theme.hoverBg}`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Compare</span>
            </button>
            <button
              type="button"
              onClick={() => setRagDebugOpen(!ragDebugOpen)}
              aria-label="Toggle RAG Inspector"
              title="Smart Context Inspector"
              className={`p-1.5 rounded-lg border ${ragDebugOpen ? theme.accentSoft : `border-transparent ${theme.hoverBg}`}`}
            >
              <Database className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Command Palette"
              title="Command Palette (Ctrl+K)"
              className={`p-1.5 rounded-lg ${theme.hoverBg}`}
            >
              <Command className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void toggleWindowMode()}
              aria-label="Switch to Spotlight"
              title="Switch to floating Spotlight mode"
              className={`p-1.5 rounded-lg ${theme.hoverBg}`}
            >
              <Minimize2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => openSettings()}
              aria-label="Settings"
              title="Settings"
              className={`p-1.5 rounded-lg ${theme.hoverBg}`}
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void api.hideAssistantWindow()}
              aria-label="Hide Window"
              title="Hide to tray"
              className={`p-1.5 rounded-lg ${theme.hoverBg}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <LocalSetupBanner onFocusComposer={onFocusComposer} />

        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <BranchSelector />
            <MessageList
              messages={activeBranch.messages}
              attachedCount={activeChat.attachedDocPaths.length}
              onBranch={(msgId) => branchFromMessage(activeChat.id, msgId)}
              onQuickPrompt={(text) => void sendMessage(text)}
            />
            <ChatComposer focusSignal={focusSignal} />
          </div>
          <RagDebugPanel />
        </div>
      </div>

      {isDraggingFiles && (
        <div className="absolute inset-0 z-40 bg-emerald-950/85 backdrop-blur-sm border-2 border-dashed border-emerald-400 flex flex-col items-center justify-center gap-2 text-emerald-100 pointer-events-none">
          <FileUp className="w-10 h-10 text-emerald-400" />
          <div className="text-base font-semibold">Drop files anywhere to index & attach</div>
          <div className="text-xs opacity-80">Up to 50 MB · 36 document, code & config formats</div>
        </div>
      )}
    </div>
  );
};
