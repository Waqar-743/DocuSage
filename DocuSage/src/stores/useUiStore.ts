import { create } from 'zustand';
import * as api from '../lib/api';
import { loadOrMigrateState, persistV2State } from '../lib/migration';
import type {
  AppearanceTheme,
  AssistantSettings,
  AssistantStatus,
  AssistantWindowMode,
  SettingsTab,
  SidebarTab,
  ToastItem,
} from '../types';

type UiState = {
  theme: AppearanceTheme;
  windowMode: AssistantWindowMode;
  isPinned: boolean;
  autostartEnabled: boolean;
  assistantSettings: AssistantSettings;
  platform: AssistantStatus['platform'];
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  sidebarTab: SidebarTab;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  commandPaletteOpen: boolean;
  shortcutsOpen: boolean;
  compareOpen: boolean;
  ragDebugOpen: boolean;
  isDraggingFiles: boolean;
  toasts: ToastItem[];

  hydrateAssistant: () => Promise<void>;
  setTheme: (theme: AppearanceTheme) => void;
  setWindowMode: (mode: AssistantWindowMode, syncBackend?: boolean) => Promise<void>;
  toggleWindowMode: () => Promise<void>;
  setPinned: (pinned: boolean) => Promise<void>;
  setAutostart: (enabled: boolean) => Promise<void>;
  saveAssistantSettings: (settings: AssistantSettings) => Promise<void>;
  setSidebarWidth: (width: number) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarTab: (tab: SidebarTab) => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setCompareOpen: (open: boolean) => void;
  setRagDebugOpen: (open: boolean) => void;
  setDraggingFiles: (dragging: boolean) => void;
  pushToast: (kind: ToastItem['kind'], message: string) => void;
  dismissToast: (id: string) => void;
};

const initial = loadOrMigrateState();

function persistUiPatch(patch: Partial<{ theme: AppearanceTheme; sidebarWidth: number; sidebarCollapsed: boolean }>) {
  const cur = loadOrMigrateState();
  persistV2State({ ...cur, ...patch });
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: initial.theme,
  windowMode: api.isTauri() ? 'spotlight' : 'dashboard',
  isPinned: false,
  autostartEnabled: false,
  assistantSettings: { ...api.ASSISTANT_SETTINGS_DEFAULTS },
  platform: {
    platform: 'desktop',
    startupHidden: '',
    taskbarHidden: '',
    altTabHidden: '',
    focusNotes: '',
  },
  sidebarWidth: initial.sidebarWidth,
  sidebarCollapsed: initial.sidebarCollapsed,
  sidebarTab: 'chats',
  settingsOpen: false,
  settingsTab: 'providers',
  commandPaletteOpen: false,
  shortcutsOpen: false,
  compareOpen: false,
  ragDebugOpen: false,
  isDraggingFiles: false,
  toasts: [],

  hydrateAssistant: async () => {
    try {
      const status = await api.getAssistantStatus();
      set({
        windowMode: status.settings.windowMode,
        isPinned: status.isPinned,
        autostartEnabled: status.autostartEnabled,
        assistantSettings: status.settings,
        platform: status.platform,
      });
    } catch {
      // Ignore in browser/test environments where assistant status is mocked minimally.
    }
  },

  setTheme: (theme) => {
    set({ theme });
    persistUiPatch({ theme });
  },

  setWindowMode: async (mode, syncBackend = true) => {
    set({ windowMode: mode });
    if (syncBackend) {
      try {
        await api.setAssistantWindowMode(mode);
      } catch (err) {
        get().pushToast('error', `Cannot switch window mode: ${String(err)}`);
      }
    }
  },

  toggleWindowMode: async () => {
    const next: AssistantWindowMode = get().windowMode === 'spotlight' ? 'dashboard' : 'spotlight';
    await get().setWindowMode(next, true);
  },

  setPinned: async (pinned) => {
    set({ isPinned: pinned });
    try {
      const result = await api.setAssistantPinned(pinned);
      set({ isPinned: result });
    } catch (err) {
      get().pushToast('error', `Failed to update pin state: ${String(err)}`);
    }
  },

  setAutostart: async (enabled) => {
    try {
      const actual = await api.setAutostartEnabled(enabled);
      set({ autostartEnabled: actual });
      get().pushToast('success', actual ? 'Autostart enabled (--hidden).' : 'Autostart disabled.');
    } catch (err) {
      get().pushToast('error', `Autostart error: ${String(err)}`);
    }
  },

  saveAssistantSettings: async (settings) => {
    try {
      const saved = await api.saveAssistantSettings(settings);
      set({ assistantSettings: saved, windowMode: saved.windowMode });
      get().pushToast('success', 'Shortcut & window settings saved.');
    } catch (err) {
      get().pushToast('error', `Failed to save settings: ${String(err)}`);
    }
  },

  setSidebarWidth: (width) => {
    const clamped = Math.min(420, Math.max(220, width));
    set({ sidebarWidth: clamped });
    persistUiPatch({ sidebarWidth: clamped });
  },

  toggleSidebarCollapsed: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    persistUiPatch({ sidebarCollapsed: next });
  },

  setSidebarTab: (sidebarTab) => set({ sidebarTab }),

  openSettings: (tab) => {
    set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab }));
    void api.setAssistantFocusGuard({ settingsOpen: true });
  },

  closeSettings: () => {
    set({ settingsOpen: false });
    void api.setAssistantFocusGuard({ settingsOpen: false });
  },

  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setCompareOpen: (compareOpen) => set({ compareOpen }),
  setRagDebugOpen: (ragDebugOpen) => set({ ragDebugOpen }),
  setDraggingFiles: (isDraggingFiles) => set({ isDraggingFiles }),

  pushToast: (kind, message) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4200);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
