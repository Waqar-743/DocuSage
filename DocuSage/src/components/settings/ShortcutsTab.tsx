import React, { useEffect, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import * as api from '../../lib/api';
import { THEMES } from '../../lib/themes';
import { useUiStore } from '../../stores/useUiStore';
import type { AssistantSettings } from '../../types';

export const ShortcutsTab: React.FC = () => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const settings = useUiStore((s) => s.assistantSettings);
  const autostartEnabled = useUiStore((s) => s.autostartEnabled);
  const saveAssistantSettings = useUiStore((s) => s.saveAssistantSettings);
  const setAutostart = useUiStore((s) => s.setAutostart);
  const pushToast = useUiStore((s) => s.pushToast);

  const [draft, setDraft] = useState<AssistantSettings>(settings);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleCheckUpdates = async () => {
    try {
      const msg = await api.checkForUpdates();
      setUpdateMsg(msg);
      pushToast('info', msg);
    } catch (err) {
      pushToast('error', String(err));
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h3 className="text-sm font-semibold">Spotlight Window, Shortcuts & Startup</h3>
        <p className={theme.textMuted}>
          Summon Spotlight at your cursor on any monitor, auto-hide on focus loss, and run quietly in the system tray.
        </p>
      </div>

      <label className={`block rounded-xl border p-3 space-y-1.5 ${theme.surfaceBg} ${theme.border}`}>
        <span className="font-medium">Global Summon Shortcut</span>
        <input
          value={draft.globalShortcut}
          onChange={(e) => setDraft({ ...draft, globalShortcut: e.target.value })}
          placeholder="Alt+Space"
          className={`w-full rounded-lg border px-2.5 py-1.5 font-mono ${theme.inputBg} ${theme.border}`}
        />
        <span className={`text-[10.5px] block ${theme.textMuted}`}>
          Examples: Alt+Space, Ctrl+Space, Ctrl+Shift+K
        </span>
      </label>

      <div className="space-y-2">
        <label className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${theme.surfaceBg} ${theme.border}`}>
          <div>
            <div className="font-medium">Start DocuSage at Login (--hidden)</div>
            <div className={`text-[11px] ${theme.textMuted}`}>
              Launch silently to the system tray using native OS autostart.
            </div>
          </div>
          <input
            type="checkbox"
            checked={autostartEnabled}
            onChange={(e) => void setAutostart(e.target.checked)}
            className="w-4 h-4 accent-emerald-500"
          />
        </label>

        <label className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${theme.surfaceBg} ${theme.border}`}>
          <div>
            <div className="font-medium">Auto-hide Spotlight on Focus Loss</div>
            <div className={`text-[11px] ${theme.textMuted}`}>
              Dismiss Spotlight when clicking outside (pauses automatically when Pinned, picking files, or editing Settings).
            </div>
          </div>
          <input
            type="checkbox"
            checked={draft.autoHideOnBlur}
            onChange={(e) => setDraft({ ...draft, autoHideOnBlur: e.target.checked })}
            className="w-4 h-4 accent-emerald-500"
          />
        </label>

        <label className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${theme.surfaceBg} ${theme.border}`}>
          <div>
            <div className="font-medium">Hide to Tray on Close</div>
            <div className={`text-[11px] ${theme.textMuted}`}>
              Keep DocuSage ready in the background when closing the window.
            </div>
          </div>
          <input
            type="checkbox"
            checked={draft.hideOnClose}
            onChange={(e) => setDraft({ ...draft, hideOnClose: e.target.checked })}
            className="w-4 h-4 accent-emerald-500"
          />
        </label>
      </div>

      {updateMsg && <p className="text-[11.5px] text-emerald-400">{updateMsg}</p>}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => void handleCheckUpdates()}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${theme.border}`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Check for Updates</span>
        </button>

        <button
          type="button"
          onClick={() => void saveAssistantSettings(draft)}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-medium ${theme.accent}`}
        >
          <Save className="w-3.5 h-3.5" />
          <span>Save Window Settings</span>
        </button>
      </div>
    </div>
  );
};
