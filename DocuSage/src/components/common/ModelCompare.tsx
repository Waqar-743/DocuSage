import React, { useMemo, useState } from 'react';
import { Columns2, Play, Plus, Trash2, X } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useChatStore } from '../../stores/useChatStore';
import { useProviderStore } from '../../stores/useProviderStore';
import { useUiStore } from '../../stores/useUiStore';
import type { CompareTarget } from '../../types';
import { ContextBadge } from '../chat/ContextBadge';
import { Markdown } from '../chat/Markdown';
import { StopButton } from '../chat/StopButton';
import { LoadingDots } from './LoadingDots';

export const ModelCompare: React.FC = () => {
  const open = useUiStore((s) => s.compareOpen);
  const setOpen = useUiStore((s) => s.setCompareOpen);
  const theme = useUiStore((s) => THEMES[s.theme]);

  const providers = useProviderStore((s) => s.providers);
  const connectedModel = useProviderStore((s) => s.connectedModel);

  const compareResults = useChatStore((s) => s.compareResults);
  const runCompare = useChatStore((s) => s.runCompare);
  const stopCompare = useChatStore((s) => s.stopCompare);
  const activeChat = useChatStore((s) => s.getActiveChat());

  const enabledProviders = useMemo(() => providers.filter((p) => p.enabled), [providers]);

  const [prompt, setPrompt] = useState('');
  const [targets, setTargets] = useState<CompareTarget[]>(() => {
    const first = enabledProviders[0];
    const second = enabledProviders[1] ?? enabledProviders[0];
    return [
      {
        id: 't1',
        providerId: first?.id ?? 'local',
        providerName: first?.name ?? 'Built-in Local (GGUF)',
        model: first?.provider === 'local' ? connectedModel ?? 'local-gguf' : first?.model ?? '',
      },
      {
        id: 't2',
        providerId: second?.id ?? 'local',
        providerName: second?.name ?? 'Built-in Local (GGUF)',
        model: second?.provider === 'local' ? connectedModel ?? 'local-gguf' : second?.model ?? '',
      },
    ];
  });

  if (!open) return null;

  const isStreaming = compareResults.some((r) => r.isStreaming);

  const addTarget = () => {
    if (targets.length >= 4) return;
    const fallback = enabledProviders[targets.length % Math.max(1, enabledProviders.length)];
    setTargets([
      ...targets,
      {
        id: `t-${Date.now()}`,
        providerId: fallback?.id ?? 'local',
        providerName: fallback?.name ?? 'Built-in Local',
        model: fallback?.model ?? connectedModel ?? '',
      },
    ]);
  };

  const updateTarget = (idx: number, providerId: string) => {
    const p = enabledProviders.find((x) => x.id === providerId);
    if (!p) return;
    setTargets(
      targets.map((t, i) =>
        i === idx
          ? {
              ...t,
              providerId: p.id,
              providerName: p.name,
              model: p.provider === 'local' ? connectedModel ?? 'local-gguf' : p.model ?? '',
            }
          : t,
      ),
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-label="Model Compare"
    >
      <div className={`w-full max-w-6xl h-[86vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${theme.surfaceElevated} ${theme.border} ${theme.text}`}>
        <div className={`flex items-center justify-between px-5 py-3.5 border-b ${theme.border}`}>
          <div className="flex items-center gap-2.5">
            <Columns2 className={`w-4 h-4 ${theme.accentText}`} />
            <div>
              <h2 className="text-sm font-semibold">Side-by-Side Model Compare</h2>
              <p className={`text-[11px] ${theme.textMuted}`}>
                Stream the same prompt to 2–4 models concurrently
                {activeChat.attachedDocPaths.length > 0
                  ? ` · Using ${activeChat.attachedDocPaths.length} attached document(s)`
                  : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close Model Compare"
            className={`p-1.5 rounded-lg ${theme.hoverBg}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Target selectors & prompt input */}
        <div className={`p-4 border-b space-y-3 ${theme.border} ${theme.surfaceBg}`}>
          <div className="flex flex-wrap items-center gap-2">
            {targets.map((t, idx) => (
              <div
                key={t.id}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs ${theme.inputBg} ${theme.border}`}
              >
                <span className={`text-[10.5px] font-semibold ${theme.textMuted}`}>#{idx + 1}</span>
                <select
                  value={t.providerId}
                  onChange={(e) => updateTarget(idx, e.target.value)}
                  className="bg-transparent outline-none text-xs font-medium"
                >
                  {enabledProviders.map((p) => (
                    <option key={p.id} value={p.id} className={theme.selectOption}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  value={t.model}
                  onChange={(e) =>
                    setTargets(targets.map((x, i) => (i === idx ? { ...x, model: e.target.value } : x)))
                  }
                  placeholder="Model override"
                  className={`w-32 bg-transparent border-l pl-2 outline-none text-[11px] ${theme.border}`}
                />
                {targets.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setTargets(targets.filter((_, i) => i !== idx))}
                    className="p-0.5 hover:text-rose-400"
                    aria-label="Remove model slot"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {targets.length < 4 && (
              <button
                type="button"
                onClick={addTarget}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-dashed text-xs hover:border-emerald-500/60 ${theme.border}`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Model</span>
              </button>
            )}
          </div>

          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void runCompare(prompt, targets);
                }
              }}
              placeholder="Enter one prompt to benchmark offline local GGUF vs cloud models side by side…"
              className={`flex-1 rounded-xl border px-3 py-2 text-xs outline-none resize-none ${theme.inputBg} ${theme.border}`}
            />
            {isStreaming ? (
              <StopButton onStop={() => void stopCompare()} label="Stop All" />
            ) : (
              <button
                type="button"
                disabled={!prompt.trim() || targets.length < 2}
                onClick={() => void runCompare(prompt, targets)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-40 ${theme.accent}`}
              >
                <Play className="w-3.5 h-3.5" />
                <span>Compare</span>
              </button>
            )}
          </div>
        </div>

        {/* Results grid */}
        <div
          className={`flex-1 overflow-auto p-4 grid gap-3 ${
            targets.length === 2
              ? 'grid-cols-1 md:grid-cols-2'
              : targets.length === 3
              ? 'grid-cols-1 md:grid-cols-3'
              : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
          }`}
        >
          {(compareResults.length > 0 ? compareResults : targets.map((t) => ({
            targetId: t.id,
            requestId: t.id,
            providerName: t.providerName,
            model: t.model,
            text: '',
            isStreaming: false,
            isError: false,
            durationMs: null,
          }))).map((col) => (
            <div
              key={col.targetId}
              className={`rounded-xl border flex flex-col overflow-hidden ${theme.surfaceBg} ${theme.border}`}
            >
              <div className={`px-3.5 py-2.5 border-b flex items-center justify-between gap-2 ${theme.border}`}>
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{col.providerName}</div>
                  <div className={`text-[10.5px] truncate ${theme.textMuted}`}>{col.model || 'default'}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {'telemetry' in col && <ContextBadge telemetry={col.telemetry} compact />}
                  {col.durationMs !== null && (
                    <span className={`text-[10.5px] font-mono px-1.5 py-0.5 rounded ${theme.badgeBg}`}>
                      {(col.durationMs / 1000).toFixed(2)}s
                    </span>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3.5 text-xs">
                {col.isError ? (
                  <p className="text-rose-400 whitespace-pre-wrap">{col.text}</p>
                ) : col.text ? (
                  <Markdown content={col.text} />
                ) : col.isStreaming ? (
                  <div className="flex items-center gap-2 py-1">
                    <LoadingDots className={theme.accentText} label="Model loading response" />
                    <span className={theme.textMuted}>Loading</span>
                  </div>
                ) : (
                  <span className={`opacity-50 ${theme.textMuted}`}>Waiting for prompt…</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
