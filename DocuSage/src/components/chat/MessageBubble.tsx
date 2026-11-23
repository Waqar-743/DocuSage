import React, { useState } from 'react';
import { AlertCircle, Check, Copy, GitBranch } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useUiStore } from '../../stores/useUiStore';
import type { ChatMessageItem } from '../../types';
import { ContextBadge } from './ContextBadge';
import { Markdown } from './Markdown';
import { SourceCitations } from './SourceCitations';

type Props = {
  message: ChatMessageItem;
  compact?: boolean;
  onBranch?: (messageId: string) => void;
};

export const MessageBubble: React.FC<Props> = ({ message, compact = false, onBranch }) => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const setRagDebugOpen = useUiStore((s) => s.setRagDebugOpen);
  const [copied, setCopied] = useState(false);

  const isUser = message.sender === 'user';

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore
    }
  };

  return (
    <div className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`relative rounded-2xl px-3.5 py-2.5 ${
          compact ? 'max-w-[94%]' : 'max-w-[85%]'
        } ${
          message.isError
            ? theme.dangerSoft
            : isUser
            ? theme.userBubble
            : theme.botBubble
        }`}
      >
        {!isUser && (message.providerLabel || message.telemetry) && (
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            {message.providerLabel && (
              <span className={`text-[10.5px] font-medium ${theme.textMuted}`}>
                {message.providerLabel}
                {message.modelLabel ? ` · ${message.modelLabel}` : ''}
              </span>
            )}
            <ContextBadge
              telemetry={message.telemetry}
              compact={compact}
              onClick={() => setRagDebugOpen(true)}
            />
          </div>
        )}

        {message.isError ? (
          <div className="flex items-start gap-2 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="whitespace-pre-wrap">{message.text}</span>
          </div>
        ) : message.isStreaming && !message.text ? (
          <div className="flex items-center gap-1.5 py-1 text-xs opacity-70">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Thinking…</span>
          </div>
        ) : isUser ? (
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">
            {message.text}
          </p>
        ) : (
          <Markdown content={message.text} />
        )}

        {!isUser && message.telemetry && message.telemetry.citations.length > 0 && (
          <SourceCitations citations={message.telemetry.citations} />
        )}
      </div>

      {/* Hover action bar */}
      {!message.isStreaming && message.text && (
        <div className="flex items-center gap-1 mt-1 px-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={copyMessage}
            className={`p-1 rounded ${theme.hoverBg} ${theme.textMuted}`}
            title="Copy message"
            aria-label="Copy message"
          >
            {copied ? <Check className={`w-3.5 h-3.5 ${theme.accentText}`} /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {onBranch && (
            <button
              type="button"
              onClick={() => onBranch(message.id)}
              className={`p-1 rounded ${theme.hoverBg} ${theme.textMuted}`}
              title="Branch conversation from here"
              aria-label="Branch from message"
            >
              <GitBranch className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
