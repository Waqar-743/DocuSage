import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import * as api from './lib/api';
import { open } from '@tauri-apps/plugin-dialog';
import userEvent from '@testing-library/user-event';

const events = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name, callback) => {
  events.set(name, callback);
  return () => { events.delete(name); };
}) }));
vi.mock('./lib/api', async original => {
  const real = await original<typeof api>();
  return { ...real, isTauri: () => true,
    listDownloadedModels: vi.fn(async () => [{ filename: 'test.gguf', path: '/tmp/test.gguf', sizeBytes: 100 }]),
    listAiProviderConfigs: vi.fn(async () => ({ activeProviderId: 'local', secureStorageAvailable: true,
      providers: [{ id: 'local', name: 'Local', provider: 'local', enabled: true, model: null }] })),
    getAssistantStatus: vi.fn(async () => ({ isVisible: true, settings: { ...real.ASSISTANT_SETTINGS_DEFAULTS, windowMode: 'full' }, platform: {} })),
    listIndexedDocuments: vi.fn(async () => []),
    getRagConfig: vi.fn(async () => real.RAG_CONFIG_DEFAULTS),
    loadModel: vi.fn(async () => 'Model ready'), getConnectedModel: vi.fn(async () => 'test.gguf'),
    chatGeneral: vi.fn(), chatRag: vi.fn(), stopChat: vi.fn(async () => {}),
    hideAssistantWindow: vi.fn(async () => {}), deleteDocument: vi.fn(async () => {}),
    ingestDocument: vi.fn(), saveRagConfig: vi.fn(async () => {}),
  };
});

beforeEach(() => {
  vi.clearAllMocks(); events.clear(); localStorage.clear();
  localStorage.setItem('docusage:app-state:v1', JSON.stringify({
    mode: 'general', theme: 'dark', generalChats: [{ id: 'first', name: 'First chat', messages: [] }],
    selectedGeneralChatId: 'first', documents: [], drafts: {}, scrollPositions: {},
  }));
});

async function ready() {
  render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ready' })).toBeTruthy());
}

test('a streamed reply stays in its originating chat when the user switches sessions', async () => {
  let finish!: (reply: string) => void;
  vi.mocked(api.chatGeneral).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await ready();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Explain my notes' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(api.chatGeneral).toHaveBeenCalledTimes(1));
  const requestId = vi.mocked(api.chatGeneral).mock.calls[0][2];
  fireEvent.click(screen.getByRole('button', { name: 'New Chat' }));
  await act(async () => {
    events.get('chat-token')?.({ payload: { requestId, token: 'A partial answer', done: false } });
    finish('A complete answer');
  });
  expect(screen.queryByText('A complete answer')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'First chat' }));
  expect(screen.getByText('A complete answer')).toBeTruthy();
});

test('Escape closes settings while leaving the assistant visible', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.hideAssistantWindow).not.toHaveBeenCalled();
});

test('documents absent from the actual index cannot be queried', async () => {
  const stored = JSON.parse(localStorage.getItem('docusage:app-state:v1')!);
  localStorage.setItem('docusage:app-state:v1', JSON.stringify({ ...stored, mode: 'rag', selectedDocId: 'missing',
    documents: [{ id: 'missing', name: 'missing.pdf', path: '/tmp/missing.pdf', status: 'ready', messages: [] }] }));
  await ready();
  expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).disabled).toBe(true);
  expect(api.chatRag).not.toHaveBeenCalled();
});

test('an interrupted empty response is restored with a useful explanation', async () => {
  const stored = JSON.parse(localStorage.getItem('docusage:app-state:v1')!);
  stored.generalChats[0].messages = [{ id: 'interrupted', sender: 'bot', text: '', isStreaming: true }];
  localStorage.setItem('docusage:app-state:v1', JSON.stringify(stored));
  await ready();
  expect(screen.getByText('Response interrupted when the app closed. Send your question again.')).toBeTruthy();
});

test('rapid sends create only one backend request', async () => {
  vi.mocked(api.chatGeneral).mockImplementation(() => new Promise(() => {}));
  await ready();
  const message = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(message, { target: { value: 'One question' } });
  fireEvent.keyDown(message, { key: 'Enter' });
  fireEvent.keyDown(message, { key: 'Enter' });
  await waitFor(() => expect(api.chatGeneral).toHaveBeenCalledTimes(1));
});

test('a missing saved chat selection falls back to an existing conversation', async () => {
  const stored = JSON.parse(localStorage.getItem('docusage:app-state:v1')!);
  stored.selectedGeneralChatId = 'deleted-chat';
  localStorage.setItem('docusage:app-state:v1', JSON.stringify(stored));
  vi.mocked(api.chatGeneral).mockResolvedValue('Saved in the right chat');
  await ready();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(await screen.findByText('Saved in the right chat')).toBeTruthy();
});

test('RAG reset reports a storage failure instead of claiming success', async () => {
  vi.mocked(api.saveRagConfig).mockRejectedValueOnce('Disk full');
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'RAG Tuning' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(await screen.findByText('Failed to reset RAG settings: Disk full')).toBeTruthy();
  expect(screen.queryByText('Reset to defaults')).toBeNull();
});

test('reimporting a Windows canonical path keeps one document and its conversation', async () => {
  const path = '\\\\?\\C:\\Notes\\guide.pdf';
  vi.mocked(api.listIndexedDocuments).mockResolvedValueOnce([{ path, chunkCount: 1 }]);
  vi.mocked(open).mockResolvedValueOnce('C:\\Notes\\guide.pdf');
  vi.mocked(api.ingestDocument).mockResolvedValueOnce({ sourcePath: path, fileName: 'guide.pdf', chunkCount: 2, charCount: 1000 });
  const stored = JSON.parse(localStorage.getItem('docusage:app-state:v1')!);
  stored.documents = [{ id: 'guide', name: 'guide.pdf', path, status: 'ready', messages: [{ id: 'answer', sender: 'bot', text: 'Earlier document answer' }] }];
  localStorage.setItem('docusage:app-state:v1', JSON.stringify(stored));
  await ready();
  fireEvent.click(screen.getAllByRole('button', { name: 'Ingest PDF' })[0]);
  expect(await screen.findByText('Earlier document answer')).toBeTruthy();
  await waitFor(() => expect(api.ingestDocument).toHaveBeenCalledTimes(1));
  expect(screen.getAllByRole('button', { name: 'guide.pdf' })).toHaveLength(1);
});

test('an indexed document can be removed with the keyboard', async () => {
  vi.mocked(api.listIndexedDocuments).mockResolvedValueOnce([{ path: '/tmp/guide.pdf', chunkCount: 1 }]);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Docs' }));
  fireEvent.click(screen.getByRole('button', { name: 'guide.pdf' }));
  const remove = screen.getByRole('button', { name: 'Delete document guide.pdf' });
  remove.focus();
  await userEvent.setup().keyboard('{Enter}');
  await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith('/tmp/guide.pdf'));
  expect(screen.queryByRole('button', { name: 'guide.pdf' })).toBeNull();
});
