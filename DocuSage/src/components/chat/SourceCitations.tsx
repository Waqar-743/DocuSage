import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import type { ContextCitation } from '../../types';

export const SourceCitations: React.FC<{ citations: ContextCitation[] }> = ({ citations }) => {
  const [open, setOpen] = useState(false);

  if (!citations || citations.length === 0) return null;

  return (
    <div className="mt-2.5 pt-2 border-t border-zinc-700/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
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
              className="rounded-lg p-2.5 bg-black/20 border border-zinc-700/50 text-[12px]"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="inline-flex items-center gap-1.5 font-medium truncate">
                  <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">{c.documentName}</span>
                  <span className="text-[10.5px] opacity-60">#{c.chunkIndex + 1}</span>
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide bg-zinc-800 text-zinc-300">
                    {c.matchSource}
                  </span>
                  <span className="text-[10.5px] font-mono text-emerald-400">
                    {c.score.toFixed(3)}
                  </span>
                </div>
              </div>
              <p className="text-[11.5px] opacity-80 line-clamp-3 leading-relaxed">{c.snippet}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
