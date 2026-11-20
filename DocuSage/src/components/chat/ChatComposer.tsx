import React, { useEffect, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { ClipboardPaste, FileText, Paperclip, Send, X } from 'lucide-react';
import * as api from '../../lib/api';
import { THEMES } from '../../lib/themes';
import { useChatStore } from '../../stores/useChatStore';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { useUiStore } from '../../stores/useUiStore';
import { StopButton } from './StopButton';

type Props = {
  compact?: boolean;
  focusSignal?: number;
};

export const ChatComposer: React.FC<Props> = ({ compact = false, focusSignal = 0 }) => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const pushToast = useUiStore((s) => s.pushToast);

  const activeChat = useChatStore((s) => s.getActiveChat());
  const draft = useChatStore((s) => s.drafts[activeChat.id] ?? '');
  const setDraft = useChatStore((s) => s.setDraft);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopActiveChatStream = useChatStore((s) => s.stopActiveChatStream);
  const isStreaming = useChatStore((s) => s.isChatStreaming(activeChat.id));
  const attachDocToChat = useChatStore((s) => s.attachDocToChat);
  const detachDocFromChat = useChatStore((s) => s.detachDocFromChat);
  const appendQuoteToActiveDraft = useChatStore((s) => s.appendQuoteToActiveDraft);

  const allowedExtensions = useDocumentStore((s) => s.allowedExtensions);
  const ingestFile = useDocumentStore((s) => s.ingestFile);
  const ingestingCount = useDocumentStore((s) => Object.keys(s.ingestingPaths).length);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [focusSignal, activeChat.id]);

  const handleSend = () => {
    if (!draft.trim() || isStreaming) return;
    void sendMessage(draft);
  };

  const handleAttachFile = async () => {
    await api.setAssistantFocusGuard({ dialogOpen: true });
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Supported Documents & Code',
            extensions: allowedExtensions,
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) {
        const doc = await ingestFile(p);
        if (doc) {
          attachDocToChat(activeChat.id, doc.path);
        }
      }
    } catch (err) {
      pushToast('error', `File picker failed: ${String(err)}`);
    } finally {
      await api.setAssistantFocusGuard({ dialogOpen: false });
    }
  };

  const handleClipboardQuote = async () => {
    try {
      const text = await api.readClipboardText();
      if (!text.trim()) {
        pushToast('info', 'Clipboard is empty.');
        return;
      }
      appendQuoteToActiveDraft(text);
      inputRef.current?.focus();
    } catch (err) {
      pushToast('error', `Clipboard read failed: ${String(err)}`);
    }
  };

  return (
    <div className={`border-t ${theme.border} ${compact ? 'p-2.5' : 'px-5 py-3.5'}`}>
      {/* Attached documents bar (Smart Context auto-activates whenever >=1 doc is attached) */}
      {activeChat.attachedDocPaths.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {activeChat.attachedDocPaths.map((docPath) => {
            const name = docPath.split(/[\\/]/).pop() ?? docPath;
            return (
              <span
                key={docPath}
                className={`inline-flex items-center gap-1.5 max-w-[200px] pl-2 pr-1 py-0.5 rounded-full text-[11px] border ${theme.accentSoft}`}
                title={docPath}
              >
                <FileText className="w-3 h-3 shrink-0" />
                <span className="truncate">{name}</span>
                <button
                  type="button"
                  onClick={() => detachDocFromChat(activeChat.id, docPath)}
                  aria-label={`Detach ${name}`}
                  className="p-0.5 rounded-full hover:bg-black/20"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className={`rounded-2xl border ${theme.border} ${theme.inputBg} p-2 flex flex-col gap-1.5`}>
        <textarea
          ref={inputRef}
          aria-label="Message"
          rows={compact ? 2 : 2}
          value={draft}
          onChange={(e) => setDraft(activeChat.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            activeChat.attachedDocPaths.length > 0
              ? 'Ask about your attached document(s)…'
              : 'Ask DocuSage… (Ctrl+K commands · Ctrl+Shift+V quote clipboard)'
          }
          className="w-full resize-none bg-transparent outline-none text-[13.5px] leading-relaxed px-1.5 py-0.5 max-h-40"
        />

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleAttachFile}
              disabled={ingestingCount > 0}
              aria-label="Attach document"
              title="Attach & index document (PDF, MD, TXT, code, config…)"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs hover:bg-zinc-500/15 transition-colors ${theme.textMuted}`}
            >
              <Paperclip className="w-3.5 h-3.5" />
              {!compact && <span>{ingestingCount > 0 ? 'Indexing…' : 'Attach'}</span>}
            </button>
            <button
              type="button"
              onClick={handleClipboardQuote}
              aria-label="Quote clipboard"
              title="Quote clipboard (Ctrl+Shift+V)"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs hover:bg-zinc-500/15 transition-colors ${theme.textMuted}`}
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              {!compact && <span>Quote</span>}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {isStreaming ? (
              <StopButton onStop={() => void stopActiveChatStream()} />
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!draft.trim()}
                aria-label="Send message"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${theme.accent}`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
