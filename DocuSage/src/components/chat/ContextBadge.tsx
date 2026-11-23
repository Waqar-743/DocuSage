import React from 'react';
import { Database, FileText, Layers, Sparkles, Zap } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useUiStore } from '../../stores/useUiStore';
import type { ContextMode, ContextTelemetry } from '../../types';

const MODE_META: Record<ContextMode, { label: string; darkColor: string; lightColor: string; icon: React.ReactNode }> = {
  none: {
    label: 'Direct',
    darkColor: 'bg-zinc-500/20 text-zinc-200 border-zinc-500/40',
    lightColor: 'bg-zinc-100 text-zinc-700 border-zinc-300',
    icon: <Zap className="w-3 h-3" />,
  },
  full: {
    label: 'Full Context',
    darkColor: 'bg-sky-500/20 text-sky-200 border-sky-400/45',
    lightColor: 'bg-sky-50 text-sky-800 border-sky-300',
    icon: <FileText className="w-3 h-3" />,
  },
  hybridRag: {
    label: 'Hybrid RAG',
    darkColor: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/45',
    lightColor: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    icon: <Sparkles className="w-3 h-3" />,
  },
  fts5Offline: {
    label: 'FTS5 Offline',
    darkColor: 'bg-violet-500/20 text-violet-200 border-violet-400/45',
    lightColor: 'bg-violet-50 text-violet-800 border-violet-300',
    icon: <Database className="w-3 h-3" />,
  },
  truncated: {
    label: 'Truncated',
    darkColor: 'bg-amber-500/20 text-amber-200 border-amber-400/45',
    lightColor: 'bg-amber-50 text-amber-800 border-amber-300',
    icon: <Layers className="w-3 h-3" />,
  },
};

export const ContextBadge: React.FC<{ telemetry?: ContextTelemetry | null; compact?: boolean; onClick?: () => void }> = ({
  telemetry,
  compact = false,
  onClick,
}) => {
  const isDark = useUiStore((s) => THEMES[s.theme].isDark);

  if (!telemetry || telemetry.mode === 'none') return null;
  const meta = MODE_META[telemetry.mode];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-opacity hover:opacity-90 ${
        isDark ? meta.darkColor : meta.lightColor
      }`}
      title={`${meta.label} · ~${telemetry.estimatedTokens.toLocaleString()} tokens across ${telemetry.documentCount} doc(s)`}
    >
      {meta.icon}
      <span>{meta.label}</span>
      {!compact && (
        <span className="opacity-80">
          · ~{telemetry.estimatedTokens.toLocaleString()} tok
        </span>
      )}
    </button>
  );
};
