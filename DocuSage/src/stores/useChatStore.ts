import { create } from 'zustand';
import * as api from '../lib/api';
import { createEmptyChat, loadOrMigrateState, persistV2State } from '../lib/migration';
import type {
  ChatBranch,
  ChatFolder,
  ChatMessageItem,
  ChatSession,
  CompareColumnResult,
  CompareTarget,
  ContextTelemetry,
} from '../types';
import { useDocumentStore } from './useDocumentStore';
import { useProviderStore } from './useProviderStore';
import { useUiStore } from './useUiStore';

type ActiveStreamMeta = {
  chatId: string;
  branchId: string;
  messageId: string;
  kind: 'chat' | 'compare';
  targetId?: string;
};

export type SearchMatch = {
  chatId: string;
  chatName: string;
  branchId: string;
  snippet: string;
  updatedAt: number;
};

type ChatState = {
  chats: ChatSession[];
  folders: ChatFolder[];
  activeChatId: string;
  drafts: Record<string, string>;
  searchQuery: string;
  activeStreams: Record<string, ActiveStreamMeta>;
  comparePrompt: string;
  compareTargets: CompareTarget[];
  compareResults: CompareColumnResult[];

  getActiveChat: () => ChatSession;
  getActiveBranch: (chat?: ChatSession) => ChatBranch;
  setActiveChat: (chatId: string) => void;
  createChat: (opts?: { name?: string; folderId?: string | null; attachedDocPaths?: string[] }) => ChatSession;
  renameChat: (chatId: string, name: string) => void;
  deleteChat: (chatId: string) => void;
  moveChatToFolder: (chatId: string, folderId: string | null) => void;

  // Folders
  createFolder: (name: string) => ChatFolder;
  renameFolder: (folderId: string, name: string) => void;
  toggleFolderCollapsed: (folderId: string) => void;
  deleteFolder: (folderId: string) => void;

  // Branching
  branchFromMessage: (chatId: string, messageId: string) => void;
  switchBranch: (chatId: string, branchId: string) => void;
  deleteBranch: (chatId: string, branchId: string) => void;

  // Per-chat attached documents (Smart Context)
  attachDocToChat: (chatId: string, path: string) => void;
  detachDocFromChat: (chatId: string, path: string) => void;

  // Drafts & Search
  setDraft: (chatId: string, value: string) => void;
  appendQuoteToActiveDraft: (quotedText: string) => void;
  setSearchQuery: (q: string) => void;
  searchAllChats: (q: string) => SearchMatch[];

  // Messaging & Streaming
  sendMessage: (prompt: string, opts?: { providerId?: string; modelOverride?: string }) => Promise<void>;
  handleStreamToken: (requestId: string, token: string, done: boolean) => void;
  handleStreamContext: (telemetry: ContextTelemetry) => void;
  stopActiveChatStream: () => Promise<void>;
  isChatStreaming: (chatId: string) => boolean;

  // Model Compare (2–4 models side by side)
  setComparePrompt: (prompt: string) => void;
  setCompareTargets: (targets: CompareTarget[]) => void;
  runCompare: (prompt: string, targets: CompareTarget[]) => Promise<void>;
  stopCompare: () => Promise<void>;

  // Export / Import Backup
  exportBackupJson: () => string;
  importBackupJson: (raw: string) => boolean;
  exportChatMarkdown: (chatId: string) => string;
  resetFromStorage: () => void;
};

function syncPersist(state: Pick<ChatState, 'chats' | 'folders' | 'activeChatId' | 'drafts'>) {
  const cur = loadOrMigrateState();
  persistV2State({
    ...cur,
    chats: state.chats,
    folders: state.folders,
    activeChatId: state.activeChatId,
    drafts: state.drafts,
  });
}

const boot = loadOrMigrateState();

