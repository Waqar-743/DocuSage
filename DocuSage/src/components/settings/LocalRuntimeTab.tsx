import React from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Link,
  Link2Off,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { formatBytes, MODEL_CATALOG } from '../../lib/catalog';
import { THEMES } from '../../lib/themes';
import { useProviderStore } from '../../stores/useProviderStore';
import { useUiStore } from '../../stores/useUiStore';

export const LocalRuntimeTab: React.FC = () => {
  const theme = useUiStore((s) => THEMES[s.theme]);

  const runtimeStatus = useProviderStore((s) => s.runtimeStatus);
  const runtimeProgress = useProviderStore((s) => s.runtimeProgress);
  const isInstallingRuntime = useProviderStore((s) => s.isInstallingRuntime);
  const isConnectingModel = useProviderStore((s) => s.isConnectingModel);
  const downloadedModels = useProviderStore((s) => s.downloadedModels);
  const connectedModel = useProviderStore((s) => s.connectedModel);
  const modelsDir = useProviderStore((s) => s.modelsDir);
  const modelDownloads = useProviderStore((s) => s.modelDownloads);

  const installRuntime = useProviderStore((s) => s.installRuntime);
  const connectLocalModel = useProviderStore((s) => s.connectLocalModel);
  const connectLocalEmbeddingModel = useProviderStore((s) => s.connectLocalEmbeddingModel);
  const disconnectLocalModel = useProviderStore((s) => s.disconnectLocalModel);
  const restartLocalEngine = useProviderStore((s) => s.restartLocalEngine);
  const downloadCatalogModel = useProviderStore((s) => s.downloadCatalogModel);
  const deleteLocalModel = useProviderStore((s) => s.deleteLocalModel);

  const downloadedSet = new Set(downloadedModels.map((m) => m.filename));

  return (
    <div className="space-y-5 text-xs">
      {/* On-Demand llama-server Sidecar Card */}
      <div className={`rounded-xl border p-4 space-y-3 ${theme.surfaceBg} ${theme.border}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold">Built-in Offline Runtime (llama-server)</h3>
            </div>
            <p className={`mt-0.5 ${theme.textMuted}`}>
              Downloaded on demand into your local app data folder with SHA256 verification — keeps the DocuSage installer under 10 MB.
            </p>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium shrink-0 ${
              runtimeStatus.installed
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-amber-500/15 text-amber-400'
            }`}
          >
            {runtimeStatus.installed ? 'Installed' : 'Not Installed'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-lg bg-black/20 p-2">
            <div className={theme.textMuted}>Platform</div>
            <div className="font-mono mt-0.5">{runtimeStatus.platformSummary}</div>
          </div>
          <div className="rounded-lg bg-black/20 p-2">
            <div className={theme.textMuted}>Chat Server</div>
            <div className="font-mono mt-0.5">
              {runtimeStatus.running ? `127.0.0.1:${runtimeStatus.port}` : 'Stopped'}
            </div>
          </div>
          <div className="rounded-lg bg-black/20 p-2">
            <div className={theme.textMuted}>Embedding Server</div>
            <div className="font-mono mt-0.5">
              {runtimeStatus.embeddingRunning
                ? `:${runtimeStatus.embeddingPort} (${runtimeStatus.embeddingModel})`
                : 'FTS5 Offline'}
            </div>
          </div>
        </div>

        {runtimeProgress && !runtimeProgress.done && (
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span>
                {runtimeProgress.stage}: {runtimeProgress.assetName}
              </span>
              <span className="font-mono">{runtimeProgress.percent.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(100, runtimeProgress.percent)}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isInstallingRuntime}
            onClick={() => void installRuntime()}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 ${theme.accent}`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {isInstallingRuntime
                ? 'Installing llama-server…'
                : runtimeStatus.installed
                ? 'Update / Reinstall Runtime'
                : `Install Runtime (${runtimeStatus.detectedBackend})`}
            </span>
          </button>
          {runtimeStatus.running && (
            <>
              <button
                type="button"
                onClick={() => void restartLocalEngine()}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border ${theme.border}`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restart</span>
              </button>
              <button
                type="button"
                onClick={() => void disconnectLocalModel()}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border ${theme.border}`}
              >
                <Link2Off className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Downloaded GGUF Files */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-[13px] flex items-center gap-1.5">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            <span>Downloaded GGUF Models ({downloadedModels.length})</span>
          </h4>
          {modelsDir && (
            <span className={`text-[10.5px] font-mono truncate max-w-[260px] ${theme.textMuted}`} title={modelsDir}>
              {modelsDir}
            </span>
          )}
        </div>

        {downloadedModels.length === 0 ? (
          <div className={`rounded-xl border p-4 text-center ${theme.surfaceBg} ${theme.border} ${theme.textMuted}`}>
            No .gguf models found yet. Download one below or place GGUF files in Documents/DocuSage/models.
          </div>
        ) : (
          <div className="space-y-1.5">
            {downloadedModels.map((m) => {
              const isChatConnected = connectedModel === m.filename;
              const isEmbedConnected = runtimeStatus.embeddingModel === m.filename;
              return (
                <div
                  key={m.path}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${theme.surfaceBg} ${
                    isChatConnected ? 'border-emerald-500/60' : theme.border
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-1.5">
                      <span>{m.filename}</span>
                      {isChatConnected && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                    </div>
                    <div className={`text-[10.5px] ${theme.textMuted}`}>{formatBytes(m.sizeBytes)}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={isConnectingModel || isChatConnected}
                      onClick={() => void connectLocalModel(m.path)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] disabled:opacity-50 ${
                        isChatConnected ? theme.accentSoft : theme.border
                      }`}
                    >
                      <Link className="w-3 h-3" />
                      <span>{isChatConnected ? 'Chat Active' : 'Load Chat'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isEmbedConnected}
                      onClick={() => void connectLocalEmbeddingModel(m.path)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] disabled:opacity-50 ${
                        isEmbedConnected ? theme.accentSoft : theme.border
                      }`}
                      title="Use this GGUF for offline semantic embeddings"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>{isEmbedConnected ? 'Embed Active' : 'Load Embed'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteLocalModel(m.path)}
                      aria-label={`Delete ${m.filename}`}
                      className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Curated GGUF Catalog (Chat + Offline Embedding GGUFs) */}
      <div className="space-y-2">
        <h4 className="font-semibold text-[13px]">Curated GGUF Catalog (Chat & Offline Embeddings)</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {MODEL_CATALOG.map((entry) => {
            const installed = downloadedSet.has(entry.filename);
            const prog = modelDownloads[entry.filename];
            const downloading = Boolean(prog && !prog.done);
            return (
              <div
                key={entry.id}
                className={`rounded-xl border p-3 flex flex-col justify-between gap-2 ${theme.surfaceBg} ${theme.border}`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{entry.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/25 shrink-0">
                      {entry.kind === 'embedding' ? 'Embed' : 'Chat'} · {entry.size}
                    </span>
                  </div>
                  <p className={`text-[11px] mt-1 leading-relaxed ${theme.textMuted}`}>
                    {entry.description}
                  </p>
                </div>

                {downloading && prog ? (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10.5px]">
                      <span>Downloading…</span>
                      <span className="font-mono">{prog.percent.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all"
                        style={{ width: `${Math.min(100, prog.percent)}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={installed}
                    onClick={() => void downloadCatalogModel(entry.directDownloadUrl, entry.filename)}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-50 ${
                      installed ? theme.border : theme.accentSoft
                    }`}
                  >
                    <Download className="w-3 h-3" />
                    <span>{installed ? 'Downloaded' : 'Download GGUF'}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
