import React, { useState } from 'react';
import { ChevronDown, Cloud, Cpu, HardDrive, Settings2 } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useProviderStore } from '../../stores/useProviderStore';
import { useUiStore } from '../../stores/useUiStore';

export const ModelSelector: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const openSettings = useUiStore((s) => s.openSettings);

  const providers = useProviderStore((s) => s.providers);
  const activeProviderId = useProviderStore((s) => s.activeProviderId);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);
  const connectedModel = useProviderStore((s) => s.connectedModel);
  const runtimeStatus = useProviderStore((s) => s.runtimeStatus);

  const [open, setOpen] = useState(false);

  const active = providers.find((p) => p.id === activeProviderId) ?? providers[0];
  const isLocal = !active || active.provider === 'local';
  const label = isLocal
    ? connectedModel
      ? connectedModel.replace(/\.gguf$/i, '')
      : 'Local GGUF (Not Loaded)'
    : active.model || active.name;

  const isReady = isLocal ? runtimeStatus.running || Boolean(connectedModel) : Boolean(active?.enabled);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Select AI model"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors max-w-[230px] ${theme.surfaceBg} ${theme.border} hover:border-emerald-500/50`}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isReady ? 'bg-emerald-400' : 'bg-amber-400'
          }`}
        />
        {isLocal ? (
          <Cpu className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        ) : (
          <Cloud className="w-3.5 h-3.5 text-sky-400 shrink-0" />
        )}
        <span className="truncate">{compact ? label.slice(0, 20) : label}</span>
        <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-0 mt-1.5 w-72 rounded-xl border shadow-xl z-40 p-1.5 ${theme.surfaceElevated} ${theme.border}`}
          >
            <div className={`px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider ${theme.textMuted}`}>
              Switch AI Provider
            </div>
            <div className="max-h-64 overflow-y-auto space-y-0.5">
              {providers
                .filter((p) => p.enabled)
                .map((p) => {
                  const selected = p.id === activeProviderId;
                  const local = p.provider === 'local';
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        void setActiveProvider(p.id);
                        setOpen(false);
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                        selected ? theme.accentSoft + ' border' : 'hover:bg-zinc-500/10'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate flex items-center gap-1.5">
                          {local ? <HardDrive className="w-3.5 h-3.5 shrink-0" /> : <Cloud className="w-3.5 h-3.5 shrink-0" />}
                          <span className="truncate">{p.name}</span>
                        </div>
                        <div className={`text-[11px] truncate ${theme.textMuted}`}>
                          {local ? connectedModel ?? 'Offline llama-server' : p.model ?? 'Configure model'}
                        </div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/20 shrink-0">
                        {local ? 'Offline' : 'Online'}
                      </span>
                    </button>
                  );
                })}
            </div>
            <div className={`mt-1.5 pt-1.5 border-t ${theme.border} flex gap-1`}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openSettings('localRuntime');
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] hover:bg-zinc-500/10"
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
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] hover:bg-zinc-500/10"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Providers</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
