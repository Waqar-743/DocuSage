import React from 'react';
import {
  Command,
  FileUp,
  Maximize2,
  Pin,
  PinOff,
  Plus,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import * as api from '../../lib/api';
import { THEMES } from '../../lib/themes';
import { useChatStore } from '../../stores/useChatStore';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { useUiStore } from '../../stores/useUiStore';
import { ChatComposer } from '../chat/ChatComposer';
import { ContextBadge } from '../chat/ContextBadge';
import { MessageList } from '../chat/MessageList';
import { BranchSelector } from '../common/BranchSelector';
import { LocalSetupBanner } from '../common/LocalSetupBanner';
import { ModelSelector } from '../common/ModelSelector';

export const SpotlightView: React.FC<{
  focusSignal: number;
  onFocusComposer?: () => void;
}> = ({ focusSignal, onFocusComposer }) => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const isPinned = useUiStore((s) => s.isPinned);
  const setPinned = useUiStore((s) => s.setPinned);
  const toggleWindowMode = useUiStore((s) => s.toggleWindowMode);
  const openSettings = useUiStore((s) => s.openSettings);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const isDraggingFiles = useUiStore((s) => s.isDraggingFiles);

  const activeChat = useChatStore((s) => s.getActiveChat());
  const activeBranch = useChatStore((s) => s.getActiveBranch(activeChat));
  const createChat = useChatStore((s) => s.createChat);
  const deleteChat = useChatStore((s) => s.deleteChat);
  const branchFromMessage = useChatStore((s) => s.branchFromMessage);
  const sendMessage = useChatStore((s) => s.sendMessage);

  const latestTelemetry = useDocumentStore((s) => s.latestTelemetry);

  return (
    <div
      className={`relative h-full w-full flex flex-col overflow-hidden rounded-2xl border shadow-2xl ${theme.appBg} ${theme.border}`}
    >
      {/* Compact Draggable Spotlight Header (Double-click to expand to Dashboard) */}
      <header
        data-tauri-drag-region
        onDoubleClick={() => void toggleWindowMode()}
        className={`flex items-center justify-between gap-2 px-3 py-2 border-b select-none ${theme.sidebarBg} ${theme.border}`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <ModelSelector compact />
          <ContextBadge telemetry={latestTelemetry} compact />
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => createChat()}
            aria-label="New Chat"
            title="New Chat (Ctrl+N)"
            className={`p-1.5 rounded-lg ${theme.hoverBg}`}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => deleteChat(activeChat.id)}
            aria-label="Delete conversation"
            title="Delete current conversation"
            className={`p-1.5 rounded-lg hover:text-rose-400 ${theme.hoverBg}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="Command Palette"
            title="Command Palette (Ctrl+K)"
            className={`p-1.5 rounded-lg ${theme.hoverBg}`}
          >
            <Command className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void setPinned(!isPinned)}
            aria-label={isPinned ? 'Unpin Spotlight' : 'Pin Spotlight'}
            title={isPinned ? 'Pinned (stays open on blur)' : 'Pin Spotlight open'}
            className={`p-1.5 rounded-lg border transition-colors ${
              isPinned ? theme.accentSoft : `border-transparent ${theme.hoverBg}`
            }`}
          >
            {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => void toggleWindowMode()}
            aria-label="Expand to Dashboard"
            title="Expand to Dashboard (Double-click titlebar)"
            className={`p-1.5 rounded-lg ${theme.hoverBg}`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => openSettings()}
            aria-label="Settings"
            title="Settings"
            className={`p-1.5 rounded-lg ${theme.hoverBg}`}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void api.hideAssistantWindow()}
            aria-label="Hide Spotlight"
            title="Hide (Esc)"
            className={`p-1.5 rounded-lg ${theme.hoverBg}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <LocalSetupBanner compact onFocusComposer={onFocusComposer} />
      <BranchSelector />

      <MessageList
        messages={activeBranch.messages}
        attachedCount={activeChat.attachedDocPaths.length}
        compact
        onBranch={(msgId) => branchFromMessage(activeChat.id, msgId)}
        onQuickPrompt={(text) => void sendMessage(text)}
      />

      <ChatComposer compact focusSignal={focusSignal} />

      {/* Drag & drop overlay */}
      {isDraggingFiles && (
        <div className="absolute inset-0 z-40 bg-emerald-950/85 backdrop-blur-sm border-2 border-dashed border-emerald-400 rounded-2xl flex flex-col items-center justify-center gap-2 text-emerald-100 pointer-events-none">
          <FileUp className="w-8 h-8 text-emerald-400" />
          <div className="text-sm font-semibold">Drop files to attach & auto-index</div>
          <div className="text-[11px] opacity-80">PDF, Markdown, TXT, HTML, code & config</div>
        </div>
      )}
    </div>
  );
};
