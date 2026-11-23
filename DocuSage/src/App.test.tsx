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
    saveAiProviderConfig: vi.fn(async (input: api.AiProviderConfigInput) => ({
      ...input,
      id: input.id ?? `provider-${input.provider}`,
      apiKeySet: Boolean(input.apiKey) && !input.deleteApiKey,
      baseUrl: input.baseUrl ?? null,
      model: input.model ?? null,
      organization: input.organization ?? null,
      project: input.project ?? null,
    })),
    setActiveAiProvider: vi.fn(async (providerId: string) => providerId),
    testAiProviderConnection: vi.fn(async () => ({
      ok: true,
      status: 'verified' as const,
      message: 'Verified! Connected (3 models available).',
      models: [{ id: 'gpt-4.1', label: 'GPT-4.1' }],
    })),
    downloadModel: vi.fn(async (_url: string, filename: string) => `/app-data/models/${filename}`),
    installLocalRuntime: vi.fn(async () => ({
      installed: true,
      binaryPath: '/app-data/runtime/llama-server',
      running: false,
      port: null,
      baseUrl: null,
      loadedModel: null,
      loadedModelPath: null,
      embeddingRunning: false,
      embeddingPort: null,
      embeddingModel: null,
      detectedBackend: 'cpu',
      platformSummary: 'linux-x86_64 (cpu)',
      version: 'b5000',
    })),
    connectModel: vi.fn(async (filePath: string) => `Connected to: ${filePath.split('/').pop()}`),
    connectEmbeddingModel: vi.fn(async () => ({
      installed: true,
      binaryPath: '/app-data/runtime/llama-server',
      running: false,
      port: null,
      baseUrl: null,
      loadedModel: null,
      loadedModelPath: null,
      embeddingRunning: true,
      embeddingPort: 18081,
      embeddingModel: 'bge-small-en-v1.5-q8_0.gguf',
      detectedBackend: 'cpu',
      platformSummary: 'linux-x86_64 (cpu)',
      version: 'b5000',
    })),
    testLocalModel: vi.fn(async () => ({
      ok: true,
      message: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf responded in 0.42s.',
      reply: 'Local model is ready!',
      durationMs: 420,
      model: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    })),
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
  useProviderStore.setState({
    providers: [],
    activeProviderId: 'local',
    connectedModel: 'test.gguf',
    verificationByProvider: {},
    modelsByProvider: {},
    isConnectingModel: false,
    isConnectingEmbedding: false,
    isInstallingRuntime: false,
    isTestingLocalModel: false,
    localTestResult: null,
    localSetup: {
      stage: 'idle',
      modelName: '',
      filename: '',
      kind: 'chat',
      percent: 0,
      message: '',
      error: null,
    },
  });
  useUiStore.setState({
    theme: 'dark',
    windowMode: 'dashboard',
    settingsOpen: false,
    settingsTab: 'providers',
    highlightedProviderKind: null,
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

test('supports Cream and Navy Blue themes alongside Dark and Light with proper color-scheme sync', async () => {
  await ready();
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.style.colorScheme).toBe('dark');

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));

  const creamBtn = screen.getByRole('button', { name: /Cream/i });
  const navyBtn = screen.getByRole('button', { name: /Navy Blue/i });
  expect(creamBtn).toBeTruthy();
  expect(navyBtn).toBeTruthy();

  fireEvent.click(creamBtn);
  expect(document.documentElement.dataset.theme).toBe('cream');
  expect(document.documentElement.style.colorScheme).toBe('light');

  fireEvent.click(navyBtn);
  expect(document.documentElement.dataset.theme).toBe('navy');
  expect(document.documentElement.style.colorScheme).toBe('dark');
});

