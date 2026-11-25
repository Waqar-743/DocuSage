import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as api from './lib/api';
import { THEMES } from './lib/themes';
import { CommandPalette } from './components/common/CommandPalette';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ModelCompare } from './components/common/ModelCompare';
import { ShortcutsModal } from './components/common/ShortcutsModal';
import { ToastStack } from './components/common/ToastStack';
import { DashboardView } from './components/dashboard/DashboardView';
import { SettingsModal } from './components/settings/SettingsModal';
import { SpotlightView } from './components/spotlight/SpotlightView';
import { useChatStore } from './stores/useChatStore';
import { useDocumentStore } from './stores/useDocumentStore';
import { useProviderStore } from './stores/useProviderStore';
import { useUiStore } from './stores/useUiStore';
import type {
  AssistantWindowMode,
  ContextTelemetry,
  DownloadProgress,
  RuntimeDownloadProgress,
} from './types';
import './App.css';

export default function App() {
  const themeKey = useUiStore((s) => s.theme);
  const theme = THEMES[themeKey];
  const appOpacity = useUiStore((s) => s.appOpacity);
  const adjustAppOpacity = useUiStore((s) => s.adjustAppOpacity);
  const windowMode = useUiStore((s) => s.windowMode);
  const setWindowMode = useUiStore((s) => s.setWindowMode);
  const hydrateAssistant = useUiStore((s) => s.hydrateAssistant);
  const openSettings = useUiStore((s) => s.openSettings);
  const closeSettings = useUiStore((s) => s.closeSettings);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const setCompareOpen = useUiStore((s) => s.setCompareOpen);
  const setDraggingFiles = useUiStore((s) => s.setDraggingFiles);
  const pushToast = useUiStore((s) => s.pushToast);

  const hydrateProviders = useProviderStore((s) => s.hydrateProviders);
  const updateDownloadProgress = useProviderStore((s) => s.updateDownloadProgress);
  const updateRuntimeProgress = useProviderStore((s) => s.updateRuntimeProgress);
  const restartLocalEngine = useProviderStore((s) => s.restartLocalEngine);

  const hydrateDocuments = useDocumentStore((s) => s.hydrateDocuments);
  const ingestFile = useDocumentStore((s) => s.ingestFile);

  const handleStreamToken = useChatStore((s) => s.handleStreamToken);
  const handleStreamContext = useChatStore((s) => s.handleStreamContext);
  const createChat = useChatStore((s) => s.createChat);
  const attachDocToChat = useChatStore((s) => s.attachDocToChat);
  const appendQuoteToActiveDraft = useChatStore((s) => s.appendQuoteToActiveDraft);

  const [focusSignal, setFocusSignal] = useState(0);

  // Sync active theme attribute & OS color-scheme for scrollbars/native controls
  useEffect(() => {
    document.documentElement.dataset.theme = themeKey;
    document.documentElement.style.colorScheme = theme.isDark ? 'dark' : 'light';
  }, [themeKey, theme.isDark]);

  // Initial backend hydration
  useEffect(() => {
    void Promise.all([hydrateAssistant(), hydrateProviders(), hydrateDocuments()]);
  }, [hydrateAssistant, hydrateDocuments, hydrateProviders]);

  // Native Tauri IPC event listeners (streaming, context telemetry, downloads, drag-drop, tray)
  useEffect(() => {
    if (!api.isTauri()) return;
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    const bind = async () => {
      const pairs: Promise<UnlistenFn>[] = [
        listen<{ requestId: string; token: string; done: boolean }>('chat-token', (e) => {
          handleStreamToken(e.payload.requestId, e.payload.token, e.payload.done);
        }),
        listen<ContextTelemetry>('chat-context', (e) => {
          handleStreamContext(e.payload);
        }),
        listen<DownloadProgress>('download-progress', (e) => {
          updateDownloadProgress(e.payload);
        }),
        listen<RuntimeDownloadProgress>('runtime-download-progress', (e) => {
          updateRuntimeProgress(e.payload);
        }),
        listen<AssistantWindowMode>('assistant-window-mode', (e) => {
          void setWindowMode(e.payload, false);
        }),
        listen('assistant-focus-prompt', () => {
          setFocusSignal((n) => n + 1);
        }),
        listen('assistant-open-settings', () => {
          openSettings();
        }),
        listen('assistant-restart-ai-engine', () => {
          void restartLocalEngine();
        }),
        listen<{ message: string }>('assistant-shortcut-error', (e) => {
          pushToast('error', e.payload.message);
        }),
        listen('tauri://drag-enter', () => setDraggingFiles(true)),
        listen('tauri://drag-leave', () => setDraggingFiles(false)),
        listen<{ paths?: string[] }>('tauri://drag-drop', async (e) => {
          setDraggingFiles(false);
          const paths = e.payload?.paths ?? [];
          if (paths.length === 0) return;
          const activeChatId = useChatStore.getState().getActiveChat().id;
          for (const p of paths) {
            const doc = await ingestFile(p);
            if (doc) attachDocToChat(activeChatId, doc.path);
          }
        }),
      ];

      const resolved = await Promise.all(pairs);
      if (disposed) {
        resolved.forEach((fn) => fn());
      } else {
        unlisteners.push(...resolved);
      }
    };

    void bind();
    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [
    attachDocToChat,
    handleStreamContext,
    handleStreamToken,
    ingestFile,
    openSettings,
    pushToast,
    restartLocalEngine,
    setDraggingFiles,
    setWindowMode,
    updateDownloadProgress,
    updateRuntimeProgress,
  ]);

  // Global keyboard workflows (Ctrl+K, Ctrl+/, Ctrl+Shift+V, Ctrl+N, Shift++/Shift+-, Escape)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const isEditable = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable),
      );

      if (e.shiftKey && (!isEditable || mod)) {
        const isIncreaseOpacity =
          e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd';
        const isDecreaseOpacity =
          e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract';

        if (isIncreaseOpacity || isDecreaseOpacity) {
          e.preventDefault();
          const next = adjustAppOpacity(isIncreaseOpacity ? 0.1 : -0.1);
          const pct = Math.round(next * 100);
          pushToast('info', `Window opacity: ${pct}% (Shift + / Shift -)`, {
            dedupeKey: 'app-opacity',
            durationMs: 1800,
          });
          return;
        }
      }

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!useUiStore.getState().commandPaletteOpen);
        return;
      }

      if (mod && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen(!useUiStore.getState().shortcutsOpen);
        return;
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        void api
          .readClipboardText()
          .then((text) => {
            if (text.trim()) {
              appendQuoteToActiveDraft(text);
              setFocusSignal((n) => n + 1);
            } else {
              pushToast('info', 'Clipboard is empty.');
            }
          })
          .catch((err) => pushToast('error', String(err)));
        return;
      }

      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        createChat();
        setFocusSignal((n) => n + 1);
        return;
      }

      if (e.key === 'Escape') {
        const ui = useUiStore.getState();
        if (ui.commandPaletteOpen) {
          setCommandPaletteOpen(false);
          return;
        }
        if (ui.shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
        if (ui.compareOpen) {
          setCompareOpen(false);
          return;
        }
        if (ui.settingsOpen) {
          closeSettings();
          return;
        }
        if (ui.windowMode === 'spotlight' && api.isTauri()) {
          void api.hideAssistantWindow();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    adjustAppOpacity,
    appendQuoteToActiveDraft,
    closeSettings,
    createChat,
    pushToast,
    setCommandPaletteOpen,
    setCompareOpen,
    setShortcutsOpen,
  ]);

  const triggerFocusComposer = () => setFocusSignal((n) => n + 1);

  return (
    <ErrorBoundary>
      <div
        data-desktop-app
        style={{ opacity: appOpacity }}
        className={`h-screen w-screen overflow-hidden bg-transparent transition-opacity duration-150 ${theme.text}`}
      >
        {windowMode === 'spotlight' ? (
          <SpotlightView focusSignal={focusSignal} onFocusComposer={triggerFocusComposer} />
        ) : (
          <DashboardView focusSignal={focusSignal} onFocusComposer={triggerFocusComposer} />
        )}

        <CommandPalette />
        <ModelCompare />
        <ShortcutsModal />
        <SettingsModal />
        <ToastStack />
      </div>
    </ErrorBoundary>
  );
}