export const useChatStore = create<ChatState>((set, get) => ({
  chats: boot.chats,
  folders: boot.folders,
  activeChatId: boot.activeChatId,
  drafts: boot.drafts,
  searchQuery: '',
  activeStreams: {},
  comparePrompt: '',
  compareTargets: [],
  compareResults: [],

  resetFromStorage: () => {
    const fresh = loadOrMigrateState();
    set({
      chats: fresh.chats,
      folders: fresh.folders,
      activeChatId: fresh.activeChatId,
      drafts: fresh.drafts,
      activeStreams: {},
      compareResults: [],
    });
  },

  getActiveChat: () => {
    const { chats, activeChatId } = get();
    return chats.find((c) => c.id === activeChatId) ?? chats[0];
  },

  getActiveBranch: (chatArg) => {
    const chat = chatArg ?? get().getActiveChat();
    return chat.branches.find((b) => b.id === chat.activeBranchId) ?? chat.branches[0];
  },

  setActiveChat: (chatId) => {
    if (!get().chats.some((c) => c.id === chatId)) return;
    set({ activeChatId: chatId });
    syncPersist(get());
  },

  createChat: (opts) => {
    const next = createEmptyChat(
      opts?.name ?? 'New Chat',
      opts?.folderId ?? null,
      opts?.attachedDocPaths ?? [],
    );
    set((s) => ({
      chats: [next, ...s.chats],
      activeChatId: next.id,
    }));
    syncPersist(get());
    return next;
  },

  renameChat: (chatId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((s) => ({
      chats: s.chats.map((c) => (c.id === chatId ? { ...c, name: trimmed, updatedAt: Date.now() } : c)),
    }));
    syncPersist(get());
  },

  deleteChat: (chatId) => {
    set((s) => {
      const remaining = s.chats.filter((c) => c.id !== chatId);
      const chats = remaining.length > 0 ? remaining : [createEmptyChat('New Chat')];
      const activeChatId = s.activeChatId === chatId ? chats[0].id : s.activeChatId;
      const drafts = { ...s.drafts };
      delete drafts[chatId];
      return { chats, activeChatId, drafts };
    });
    syncPersist(get());
  },

  moveChatToFolder: (chatId, folderId) => {
    set((s) => ({
      chats: s.chats.map((c) => (c.id === chatId ? { ...c, folderId } : c)),
    }));
    syncPersist(get());
  },

  createFolder: (name) => {
    const folder: ChatFolder = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || 'Untitled Folder',
      collapsed: false,
      createdAt: Date.now(),
    };
    set((s) => ({ folders: [...s.folders, folder] }));
    syncPersist(get());
    return folder;
  },

  renameFolder: (folderId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((s) => ({
      folders: s.folders.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)),
    }));
    syncPersist(get());
  },

  toggleFolderCollapsed: (folderId) => {
    set((s) => ({
      folders: s.folders.map((f) => (f.id === folderId ? { ...f, collapsed: !f.collapsed } : f)),
    }));
    syncPersist(get());
  },

  deleteFolder: (folderId) => {
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== folderId),
      chats: s.chats.map((c) => (c.folderId === folderId ? { ...c, folderId: null } : c)),
    }));
    syncPersist(get());
  },

  branchFromMessage: (chatId, messageId) => {
    set((s) => ({
      chats: s.chats.map((c) => {
        if (c.id !== chatId) return c;
        const currentBranch = c.branches.find((b) => b.id === c.activeBranchId) ?? c.branches[0];
        const idx = currentBranch.messages.findIndex((m) => m.id === messageId);
        if (idx === -1) return c;
        const prefix = currentBranch.messages.slice(0, idx + 1).map((m) => ({ ...m }));
        const newBranch: ChatBranch = {
          id: `branch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: `Branch ${c.branches.length + 1}`,
          parentBranchId: currentBranch.id,
          forkedFromMessageId: messageId,
          messages: prefix,
          createdAt: Date.now(),
        };
        return {
          ...c,
          branches: [...c.branches, newBranch],
          activeBranchId: newBranch.id,
          updatedAt: Date.now(),
        };
      }),
    }));
    syncPersist(get());
    useUiStore.getState().pushToast('info', 'Created new conversation branch.');
  },

  switchBranch: (chatId, branchId) => {
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId && c.branches.some((b) => b.id === branchId)
          ? { ...c, activeBranchId: branchId }
          : c,
      ),
    }));
    syncPersist(get());
  },

  deleteBranch: (chatId, branchId) => {
    set((s) => ({
      chats: s.chats.map((c) => {
        if (c.id !== chatId || c.branches.length <= 1) return c;
        const branches = c.branches.filter((b) => b.id !== branchId);
        const activeBranchId = c.activeBranchId === branchId ? branches[0].id : c.activeBranchId;
        return { ...c, branches, activeBranchId };
      }),
    }));
    syncPersist(get());
  },

  attachDocToChat: (chatId, path) => {
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId && !c.attachedDocPaths.includes(path)
          ? { ...c, attachedDocPaths: [...c.attachedDocPaths, path], updatedAt: Date.now() }
          : c,
      ),
    }));
    syncPersist(get());
  },

  detachDocFromChat: (chatId, path) => {
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId
          ? { ...c, attachedDocPaths: c.attachedDocPaths.filter((p) => p !== path), updatedAt: Date.now() }
          : c,
      ),
    }));
    syncPersist(get());
  },

  setDraft: (chatId, value) => {
    set((s) => ({ drafts: { ...s.drafts, [chatId]: value } }));
    syncPersist(get());
  },

  appendQuoteToActiveDraft: (quotedText) => {
    const clean = quotedText.trim();
    if (!clean) return;
    const chat = get().getActiveChat();
    const quoted = clean
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    const existing = get().drafts[chat.id] ?? '';
    const next = existing.trim() ? `${existing}\n\n${quoted}\n\n` : `${quoted}\n\n`;
    get().setDraft(chat.id, next);
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  searchAllChats: (rawQuery) => {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return [];
    const results: SearchMatch[] = [];
    for (const chat of get().chats) {
      if (chat.name.toLowerCase().includes(q)) {
        results.push({
          chatId: chat.id,
          chatName: chat.name,
          branchId: chat.activeBranchId,
          snippet: `Chat title matches "${rawQuery}"`,
          updatedAt: chat.updatedAt,
        });
        continue;
      }
      for (const branch of chat.branches) {
        const hit = branch.messages.find((m) => m.text.toLowerCase().includes(q));
        if (hit) {
          const idx = hit.text.toLowerCase().indexOf(q);
          const start = Math.max(0, idx - 40);
          const snippet = (start > 0 ? '…' : '') + hit.text.slice(start, start + 120);
          results.push({
            chatId: chat.id,
            chatName: chat.name,
            branchId: branch.id,
            snippet,
            updatedAt: chat.updatedAt,
          });
          break;
        }
      }
    }
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  isChatStreaming: (chatId) =>
    Object.values(get().activeStreams).some((m) => m.kind === 'chat' && m.chatId === chatId),

  sendMessage: async (rawPrompt, opts) => {
    const prompt = rawPrompt.trim();
    if (!prompt) return;

    const chat = get().getActiveChat();
    const branch = get().getActiveBranch(chat);
    // Prevent duplicate concurrent sends in the same chat.
    if (get().isChatStreaming(chat.id)) return;

    const providerState = useProviderStore.getState();
    const targetProviderId = opts?.providerId ?? providerState.activeProviderId;
    const provider = providerState.providers.find((p) => p.id === targetProviderId);
    const providerLabel = provider?.name ?? 'Local';
    const modelLabel =
      opts?.modelOverride ??
      (provider?.provider === 'local' ? providerState.connectedModel ?? 'GGUF' : provider?.model ?? undefined);

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userMsg: ChatMessageItem = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: prompt,
      createdAt: Date.now(),
    };
    const botMsgId = `bot-${Date.now() + 1}`;
    const botMsg: ChatMessageItem = {
      id: botMsgId,
      sender: 'bot',
      text: '',
      createdAt: Date.now(),
      isStreaming: true,
      requestId,
      providerLabel,
      modelLabel,
    };

    const history = branch.messages
      .filter((m) => !m.isError && m.text.trim().length > 0)
      .slice(-16)
      .map((m) => ({ sender: m.sender, text: m.text }));

    const shouldAutoTitle =
      branch.messages.length === 0 && (chat.name === 'New Chat' || chat.name === 'Welcome Chat');
    const nextTitle = shouldAutoTitle ? prompt.slice(0, 42) + (prompt.length > 42 ? '…' : '') : chat.name;

    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chat.id
          ? {
              ...c,
              name: nextTitle,
              updatedAt: Date.now(),
              branches: c.branches.map((b) =>
                b.id === branch.id ? { ...b, messages: [...b.messages, userMsg, botMsg] } : b,
              ),
            }
          : c,
      ),
      drafts: { ...s.drafts, [chat.id]: '' },
      activeStreams: {
        ...s.activeStreams,
        [requestId]: { chatId: chat.id, branchId: branch.id, messageId: botMsgId, kind: 'chat' },
      },
    }));
    syncPersist(get());

    try {
      const response = await api.chatSend({
        prompt,
        history,
        requestId,
        attachedPaths: chat.attachedDocPaths,
        providerId: targetProviderId,
        modelOverride: opts?.modelOverride ?? null,
      });

      useDocumentStore.getState().recordTelemetry(response.telemetry);
      set((s) => {
        const nextStreams = { ...s.activeStreams };
        delete nextStreams[requestId];
        return {
          activeStreams: nextStreams,
          chats: s.chats.map((c) =>
            c.id === chat.id
              ? {
                  ...c,
                  updatedAt: Date.now(),
                  branches: c.branches.map((b) =>
                    b.id === branch.id
                      ? {
                          ...b,
                          messages: b.messages.map((m) =>
                            m.id === botMsgId
                              ? {
                                  ...m,
                                  text: response.reply || m.text,
                                  isStreaming: false,
                                  telemetry: response.telemetry,
                                }
                              : m,
                          ),
                        }
                      : b,
                  ),
                }
              : c,
          ),
        };
      });
      syncPersist(get());
    } catch (err) {
      const message = String(err);
      set((s) => {
        const nextStreams = { ...s.activeStreams };
        delete nextStreams[requestId];
        return {
          activeStreams: nextStreams,
          chats: s.chats.map((c) =>
            c.id === chat.id
              ? {
                  ...c,
                  branches: c.branches.map((b) =>
                    b.id === branch.id
                      ? {
                          ...b,
                          messages: b.messages.map((m) =>
                            m.id === botMsgId
                              ? { ...m, text: message, isStreaming: false, isError: true }
                              : m,
                          ),
                        }
                      : b,
                  ),
                }
              : c,
          ),
        };
      });
      syncPersist(get());
    }
  },

  handleStreamToken: (requestId, token, done) => {
    const meta = get().activeStreams[requestId];
    if (!meta) return;

    if (meta.kind === 'compare') {
      set((s) => ({
        compareResults: s.compareResults.map((col) =>
          col.requestId === requestId
            ? { ...col, text: col.text + token, isStreaming: !done }
            : col,
        ),
      }));
      return;
    }

    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === meta.chatId
          ? {
              ...c,
              branches: c.branches.map((b) =>
                b.id === meta.branchId
                  ? {
                      ...b,
                      messages: b.messages.map((m) =>
                        m.id === meta.messageId
                          ? { ...m, text: m.text + token, isStreaming: !done }
                          : m,
                      ),
                    }
                  : b,
              ),
            }
          : c,
      ),
    }));
  },

  handleStreamContext: (telemetry) => {
    useDocumentStore.getState().recordTelemetry(telemetry);
    const meta = get().activeStreams[telemetry.requestId];
    if (!meta || meta.kind !== 'chat') return;
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === meta.chatId
          ? {
              ...c,
              branches: c.branches.map((b) =>
                b.id === meta.branchId
                  ? {
                      ...b,
                      messages: b.messages.map((m) =>
                        m.id === meta.messageId ? { ...m, telemetry } : m,
                      ),
                    }
                  : b,
              ),
            }
          : c,
      ),
    }));
  },

  stopActiveChatStream: async () => {
    const activeChat = get().getActiveChat();
    const entries = Object.entries(get().activeStreams).filter(
      ([, meta]) => meta.kind === 'chat' && meta.chatId === activeChat.id,
    );
    for (const [reqId] of entries) {
      await api.stopChat(reqId).catch(() => {});
    }
  },

  setComparePrompt: (comparePrompt) => set({ comparePrompt }),
  setCompareTargets: (compareTargets) => set({ compareTargets }),

  runCompare: async (rawPrompt, targets) => {
    const prompt = rawPrompt.trim();
    if (!prompt || targets.length < 2) return;

    const chat = get().getActiveChat();
    const attachedPaths = chat.attachedDocPaths;
    const startedAt = Date.now();

    const cols: CompareColumnResult[] = targets.slice(0, 4).map((t) => ({
      targetId: t.id,
      requestId: `cmp-${startedAt}-${t.id}`,
      providerName: t.providerName,
      model: t.model,
      text: '',
      isStreaming: true,
      isError: false,
      durationMs: null,
    }));

    const nextStreams = { ...get().activeStreams };
    for (const col of cols) {
      nextStreams[col.requestId] = {
        chatId: chat.id,
        branchId: chat.activeBranchId,
        messageId: col.requestId,
        kind: 'compare',
        targetId: col.targetId,
      };
    }

    set({ comparePrompt: prompt, compareResults: cols, activeStreams: nextStreams });

    await Promise.all(
      cols.map(async (col, idx) => {
        const target = targets[idx];
        const t0 = performance.now();
        try {
          const res = await api.chatSend({
            prompt,
            history: [],
            requestId: col.requestId,
            attachedPaths,
            providerId: target.providerId,
            modelOverride: target.model || null,
          });
          const durationMs = Math.round(performance.now() - t0);
          set((s) => {
            const streams = { ...s.activeStreams };
            delete streams[col.requestId];
            return {
              activeStreams: streams,
              compareResults: s.compareResults.map((r) =>
                r.requestId === col.requestId
                  ? { ...r, text: res.reply || r.text, isStreaming: false, durationMs, telemetry: res.telemetry }
                  : r,
              ),
            };
          });
        } catch (err) {
          const durationMs = Math.round(performance.now() - t0);
          set((s) => {
            const streams = { ...s.activeStreams };
            delete streams[col.requestId];
            return {
              activeStreams: streams,
              compareResults: s.compareResults.map((r) =>
                r.requestId === col.requestId
                  ? { ...r, text: String(err), isStreaming: false, isError: true, durationMs }
                  : r,
              ),
            };
          });
        }
      }),
    );
  },

  stopCompare: async () => {
    const entries = Object.entries(get().activeStreams).filter(([, m]) => m.kind === 'compare');
    for (const [reqId] of entries) {
      await api.stopChat(reqId).catch(() => {});
    }
  },

  exportBackupJson: () => {
    const { chats, folders, activeChatId, drafts } = get();
    const { theme, sidebarWidth, sidebarCollapsed } = useUiStore.getState();
    return JSON.stringify(
      { version: 2, exportedAt: new Date().toISOString(), theme, chats, folders, activeChatId, drafts, sidebarWidth, sidebarCollapsed },
      null,
      2,
    );
  },

  importBackupJson: (raw) => {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.chats) || parsed.chats.length === 0) return false;
      const activeChatId = parsed.chats.some((c: ChatSession) => c.id === parsed.activeChatId)
        ? parsed.activeChatId
        : parsed.chats[0].id;
      set({
        chats: parsed.chats,
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
        activeChatId,
        drafts: parsed.drafts ?? {},
      });
      syncPersist(get());
      useUiStore.getState().pushToast('success', `Imported ${parsed.chats.length} chat(s) from backup.`);
      return true;
    } catch {
      useUiStore.getState().pushToast('error', 'Invalid backup JSON file.');
      return false;
    }
  },

  exportChatMarkdown: (chatId) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat) return '';
    const branch = get().getActiveBranch(chat);
    const lines = [`# ${chat.name}`, ''];
    if (chat.attachedDocPaths.length > 0) {
      lines.push(`**Attached Documents**: ${chat.attachedDocPaths.map((p) => p.split(/[\\/]/).pop()).join(', ')}`, '');
    }
    for (const msg of branch.messages) {
      lines.push(msg.sender === 'user' ? '## User' : `## DocuSage${msg.modelLabel ? ` (${msg.modelLabel})` : ''}`);
      lines.push('', msg.text, '');
    }
    return lines.join('\n');
  },
}));
