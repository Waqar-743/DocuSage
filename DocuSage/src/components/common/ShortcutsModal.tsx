import React from 'react';
import { Keyboard, X } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useUiStore } from '../../stores/useUiStore';

const SHORTCUTS = [
  { keys: 'Alt + Space', desc: 'Summon / hide Spotlight at cursor (configurable)' },
  { keys: 'Ctrl + K', desc: 'Open Command Palette (switch models, search chats, actions)' },
  { keys: 'Ctrl + Shift + V', desc: 'Quote clipboard directly into prompt composer' },
  { keys: 'Ctrl + N', desc: 'Start a new conversation' },
  { keys: 'Ctrl + /', desc: 'Show keyboard shortcuts' },
  { keys: 'Enter / Shift + Enter', desc: 'Send message / insert newline' },
  { keys: 'Double-click Header', desc: 'Toggle Spotlight ↔ Dashboard mode' },
  { keys: 'Escape', desc: 'Close active modal or hide Spotlight' },
];

export const ShortcutsModal: React.FC = () => {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  const theme = useUiStore((s) => THEMES[s.theme]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label="Keyboard Shortcuts"
    >
      <div
        className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${theme.surfaceElevated} ${theme.border}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-4 py-3 border-b ${theme.border}`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Keyboard className="w-4 h-4 text-emerald-400" />
            <span>Keyboard Shortcuts</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close shortcuts"
            className="p-1 rounded-lg hover:bg-zinc-500/15"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-3 text-xs py-1">
              <span className={theme.textMuted}>{s.desc}</span>
              <kbd className={`px-2 py-0.5 rounded-md border font-mono text-[11px] shrink-0 ${theme.surfaceBg} ${theme.border}`}>
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
