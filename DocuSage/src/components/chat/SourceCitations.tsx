import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useUiStore } from '../../stores/useUiStore';
import type { ContextCitation } from '../../types';

export const SourceCitations: React.FC<{ citations: ContextCitation[] }> = ({ citations }) => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const [open, setOpen] = useState(false);

  if (!citations || citations.length === 0) return null;

  return (
    <div className={`mt-2.5 pt-2 border-t ${theme.border}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 text-[11.5px] font-medium hover:underline transition-colors ${theme.accentText}`}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span>
          {citations.length} retrieved source{citations.length === 1 ? '' : 's'}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {citations.map((c, idx) => (
            <div
              key={`${c.sourcePath}-${c.chunkIndex}-${idx}`}
              className={`rounded-lg p-2.5 border text-[12px] ${theme.subtleBg} ${theme.border}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="inline-flex items-center gap-1.5 font-medium truncate">
                  <FileText className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`} />
                  <span className="truncate">{c.documentName}</span>
                  <span className={`text-[10.5px] ${theme.textMuted}`}>#{c.chunkIndex + 1}</span>
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${theme.badgeBg}`}>
                    {c.matchSource}
                  </span>
                  <span className={`text-[10.5px] font-mono ${theme.accentText}`}>
                    {c.score.toFixed(3)}
                  </span>
                </div>
              </div>
              <p className={`text-[11.5px] line-clamp-3 leading-relaxed ${theme.textMuted}`}>{c.snippet}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
