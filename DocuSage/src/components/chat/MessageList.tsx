import React, { useEffect, useRef } from 'react';
import { Cloud, Cpu, FileUp } from 'lucide-react';
import docusageLogo from '../../assets/docusage-logo.png';
import { THEMES } from '../../lib/themes';
import { useProviderStore } from '../../stores/useProviderStore';
import { useUiStore } from '../../stores/useUiStore';
import type { ChatMessageItem } from '../../types';
import { MessageBubble } from './MessageBubble';

type Props = {
  messages: ChatMessageItem[];
  attachedCount: number;
  compact?: boolean;
  onBranch?: (messageId: string) => void;
  onQuickPrompt?: (text: string) => void;
  onAttachDocument?: () => void;
};

const QUICK_PROMPTS_GENERAL = [
  'Summarize key ideas from my clipboard',
  'Draft a clear project checklist from my notes',
  'Explain this topic in simple, practical steps',
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
  onAttachDocument,
}) => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const openSettings = useUiStore((s) => s.openSettings);
  const runtimeStatus = useProviderStore((s) => s.runtimeStatus);
  const providers = useProviderStore((s) => s.providers);
  const endRef = useRef<HTMLDivElement | null>(null);

  const hasCloudKey = providers.some((p) => p.provider !== 'local' && p.apiKeySet);
  const hasReadyModel = runtimeStatus.running || hasCloudKey;

  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length, messages[messages.length - 1]?.text]);

  if (messages.length === 0) {
    const prompts = attachedCount > 0 ? QUICK_PROMPTS_DOCS : QUICK_PROMPTS_GENERAL;
    return (
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-5 py-7 text-center">
        <img
          src={docusageLogo}
          alt="DocuSage"
          className="w-12 h-12 rounded-2xl object-contain mb-3"
        />
        <h2 className="text-base font-semibold tracking-tight">
          {attachedCount > 0
            ? `${attachedCount} document${attachedCount === 1 ? '' : 's'} ready for Q&A`
            : 'Ask anything — offline or online'}
        </h2>
        <p className={`text-xs mt-1 max-w-md ${theme.textMuted}`}>
          {attachedCount > 0
            ? 'Ask a question below to search your attached files privately with exact citations.'
            : 'Drop any PDF, Markdown, or code file here, or choose an offline or cloud model to start.'}
        </p>

        {/* Easy 1-click Quick Start cards for end users */}
        {!compact && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 w-full max-w-xl">
            <button
              type="button"
              onClick={() => openSettings('localRuntime')}
              className={`text-left p-3 rounded-xl border transition-colors ${theme.surfaceBg} ${
                !hasReadyModel ? theme.accentBorder : theme.border
              } ${theme.accentHoverBorder}`}
            >
              <div className="flex items-center gap-1.5 font-semibold text-xs">
                <Cpu className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`} />
                <span>Offline models</span>
              </div>
              <p className={`text-[11px] mt-1 leading-snug ${theme.textMuted}`}>
                1-click free models from 229 MB — runs privately with no internet.
              </p>
            </button>

            <button
              type="button"
              onClick={() => openSettings('providers')}
              className={`text-left p-3 rounded-xl border transition-colors ${theme.surfaceBg} ${theme.border} ${theme.accentHoverBorder}`}
            >
              <div className="flex items-center gap-1.5 font-semibold text-xs">
                <Cloud className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`} />
                <span>Cloud AI Keys</span>
              </div>
              <p className={`text-[11px] mt-1 leading-snug ${theme.textMuted}`}>
                Connect latest Gemini, ChatGPT, or Claude models in seconds.
              </p>
            </button>

            <button
              type="button"
              onClick={() => onAttachDocument?.()}
              className={`text-left p-3 rounded-xl border transition-colors ${theme.surfaceBg} ${theme.border} ${theme.accentHoverBorder}`}
            >
              <div className="flex items-center gap-1.5 font-semibold text-xs">
                <FileUp className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`} />
                <span>Add Document</span>
              </div>
              <p className={`text-[11px] mt-1 leading-snug ${theme.textMuted}`}>
                Attach PDFs, notes, or code — stays 100% on your computer.
              </p>
            </button>
          </div>
        )}

        <div className="mt-4 grid gap-2 w-full max-w-md">
          {prompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onQuickPrompt?.(p)}
              className={`text-left text-xs px-3.5 py-2.5 rounded-xl border transition-colors ${theme.surfaceBg} ${theme.border} ${theme.accentHoverBorder}`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className={`mt-4 inline-flex items-center gap-1.5 text-[11px] ${theme.textMuted}`}>
          <FileUp className="w-3.5 h-3.5" />
          <span>36 file formats supported · Press Shift + - / + to adjust transparency</span>
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