test('provides separate API key config & verification for Anthropic, OpenAI, and Google Gemini plus grouped Model Selector', async () => {
  let savedProviders: api.AiProviderConfig[] = [
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
  ];
  vi.mocked(api.listAiProviderConfigs).mockImplementation(async () => ({
    activeProviderId: useProviderStore.getState().activeProviderId || 'local',
    secureStorageAvailable: true,
    providers: savedProviders,
  }));
  vi.mocked(api.saveAiProviderConfig).mockImplementation(async (input) => {
    const saved = {
      ...input,
      id: input.id ?? input.provider,
      apiKeySet: Boolean(input.apiKey) && !input.deleteApiKey,
      baseUrl: input.baseUrl ?? null,
      model: input.model ?? null,
      organization: input.organization ?? null,
      project: input.project ?? null,
    };
    savedProviders = [...savedProviders.filter((p) => p.id !== saved.id), saved];
    return saved;
  });

  await ready();

  // Open Settings -> Providers and confirm all 3 independent cloud sections exist
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByLabelText('Anthropic API Key')).toBeTruthy();
  expect(screen.getByLabelText('OpenAI API Key')).toBeTruthy();
  expect(screen.getByLabelText('Google Gemini API Key')).toBeTruthy();

  // Save & Verify OpenAI key (masked input cleared after save)
  const openaiInput = screen.getByLabelText('OpenAI API Key') as HTMLInputElement;
  expect(openaiInput.type).toBe('password');
  fireEvent.change(openaiInput, { target: { value: 'sk-test-secret-key' } });

  const openaiSection = screen.getByRole('region', { name: 'OpenAI API Configuration' });
  const verifyBtn = Array.from(openaiSection.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Verify'),
  )!;
  fireEvent.click(verifyBtn);

  await waitFor(() => expect(api.testAiProviderConnection).toHaveBeenCalledWith('openai'));
  await waitFor(() => expect(openaiInput.value).toBe(''));
  expect(screen.getByText('Verified')).toBeTruthy();

  // Close settings and verify grouped Model Selector in top-left navigation
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }));
  expect(screen.getByText('Anthropic')).toBeTruthy();
  expect(screen.getByText('OpenAI')).toBeTruthy();
  expect(screen.getByText('Google Gemini')).toBeTruthy();
  expect(screen.getByRole('option', { name: /GPT-4\.1 Mini/i })).toBeTruthy();
  expect(screen.getByRole('option', { name: /Claude Sonnet 4\.5/i })).toBeTruthy();
  expect(screen.getByRole('option', { name: /Gemini 2\.5 Flash-Lite/i })).toBeTruthy();

  // Switch to GPT-4.1 under OpenAI
  fireEvent.click(screen.getByRole('option', { name: /GPT-4\.1\s*gpt-4\.1/i }));
  await waitFor(() => expect(api.setActiveAiProvider).toHaveBeenCalledWith('openai'));
});

test('deduplicates repeated runtime-not-installed error notifications when loading chat or embed models', async () => {
  vi.mocked(api.getLocalRuntimeStatus).mockResolvedValue({
    installed: false,
    binaryPath: null,
    running: false,
    port: null,
    baseUrl: null,
    loadedModel: null,
    loadedModelPath: null,
    embeddingRunning: false,
    embeddingPort: null,
    embeddingModel: null,
    detectedBackend: 'cpu',
    platformSummary: 'linux-x86_64 (cpu)',
    version: null,
  });

  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Local AI & GGUF' }));

  const loadChatBtn = await screen.findByRole('button', { name: /Load Chat/i });
  const loadEmbedBtn = screen.getByRole('button', { name: /Load Embed/i });

  // Click repeatedly without runtime installed
  fireEvent.click(loadChatBtn);
  fireEvent.click(loadChatBtn);
  fireEvent.click(loadEmbedBtn);
  fireEvent.click(loadEmbedBtn);

  const notifications = await screen.findAllByText(/Built-in llama-server runtime is not installed yet/i);
  expect(notifications).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Install Runtime' }).length).toBeGreaterThanOrEqual(1);
});

test('1-click local model download redirects to workspace, auto-installs runtime, loads model, and supports live Test Model', async () => {
  vi.mocked(api.getLocalRuntimeStatus)
    .mockResolvedValueOnce({
      installed: false,
      binaryPath: null,
      running: false,
      port: null,
      baseUrl: null,
      loadedModel: null,
      loadedModelPath: null,
      embeddingRunning: false,
      embeddingPort: null,
      embeddingModel: null,
      detectedBackend: 'cpu',
      platformSummary: 'linux-x86_64 (cpu)',
      version: null,
    })
    .mockResolvedValueOnce({
      installed: false,
      binaryPath: null,
      running: false,
      port: null,
      baseUrl: null,
      loadedModel: null,
      loadedModelPath: null,
      embeddingRunning: false,
      embeddingPort: null,
      embeddingModel: null,
      detectedBackend: 'cpu',
      platformSummary: 'linux-x86_64 (cpu)',
      version: null,
    })
    .mockResolvedValue({
      installed: true,
      binaryPath: '/app-data/runtime/llama-server',
      running: true,
      port: 18080,
      baseUrl: 'http://127.0.0.1:18080/v1',
      loadedModel: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
      loadedModelPath: '/app-data/models/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
      embeddingRunning: false,
      embeddingPort: null,
      embeddingModel: null,
      detectedBackend: 'cpu',
      platformSummary: 'linux-x86_64 (cpu)',
      version: 'b5000',
    });

  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Local AI & GGUF' }));

  const downloadButtons = await screen.findAllByRole('button', { name: /Download & Run/i });
  fireEvent.click(downloadButtons[0]);

  // Redirected immediately back to workspace (Settings closed) with no path dialog
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull());

  // Automatically downloaded model, installed runtime, and connected model
  await waitFor(() => expect(api.downloadModel).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(api.installLocalRuntime).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(api.connectModel).toHaveBeenCalledTimes(1));

  // Test Model button is immediately available on the setup banner and returns live reply
  const testBtn = await screen.findByRole('button', { name: /Test Model/i });
  fireEvent.click(testBtn);
  await waitFor(() => expect(api.testLocalModel).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/Local model is ready!/i)).toBeTruthy();
});
