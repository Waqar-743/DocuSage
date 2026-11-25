import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Download,
  HardDrive,
  Info,
  Link,
  Link2Off,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  findCatalogEntryByFilename,
  fitSummary,
  formatBytes,
  formatEta,
  formatSpeed,
  MODEL_CATALOG,
  modelFit,
  nominalRamGb,
  REASONING_LABELS,
  recommendModel,
  releaseLabel,
  STORE_FILTER_TAGS,
  type DeviceFit,
  type ModelTag,
} from '../../lib/catalog';
import { THEMES } from '../../lib/themes';
import { useProviderStore } from '../../stores/useProviderStore';
import { useUiStore } from '../../stores/useUiStore';
import { LoadingDots } from '../common/LoadingDots';

const MeterBars: React.FC<{ label: string; value: number; accentClass: string; mutedClass: string }> = ({
  label,
  value,
  accentClass,
  mutedClass,
}) => (
  <span className="inline-flex items-center gap-1.5 text-[10.5px]">
    <span className={mutedClass}>{label}</span>
    <span className="inline-flex items-center gap-0.5" aria-label={`${label} ${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`inline-block w-1.5 h-2.5 rounded-[2px] ${
            i <= value ? accentClass : 'bg-current opacity-15'
          }`}
        />
      ))}
    </span>
  </span>
);

function fitBadge(fit: DeviceFit): { label: string; cls: string } | null {
  if (fit === 'unknown') return null;
  if (fit === 'good') {
    return {
      label: 'Fits comfortably',
      cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/35',
    };
  }
  if (fit === 'tight') {
    return {
      label: 'Tight fit',
      cls: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
    };
  }
  return {
    label: 'May be slow',
    cls: 'bg-rose-500/15 text-rose-300 border-rose-500/35',
  };
}

export const LocalRuntimeTab: React.FC = () => {
  const theme = useUiStore((s) => THEMES[s.theme]);

  const runtimeStatus = useProviderStore((s) => s.runtimeStatus);
  const runtimeProgress = useProviderStore((s) => s.runtimeProgress);
  const isInstallingRuntime = useProviderStore((s) => s.isInstallingRuntime);
  const isConnectingModel = useProviderStore((s) => s.isConnectingModel);
  const isTestingLocalModel = useProviderStore((s) => s.isTestingLocalModel);
  const localTestResult = useProviderStore((s) => s.localTestResult);
  const localSetup = useProviderStore((s) => s.localSetup);
  const downloadedModels = useProviderStore((s) => s.downloadedModels);
  const partialDownloads = useProviderStore((s) => s.partialDownloads);
  const connectedModel = useProviderStore((s) => s.connectedModel);
  const modelDownloads = useProviderStore((s) => s.modelDownloads);
  const isLocalBusy =
    isConnectingModel ||
    isTestingLocalModel ||
    isInstallingRuntime ||
    Boolean(runtimeStatus.loading);

  const installRuntime = useProviderStore((s) => s.installRuntime);
  const connectLocalModel = useProviderStore((s) => s.connectLocalModel);
  const disconnectLocalModel = useProviderStore((s) => s.disconnectLocalModel);
  const restartLocalEngine = useProviderStore((s) => s.restartLocalEngine);
  const downloadAndSetupLocalModel = useProviderStore((s) => s.downloadAndSetupLocalModel);
  const cancelModelDownload = useProviderStore((s) => s.cancelModelDownload);
  const discardPartialDownload = useProviderStore((s) => s.discardPartialDownload);
  const testLocalModel = useProviderStore((s) => s.testLocalModel);
  const deleteLocalModel = useProviderStore((s) => s.deleteLocalModel);

  const selectedModelId = useUiStore((s) => s.selectedLocalModelId);
  const setSelectedModelId = useUiStore((s) => s.setSelectedLocalModelId);
  const [activeFilter, setActiveFilter] = useState<'All' | ModelTag>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const downloadedByName = useMemo(
    () => new Map(downloadedModels.map((m) => [m.filename.toLowerCase(), m])),
    [downloadedModels],
  );

  const partialByName = useMemo(
    () => new Map(partialDownloads.map((p) => [p.filename.toLowerCase(), p])),
    [partialDownloads],
  );

  const deviceMemory = runtimeStatus.totalMemoryBytes ?? null;
  const ramGb = nominalRamGb(deviceMemory);
  const recommendedPick = useMemo(
    () => recommendModel(MODEL_CATALOG, deviceMemory),
    [deviceMemory],
  );

  const selectedModel = useMemo(
    () => MODEL_CATALOG.find((m) => m.id === selectedModelId) ?? null,
    [selectedModelId],
  );

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return MODEL_CATALOG.filter((m) => {
      if (activeFilter === 'All') {
        if (m.legacy && !downloadedByName.has(m.filename.toLowerCase()) && !q) {
          return false;
        }
      } else if (m.tag !== activeFilter) {
        return false;
      }
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.company.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.parameters.toLowerCase().includes(q) ||
        m.quantization.toLowerCase().includes(q) ||
        m.bestFor.some((b) => b.toLowerCase().includes(q))
      );
    });
  }, [activeFilter, downloadedByName, searchQuery]);

  // ── Model Detail View (Neurix ModelDetailPage style) ────────────────────────
  if (selectedModel) {
    const downloaded = downloadedByName.get(selectedModel.filename.toLowerCase());
    const partial = partialByName.get(selectedModel.filename.toLowerCase());
    const prog = modelDownloads[selectedModel.filename];
    const downloading = Boolean(prog && !prog.done);
    const hasSavedPartial = !downloaded && !downloading && Boolean(partial && partial.downloadedBytes > 0);
    const partialPct =
      hasSavedPartial && partial && selectedModel.sizeBytes > 0
        ? Math.min(99.9, (partial.downloadedBytes / selectedModel.sizeBytes) * 100)
        : 0;
    const isVerifying = downloading && prog?.stage === 'verifying';
    const isActive =
      connectedModel?.toLowerCase() === selectedModel.filename.toLowerCase() &&
      runtimeStatus.running;
    const fit = modelFit(selectedModel, deviceMemory);
    const badge = fitBadge(fit);
    const warnFit = fit === 'tight' || fit === 'too_big';
    const dlBytes = prog?.downloaded ?? 0;
    const totalBytes = prog?.total || selectedModel.sizeBytes;
    const speedBps = prog?.speedBps ?? 0;
    const pct = prog ? Math.min(100, Math.max(0, prog.percent)) : 0;

    return (
      <div className="space-y-4 text-xs" aria-label={`Details for ${selectedModel.name}`}>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setSelectedModelId(null)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-medium ${theme.border} ${theme.hoverBg}`}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Local Models</span>
          </button>
          <span className={`text-[10.5px] font-mono ${theme.textMuted}`}>
            {selectedModel.hfRepo}
          </span>
        </div>

        {/* Hero Detail Card */}
        <div className={`rounded-xl border p-4 space-y-3.5 ${theme.surfaceBg} ${theme.border}`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className={`text-[10px] font-bold uppercase tracking-wider ${theme.accentText}`}>
                {selectedModel.company}
              </div>
              <h3 className="text-base font-bold mt-0.5">{selectedModel.name}</h3>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md border ${theme.accentSoft}`}>
                {selectedModel.tag}
              </span>
              <span className={`text-[10.5px] font-mono px-2 py-0.5 rounded-md ${theme.badgeBg}`}>
                {selectedModel.quantization.split(' ')[0]}
              </span>
              <span className={`text-[10.5px] font-mono px-2 py-0.5 rounded-md ${theme.badgeBg}`}>
                {selectedModel.size}
              </span>
            </div>
          </div>

          <p className={`text-[12px] leading-relaxed ${theme.textMuted}`}>
            {selectedModel.description}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3.5">
              <MeterBars
                label="Quality"
                value={selectedModel.quality}
                accentClass="bg-emerald-400"
                mutedClass={theme.textMuted}
              />
              <MeterBars
                label="Speed"
                value={selectedModel.speed}
                accentClass="bg-sky-400"
                mutedClass={theme.textMuted}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedModel.bestFor.map((item) => (
                <span
                  key={item}
                  className={`text-[10.5px] px-2 py-0.5 rounded-md border ${theme.subtleBg} ${theme.border}`}
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          {/* Device Memory Fit Callout */}
          <div
            className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-2 flex-wrap ${
              warnFit
                ? 'bg-amber-500/10 border-amber-500/35'
                : 'bg-emerald-500/10 border-emerald-500/35'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {warnFit ? (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              )}
              <span className="text-[11.5px]">
                {fitSummary(selectedModel, deviceMemory)}
                {fit === 'too_big'
                  ? ' — a smaller model will run more reliably.'
                  : fit === 'tight'
                  ? ' — expect slower replies under heavy memory load.'
                  : '.'}
              </span>
            </div>
            {badge && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${badge.cls}`}>
                {badge.label}
              </span>
            )}
          </div>

          {/* Live Download Telemetry Panel (Neurix DownloadingPage style) */}
          {downloading && prog && (
            <div className={`rounded-xl border p-3.5 space-y-2.5 ${theme.subtleBg} ${theme.border}`}>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className={`text-[10px] uppercase tracking-wider font-semibold ${theme.textMuted}`}>
                    {isVerifying ? 'Stage' : 'Download Speed'}
                  </div>
                  <div className={`text-sm font-mono font-bold ${theme.accentText}`}>
                    {isVerifying ? 'Verifying SHA-256…' : formatSpeed(speedBps)}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-[10px] uppercase tracking-wider font-semibold ${theme.textMuted}`}>
                    Remaining
                  </div>
                  <div className="text-sm font-mono font-bold">
                    {isVerifying
                      ? 'Checking…'
                      : formatEta(prog.etaSecs, Math.max(0, totalBytes - dlBytes), speedBps)}
                  </div>
                </div>
              </div>

              <div className={`h-2 rounded-full overflow-hidden ${theme.progressTrack}`}>
                <div
                  className={`h-full transition-all duration-200 ${
                    isVerifying ? 'w-full animate-pulse bg-emerald-500' : 'bg-emerald-500'
                  }`}
                  style={isVerifying ? undefined : { width: `${pct}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className={theme.textMuted}>
                  {formatBytes(dlBytes)} / {formatBytes(totalBytes)}
                </span>
                <span className={`font-semibold ${theme.accentText}`}>{pct.toFixed(1)}%</span>
              </div>

              <div className={`pt-2 border-t flex flex-wrap items-center justify-between gap-2 text-[10.5px] ${theme.border} ${theme.textMuted}`}>
                <span className="font-mono truncate">{selectedModel.filename}</span>
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  {selectedModel.sha256 ? 'SHA-256 verified transfer' : 'GGUF integrity check'}
                </span>
              </div>

              {!isVerifying && (
                <button
                  type="button"
                  onClick={() => void cancelModelDownload(selectedModel.filename)}
                  className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium ${theme.border} ${theme.hoverBg}`}
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause Download (Resume Anytime)</span>
                </button>
              )}
            </div>
          )}

          {/* Primary Action CTA */}
          {!downloading && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isActive || isLocalBusy}
                  onClick={() => void downloadAndSetupLocalModel(selectedModel)}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-55 ${
                    isActive ? theme.accentSoft : theme.accent
                  }`}
                >
                  {isActive ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Active &amp; Ready in Chat</span>
                    </>
                  ) : downloaded ? (
                    <>
                      <Play className="w-4 h-4" />
                      <span>Load &amp; Use Now</span>
                    </>
                  ) : hasSavedPartial && partial ? (
                    <>
                      <Play className="w-4 h-4" />
                      <span>
                        Resume Download · {partialPct.toFixed(1)}% ({formatBytes(partial.downloadedBytes)} saved)
                      </span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Download &amp; Run · {selectedModel.size}</span>
                    </>
                  )}
                </button>

                {hasSavedPartial && (
                  <button
                    type="button"
                    onClick={() => void discardPartialDownload(selectedModel.filename)}
                    aria-label={`Discard partial download for ${selectedModel.name}`}
                    className="px-3 py-2 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/15 inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Discard</span>
                  </button>
                )}

                {downloaded && !isActive && (
                  <button
                    type="button"
                    onClick={() => void deleteLocalModel(downloaded.path)}
                    aria-label={`Delete ${selectedModel.name}`}
                    className="px-3 py-2 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/15 inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                )}
              </div>
              <div className={`text-[10.5px] text-center ${theme.textMuted}`}>
                {selectedModel.sha256
                  ? `Downloaded once (${selectedModel.size}), verified with SHA-256, then runs 100% offline in an isolated local worker.`
                  : `Downloaded once (${selectedModel.size}), verified as valid GGUF, then runs 100% offline in an isolated local worker.`}
              </div>
            </div>
          )}
        </div>

        {/* 2-Column Specifications Bento Grid (Neurix ModelDetailPage style) */}
        <div className="space-y-2">
          <h4 className={`text-[10.5px] font-bold uppercase tracking-wider ${theme.textMuted}`}>
            Model Specifications
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className={`rounded-lg border p-2.5 ${theme.surfaceBg} ${theme.border}`}>
              <div className={`text-[10.5px] ${theme.textMuted}`}>Publisher</div>
              <div className="font-semibold mt-0.5">{selectedModel.company}</div>
            </div>
            <div className={`rounded-lg border p-2.5 ${theme.surfaceBg} ${theme.border}`}>
              <div className={`text-[10.5px] ${theme.textMuted}`}>Parameters</div>
              <div className="font-mono font-semibold mt-0.5">{selectedModel.parameters}</div>
            </div>
            <div className={`rounded-lg border p-2.5 ${theme.surfaceBg} ${theme.border}`}>
              <div className={`text-[10.5px] ${theme.textMuted}`}>Quantization</div>
              <div className="font-mono font-semibold mt-0.5">{selectedModel.quantization}</div>
            </div>
            <div className={`rounded-lg border p-2.5 ${theme.surfaceBg} ${theme.border}`}>
              <div className={`text-[10.5px] ${theme.textMuted}`}>Memory Needed</div>
              <div className="font-mono font-semibold mt-0.5">
                {selectedModel.minRamGb} GB{ramGb ? ` (device: ${ramGb} GB)` : ''}
              </div>
            </div>
            <div className={`rounded-lg border p-2.5 ${theme.surfaceBg} ${theme.border}`}>
              <div className={`text-[10.5px] ${theme.textMuted}`}>Context Window</div>
              <div className="font-mono font-semibold mt-0.5">
                up to {selectedModel.contextLength.toLocaleString()} tokens
              </div>
            </div>
            <div className={`rounded-lg border p-2.5 ${theme.surfaceBg} ${theme.border}`}>
              <div className={`text-[10.5px] ${theme.textMuted}`}>Reasoning</div>
              <div className="font-semibold mt-0.5">{REASONING_LABELS[selectedModel.reasoning]}</div>
            </div>
            <div className={`rounded-lg border p-2.5 ${theme.surfaceBg} ${theme.border}`}>
              <div className={`text-[10.5px] ${theme.textMuted}`}>Download Size</div>
              <div className="font-mono font-semibold mt-0.5">
                {selectedModel.size} ({formatBytes(selectedModel.sizeBytes)})
              </div>
            </div>
            <div className={`rounded-lg border p-2.5 ${theme.surfaceBg} ${theme.border}`}>
              <div className={`text-[10.5px] ${theme.textMuted}`}>Released</div>
              <div className="font-semibold mt-0.5">{releaseLabel(selectedModel.released)}</div>
            </div>
            <div className={`rounded-lg border p-2.5 sm:col-span-2 ${theme.surfaceBg} ${theme.border}`}>
              <div className={`text-[10.5px] ${theme.textMuted}`}>GGUF File &amp; Integrity</div>
              <div className="font-mono text-[11px] font-medium mt-0.5 break-all">
                {selectedModel.hfRepo}/{selectedModel.filename}
              </div>
              {selectedModel.sha256 && (
                <div className={`font-mono text-[10px] mt-1 break-all ${theme.textMuted}`}>
                  SHA-256: {selectedModel.sha256}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main Local AI & Model Catalog View ─────────────────────────────────────
  return (
    <div className="space-y-5 text-xs">
      {/* Built-in Crash-Isolated Engine Status Card */}
      <div className={`rounded-xl border p-4 space-y-3 ${theme.surfaceBg} ${theme.border}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className={`w-4 h-4 ${theme.accentText}`} />
              <h3 className="text-sm font-semibold">
                Built-in Offline Engine (Isolated llama.cpp Worker)
              </h3>
            </div>
            <p className={`mt-0.5 ${theme.textMuted}`}>
              Runs GGUF models in a crash-isolated local worker process—no external downloads, no port setup, and a native engine fault can never close DocuSage.
            </p>
          </div>
          {(() => {
            const hasLoadError = Boolean(
              runtimeStatus.lastError ||
                localTestResult?.ok === false ||
                localSetup.stage === 'error',
            );
            const statusBadge = !runtimeStatus.installed
              ? {
                  label: 'Not Installed',
                  cls: theme.isDark
                    ? 'bg-amber-500/20 text-amber-200 border-amber-400/50'
                    : 'bg-amber-50 text-amber-800 border-amber-300',
                }
              : isConnectingModel || runtimeStatus.loading
              ? {
                  label: 'Loading Model…',
                  cls: theme.isDark
                    ? 'bg-amber-500/20 text-amber-200 border-amber-400/50'
                    : 'bg-amber-50 text-amber-800 border-amber-300',
                }
              : isTestingLocalModel
              ? {
                  label: 'Testing Model…',
                  cls: theme.isDark
                    ? 'bg-amber-500/20 text-amber-200 border-amber-400/50'
                    : 'bg-amber-50 text-amber-800 border-amber-300',
                }
              : runtimeStatus.running && runtimeStatus.loadedModel
              ? { label: 'Model Loaded', cls: theme.accentSoft }
              : hasLoadError
              ? { label: 'Load Failed', cls: theme.dangerSoft }
              : { label: 'Standby', cls: `${theme.badgeBg} ${theme.border}` };
            return (
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold shrink-0 border ${statusBadge.cls}`}
              >
                {(isConnectingModel || runtimeStatus.loading) && (
                  <LoadingDots dotClassName="w-1 h-1" label="Loading model" />
                )}
                <span>{statusBadge.label}</span>
              </span>
            );
          })()}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
          <div className={`rounded-lg p-2.5 border ${theme.subtleBg} ${theme.border}`}>
            <div className={theme.textMuted}>Hardware</div>
            <div className="font-mono mt-0.5 font-medium truncate">
              {runtimeStatus.platformSummary}
            </div>
          </div>
          <div className={`rounded-lg p-2.5 border ${theme.subtleBg} ${theme.border}`}>
            <div className={theme.textMuted}>Loaded Model</div>
            <div className="font-mono mt-0.5 font-medium truncate">
              {runtimeStatus.running && runtimeStatus.loadedModel
                ? findCatalogEntryByFilename(runtimeStatus.loadedModel)?.name ??
                  runtimeStatus.loadedModel
                : 'Standby'}
            </div>
          </div>
          <div className={`rounded-lg p-2.5 border ${theme.subtleBg} ${theme.border}`}>
            <div className={theme.textMuted}>Context / Search</div>
            <div className="font-mono mt-0.5 font-medium truncate">
              {runtimeStatus.contextLength
                ? `${runtimeStatus.contextLength.toLocaleString()} tok · FTS5`
                : 'FTS5 Offline'}
            </div>
          </div>
        </div>

        {runtimeProgress && !runtimeProgress.done && (
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="truncate">
                {runtimeProgress.stage === 'starting'
                  ? `Loading model: ${runtimeProgress.assetName}`
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
          {!runtimeStatus.installed && (
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
                  ? 'Preparing Runtime…'
                  : `Install Local Runtime (${runtimeStatus.detectedBackend})`}
              </span>
            </button>
          )}

          {downloadedModels.length > 0 && (
            <button
              type="button"
              disabled={isLocalBusy}
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
                disabled={isLocalBusy}
                onClick={() => void restartLocalEngine()}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border disabled:opacity-50 ${theme.border} ${theme.hoverBg}`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reload</span>
              </button>
              <button
                type="button"
                disabled={isLocalBusy}
                onClick={() => void disconnectLocalModel()}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border disabled:opacity-50 ${theme.border} ${theme.hoverBg}`}
              >
                <Link2Off className="w-3.5 h-3.5" />
                <span>Unload</span>
              </button>
            </>
          )}
        </div>

        {runtimeStatus.lastError && !localTestResult && (
          <div className={`rounded-xl border px-3 py-2 text-[11.5px] space-y-1 ${theme.dangerSoft}`}>
            <div className="font-semibold">Local model load error</div>
            <div className="opacity-90 break-words">{runtimeStatus.lastError}</div>
          </div>
        )}

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

        {runtimeStatus.logPath && (
          <div className={`text-[10.5px] font-mono truncate ${theme.textMuted}`} title={runtimeStatus.logPath}>
            Diagnostic log: {runtimeStatus.logPath}
          </div>
        )}
      </div>

      {/* Downloaded GGUF Files */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-[13px] flex items-center gap-1.5">
            <HardDrive className={`w-4 h-4 ${theme.accentText}`} />
            <span>My Downloaded Models ({downloadedModels.length})</span>
          </h4>
          <span className={`text-[10.5px] ${theme.textMuted}`}>Managed automatically</span>
        </div>

        {downloadedModels.length === 0 ? (
          <div className={`rounded-xl border p-4 text-center ${theme.surfaceBg} ${theme.border} ${theme.textMuted}`}>
            No models downloaded yet. Pick a model below and click <strong>Download &amp; Run</strong> — it downloads with live speed &amp; SHA-256 verification and loads directly in-process.
          </div>
        ) : (
          <div className="space-y-1.5">
            {downloadedModels.map((m) => {
              const catalogMatch = findCatalogEntryByFilename(m.filename);
              const isChatConnected =
                connectedModel?.toLowerCase() === m.filename.toLowerCase() &&
                runtimeStatus.running;
              return (
                <div
                  key={m.path}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${theme.surfaceBg} ${
                    isChatConnected ? 'border-emerald-500/60' : theme.border
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (catalogMatch) setSelectedModelId(catalogMatch.id);
                    }}
                    className="min-w-0 text-left flex-1 group"
                  >
                    <div className="font-medium truncate flex items-center gap-1.5">
                      <span className={catalogMatch ? 'group-hover:underline' : ''}>
                        {catalogMatch ? catalogMatch.name : m.filename}
                      </span>
                      {isChatConnected && (
                        <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`} />
                      )}
                    </div>
                    <div className={`text-[10.5px] flex items-center gap-2 ${theme.textMuted}`}>
                      <span>{formatBytes(m.sizeBytes)}</span>
                      {catalogMatch && (
                        <>
                          <span>·</span>
                          <span>{catalogMatch.company}</span>
                          <span>·</span>
                          <span>{catalogMatch.quantization.split(' ')[0]}</span>
                        </>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {catalogMatch && (
                      <button
                        type="button"
                        onClick={() => setSelectedModelId(catalogMatch.id)}
                        aria-label={`View details for ${catalogMatch.name}`}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] ${theme.border} ${theme.hoverBg}`}
                      >
                        <Info className="w-3 h-3" />
                        <span>Details</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isLocalBusy || isChatConnected}
                      onClick={() => void connectLocalModel(m.path)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium disabled:opacity-50 ${
                        isChatConnected ? theme.accentSoft : `${theme.border} ${theme.hoverBg}`
                      }`}
                    >
                      {isConnectingModel ? (
                        <LoadingDots dotClassName="w-1 h-1" label="Loading model" />
                      ) : (
                        <Link className="w-3 h-3" />
                      )}
                      <span>
                        {isChatConnected ? 'Chat Active' : isConnectingModel ? 'Loading' : 'Load Chat'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={isLocalBusy || isChatConnected}
                      onClick={() => void deleteLocalModel(m.path)}
                      aria-label={`Delete ${m.filename}`}
                      className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15 disabled:opacity-40"
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

      {/* Recommended Pick Card (Neurix Store style) */}
      {recommendedPick &&
        !searchQuery.trim() &&
        activeFilter === 'All' &&
        !downloadedByName.has(recommendedPick.filename.toLowerCase()) && (
          <div className={`rounded-xl border-2 border-emerald-500/50 p-3.5 space-y-2.5 ${theme.surfaceBg}`}>
            <div className="flex items-center justify-between gap-2">
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${theme.accentText}`}>
                <Sparkles className="w-3 h-3" />
                Recommended for your device{ramGb ? ` (${ramGb} GB RAM)` : ''}
              </span>
              <span className={`text-[10.5px] font-mono ${theme.textMuted}`}>
                {recommendedPick.size} · {recommendedPick.quantization.split(' ')[0]}
              </span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold">{recommendedPick.name}</div>
                <p className={`text-[11px] mt-0.5 leading-relaxed ${theme.textMuted}`}>
                  {recommendedPick.description}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <MeterBars
                label="Quality"
                value={recommendedPick.quality}
                accentClass="bg-emerald-400"
                mutedClass={theme.textMuted}
              />
              <MeterBars
                label="Speed"
                value={recommendedPick.speed}
                accentClass="bg-sky-400"
                mutedClass={theme.textMuted}
              />
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                disabled={isConnectingModel || Boolean(modelDownloads[recommendedPick.filename] && !modelDownloads[recommendedPick.filename].done)}
                onClick={() => void downloadAndSetupLocalModel(recommendedPick)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-50 ${theme.accent}`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download &amp; Run · {recommendedPick.size}</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedModelId(recommendedPick.id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium ${theme.border} ${theme.hoverBg}`}
              >
                <span>View Details</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

      {/* Curated Neurix GGUF Model Catalog */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="font-semibold text-[13px]">Local Model Store</h4>
            <p className={`text-[11px] ${theme.textMuted}`}>
              Click any model to inspect full specifications, RAM fit, quantization, and download progress.
            </p>
          </div>
          <div className="relative w-full sm:w-56">
            <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${theme.textMuted}`} />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search models, tasks…"
              aria-label="Search local models"
              className={`w-full pl-8 pr-2.5 py-1.5 rounded-lg border text-[11.5px] outline-none ${theme.inputBg} ${theme.border}`}
            />
          </div>
        </div>

        {/* Category Filter Chips (All, Tiny, Fast, Balanced, Smart, Specialist, Legacy) */}
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter models by category">
          {STORE_FILTER_TAGS.map((tag) => {
            const active = activeFilter === tag;
            return (
              <button
                key={tag}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveFilter(tag)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors border ${
                  active ? theme.accent : `${theme.subtleBg} ${theme.border} ${theme.hoverBg}`
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>

        {filteredCatalog.length === 0 ? (
          <div className={`rounded-xl border p-6 text-center ${theme.surfaceBg} ${theme.border} ${theme.textMuted}`}>
            No models match your search. Try another keyword or switch category filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {filteredCatalog.map((entry) => {
              const downloaded = downloadedByName.get(entry.filename.toLowerCase());
              const partial = partialByName.get(entry.filename.toLowerCase());
              const prog = modelDownloads[entry.filename];
              const downloading = Boolean(prog && !prog.done);
              const hasSavedPartial =
                !downloaded && !downloading && Boolean(partial && partial.downloadedBytes > 0);
              const partialPct =
                hasSavedPartial && partial && entry.sizeBytes > 0
                  ? Math.min(99.9, (partial.downloadedBytes / entry.sizeBytes) * 100)
                  : 0;
              const isVerifying = downloading && prog?.stage === 'verifying';
              const isActive =
                connectedModel?.toLowerCase() === entry.filename.toLowerCase() &&
                runtimeStatus.running;
              const fit = modelFit(entry, deviceMemory);
              const badge = fitBadge(fit);
              const dlBytes = prog?.downloaded ?? 0;
              const totalBytes = prog?.total || entry.sizeBytes;
              const speedBps = prog?.speedBps ?? 0;

              return (
                <div
                  key={entry.id}
                  onClick={() => setSelectedModelId(entry.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedModelId(entry.id);
                    }
                  }}
                  aria-label={`${entry.name} by ${entry.company}, ${entry.size}`}
                  className={`rounded-xl border p-3 flex flex-col justify-between gap-2.5 cursor-pointer transition-colors ${theme.surfaceBg} ${
                    isActive
                      ? 'border-emerald-500/60'
                      : `${theme.border} hover:border-emerald-500/40`
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold flex items-center gap-1.5 flex-wrap">
                          <span>{entry.name}</span>
                          <span className={`text-[10px] font-normal ${theme.textMuted}`}>
                            {entry.company}
                          </span>
                        </div>
                      </div>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${theme.badgeBg}`}>
                        {entry.size}
                      </span>
                    </div>

                    <p className={`text-[11px] leading-relaxed line-clamp-2 ${theme.textMuted}`}>
                      {entry.description}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                      <div className="flex items-center gap-2.5">
                        <MeterBars
                          label="Quality"
                          value={entry.quality}
                          accentClass="bg-emerald-400"
                          mutedClass={theme.textMuted}
                        />
                        <MeterBars
                          label="Speed"
                          value={entry.speed}
                          accentClass="bg-sky-400"
                          mutedClass={theme.textMuted}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      <span className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded ${theme.badgeBg}`}>
                        {entry.tag}
                      </span>
                      <span className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded ${theme.badgeBg}`}>
                        {entry.quantization.split(' ')[0]}
                      </span>
                      {entry.reasoning !== 'none' && (
                        <span className={`text-[9.5px] px-1.5 py-0.5 rounded border ${theme.border} ${theme.textMuted}`}>
                          {entry.reasoning === 'always' ? 'Reasoning' : 'Thinking'}
                        </span>
                      )}
                      {badge && (
                        <span className={`text-[9.5px] font-medium px-1.5 py-0.5 rounded border ${badge.cls}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                  </div>

                  {downloading && prog ? (
                    <div
                      className="space-y-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex justify-between text-[10.5px] font-mono">
                        <span>
                          {isVerifying
                            ? 'Verifying SHA-256…'
                            : `${formatBytes(dlBytes)} / ${formatBytes(totalBytes)}`}
                        </span>
                        <span className="font-semibold">{prog.percent.toFixed(1)}%</span>
                      </div>
                      <div className={`h-1.5 rounded-full overflow-hidden ${theme.progressTrack}`}>
                        <div
                          className={`h-full transition-all ${
                            isVerifying ? 'w-full animate-pulse bg-emerald-500' : 'bg-emerald-500'
                          }`}
                          style={isVerifying ? undefined : { width: `${Math.min(100, prog.percent)}%` }}
                        />
                      </div>
                      {!isVerifying && (
                        <div className={`flex items-center justify-between text-[10px] font-mono ${theme.textMuted}`}>
                          <span>{formatSpeed(speedBps)}</span>
                          <span>
                            ETA {formatEta(prog.etaSecs, Math.max(0, totalBytes - dlBytes), speedBps)}
                          </span>
                          <button
                            type="button"
                            onClick={() => void cancelModelDownload(entry.filename)}
                            className="text-rose-400 hover:underline font-sans font-medium"
                          >
                            Pause
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={isActive || isConnectingModel || isInstallingRuntime}
                        onClick={() => void downloadAndSetupLocalModel(entry)}
                        className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-55 ${
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
                            <span>Load &amp; Use Now</span>
                          </>
                        ) : hasSavedPartial ? (
                          <>
                            <Play className="w-3 h-3" />
                            <span>Resume · {partialPct.toFixed(0)}%</span>
                          </>
                        ) : (
                          <>
                            <Download className="w-3 h-3" />
                            <span>Download &amp; Run</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedModelId(entry.id)}
                        aria-label={`Details for ${entry.name}`}
                        className={`px-2 py-1.5 rounded-lg border text-[11px] ${theme.border} ${theme.hoverBg}`}
                        title="Inspect model specifications"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
