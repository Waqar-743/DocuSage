import React, { useState } from 'react';
import {
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  HardDrive,
  KeyRound,
  Settings2,
} from 'lucide-react';
import {
  getMergedProviderModels,
  getModelDisplayName,
  isMajorCloudKind,
  MAJOR_CLOUD_PROVIDERS,
  type MajorCloudProviderKind,
} from '../../lib/catalog';
import { THEMES } from '../../lib/themes';
import { useProviderStore } from '../../stores/useProviderStore';
import { useUiStore } from '../../stores/useUiStore';

export const ModelSelector: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const openSettings = useUiStore((s) => s.openSettings);
  const pushToast = useUiStore((s) => s.pushToast);

  const providers = useProviderStore((s) => s.providers);
  const activeProviderId = useProviderStore((s) => s.activeProviderId);
  const modelsByProvider = useProviderStore((s) => s.modelsByProvider);
  const verificationByProvider = useProviderStore((s) => s.verificationByProvider);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);
  const selectProviderModel = useProviderStore((s) => s.selectProviderModel);
  const connectLocalModel = useProviderStore((s) => s.connectLocalModel);
  const downloadedModels = useProviderStore((s) => s.downloadedModels);
  const connectedModel = useProviderStore((s) => s.connectedModel);
  const runtimeStatus = useProviderStore((s) => s.runtimeStatus);
  const isConnectingModel = useProviderStore((s) => s.isConnectingModel);
  const isTestingLocalModel = useProviderStore((s) => s.isTestingLocalModel);
  const isLocalBusy =
    isConnectingModel || isTestingLocalModel || Boolean(runtimeStatus.loading);

  const [open, setOpen] = useState(false);

  const active = providers.find((p) => p.id === activeProviderId) ?? providers[0];
  const isLocal = !active || active.provider === 'local';
  const activeDisplayName = isLocal
    ? connectedModel
      ? getModelDisplayName('local', connectedModel)
      : 'Local GGUF (Not Loaded)'
    : getModelDisplayName(active.provider, active.model, modelsByProvider[active.id]) || active.name;

  const isReady = isLocal
    ? runtimeStatus.running
    : Boolean(active?.enabled && (active.apiKeySet || !isMajorCloudKind(active.provider)));

  const otherProviders = providers.filter(
    (p) => p.enabled && p.provider !== 'local' && !isMajorCloudKind(p.provider),
  );

  const chatDownloadedModels = downloadedModels.filter((m) => {
    const lower = m.filename.toLowerCase();
    return !lower.includes('embed') && !lower.includes('bge-');
  });

  const handleSelectCloudModel = async (
    kind: MajorCloudProviderKind,
    providerName: string,
    modelId: string,
    modelLabel: string,
  ) => {
    const configured = providers.find((p) => p.provider === kind);
    if (!configured || !configured.apiKeySet) {
      setOpen(false);
      openSettings('providers', kind);
      pushToast(
        'info',
        `Add your ${providerName} API key in Settings → Providers to use ${modelLabel}.`,
        { dedupeKey: `configure-provider:${kind}` },
      );
      return;
    }
    await selectProviderModel(configured.id, modelId);
    setOpen(false);
  };

  const handleSelectLocalModel = async (filePath: string, filename: string) => {
    if (isLocalBusy) return;
    setOpen(false);
    await setActiveProvider('local');
    if (connectedModel !== filename || !runtimeStatus.running) {
      await connectLocalModel(filePath);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Select AI model"
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors max-w-[260px] ${theme.surfaceBg} ${theme.border} ${theme.text} ${theme.hoverBg}`}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isReady ? 'bg-emerald-400' : 'bg-amber-400'
          }`}
        />
        {isLocal ? (
          <Cpu className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`} />
        ) : (
          <Cloud className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`} />
        )}
        <span className="truncate">
          {compact ? activeDisplayName.slice(0, 22) : activeDisplayName}
        </span>
        <ChevronDown className="w-3 h-3 opacity-70 shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label="AI Models"
            className={`absolute left-0 mt-1.5 w-80 rounded-xl border shadow-2xl z-40 p-1.5 ${theme.surfaceElevated} ${theme.border} ${theme.text}`}
          >
            <div className="max-h-[70vh] overflow-y-auto space-y-2 p-0.5">
              {/* Built-in Local (GGUF) Group */}
              <div>
                <div className="flex items-center justify-between px-2 py-1">
                  <span className={`text-[10.5px] font-semibold uppercase tracking-wider flex items-center gap-1.5 ${theme.textMuted}`}>
                    <HardDrive className="w-3 h-3" />
                    Built-in Local (GGUF)
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${theme.badgeBg}`}>
                    Offline
                  </span>
                </div>

                {chatDownloadedModels.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      openSettings('localRuntime');
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${theme.hoverBg}`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium">Download a Local GGUF Model</div>
                      <div className={`text-[11px] ${theme.textMuted}`}>
                        1-click setup — no manual path required
                      </div>
                    </div>
                    <Cpu className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`} />
                  </button>
                ) : (
                  <div className="space-y-0.5">
                    {chatDownloadedModels.map((m) => {
                      const selected = isLocal && connectedModel === m.filename;
                      const label = getModelDisplayName('local', m.filename);
                      return (
                        <button
                          key={m.path}
                          type="button"
                          role="option"
                          disabled={isLocalBusy}
                          aria-selected={selected}
                          onClick={() => void handleSelectLocalModel(m.path, m.filename)}
                          className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors border disabled:opacity-50 ${
                            selected
                              ? theme.accentSoft
                              : `border-transparent ${theme.hoverBg}`
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-medium truncate">{label}</div>
                            <div className={`text-[10.5px] truncate ${theme.textMuted}`}>
                              {isLocalBusy
                                ? 'Engine busy…'
                                : selected && runtimeStatus.running
                                ? 'Running locally'
                                : m.filename}
                            </div>
                          </div>
                          {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Major Cloud Providers: Anthropic, OpenAI, Google Gemini */}
              {MAJOR_CLOUD_PROVIDERS.map((meta) => {
                const configured = providers.find((p) => p.provider === meta.kind);
                const hasKey = Boolean(configured?.apiKeySet);
                const verStatus = configured
                  ? verificationByProvider[configured.id]?.status
                  : 'notConfigured';
                const models = getMergedProviderModels(
                  meta.kind,
                  configured ? modelsByProvider[configured.id] : undefined,
                ).slice(0, 8);

                return (
                  <div key={meta.kind} className={`pt-1.5 border-t ${theme.border}`}>
                    <div className="flex items-center justify-between px-2 py-1 gap-2">
                      <span className={`text-[10.5px] font-semibold uppercase tracking-wider flex items-center gap-1.5 ${theme.textMuted}`}>
                        <Cloud className="w-3 h-3" />
                        {meta.name}
                      </span>
                      {hasKey ? (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            verStatus === 'verified'
                              ? theme.accentSoft
                              : verStatus === 'invalidApiKey'
                              ? theme.dangerSoft
                              : theme.badgeBg
                          }`}
                        >
                          {verStatus === 'verified'
                            ? 'Verified'
                            : verStatus === 'invalidApiKey'
                            ? 'Invalid Key'
                            : 'Configured'}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            openSettings('providers', meta.kind);
                          }}
                          className={`inline-flex items-center gap-1 text-[10px] font-medium hover:underline ${theme.accentText}`}
                        >
                          <KeyRound className="w-2.5 h-2.5" />
                          <span>Add Key</span>
                        </button>
                      )}
                    </div>

                    <div className="space-y-0.5">
                      {models.map((m) => {
                        const selected =
                          Boolean(configured) &&
                          configured?.id === activeProviderId &&
                          configured?.model === m.id;
                        return (
                          <button
                            key={`${meta.kind}-${m.id}`}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() =>
                              void handleSelectCloudModel(meta.kind, meta.name, m.id, m.label)
                            }
                            className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors border ${
                              selected
                                ? theme.accentSoft
                                : `border-transparent ${theme.hoverBg} ${!hasKey ? 'opacity-70' : ''}`
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-medium truncate">{m.label}</div>
                              {m.label !== m.id && (
                                <div className={`text-[10px] font-mono truncate ${theme.textMuted}`}>
                                  {m.id}
                                </div>
                              )}
                            </div>
                            {selected ? (
                              <Check className="w-3.5 h-3.5 shrink-0" />
                            ) : !hasKey ? (
                              <span className={`text-[10px] shrink-0 ${theme.textMuted}`}>
                                Key needed
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Other Custom / Local Server Providers (Ollama, LM Studio, OpenRouter, Custom) */}
              {otherProviders.length > 0 && (
                <div className={`pt-1.5 border-t ${theme.border}`}>
                  <div className={`px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider ${theme.textMuted}`}>
                    Other Providers
                  </div>
                  <div className="space-y-0.5">
                    {otherProviders.map((p) => {
                      const selected = p.id === activeProviderId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            void setActiveProvider(p.id);
                            setOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors border ${
                            selected ? theme.accentSoft : `border-transparent ${theme.hoverBg}`
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-medium truncate">{p.name}</div>
                            <div className={`text-[10.5px] truncate ${theme.textMuted}`}>
                              {p.model || 'Default model'}
                            </div>
                          </div>
                          {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className={`mt-1.5 pt-1.5 border-t ${theme.border} flex gap-1`}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openSettings('localRuntime');
                }}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium ${theme.hoverBg}`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Local GGUF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openSettings('providers');
                }}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium ${theme.hoverBg}`}
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>API Keys & Providers</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
