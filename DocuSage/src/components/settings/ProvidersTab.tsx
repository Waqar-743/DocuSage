import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  WifiOff,
} from 'lucide-react';
import {
  getMergedProviderModels,
  isMajorCloudKind,
  MAJOR_CLOUD_PROVIDERS,
  PROVIDER_DEFAULTS,
  PROVIDER_LABELS,
  type MajorCloudProviderKind,
} from '../../lib/catalog';
import { THEMES } from '../../lib/themes';
import { useProviderStore } from '../../stores/useProviderStore';
import { useUiStore } from '../../stores/useUiStore';
import type { AiProviderConfig, AiProviderKind, ProviderVerificationStatus } from '../../types';

const EXTRA_PROVIDER_KINDS: AiProviderKind[] = [
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

function makeDraft(kind: AiProviderKind = 'ollamaLocal'): Draft {
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

function StatusBadge({ status, isDark }: { status: ProviderVerificationStatus; isDark: boolean }) {
  switch (status) {
    case 'verified':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold border ${
            isDark
              ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
              : 'bg-emerald-50 text-emerald-800 border-emerald-300'
          }`}
        >
          <CheckCircle2 className="w-3 h-3" />
          Verified
        </span>
      );
    case 'invalidApiKey':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold border ${
            isDark
              ? 'bg-rose-500/20 text-rose-200 border-rose-400/50'
              : 'bg-rose-50 text-rose-800 border-rose-300'
          }`}
        >
          <AlertCircle className="w-3 h-3" />
          Invalid API Key
        </span>
      );
    case 'connectionError':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold border ${
            isDark
              ? 'bg-amber-500/20 text-amber-200 border-amber-400/50'
              : 'bg-amber-50 text-amber-800 border-amber-300'
          }`}
        >
          <WifiOff className="w-3 h-3" />
          Connection Error
        </span>
      );
    case 'verifying':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold border ${
            isDark
              ? 'bg-sky-500/20 text-sky-200 border-sky-400/50'
              : 'bg-sky-50 text-sky-800 border-sky-300'
          }`}
        >
          <Loader2 className="w-3 h-3 animate-spin" />
          Verifying…
        </span>
      );
    case 'unverified':
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold border ${
            isDark
              ? 'bg-sky-500/15 text-sky-200 border-sky-400/40'
              : 'bg-sky-50 text-sky-800 border-sky-200'
          }`}
        >
          <KeyRound className="w-3 h-3" />
          Key Saved · Unverified
        </span>
      );
    default:
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium border ${
            isDark
              ? 'bg-white/[0.06] text-zinc-300 border-zinc-600'
              : 'bg-zinc-100 text-zinc-600 border-zinc-300'
          }`}
        >
          Not Configured
        </span>
      );
  }
}

