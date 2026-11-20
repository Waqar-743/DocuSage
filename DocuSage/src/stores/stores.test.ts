import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../lib/api';
import { highlightCodeLine, parseMarkdownBlocks } from '../lib/markdown';
import { loadOrMigrateState, V1_STORAGE_KEY, V2_STORAGE_KEY } from '../lib/migration';
import { useChatStore } from './useChatStore';

vi.mock('../lib/api', async (original) => {
  const real = await original<typeof api>();
  return {
    ...real,
    isTauri: () => false,
    chatSend: vi.fn(async (req: api.ChatSendRequest) => ({
      reply: `Reply from ${req.modelOverride || req.providerId}`,
      stopped: false,
      telemetry: {
        requestId: req.requestId,
        mode: req.attachedPaths.length > 0 ? ('hybridRag' as const) : ('none' as const),
        estimatedTokens: 120,
        totalChars: 480,
        documentCount: req.attachedPaths.length,
        citations: [],
      },
    })),
  };
});

describe('DocuSage v2 Stores & Utilities', () => {
  beforeEach(() => {
    localStorage.clear();
    useChatStore.getState().resetFromStorage();
  });

  it('migrates v1 chats and document conversations cleanly to v2', () => {
    localStorage.setItem(
      V1_STORAGE_KEY,
      JSON.stringify({
        theme: 'ocean',
        mode: 'general',
        generalChats: [
          {
            id: 'legacy-1',
            name: 'Legacy Chat',
            messages: [{ id: 'm1', sender: 'user', text: 'Hello v1' }],
          },
        ],
        selectedGeneralChatId: 'legacy-1',
        documents: [
          {
            id: 'doc-1',
            name: 'spec.pdf',
            path: '/docs/spec.pdf',
            messages: [{ id: 'dm1', sender: 'bot', text: 'Found clause 4.2' }],
          },
        ],
      }),
    );

    const state = loadOrMigrateState();
    expect(state.version).toBe(2);
    expect(state.theme).toBe('ocean');
    expect(state.chats).toHaveLength(2);
    expect(state.chats[0].name).toBe('Legacy Chat');
    expect(state.chats[1].attachedDocPaths).toEqual(['/docs/spec.pdf']);
    expect(localStorage.getItem(V2_STORAGE_KEY)).toBeTruthy();
  });

  it('supports folders, conversation branching, and full-text chat search', async () => {
    const store = useChatStore.getState();
    const folder = store.createFolder('Research');
    const chat = store.createChat({ name: 'Quantum Paper', folderId: folder.id });
    store.attachDocToChat(chat.id, '/tmp/quantum.pdf');

    await useChatStore.getState().sendMessage('Explain entanglement');
    const branch = useChatStore.getState().getActiveBranch();
    expect(branch.messages).toHaveLength(2);

    // Branch from the user message
    useChatStore.getState().branchFromMessage(chat.id, branch.messages[0].id);
    const updatedChat = useChatStore.getState().getActiveChat();
    expect(updatedChat.branches).toHaveLength(2);
    expect(useChatStore.getState().getActiveBranch().messages).toHaveLength(1);

    // Full-text search across saved chats
    const hits = useChatStore.getState().searchAllChats('entanglement');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].chatId).toBe(chat.id);
  });

  it('runs Model Compare across multiple models concurrently', async () => {
    await useChatStore.getState().runCompare('Compare offline vs online', [
      { id: 't1', providerId: 'local', providerName: 'Local GGUF', model: 'llama-3.2-1b' },
      { id: 't2', providerId: 'gemini', providerName: 'Google Gemini', model: 'gemini-2.5-flash' },
    ]);

    const results = useChatStore.getState().compareResults;
    expect(results).toHaveLength(2);
    expect(results[0].text).toContain('llama-3.2-1b');
    expect(results[1].text).toContain('gemini-2.5-flash');
    expect(results.every((r) => !r.isStreaming && r.durationMs !== null)).toBe(true);
  });

  it('exports and imports JSON backups losslessly', () => {
    const chat = useChatStore.getState().createChat({ name: 'Backup Test' });
    const json = useChatStore.getState().exportBackupJson();
    useChatStore.getState().deleteChat(chat.id);
    expect(useChatStore.getState().chats.some((c) => c.name === 'Backup Test')).toBe(false);

    const ok = useChatStore.getState().importBackupJson(json);
    expect(ok).toBe(true);
    expect(useChatStore.getState().chats.some((c) => c.name === 'Backup Test')).toBe(true);
  });

  it('parses markdown code fences, lists, and syntax highlights keywords', () => {
    const blocks = parseMarkdownBlocks('# Title\n\n- item 1\n- item 2\n\n```rust\nfn main() { let x = 42; }\n```');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'ul', 'code']);
    const tokens = highlightCodeLine('const x = "hello"; // note');
    expect(tokens.some((t) => t.kind === 'keyword' && t.text === 'const')).toBe(true);
    expect(tokens.some((t) => t.kind === 'string' && t.text === '"hello"')).toBe(true);
    expect(tokens.some((t) => t.kind === 'comment')).toBe(true);
  });
});
