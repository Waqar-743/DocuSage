import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import * as api from './lib/api';
import { useChatStore } from './stores/useChatStore';
import { useDocumentStore } from './stores/useDocumentStore';
import { useProviderStore } from './stores/useProviderStore';
import { useUiStore } from './stores/useUiStore';

const events = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    events.set(name, callback);
    return () => {
      events.delete(name);
    };
  }),
}));

vi.mock('./lib/api', async (original) => {
  const real = await original<typeof api>();
  return {
    ...real,
    isTauri: () => true,
    listDownloadedModels: vi.fn(async () => [
      { filename: 'test.gguf', path: '/tmp/test.gguf', sizeBytes: 100 },
    ]),
    listAiProviderConfigs: vi.fn(async () => ({
      activeProviderId: 'local',
      secureStorageAvailable: true,
      providers: [
        {
          id: 'local',
          name: 'Built-in Local (GGUF)',
          provider: 'local' as const,
          enabled: true,
          baseUrl: null,
          model: null,
          organization: null,
          project: null,
          timeoutSecs: 60,
          temperature: 0.3,
          apiKeySet: false,
          options: {},
        },
      ],
    })),
    getLocalRuntimeStatus: vi.fn(async () => ({
      installed: true,
      binaryPath: '/tmp/llama-server',
      running: true,
      port: 18080,
      baseUrl: 'http://127.0.0.1:18080/v1',
      loadedModel: 'test.gguf',
      loadedModelPath: '/tmp/test.gguf',
      embeddingRunning: false,
      embeddingPort: null,
      embeddingModel: null,
      detectedBackend: 'cpu',
      platformSummary: 'linux-x86_64 (cpu)',
      version: 'b5000',
    })),
    getAssistantStatus: vi.fn(async () => ({
      isVisible: true,
      isPinned: false,
      autostartEnabled: false,
      settings: { ...real.ASSISTANT_SETTINGS_DEFAULTS, windowMode: 'dashboard' as const },
      platform: {
        platform: 'linux',
        startupHidden: '',
        taskbarHidden: '',
        altTabHidden: '',
        focusNotes: '',
      },
    })),
    listIndexedDocuments: vi.fn(async () => []),
    getAllowedExtensions: vi.fn(async () => [...real.DEFAULT_ALLOWED_EXTENSIONS]),
    getRagConfig: vi.fn(async () => ({ ...real.RAG_CONFIG_DEFAULTS, embedding: { ...real.RAG_CONFIG_DEFAULTS.embedding } })),
    getConnectedModel: vi.fn(async () => 'test.gguf'),
    getModelsDir: vi.fn(async () => '/tmp/models'),
    chatSend: vi.fn(),
    stopChat: vi.fn(async () => {}),
    hideAssistantWindow: vi.fn(async () => {}),
    setAssistantFocusGuard: vi.fn(async () => {}),
    readClipboardText: vi.fn(async () => 'Quoted from clipboard'),
    deleteDocument: vi.fn(async () => {}),
    ingestDocument: vi.fn(),
    saveRagConfig: vi.fn(async () => {}),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  events.clear();
  localStorage.clear();
  localStorage.setItem(
    'docusage:app-state:v1',
    JSON.stringify({
      mode: 'general',
      theme: 'dark',
      generalChats: [{ id: 'first', name: 'First chat', messages: [] }],
      selectedGeneralChatId: 'first',
      documents: [],
      drafts: {},
      scrollPositions: {},
    }),
  );
  useChatStore.getState().resetFromStorage();
  useDocumentStore.setState({ documents: [], ingestingPaths: {}, latestTelemetry: null, telemetryHistory: [] });
  useProviderStore.setState({ providers: [], activeProviderId: 'local', connectedModel: 'test.gguf' });
  useUiStore.setState({
    windowMode: 'dashboard',
    settingsOpen: false,
    commandPaletteOpen: false,
    shortcutsOpen: false,
    compareOpen: false,
    ragDebugOpen: false,
    sidebarTab: 'chats',
    toasts: [],
  });
});

async function ready() {
  render(<App />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeTruthy());
}

test('streamed reply stays in its originating chat when switching sessions', async () => {
  let finish!: (res: api.ChatSendResponse) => void;
  vi.mocked(api.chatSend).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );

  await ready();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Explain my notes' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(api.chatSend).toHaveBeenCalledTimes(1));

  const requestId = vi.mocked(api.chatSend).mock.calls[0][0].requestId;
  fireEvent.click(screen.getByRole('button', { name: 'New Chat' }));

  await act(async () => {
    events.get('chat-token')?.({ payload: { requestId, token: 'A partial answer', done: false } });
    finish({
      reply: 'A complete answer',
      stopped: false,
      telemetry: { requestId, mode: 'none', estimatedTokens: 0, totalChars: 0, documentCount: 0, citations: [] },
    });
  });

  expect(screen.queryByText('A complete answer')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'First chat' }));
  expect(screen.getByText('A complete answer')).toBeTruthy();
});

test('Escape closes settings without hiding the assistant', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  expect(api.hideAssistantWindow).not.toHaveBeenCalled();
});

test('v1 interrupted empty response is migrated with a helpful explanation', async () => {
  const stored = JSON.parse(localStorage.getItem('docusage:app-state:v1')!);
  stored.generalChats[0].messages = [{ id: 'interrupted', sender: 'bot', text: '', isStreaming: true }];
  localStorage.setItem('docusage:app-state:v1', JSON.stringify(stored));
  localStorage.removeItem('docusage:app-state:v2');
  useChatStore.getState().resetFromStorage();

  await ready();
  expect(
    screen.getByText('Response interrupted when the app closed. Send your question again.'),
  ).toBeTruthy();
});

test('rapid sends create only one backend request', async () => {
  vi.mocked(api.chatSend).mockImplementation(() => new Promise(() => {}));
  await ready();
  const message = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(message, { target: { value: 'One question' } });
  fireEvent.keyDown(message, { key: 'Enter' });
  fireEvent.keyDown(message, { key: 'Enter' });
  await waitFor(() => expect(api.chatSend).toHaveBeenCalledTimes(1));
});

test('Ctrl+Shift+V quotes clipboard text into the prompt composer', async () => {
  await ready();
  fireEvent.keyDown(window, { key: 'V', ctrlKey: true, shiftKey: true });
  await waitFor(() => {
    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    expect(box.value).toContain('> Quoted from clipboard');
  });
});

test('Ctrl+K opens Command Palette', async () => {
  await ready();
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(screen.getByRole('dialog', { name: 'Command Palette' })).toBeTruthy();
});

test('RAG reset reports storage failure instead of claiming success', async () => {
  vi.mocked(api.saveRagConfig).mockRejectedValueOnce('Disk full');
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'RAG & Context' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(await screen.findByText('Failed to reset RAG settings: Disk full')).toBeTruthy();
  expect(screen.queryByText('Reset to defaults.')).toBeNull();
});

test('indexed document can be removed with the keyboard', async () => {
  vi.mocked(api.listIndexedDocuments).mockResolvedValueOnce([
    {
      id: '/tmp/guide.pdf',
      path: '/tmp/guide.pdf',
      name: 'guide.pdf',
      chunkCount: 3,
      charCount: 1400,
      embeddingModel: null,
      hasEmbeddings: false,
      updatedAt: 1,
    },
  ]);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: /Docs/ }));
  const remove = await screen.findByRole('button', { name: 'Delete document guide.pdf' });
  remove.focus();
  await userEvent.setup().keyboard('{Enter}');
  await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith('/tmp/guide.pdf'));
  expect(screen.queryByText('guide.pdf')).toBeNull();
});
