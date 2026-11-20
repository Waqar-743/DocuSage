import React from 'react';
import { Database, FileText, Layers, Sparkles, Zap } from 'lucide-react';
import type { ContextMode, ContextTelemetry } from '../../types';

const MODE_META: Record<ContextMode, { label: string; color: string; icon: React.ReactNode }> = {
  none: {
    label: 'Direct',
    color: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    icon: <Zap className="w-3 h-3" />,
  },
  full: {
    label: 'Full Context',
    color: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    icon: <FileText className="w-3 h-3" />,
  },
  hybridRag: {
    label: 'Hybrid RAG',
    color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    icon: <Sparkles className="w-3 h-3" />,
  },
  fts5Offline: {
    label: 'FTS5 Offline',
    color: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    icon: <Database className="w-3 h-3" />,
  },
  truncated: {
    label: 'Truncated',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    icon: <Layers className="w-3 h-3" />,
  },
};

export const ContextBadge: React.FC<{ telemetry?: ContextTelemetry | null; compact?: boolean; onClick?: () => void }> = ({
  telemetry,
  compact = false,
  onClick,
}) => {
  if (!telemetry || telemetry.mode === 'none') return null;
  const meta = MODE_META[telemetry.mode];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-opacity hover:opacity-90 ${meta.color}`}
      title={`${meta.label} · ~${telemetry.estimatedTokens.toLocaleString()} tokens across ${telemetry.documentCount} doc(s)`}
    >
      {meta.icon}
      <span>{meta.label}</span>
      {!compact && (
        <span className="opacity-75">
          · ~{telemetry.estimatedTokens.toLocaleString()} tok
        </span>
      )}
    </button>
  );
};
