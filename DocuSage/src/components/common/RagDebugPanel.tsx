import React from 'react';
import { Database, FileText, X } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useDocumentStore } from '../../stores/useDocumentStore';
import { useUiStore } from '../../stores/useUiStore';
import { ContextBadge } from '../chat/ContextBadge';

export const RagDebugPanel: React.FC = () => {
  const open = useUiStore((s) => s.ragDebugOpen);
  const setOpen = useUiStore((s) => s.setRagDebugOpen);
  const theme = useUiStore((s) => THEMES[s.theme]);

  const latest = useDocumentStore((s) => s.latestTelemetry);
  const history = useDocumentStore((s) => s.telemetryHistory);

  if (!open) return null;

  return (
    <aside
      aria-label="Smart Context & RAG Inspector"
      className={`w-80 shrink-0 border-l flex flex-col overflow-hidden ${theme.sidebarBg} ${theme.border}`}
    >
      <div className={`px-4 py-3 border-b flex items-center justify-between ${theme.border}`}>
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Database className={`w-4 h-4 ${theme.accentText}`} />
          <span>Smart Context Inspector</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close RAG Inspector"
          className={`p-1 rounded ${theme.hoverBg}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-xs">
        {!latest ? (
          <div className={`py-10 text-center ${theme.textMuted}`}>
            Attach a document and send a message to inspect Smart Context routing, token estimates, and RRF scores.
          </div>
        ) : (
          <>
            <div className={`rounded-xl border p-3 space-y-2 ${theme.surfaceBg} ${theme.border}`}>
              <div className="flex items-center justify-between">
                <span className={theme.textMuted}>Active Mode</span>
                <ContextBadge telemetry={latest} />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                <div className={`rounded-lg p-2 border ${theme.subtleBg} ${theme.border}`}>
                  <div className={theme.textMuted}>Est. Tokens</div>
                  <div className="font-mono font-semibold mt-0.5">{latest.estimatedTokens.toLocaleString()}</div>
                </div>
                <div className={`rounded-lg p-2 border ${theme.subtleBg} ${theme.border}`}>
                  <div className={theme.textMuted}>Context Chars</div>
                  <div className="font-mono font-semibold mt-0.5">{latest.totalChars.toLocaleString()}</div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className={`text-[11px] font-semibold uppercase tracking-wider ${theme.textMuted}`}>
                Retrieved Excerpts ({latest.citations.length})
              </div>
              {latest.citations.length === 0 ? (
                <p className={theme.textMuted}>No excerpts retrieved for this turn.</p>
              ) : (
                latest.citations.map((c, idx) => (
                  <div
                    key={`${c.sourcePath}-${c.chunkIndex}-${idx}`}
                    className={`rounded-xl border p-2.5 space-y-1 ${theme.surfaceBg} ${theme.border}`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="inline-flex items-center gap-1 font-medium truncate">
                        <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="truncate">{c.documentName}</span>
                      </span>
                      <span className="font-mono text-[10.5px] text-emerald-400 shrink-0">
                        {c.score.toFixed(4)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] opacity-70">
                      <span>Chunk #{c.chunkIndex + 1}</span>
                      <span>·</span>
                      <span className="uppercase">{c.matchSource}</span>
                    </div>
                    <p className="text-[11px] opacity-80 leading-relaxed line-clamp-4">{c.snippet}</p>
                  </div>
                ))
              )}
            </div>

            {history.length > 1 && (
              <div className="space-y-1.5 pt-2 border-t border-zinc-800/60">
                <div className={`text-[11px] font-semibold uppercase tracking-wider ${theme.textMuted}`}>
                  Recent Turns ({history.length})
                </div>
                {history.slice(1, 6).map((item) => (
                  <div
                    key={item.requestId}
                    className="flex items-center justify-between text-[11px] py-1 opacity-75"
                  >
                    <span>{item.mode}</span>
                    <span className="font-mono">~{item.estimatedTokens} tok</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
