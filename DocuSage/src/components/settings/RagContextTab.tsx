import React, { useEffect, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useProviderStore } from '../../stores/useProviderStore';
import { useUiStore } from '../../stores/useUiStore';
import type { EmbeddingBackendKind, RagConfig } from '../../types';

export const RagContextTab: React.FC = () => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const ragConfig = useProviderStore((s) => s.ragConfig);
  const saveRagConfig = useProviderStore((s) => s.saveRagConfig);
  const resetRagConfig = useProviderStore((s) => s.resetRagConfig);

  const [draft, setDraft] = useState<RagConfig>(ragConfig);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraft(ragConfig);
  }, [ragConfig]);

  const handleSave = async () => {
    setStatusMsg(null);
    const ok = await saveRagConfig(draft);
    if (ok) setStatusMsg('Saved Smart Context settings.');
  };

  const handleReset = async () => {
    setStatusMsg(null);
    const ok = await resetRagConfig();
    if (ok) setStatusMsg('Reset to defaults.');
  };

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h3 className="text-sm font-semibold">Smart Context Routing & Hybrid RAG</h3>
        <p className={theme.textMuted}>
          Documents under the threshold are injected verbatim (`Full Context`). Larger documents automatically switch to Hybrid SQLite FTS5 + Vector RAG within your token budget.
        </p>
      </div>

      <label className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${theme.surfaceBg} ${theme.border}`}>
        <div>
          <div className="font-medium">Force Hybrid RAG Always</div>
          <div className={`text-[11px] ${theme.textMuted}`}>
            Run Hybrid/FTS5 retrieval even on small documents (&le; {draft.fullContextThreshold.toLocaleString()} chars) to save tokens.
          </div>
        </div>
        <input
          type="checkbox"
          checked={draft.forceRagAlways}
          onChange={(e) => setDraft({ ...draft, forceRagAlways: e.target.checked })}
          className="w-4 h-4 accent-emerald-500"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className={`rounded-xl border p-3 space-y-1.5 ${theme.surfaceBg} ${theme.border}`}>
          <div className="flex justify-between">
            <span className="font-medium">Full Context Threshold</span>
            <span className="font-mono">{draft.fullContextThreshold.toLocaleString()} chars</span>
          </div>
          <input
            type="range"
            min={2000}
            max={48000}
            step={1000}
            value={draft.fullContextThreshold}
            onChange={(e) => setDraft({ ...draft, fullContextThreshold: Number(e.target.value) })}
            className="w-full accent-emerald-500"
          />
        </label>

        <label className={`rounded-xl border p-3 space-y-1.5 ${theme.surfaceBg} ${theme.border}`}>
          <div className="flex justify-between">
            <span className="font-medium">RAG Token Budget</span>
            <span className="font-mono">{draft.tokenBudget.toLocaleString()} tok</span>
          </div>
          <input
            type="range"
            min={1000}
            max={16000}
            step={500}
            value={draft.tokenBudget}
            onChange={(e) => setDraft({ ...draft, tokenBudget: Number(e.target.value) })}
            className="w-full accent-emerald-500"
          />
        </label>

        <label className={`rounded-xl border p-3 space-y-1.5 ${theme.surfaceBg} ${theme.border}`}>
          <div className="flex justify-between">
            <span className="font-medium">Chunk Size (tokens)</span>
            <span className="font-mono">{draft.chunkSize}</span>
          </div>
          <input
            type="range"
            min={150}
            max={1200}
            step={50}
            value={draft.chunkSize}
            onChange={(e) => setDraft({ ...draft, chunkSize: Number(e.target.value) })}
            className="w-full accent-emerald-500"
          />
        </label>

        <label className={`rounded-xl border p-3 space-y-1.5 ${theme.surfaceBg} ${theme.border}`}>
          <div className="flex justify-between">
            <span className="font-medium">Chunk Overlap (tokens)</span>
            <span className="font-mono">{draft.chunkOverlap}</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.min(300, draft.chunkSize - 20)}
            step={10}
            value={draft.chunkOverlap}
            onChange={(e) => setDraft({ ...draft, chunkOverlap: Number(e.target.value) })}
            className="w-full accent-emerald-500"
          />
        </label>

        <label className={`rounded-xl border p-3 space-y-1.5 ${theme.surfaceBg} ${theme.border}`}>
          <div className="flex justify-between">
            <span className="font-medium">Top-K Chunks</span>
            <span className="font-mono">{draft.topK}</span>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            step={1}
            value={draft.topK}
            onChange={(e) => setDraft({ ...draft, topK: Number(e.target.value) })}
            className="w-full accent-emerald-500"
          />
        </label>

        <label className={`rounded-xl border p-3 space-y-1.5 ${theme.surfaceBg} ${theme.border}`}>
          <span className="font-medium">Embedding Backend</span>
          <select
            value={draft.embedding.backend}
            onChange={(e) =>
              setDraft({
                ...draft,
                embedding: { ...draft.embedding, backend: e.target.value as EmbeddingBackendKind },
              })
            }
            className={`w-full rounded-lg border px-2.5 py-1.5 ${theme.inputBg} ${theme.border}`}
          >
            <option value="auto" className={theme.selectOption}>Auto (Local → Active Provider → FTS5)</option>
            <option value="none" className={theme.selectOption}>FTS5 Offline Only (Zero ML)</option>
            <option value="localLlama" className={theme.selectOption}>Built-in llama-server (/v1/embeddings)</option>
            <option value="ollama" className={theme.selectOption}>Ollama (/api/embed)</option>
            <option value="gemini" className={theme.selectOption}>Google Gemini (gemini-embedding-001)</option>
            <option value="openAiCompatible" className={theme.selectOption}>OpenAI-Compatible (/v1/embeddings)</option>
          </select>
        </label>
      </div>

      {draft.embedding.backend !== 'none' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className={theme.textMuted}>Embedding Model (optional override)</span>
            <input
              value={draft.embedding.model}
              onChange={(e) =>
                setDraft({ ...draft, embedding: { ...draft.embedding, model: e.target.value } })
              }
              placeholder="e.g. nomic-embed-text, gemini-embedding-001"
              className={`w-full rounded-lg border px-2.5 py-1.5 ${theme.inputBg} ${theme.border}`}
            />
          </label>
          <label className="space-y-1">
            <span className={theme.textMuted}>Embedding Endpoint Base URL (optional)</span>
            <input
              value={draft.embedding.baseUrl ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  embedding: { ...draft.embedding, baseUrl: e.target.value || null },
                })
              }
              placeholder="http://localhost:11434"
              className={`w-full rounded-lg border px-2.5 py-1.5 ${theme.inputBg} ${theme.border}`}
            />
          </label>
        </div>
      )}

      {statusMsg && <p className={`text-[11.5px] font-medium ${theme.accentText}`}>{statusMsg}</p>}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => void handleReset()}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${theme.border} ${theme.hoverBg}`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-medium ${theme.accent}`}
        >
          <Save className="w-3.5 h-3.5" />
          <span>Save Settings</span>
        </button>
      </div>
    </div>
  );
};