export const ProvidersTab: React.FC = () => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const highlightedProviderKind = useUiStore((s) => s.highlightedProviderKind);
  const pushToast = useUiStore((s) => s.pushToast);

  const providers = useProviderStore((s) => s.providers);
  const activeProviderId = useProviderStore((s) => s.activeProviderId);
  const secureStorageAvailable = useProviderStore((s) => s.secureStorageAvailable);
  const modelsByProvider = useProviderStore((s) => s.modelsByProvider);
  const verificationByProvider = useProviderStore((s) => s.verificationByProvider);
  const saveProvider = useProviderStore((s) => s.saveProvider);
  const saveCloudProviderKey = useProviderStore((s) => s.saveCloudProviderKey);
  const clearCloudProviderKey = useProviderStore((s) => s.clearCloudProviderKey);
  const deleteProvider = useProviderStore((s) => s.deleteProvider);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);
  const selectProviderModel = useProviderStore((s) => s.selectProviderModel);
  const verifyAndFetchModels = useProviderStore((s) => s.verifyAndFetchModels);

  const [keyInputs, setKeyInputs] = useState<Record<MajorCloudProviderKind, string>>({
    anthropic: '',
    openAi: '',
    googleGemini: '',
  });
  const [revealKey, setRevealKey] = useState<Record<MajorCloudProviderKind, boolean>>({
    anthropic: false,
    openAi: false,
    googleGemini: false,
  });
  const [savingKind, setSavingKind] = useState<MajorCloudProviderKind | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const otherProviders = providers.filter((p) => !isMajorCloudKind(p.provider));

  const handleSaveCloudKey = async (kind: MajorCloudProviderKind, name: string) => {
    const raw = keyInputs[kind].trim();
    if (!raw) {
      pushToast('error', `Enter an API key for ${name} to save or update.`, {
        dedupeKey: `empty-key:${kind}`,
      });
      return;
    }
    setSavingKind(kind);
    const saved = await saveCloudProviderKey(kind, raw);
    setSavingKind(null);
    if (saved) {
      setKeyInputs((prev) => ({ ...prev, [kind]: '' }));
      setRevealKey((prev) => ({ ...prev, [kind]: false }));
      pushToast('success', `Saved masked API key for ${name} in OS Keyring.`, {
        dedupeKey: `saved-key:${kind}`,
      });
    }
  };

  const handleVerifyCloudProvider = async (kind: MajorCloudProviderKind, name: string) => {
    let provider = providers.find((p) => p.provider === kind);
    const typedKey = keyInputs[kind].trim();

    if (typedKey) {
      setSavingKind(kind);
      const saved = await saveCloudProviderKey(kind, typedKey);
      setSavingKind(null);
      if (!saved) return;
      provider = saved;
      setKeyInputs((prev) => ({ ...prev, [kind]: '' }));
      setRevealKey((prev) => ({ ...prev, [kind]: false }));
    }

    if (!provider || !provider.apiKeySet) {
      pushToast('error', `Not Configured: Enter and save a ${name} API key before verifying.`, {
        dedupeKey: `verify-missing:${kind}`,
      });
      return;
    }

    setTestingId(provider.id);
    await verifyAndFetchModels(provider.id);
    setTestingId(null);
  };

  const handleSaveCustom = async (e: React.FormEvent) => {
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
    <div className="space-y-5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">AI Provider API Configuration</h3>
          <p className={`mt-0.5 ${theme.textMuted}`}>
            Configure and verify API keys independently for Anthropic, OpenAI, and Google Gemini. Keys are stored masked in your OS Keyring and never logged.
          </p>
        </div>
      </div>

      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] ${theme.surfaceBg} ${theme.border}`}>
        <ShieldCheck className={`w-4 h-4 shrink-0 ${secureStorageAvailable ? theme.accentText : 'text-amber-400'}`} />
        <span>
          {secureStorageAvailable
            ? 'OS Keyring secure storage is active. Saved keys remain masked and are never written to JSON files or logs.'
            : 'OS Keyring probe unavailable in this preview environment.'}
        </span>
      </div>

      {/* Dedicated Anthropic, OpenAI, and Google Gemini API Key Sections */}
      <div className="space-y-3">
        {MAJOR_CLOUD_PROVIDERS.map((meta) => {
          const configured = providers.find((p) => p.provider === meta.kind);
          const isActive = Boolean(configured && configured.id === activeProviderId);
          const hasKey = Boolean(configured?.apiKeySet);
          const verEntry = configured ? verificationByProvider[configured.id] : undefined;
          const status: ProviderVerificationStatus = !hasKey
            ? 'notConfigured'
            : verEntry?.status ?? 'unverified';
          const isVerifying = testingId === configured?.id || status === 'verifying';
          const isSaving = savingKind === meta.kind;
          const isHighlighted = highlightedProviderKind === meta.kind;
          const models = getMergedProviderModels(
            meta.kind,
            configured ? modelsByProvider[configured.id] : undefined,
          );
          const selectedModel = configured?.model ?? meta.defaultModel;

          return (
            <section
              key={meta.kind}
              aria-label={`${meta.name} API Configuration`}
              className={`rounded-xl border p-4 space-y-3 transition-colors ${theme.surfaceBg} ${
                isHighlighted
                  ? 'border-emerald-400 ring-1 ring-emerald-400/40'
                  : isActive
                  ? 'border-emerald-500/60'
                  : theme.border
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-[13px]">{meta.name}</h4>
                    <StatusBadge status={status} isDark={theme.isDark} />
                    {isActive && (
                      <span className={`text-[10.5px] px-2 py-0.5 rounded-full border font-medium ${theme.accentSoft}`}>
                        Active Provider
                      </span>
                    )}
                  </div>
                  <p className={`text-[11px] mt-0.5 ${theme.textMuted}`}>
                    Get an API key from {meta.docsHint}
                  </p>
                </div>

                {configured && hasKey && !isActive && (
                  <button
                    type="button"
                    onClick={() => void setActiveProvider(configured.id)}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium ${theme.border} ${theme.hoverBg}`}
                  >
                    Use Active
                  </button>
                )}
              </div>

              {/* Masked API Key Input + Independent Save/Update & Verify buttons */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1 min-w-0">
                  <input
                    type={revealKey[meta.kind] ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`${meta.name} API Key`}
                    value={keyInputs[meta.kind]}
                    onChange={(e) =>
                      setKeyInputs((prev) => ({ ...prev, [meta.kind]: e.target.value }))
                    }
                    placeholder={
                      hasKey
                        ? '•••••••••••••••••••• (Saved securely — enter new key to update)'
                        : `Enter ${meta.name} API key (${meta.keyPlaceholder})`
                    }
                    className={`w-full rounded-lg border pl-3 pr-9 py-2 text-xs outline-none ${theme.inputBg} ${theme.border}`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setRevealKey((prev) => ({ ...prev, [meta.kind]: !prev[meta.kind] }))
                    }
                    aria-label={revealKey[meta.kind] ? `Hide ${meta.name} API key` : `Show ${meta.name} API key`}
                    title={revealKey[meta.kind] ? 'Hide input' : 'Show input'}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded ${theme.textMuted} ${theme.hoverBg}`}
                  >
                    {revealKey[meta.kind] ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={isSaving || !keyInputs[meta.kind].trim()}
                    onClick={() => void handleSaveCloudKey(meta.kind, meta.name)}
                    className={`px-3 py-2 rounded-lg text-[11.5px] transition-colors disabled:opacity-45 ${theme.accent}`}
                  >
                    {isSaving ? 'Saving…' : hasKey ? 'Update Key' : 'Save Key'}
                  </button>

                  <button
                    type="button"
                    disabled={isVerifying || (!hasKey && !keyInputs[meta.kind].trim())}
                    onClick={() => void handleVerifyCloudProvider(meta.kind, meta.name)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[11.5px] font-medium transition-colors disabled:opacity-45 ${theme.border} ${theme.hoverBg}`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                    <span>{isVerifying ? 'Verifying…' : 'Verify'}</span>
                  </button>

                  {configured && hasKey && (
                    <button
                      type="button"
                      onClick={() => void clearCloudProviderKey(configured.id)}
                      aria-label={`Remove ${meta.name} API key`}
                      title="Remove saved API key"
                      className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/15 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Status Feedback Message */}
              {verEntry?.message && (
                <div
                  className={`text-[11px] px-2.5 py-1.5 rounded-lg border ${
                    status === 'verified'
                      ? theme.accentSoft
                      : status === 'invalidApiKey' || status === 'connectionError'
                      ? theme.dangerSoft
                      : `${theme.subtleBg} ${theme.border} ${theme.textMuted}`
                  }`}
                >
                  {verEntry.message}
                </div>
              )}

              {/* Provider Model Selector */}
              <div className="flex items-center gap-2 pt-1">
                <label
                  htmlFor={`model-select-${meta.kind}`}
                  className={`text-[11px] shrink-0 font-medium ${theme.textMuted}`}
                >
                  Model:
                </label>
                <select
                  id={`model-select-${meta.kind}`}
                  aria-label={`${meta.name} model`}
                  value={selectedModel}
                  disabled={!configured}
                  onChange={(e) => {
                    if (configured) {
                      void selectProviderModel(configured.id, e.target.value);
                    }
                  }}
                  className={`flex-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] disabled:opacity-60 ${theme.inputBg} ${theme.border}`}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id} className={theme.selectOption}>
                      {m.label} {m.label !== m.id ? `(${m.id})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          );
        })}
      </div>

      {/* Local & Custom Providers Section (Ollama, LM Studio, OpenRouter, Custom OpenAI-compatible) */}
      <div className={`pt-4 border-t space-y-3 ${theme.border}`}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-[13px] font-semibold">Local &amp; Custom Providers</h4>
            <p className={`text-[11px] ${theme.textMuted}`}>
              Built-in Local GGUF, Ollama, LM Studio, OpenRouter, or any OpenAI-compatible endpoint.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDraft(makeDraft('ollamaLocal'))}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11.5px] font-medium ${theme.border} ${theme.hoverBg}`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Custom Provider</span>
          </button>
        </div>

        <div className="space-y-2">
          {otherProviders.map((p) => {
            const isActive = p.id === activeProviderId;
            const fetchedModels = modelsByProvider[p.id] ?? [];
            return (
              <div
                key={p.id}
                className={`rounded-xl border p-3.5 space-y-2.5 ${theme.surfaceBg} ${
                  isActive ? 'border-emerald-500/60' : theme.border
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[13px] truncate">{p.name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${theme.badgeBg}`}>
                        {PROVIDER_LABELS[p.provider]}
                      </span>
                      {p.apiKeySet && (
                        <span className={`inline-flex items-center gap-1 text-[10px] ${theme.accentText}`}>
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
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium ${theme.border} ${theme.hoverBg}`}
                      >
                        Use Active
                      </button>
                    ) : (
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border ${theme.accentSoft}`}>
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
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] ${theme.border} ${theme.hoverBg}`}
                        >
                          <RefreshCw className={`w-3 h-3 ${testingId === p.id ? 'animate-spin' : ''}`} />
                          <span>Verify</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraft(fromConfig(p))}
                          className={`px-2.5 py-1 rounded-lg border text-[11px] ${theme.border} ${theme.hoverBg}`}
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
                  <div className={`flex items-center gap-2 pt-2 border-t ${theme.border}`}>
                    <span className={`text-[11px] shrink-0 ${theme.textMuted}`}>
                      Models ({fetchedModels.length}):
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
                        <option key={m.id} value={m.id} className={theme.selectOption}>
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

        {draft && (
          <form
            onSubmit={handleSaveCustom}
            className={`rounded-xl border p-4 space-y-3 ${theme.surfaceElevated} ${theme.border}`}
          >
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-[13px]">{draft.id ? 'Edit Custom Provider' : 'Add Custom Provider'}</h4>
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
                  {EXTRA_PROVIDER_KINDS.map((k) => (
                    <option key={k} value={k} className={theme.selectOption}>
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
                  placeholder="e.g. llama3.2, openai/gpt-6.2-sol"
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
                  placeholder={draft.id ? 'Leave blank to keep existing key' : 'sk-...'}
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
                className={`px-4 py-1.5 rounded-lg ${theme.accent}`}
              >
                Save Provider
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
