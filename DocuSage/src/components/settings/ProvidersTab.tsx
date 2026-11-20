import React, { useState } from 'react';
import { CheckCircle2, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { PROVIDER_DEFAULTS, PROVIDER_LABELS } from '../../lib/catalog';
import { THEMES } from '../../lib/themes';
import { useProviderStore } from '../../stores/useProviderStore';
import { useUiStore } from '../../stores/useUiStore';
import type { AiProviderConfig, AiProviderKind } from '../../types';

const REMOTE_KINDS: AiProviderKind[] = [
  'googleGemini',
  'openAi',
  'anthropic',
  'openRouter',
  'ollamaLocal',
  'ollamaRemote',
  'lmStudio',
  'lmStudioRemote',
  'customOpenAiCompatible',
];

type Draft = {
  id?: string;
  name: string;
  provider: AiProviderKind;
  enabled: boolean;
  baseUrl: string;
  model: string;
  organization: string;
  project: string;
  timeoutSecs: number;
  temperature: number;
  apiKey: string;
  deleteApiKey: boolean;
};

function makeDraft(kind: AiProviderKind = 'googleGemini'): Draft {
  const def = PROVIDER_DEFAULTS[kind];
  return {
    name: PROVIDER_LABELS[kind],
    provider: kind,
    enabled: true,
    baseUrl: def.baseUrl,
    model: def.model,
    organization: '',
    project: '',
    timeoutSecs: 60,
    temperature: 0.3,
    apiKey: '',
    deleteApiKey: false,
  };
}

function fromConfig(p: AiProviderConfig): Draft {
  return {
    id: p.id,
    name: p.name,
    provider: p.provider,
    enabled: p.enabled,
    baseUrl: p.baseUrl ?? '',
    model: p.model ?? '',
    organization: p.organization ?? '',
    project: p.project ?? '',
    timeoutSecs: p.timeoutSecs,
    temperature: p.temperature,
    apiKey: '',
    deleteApiKey: false,
  };
}

export const ProvidersTab: React.FC = () => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const providers = useProviderStore((s) => s.providers);
  const activeProviderId = useProviderStore((s) => s.activeProviderId);
  const secureStorageAvailable = useProviderStore((s) => s.secureStorageAvailable);
  const modelsByProvider = useProviderStore((s) => s.modelsByProvider);
  const saveProvider = useProviderStore((s) => s.saveProvider);
  const deleteProvider = useProviderStore((s) => s.deleteProvider);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);
  const verifyAndFetchModels = useProviderStore((s) => s.verifyAndFetchModels);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const saved = await saveProvider({
      id: draft.id,
      name: draft.name,
      provider: draft.provider,
      enabled: draft.enabled,
      baseUrl: draft.baseUrl || null,
      model: draft.model || null,
      organization: draft.organization || null,
      project: draft.project || null,
      timeoutSecs: draft.timeoutSecs,
      temperature: draft.temperature,
      apiKey: draft.apiKey || undefined,
      deleteApiKey: draft.deleteApiKey,
      options: {},
    });
    if (saved) {
      setDraft(null);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">AI Providers (Online & Local Servers)</h3>
          <p className={theme.textMuted}>
            API keys are stored exclusively in your OS Keyring — never written to JSON files.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDraft(makeDraft('googleGemini'))}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium ${theme.accent}`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Provider</span>
        </button>
      </div>

      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] ${theme.surfaceBg} ${theme.border}`}>
        <ShieldCheck className={`w-4 h-4 ${secureStorageAvailable ? 'text-emerald-400' : 'text-amber-400'}`} />
        <span>
          {secureStorageAvailable
            ? 'OS Keyring secure storage is active.'
            : 'OS Keyring probe unavailable in this environment.'}
        </span>
      </div>

      {/* Configured provider cards */}
      <div className="space-y-2">
        {providers.map((p) => {
          const isActive = p.id === activeProviderId;
          const fetchedModels = modelsByProvider[p.id] ?? [];
          return (
            <div
              key={p.id}
              className={`rounded-xl border p-3.5 space-y-2.5 ${theme.surfaceBg} ${
                isActive ? 'border-emerald-500/50' : theme.border
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[13px] truncate">{p.name}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-black/25">
                      {PROVIDER_LABELS[p.provider]}
                    </span>
                    {p.apiKeySet && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                        <KeyRound className="w-3 h-3" /> Keyring
                      </span>
                    )}
                  </div>
                  <div className={`text-[11px] mt-0.5 truncate ${theme.textMuted}`}>
                    {p.provider === 'local'
                      ? 'Built-in llama-server sidecar (100% offline GGUF)'
                      : `${p.model ?? 'No model'} · ${p.baseUrl ?? ''}`}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!isActive ? (
                    <button
                      type="button"
                      onClick={() => void setActiveProvider(p.id)}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] hover:border-emerald-500/60 ${theme.border}`}
                    >
                      Use Active
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-emerald-500/15 text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" /> Active
                    </span>
                  )}

                  {p.provider !== 'local' && (
                    <>
                      <button
                        type="button"
                        disabled={testingId === p.id}
                        onClick={async () => {
                          setTestingId(p.id);
                          await verifyAndFetchModels(p.id);
                          setTestingId(null);
                        }}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] hover:border-emerald-500/60 ${theme.border}`}
                      >
                        <RefreshCw className={`w-3 h-3 ${testingId === p.id ? 'animate-spin' : ''}`} />
                        <span>Verify & Fetch Models</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraft(fromConfig(p))}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] hover:bg-zinc-500/15 ${theme.border}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteProvider(p.id)}
                        aria-label={`Delete ${p.name}`}
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {fetchedModels.length > 0 && (
                <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/50">
                  <span className={`text-[11px] shrink-0 ${theme.textMuted}`}>
                    Fetched Models ({fetchedModels.length}):
                  </span>
                  <select
                    value={p.model ?? ''}
                    onChange={(e) =>
                      void saveProvider({
                        ...p,
                        model: e.target.value,
                        deleteApiKey: false,
                      })
                    }
                    className={`flex-1 rounded-lg border px-2 py-1 text-[11px] ${theme.inputBg} ${theme.border}`}
                  >
                    {fetchedModels.map((m) => (
                      <option key={m.id} value={m.id} className="bg-zinc-900 text-zinc-100">
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add / Edit Provider Form */}
      {draft && (
        <form
          onSubmit={handleSave}
          className={`rounded-xl border p-4 space-y-3 ${theme.surfaceElevated} ${theme.border}`}
        >
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-[13px]">{draft.id ? 'Edit Provider' : 'New Provider'}</h4>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className={`text-[11px] underline ${theme.textMuted}`}
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className={theme.textMuted}>Provider Type</span>
              <select
                value={draft.provider}
                onChange={(e) => {
                  const kind = e.target.value as AiProviderKind;
                  const def = PROVIDER_DEFAULTS[kind];
                  setDraft({
                    ...draft,
                    provider: kind,
                    name: draft.id ? draft.name : PROVIDER_LABELS[kind],
                    baseUrl: def.baseUrl,
                    model: def.model,
                  });
                }}
                className={`w-full rounded-lg border px-2.5 py-1.5 ${theme.inputBg} ${theme.border}`}
              >
                {REMOTE_KINDS.map((k) => (
                  <option key={k} value={k} className="bg-zinc-900 text-zinc-100">
                    {PROVIDER_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className={theme.textMuted}>Display Name</span>
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={`w-full rounded-lg border px-2.5 py-1.5 ${theme.inputBg} ${theme.border}`}
              />
            </label>

            <label className="space-y-1">
              <span className={theme.textMuted}>Base URL</span>
              <input
                required
                value={draft.baseUrl}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                className={`w-full rounded-lg border px-2.5 py-1.5 ${theme.inputBg} ${theme.border}`}
              />
            </label>

            <label className="space-y-1">
              <span className={theme.textMuted}>Model ID</span>
              <input
                required
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder="e.g. gemini-2.5-flash, gpt-4.1-mini, llama3.2"
                className={`w-full rounded-lg border px-2.5 py-1.5 ${theme.inputBg} ${theme.border}`}
              />
            </label>

            <label className="space-y-1">
              <span className={theme.textMuted}>
                API Key {PROVIDER_DEFAULTS[draft.provider].needsKey ? '(Stored in Keyring)' : '(Optional)'}
              </span>
              <input
                type="password"
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder={draft.id ? 'Leave blank to keep existing key' : 'sk-... / AIza...'}
                className={`w-full rounded-lg border px-2.5 py-1.5 ${theme.inputBg} ${theme.border}`}
              />
            </label>

            <label className="space-y-1">
              <span className={theme.textMuted}>Temperature ({draft.temperature.toFixed(2)})</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={draft.temperature}
                onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
                className="w-full accent-emerald-500 mt-1"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="submit"
              className={`px-4 py-1.5 rounded-lg font-medium ${theme.accent}`}
            >
              Save Provider
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
