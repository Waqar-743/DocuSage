import React, { useEffect, useRef } from 'react';
import { FileUp, Sparkles } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useUiStore } from '../../stores/useUiStore';
import type { ChatMessageItem } from '../../types';
import { MessageBubble } from './MessageBubble';

type Props = {
  messages: ChatMessageItem[];
  attachedCount: number;
  compact?: boolean;
  onBranch?: (messageId: string) => void;
  onQuickPrompt?: (text: string) => void;
};

const QUICK_PROMPTS_GENERAL = [
  'Summarize key ideas from my clipboard',
  'Draft a concise technical Architecture Decision Record',
  'Compare local GGUF privacy vs cloud speed',
];

const QUICK_PROMPTS_DOCS = [
  'Summarize the attached document in 5 bullet points with citations',
  'Extract key dates, metrics, and action items',
  'What are the main risks or caveats mentioned?',
];

export const MessageList: React.FC<Props> = ({
  messages,
  attachedCount,
  compact = false,
  onBranch,
  onQuickPrompt,
}) => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length, messages[messages.length - 1]?.text]);

  if (messages.length === 0) {
    const prompts = attachedCount > 0 ? QUICK_PROMPTS_DOCS : QUICK_PROMPTS_GENERAL;
    return (
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-5 py-8 text-center">
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border mb-3 ${theme.accentSoft}`}>
          <Sparkles className="w-5 h-5" />
        </div>
        <h2 className="text-base font-semibold tracking-tight">
          {attachedCount > 0
            ? `${attachedCount} document${attachedCount === 1 ? '' : 's'} ready for Smart Context`
            : 'Ask anything — offline or online'}
        </h2>
        <p className={`text-xs mt-1 max-w-sm ${theme.textMuted}`}>
          {attachedCount > 0
            ? 'DocuSage automatically routes small files into Full Context and large files into Hybrid SQLite RAG.'
            : 'Drop PDF, Markdown, code, or config files anywhere to auto-index, or press Ctrl+Shift+V to quote clipboard.'}
        </p>

        <div className="mt-5 grid gap-2 w-full max-w-md">
          {prompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onQuickPrompt?.(p)}
              className={`text-left text-xs px-3.5 py-2.5 rounded-xl border transition-colors hover:border-emerald-500/50 ${theme.surfaceBg} ${theme.border}`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className={`mt-4 inline-flex items-center gap-1.5 text-[11px] ${theme.textMuted}`}>
          <FileUp className="w-3.5 h-3.5" />
          <span>36 file formats supported · 100% private local SQLite FTS5 + vectors</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto ${compact ? 'px-3 py-3 space-y-3' : 'px-5 py-4 space-y-4'}`}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} compact={compact} onBranch={onBranch} />
      ))}
      <div ref={endRef} />
    </div>
  );
};
