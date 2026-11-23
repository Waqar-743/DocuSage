import type { AppearanceTheme, ChatBranch, ChatFolder, ChatMessageItem, ChatSession } from '../types';
import { isValidTheme } from './themes';

export const V1_STORAGE_KEY = 'docusage:app-state:v1';
export const V2_STORAGE_KEY = 'docusage:app-state:v2';

export type PersistedV2State = {
  version: 2;
  theme: AppearanceTheme;
  chats: ChatSession[];
  folders: ChatFolder[];
  activeChatId: string;
  drafts: Record<string, string>;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
};

type LegacyMessage = {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  isStreaming?: boolean;
  isError?: boolean;
};

type LegacyAppState = {
  theme?: AppearanceTheme;
  mode?: 'general' | 'rag';
  generalChats?: { id: string; name: string; messages: LegacyMessage[] }[];
  selectedGeneralChatId?: string;
  selectedDocId?: string | null;
  documents?: { id: string; name: string; path: string; status?: string; messages?: LegacyMessage[] }[];
  drafts?: Record<string, string>;
  sidebarCollapsed?: boolean;
};

function sanitizeMessages(messages: LegacyMessage[] | ChatMessageItem[] | undefined): ChatMessageItem[] {
  if (!Array.isArray(messages)) return [];
  const now = Date.now();
  return messages.map((m) => {
    const wasInterrupted = Boolean(m.isStreaming);
    const text =
      wasInterrupted && (!m.text || m.text.trim() === '')
        ? 'Response interrupted when the app closed. Send your question again.'
        : m.text ?? '';
    return {
      id: m.id || `msg-${Math.random().toString(36).slice(2, 10)}`,
      sender: m.sender === 'user' ? 'user' : 'bot',
      text,
      createdAt: 'createdAt' in m && typeof m.createdAt === 'number' ? m.createdAt : now,
      isStreaming: false,
      isError: Boolean(m.isError) || (wasInterrupted && !m.text?.trim()),
      providerLabel: 'providerLabel' in m ? m.providerLabel : undefined,
      modelLabel: 'modelLabel' in m ? m.modelLabel : undefined,
      telemetry: 'telemetry' in m ? m.telemetry : undefined,
    };
  });
}

export function createEmptyChat(name = 'New Chat', folderId: string | null = null, attachedDocPaths: string[] = []): ChatSession {
  const now = Date.now();
  const chatId = `chat-${now}-${Math.random().toString(36).slice(2, 7)}`;
  const mainBranch: ChatBranch = {
    id: `branch-${now}`,
    name: 'Main',
    parentBranchId: null,
    forkedFromMessageId: null,
    messages: [],
    createdAt: now,
  };
  return {
    id: chatId,
    name,
    folderId,
    attachedDocPaths,
    branches: [mainBranch],
    activeBranchId: mainBranch.id,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Load v2 state from localStorage, seamlessly migrating legacy v1 chats and
 * document conversations so existing users never lose history on upgrade.
 */
export function loadOrMigrateState(): PersistedV2State {
  const fallbackChat = createEmptyChat('Welcome Chat');
  const defaults: PersistedV2State = {
    version: 2,
    theme: 'dark',
    chats: [fallbackChat],
    folders: [],
    activeChatId: fallbackChat.id,
    drafts: {},
    sidebarWidth: 272,
    sidebarCollapsed: false,
  };

  try {
    const rawV2 = localStorage.getItem(V2_STORAGE_KEY);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as Partial<PersistedV2State>;
      const chats = Array.isArray(parsed.chats) && parsed.chats.length > 0
        ? parsed.chats.map((c) => {
            const branches = Array.isArray(c.branches) && c.branches.length > 0
              ? c.branches.map((b) => ({ ...b, messages: sanitizeMessages(b.messages) }))
              : [{
                  id: `branch-${c.id}`,
                  name: 'Main',
                  parentBranchId: null,
                  forkedFromMessageId: null,
                  messages: [],
                  createdAt: c.createdAt || Date.now(),
                }];
            const activeBranchId = branches.some((b) => b.id === c.activeBranchId)
              ? c.activeBranchId
              : branches[0].id;
            return {
              ...c,
              folderId: c.folderId ?? null,
              attachedDocPaths: Array.isArray(c.attachedDocPaths) ? c.attachedDocPaths : [],
              branches,
              activeBranchId,
            };
          })
        : [fallbackChat];

      const activeChatId = chats.some((c) => c.id === parsed.activeChatId)
        ? (parsed.activeChatId as string)
        : chats[0].id;

      return {
        version: 2,
        theme: isValidTheme(parsed.theme) ? parsed.theme : 'dark',
        chats,
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
        activeChatId,
        drafts: parsed.drafts && typeof parsed.drafts === 'object' ? parsed.drafts : {},
        sidebarWidth: typeof parsed.sidebarWidth === 'number' ? Math.min(420, Math.max(220, parsed.sidebarWidth)) : 272,
        sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      };
    }

    // Backwards-compatible migration from v1 storage
    const rawV1 = localStorage.getItem(V1_STORAGE_KEY);
    if (rawV1) {
      const v1 = JSON.parse(rawV1) as LegacyAppState;
      const migratedChats: ChatSession[] = [];
      const now = Date.now();

      if (Array.isArray(v1.generalChats)) {
        for (const gc of v1.generalChats) {
          const branchId = `branch-${gc.id}`;
          migratedChats.push({
            id: gc.id,
            name: gc.name || 'Chat',
            folderId: null,
            attachedDocPaths: [],
            branches: [
              {
                id: branchId,
                name: 'Main',
                parentBranchId: null,
                forkedFromMessageId: null,
                messages: sanitizeMessages(gc.messages),
                createdAt: now,
              },
            ],
            activeBranchId: branchId,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      if (Array.isArray(v1.documents)) {
        for (const doc of v1.documents) {
          const msgs = sanitizeMessages(doc.messages);
          if (msgs.length > 0 || v1.selectedDocId === doc.id) {
            const branchId = `branch-doc-${doc.id}`;
            migratedChats.push({
              id: `doc-chat-${doc.id}`,
              name: doc.name || 'Document Chat',
              folderId: null,
              attachedDocPaths: doc.path ? [doc.path] : [],
              branches: [
                {
                  id: branchId,
                  name: 'Main',
                  parentBranchId: null,
                  forkedFromMessageId: null,
                  messages: msgs,
                  createdAt: now,
                },
              ],
              activeBranchId: branchId,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
      }

      const chats = migratedChats.length > 0 ? migratedChats : [fallbackChat];
      let activeChatId = chats[0].id;
      if (v1.mode === 'rag' && v1.selectedDocId) {
        const docChat = chats.find((c) => c.id === `doc-chat-${v1.selectedDocId}`);
        if (docChat) activeChatId = docChat.id;
      } else if (v1.selectedGeneralChatId && chats.some((c) => c.id === v1.selectedGeneralChatId)) {
        activeChatId = v1.selectedGeneralChatId;
      }

      const migrated: PersistedV2State = {
        version: 2,
        theme: v1.theme ?? 'dark',
        chats,
        folders: [],
        activeChatId,
        drafts: v1.drafts ?? {},
        sidebarWidth: 272,
        sidebarCollapsed: Boolean(v1.sidebarCollapsed),
      };
      localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    // Fall back cleanly if localStorage is corrupt or unavailable.
  }

  return defaults;
}

export function persistV2State(state: PersistedV2State): void {
  try {
    localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors safely.
  }
}
