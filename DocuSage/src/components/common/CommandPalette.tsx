import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Columns2,
  Cpu,
  Database,
  Keyboard,
  Maximize2,
  MessageSquare,
  Minimize2,
  Palette,
  Plus,
  Search,
  Settings,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { APPEARANCE_OPTIONS, THEMES } from '../../lib/themes';
import { useChatStore } from '../../stores/useChatStore';
import { useProviderStore } from '../../stores/useProviderStore';
import { useUiStore } from '../../stores/useUiStore';

type PaletteAction = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
};

export const CommandPalette: React.FC = () => {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const theme = useUiStore((s) => THEMES[s.theme]);
  const setTheme = useUiStore((s) => s.setTheme);
  const windowMode = useUiStore((s) => s.windowMode);
  const toggleWindowMode = useUiStore((s) => s.toggleWindowMode);
  const openSettings = useUiStore((s) => s.openSettings);
  const setCompareOpen = useUiStore((s) => s.setCompareOpen);
  const setRagDebugOpen = useUiStore((s) => s.setRagDebugOpen);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);

  const chats = useChatStore((s) => s.chats);
  const createChat = useChatStore((s) => s.createChat);
  const setActiveChat = useChatStore((s) => s.setActiveChat);

  const providers = useProviderStore((s) => s.providers);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [
      {
        id: 'new-chat',
        group: 'Actions',
        label: 'New Chat',
        hint: 'Ctrl+N',
        icon: <Plus className="w-4 h-4 text-emerald-400" />,
        run: () => createChat(),
      },
      {
        id: 'toggle-mode',
        group: 'Window',
        label: windowMode === 'spotlight' ? 'Expand to Dashboard' : 'Collapse to Spotlight',
        hint: 'Double-click header',
        icon: windowMode === 'spotlight' ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />,
        run: () => void toggleWindowMode(),
      },
      {
        id: 'compare',
        group: 'Workflows',
        label: 'Open Model Compare (Side-by-Side)',
        hint: '2–4 models',
        icon: <Columns2 className="w-4 h-4 text-sky-400" />,
        run: () => setCompareOpen(true),
      },
      {
        id: 'rag-debug',
        group: 'Workflows',
        label: 'Toggle Smart Context & RAG Inspector',
        icon: <Database className="w-4 h-4 text-violet-400" />,
        run: () => setRagDebugOpen(true),
      },
      {
        id: 'offline-local',
        group: 'Models',
        label: 'Switch to Offline Built-in Local AI (GGUF)',
        icon: <WifiOff className="w-4 h-4 text-emerald-400" />,
        run: () => void setActiveProvider('local'),
      },
      {
        id: 'settings-local',
        group: 'Settings',
        label: 'Manage Local GGUF Runtime & Models',
        icon: <Cpu className="w-4 h-4" />,
        run: () => openSettings('localRuntime'),
      },
      {
        id: 'settings-providers',
        group: 'Settings',
        label: 'Configure Cloud & Ollama Providers',
        icon: <Settings className="w-4 h-4" />,
        run: () => openSettings('providers'),
      },
      {
        id: 'shortcuts',
        group: 'Help',
        label: 'Keyboard Shortcuts',
        hint: 'Ctrl+/',
        icon: <Keyboard className="w-4 h-4" />,
        run: () => setShortcutsOpen(true),
      },
    ];

    for (const p of providers.filter((x) => x.enabled && x.id !== 'local')) {
      list.push({
        id: `provider-${p.id}`,
        group: 'Models',
        label: `Switch provider → ${p.name}`,
        hint: p.model ?? undefined,
        icon: <Sparkles className="w-4 h-4 text-sky-400" />,
        run: () => void setActiveProvider(p.id),
      });
    }

    for (const opt of APPEARANCE_OPTIONS) {
      list.push({
        id: `theme-${opt.key}`,
        group: 'Themes',
        label: `Switch Theme → ${opt.label}`,
        hint: opt.description,
        icon: <Palette className={`w-4 h-4 ${theme.accentText}`} />,
        run: () => setTheme(opt.key),
      });
    }

    for (const c of chats.slice(0, 12)) {
      list.push({
        id: `chat-${c.id}`,
        group: 'Chats',
        label: c.name,
        hint: c.attachedDocPaths.length > 0 ? `${c.attachedDocPaths.length} doc(s)` : undefined,
        icon: <MessageSquare className="w-4 h-4 opacity-70" />,
        run: () => setActiveChat(c.id),
      });
    }

    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q) ||
        (item.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [
    chats,
    createChat,
    openSettings,
    providers,
    query,
    setActiveChat,
    setActiveProvider,
    setCompareOpen,
    setRagDebugOpen,
    setShortcutsOpen,
    setTheme,
    theme.accentText,
    toggleWindowMode,
    windowMode,
  ]);

  if (!open) return null;

  const execute = (action: PaletteAction | undefined) => {
    if (!action) return;
    setOpen(false);
    action.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-start justify-center pt-[14vh] px-4"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label="Command Palette"
    >
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${theme.surfaceElevated} ${theme.border} ${theme.text}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center gap-2.5 px-4 py-3 border-b ${theme.border}`}>
          <Search className="w-4 h-4 opacity-70 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(i + 1, Math.max(0, actions.length - 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                execute(actions[selectedIdx]);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder="Type a command, switch models or themes, or jump to a chat…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <kbd className={`text-[10px] px-1.5 py-0.5 rounded ${theme.badgeBg}`}>ESC</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {actions.length === 0 ? (
            <div className={`py-8 text-center text-xs ${theme.textMuted}`}>No matching commands or chats.</div>
          ) : (
            actions.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => execute(item)}
                onMouseEnter={() => setSelectedIdx(idx)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left text-xs transition-colors border ${
                  idx === selectedIdx ? theme.accentSoft : `border-transparent ${theme.hoverBg}`
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {item.icon}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{item.label}</div>
                    <div className={`text-[10.5px] ${theme.textMuted}`}>{item.group}</div>
                  </div>
                </div>
                {item.hint && (
                  <span className={`text-[10.5px] shrink-0 ${theme.textMuted}`}>{item.hint}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
