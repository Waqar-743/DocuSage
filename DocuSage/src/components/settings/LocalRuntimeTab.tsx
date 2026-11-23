import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Link,
  Link2Off,
  Loader2,
  Play,
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
  const isConnectingEmbedding = useProviderStore((s) => s.isConnectingEmbedding);
  const isTestingLocalModel = useProviderStore((s) => s.isTestingLocalModel);
  const localTestResult = useProviderStore((s) => s.localTestResult);
  const downloadedModels = useProviderStore((s) => s.downloadedModels);
  const connectedModel = useProviderStore((s) => s.connectedModel);
  const modelDownloads = useProviderStore((s) => s.modelDownloads);

  const installRuntime = useProviderStore((s) => s.installRuntime);
  const connectLocalModel = useProviderStore((s) => s.connectLocalModel);
  const connectLocalEmbeddingModel = useProviderStore((s) => s.connectLocalEmbeddingModel);
  const disconnectLocalModel = useProviderStore((s) => s.disconnectLocalModel);
  const restartLocalEngine = useProviderStore((s) => s.restartLocalEngine);
  const downloadAndSetupLocalModel = useProviderStore((s) => s.downloadAndSetupLocalModel);
  const testLocalModel = useProviderStore((s) => s.testLocalModel);
  const deleteLocalModel = useProviderStore((s) => s.deleteLocalModel);

  const downloadedByName = new Map(downloadedModels.map((m) => [m.filename, m]));

  return (
    <div className="space-y-5 text-xs">
      {/* Zero-Config Explanation + Runtime Status Card */}
      <div className={`rounded-xl border p-4 space-y-3 ${theme.surfaceBg} ${theme.border}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className={`w-4 h-4 ${theme.accentText}`} />
              <h3 className="text-sm font-semibold">Built-in Offline Runtime (llama-server)</h3>
            </div>
            <p className={`mt-0.5 ${theme.textMuted}`}>
              Everything is managed automatically inside DocuSage — no manual local path or folder configuration needed. Downloading any model below automatically installs the runtime and loads it for you.
            </p>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold shrink-0 border ${
              runtimeStatus.installed
                ? theme.accentSoft
                : theme.isDark
                ? 'bg-amber-500/20 text-amber-200 border-amber-400/50'
                : 'bg-amber-50 text-amber-800 border-amber-300'
            }`}
          >
            {runtimeStatus.installed ? 'Installed' : 'Not Installed'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
          <div className={`rounded-lg p-2.5 border ${theme.subtleBg} ${theme.border}`}>
            <div className={theme.textMuted}>Platform</div>
            <div className="font-mono mt-0.5 font-medium truncate">
              {runtimeStatus.version
                ? `${runtimeStatus.platformSummary} · ${runtimeStatus.version}`
                : runtimeStatus.platformSummary}
            </div>
          </div>
          <div className={`rounded-lg p-2.5 border ${theme.subtleBg} ${theme.border}`}>
            <div className={theme.textMuted}>Chat Server</div>
            <div className="font-mono mt-0.5 font-medium">
              {runtimeStatus.running ? `127.0.0.1:${runtimeStatus.port}` : 'Standby'}
            </div>
          </div>
          <div className={`rounded-lg p-2.5 border ${theme.subtleBg} ${theme.border}`}>
            <div className={theme.textMuted}>Embedding Server</div>
            <div className="font-mono mt-0.5 font-medium truncate">
              {runtimeStatus.embeddingRunning
                ? `:${runtimeStatus.embeddingPort} (${runtimeStatus.embeddingModel})`
                : 'FTS5 Offline'}
            </div>
          </div>
        </div>

        {runtimeProgress && !runtimeProgress.done && (
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="truncate">
                {runtimeProgress.stage === 'starting'
                  ? `Starting runtime: ${runtimeProgress.assetName}`
                  : runtimeProgress.assetName
                  ? `${runtimeProgress.stage}: ${runtimeProgress.assetName}`
                  : `${runtimeProgress.stage}…`}
              </span>
              <span className="font-mono">{runtimeProgress.percent.toFixed(0)}%</span>
            </div>
            <div className={`h-1.5 rounded-full overflow-hidden ${theme.progressTrack}`}>
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(100, runtimeProgress.percent)}%` }}
              />
            </div>
          </div>
        )}

        {runtimeProgress?.done && runtimeProgress.error && (
          <div className={`rounded-xl border px-3 py-2 text-[11.5px] ${theme.dangerSoft}`}>
            <div className="font-semibold">Runtime setup error</div>
            <div className="opacity-90 break-words">{runtimeProgress.error}</div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isInstallingRuntime}
            onClick={() => void installRuntime()}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg disabled:opacity-50 ${theme.accent}`}
          >
            {isInstallingRuntime ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>
              {isInstallingRuntime
                ? 'Installing llama-server…'
                : runtimeStatus.installed
                ? 'Update / Reinstall Runtime'
                : `Install Local Runtime (${runtimeStatus.detectedBackend})`}
            </span>
          </button>

          {downloadedModels.length > 0 && (
            <button
              type="button"
              disabled={isTestingLocalModel || isInstallingRuntime || isConnectingModel}
              onClick={() => void testLocalModel()}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium disabled:opacity-50 ${theme.border} ${theme.hoverBg}`}
            >
              {isTestingLocalModel ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{isTestingLocalModel ? 'Testing Local Model…' : 'Test Local Model'}</span>
            </button>
          )}

          {runtimeStatus.running && (
            <>
              <button
                type="button"
                onClick={() => void restartLocalEngine()}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border ${theme.border} ${theme.hoverBg}`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restart</span>
              </button>
              <button
                type="button"
                onClick={() => void disconnectLocalModel()}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border ${theme.border} ${theme.hoverBg}`}
              >
                <Link2Off className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </>
          )}
        </div>

        {localTestResult && (
          <div
            className={`rounded-xl border px-3 py-2 text-[11.5px] space-y-0.5 ${
              localTestResult.ok ? theme.accentSoft : theme.dangerSoft
            }`}
          >
            <div className="font-semibold">{localTestResult.message}</div>
            {localTestResult.reply && (
              <div className="opacity-90">Model reply: “{localTestResult.reply}”</div>
            )}
          </div>
        )}
      </div>

      {/* Inline Callout when models exist but runtime is not yet installed */}
      {downloadedModels.length > 0 && !runtimeStatus.installed && (
        <div
          className={`rounded-xl border px-3.5 py-3 flex items-center justify-between gap-3 ${
            theme.isDark
              ? 'bg-amber-500/15 border-amber-400/50 text-amber-100'
              : 'bg-amber-50 border-amber-300 text-amber-950'
          }`}
        >
          <div className="flex items-start gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <div className="font-semibold">Install Local Runtime to load your downloaded models</div>
              <div className="text-[11px] opacity-90">
                Click Install Local Runtime once — DocuSage will automatically run your GGUF models with zero path setup.
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={isInstallingRuntime}
            onClick={() => void installRuntime()}
            className={`px-3 py-1.5 rounded-lg text-[11px] shrink-0 disabled:opacity-50 ${theme.accent}`}
          >
            {isInstallingRuntime ? 'Installing…' : 'Install Runtime'}
          </button>
        </div>
      )}

      {/* Downloaded GGUF Files */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-[13px] flex items-center gap-1.5">
            <HardDrive className={`w-4 h-4 ${theme.accentText}`} />
            <span>Downloaded GGUF Models ({downloadedModels.length})</span>
          </h4>
          <span className={`text-[10.5px] ${theme.textMuted}`}>Managed automatically by DocuSage</span>
        </div>

        {downloadedModels.length === 0 ? (
          <div className={`rounded-xl border p-4 text-center ${theme.surfaceBg} ${theme.border} ${theme.textMuted}`}>
            No models downloaded yet. Click <strong>Download &amp; Run</strong> on any model below — DocuSage will download, install the runtime if needed, and load it automatically.
          </div>
        ) : (
          <div className="space-y-1.5">
            {downloadedModels.map((m) => {
              const isChatConnected = connectedModel === m.filename && runtimeStatus.running;
              const isEmbedConnected = runtimeStatus.embeddingModel === m.filename && runtimeStatus.embeddingRunning;
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
                      {isChatConnected && <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`} />}
                    </div>
                    <div className={`text-[10.5px] ${theme.textMuted}`}>{formatBytes(m.sizeBytes)}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={isConnectingModel || isInstallingRuntime || isChatConnected}
                      onClick={() => void connectLocalModel(m.path)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium disabled:opacity-50 ${
                        isChatConnected ? theme.accentSoft : `${theme.border} ${theme.hoverBg}`
                      }`}
                    >
                      <Link className="w-3 h-3" />
                      <span>{isChatConnected ? 'Chat Active' : 'Load Chat'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isConnectingEmbedding || isInstallingRuntime || isEmbedConnected}
                      onClick={() => void connectLocalEmbeddingModel(m.path)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium disabled:opacity-50 ${
                        isEmbedConnected ? theme.accentSoft : `${theme.border} ${theme.hoverBg}`
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

      {/* Curated GGUF Catalog (1-Click Download, Auto-Install Runtime, Auto-Load & Redirect) */}
      <div className="space-y-2">
        <div>
          <h4 className="font-semibold text-[13px]">One-Click Local Model Catalog</h4>
          <p className={`text-[11px] ${theme.textMuted}`}>
            Click Download &amp; Run to download directly into DocuSage, auto-install the runtime, and return to chat while it sets up.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {MODEL_CATALOG.map((entry) => {
            const downloaded = downloadedByName.get(entry.filename);
            const prog = modelDownloads[entry.filename];
            const downloading = Boolean(prog && !prog.done);
            const isActive =
              entry.kind === 'chat'
                ? connectedModel === entry.filename && runtimeStatus.running
                : runtimeStatus.embeddingModel === entry.filename && runtimeStatus.embeddingRunning;

            return (
              <div
                key={entry.id}
                className={`rounded-xl border p-3 flex flex-col justify-between gap-2.5 ${theme.surfaceBg} ${
                  isActive ? 'border-emerald-500/60' : theme.border
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{entry.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${theme.badgeBg}`}>
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
                    <div className={`h-1.5 rounded-full overflow-hidden ${theme.progressTrack}`}>
                      <div
                        className="h-full bg-emerald-500 transition-all"
                        style={{ width: `${Math.min(100, prog.percent)}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isActive || isConnectingModel || isInstallingRuntime}
                    onClick={() => void downloadAndSetupLocalModel(entry)}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-55 ${
                      isActive
                        ? theme.accentSoft
                        : downloaded
                        ? `${theme.border} ${theme.hoverBg}`
                        : theme.accentSoft
                    }`}
                  >
                    {isActive ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Active &amp; Ready</span>
                      </>
                    ) : downloaded ? (
                      <>
                        <Play className="w-3 h-3" />
                        <span>{entry.kind === 'chat' ? 'Load & Use Now' : 'Activate Embeddings'}</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3 h-3" />
                        <span>{entry.kind === 'chat' ? 'Download & Run' : 'Download & Enable'}</span>
                      </>
                    )}
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
