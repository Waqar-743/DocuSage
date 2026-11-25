import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Info,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  findCatalogEntryByFilename,
  formatBytes,
  formatEta,
  formatSpeed,
} from '../../lib/catalog';
import { THEMES } from '../../lib/themes';
import { useProviderStore } from '../../stores/useProviderStore';
import { useUiStore } from '../../stores/useUiStore';

export const LocalSetupBanner: React.FC<{
  compact?: boolean;
  onFocusComposer?: () => void;
}> = ({ compact = false, onFocusComposer }) => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const openSettings = useUiStore((s) => s.openSettings);
  const openLocalModelDetails = useUiStore((s) => s.openLocalModelDetails);

  const localSetup = useProviderStore((s) => s.localSetup);
  const dismissLocalSetup = useProviderStore((s) => s.dismissLocalSetup);
  const cancelModelDownload = useProviderStore((s) => s.cancelModelDownload);
  const resumePausedDownload = useProviderStore((s) => s.resumePausedDownload);
  const discardPartialDownload = useProviderStore((s) => s.discardPartialDownload);
  const testLocalModel = useProviderStore((s) => s.testLocalModel);
  const isTestingLocalModel = useProviderStore((s) => s.isTestingLocalModel);
  const localTestResult = useProviderStore((s) => s.localTestResult);

  if (localSetup.stage === 'idle') return null;

  const isWorking =
    localSetup.stage === 'downloading' ||
    localSetup.stage === 'installingRuntime' ||
    localSetup.stage === 'loadingModel';
  const isReady = localSetup.stage === 'ready';
  const isError = localSetup.stage === 'error';
  const isPaused = localSetup.stage === 'paused';
  const isDownloading = localSetup.stage === 'downloading';
  const isVerifying = isDownloading && localSetup.downloadStage === 'verifying';
  const downloaded = localSetup.downloaded ?? 0;
  const total = localSetup.total ?? 0;
  const speedBps = localSetup.speedBps ?? 0;
  const pct = Math.min(100, Math.max(0, localSetup.percent));
  const etaText = formatEta(localSetup.etaSecs, Math.max(0, total - downloaded), speedBps);
  const catalogMatch = localSetup.filename
    ? findCatalogEntryByFilename(localSetup.filename)
    : undefined;

  const handleOpenDetails = () => {
    if (catalogMatch) {
      openLocalModelDetails(catalogMatch.id);
    } else {
      openSettings('localRuntime');
    }
  };

  return (
    <div
      role="status"
      aria-label="Local model setup status"
      className={`border-b text-xs ${compact ? 'px-3 py-2' : 'px-4 py-2.5'} ${theme.border} ${
        isError ? theme.dangerSoft : theme.surfaceBg
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isVerifying ? (
            <ShieldCheck className={`w-4 h-4 shrink-0 animate-pulse ${theme.accentText}`} />
          ) : isWorking ? (
            <Loader2 className={`w-4 h-4 animate-spin shrink-0 ${theme.accentText}`} />
          ) : isPaused ? (
            <Pause className={`w-4 h-4 shrink-0 ${theme.accentText}`} />
          ) : isReady ? (
            <CheckCircle2 className={`w-4 h-4 shrink-0 ${theme.accentText}`} />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-medium truncate">{localSetup.message}</span>
              {catalogMatch && (isDownloading || isPaused || isReady) && (
                <button
                  type="button"
                  onClick={handleOpenDetails}
                  className={`inline-flex items-center gap-0.5 text-[10.5px] shrink-0 hover:underline ${theme.accentText}`}
                  title={`Inspect ${catalogMatch.name} specifications`}
                >
                  <Info className="w-3 h-3" />
                  <span>Details</span>
                </button>
              )}
            </div>
            {isDownloading && !isVerifying && (
              <div
                className={`text-[10.5px] font-mono flex flex-wrap items-center gap-x-2.5 gap-y-0.5 ${theme.textMuted}`}
              >
                <span>
                  {formatBytes(downloaded)} / {total > 0 ? formatBytes(total) : '…'}
                </span>
                <span>Speed: {formatSpeed(speedBps)}</span>
                <span>ETA: {etaText}</span>
              </div>
            )}
            {isPaused && (
              <div className={`text-[10.5px] font-mono flex flex-wrap items-center gap-x-2.5 ${theme.textMuted}`}>
                <span>
                  {formatBytes(downloaded)} / {total > 0 ? formatBytes(total) : '…'} ({pct.toFixed(1)}%)
                </span>
                <span>Progress saved on disk — resume anytime</span>
              </div>
            )}
            {isError && localSetup.error && (
              <div className="text-[11px] opacity-90 break-words">{localSetup.error}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isWorking && localSetup.stage !== 'loadingModel' && (
            <span className="font-mono text-[11px] font-semibold">{pct.toFixed(1)}%</span>
          )}

          {isDownloading && !isVerifying && localSetup.filename && (
            <button
              type="button"
              onClick={() => void cancelModelDownload(localSetup.filename)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium ${theme.border} ${theme.hoverBg}`}
              title="Pause download (resume anytime)"
            >
              <Pause className="w-3 h-3" />
              <span>Pause</span>
            </button>
          )}

          {isPaused && localSetup.filename && (
            <>
              <button
                type="button"
                onClick={() => void resumePausedDownload(localSetup.filename)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${theme.accent}`}
              >
                <Play className="w-3 h-3" />
                <span>Resume</span>
              </button>
              <button
                type="button"
                onClick={() => void discardPartialDownload(localSetup.filename)}
                aria-label="Discard partial download"
                title="Delete saved partial download"
                className={`p-1 rounded-lg text-rose-400 hover:bg-rose-500/15`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          {isReady && localSetup.kind === 'chat' && (
            <>
              {onFocusComposer && (
                <button
                  type="button"
                  onClick={() => {
                    onFocusComposer();
                    dismissLocalSetup();
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium ${theme.border} ${theme.hoverBg}`}
                >
                  <MessageSquare className="w-3 h-3" />
                  <span>Start Chatting</span>
                </button>
              )}
              <button
                type="button"
                disabled={isTestingLocalModel}
                onClick={() => void testLocalModel()}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] transition-colors disabled:opacity-60 ${theme.accent}`}
              >
                {isTestingLocalModel ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                <span>{isTestingLocalModel ? 'Testing…' : 'Test Model'}</span>
              </button>
            </>
          )}

          {isError && (
            <>
              {catalogMatch && (
                <button
                  type="button"
                  onClick={() => void resumePausedDownload(catalogMatch.filename)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium ${theme.accent}`}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{downloaded > 0 ? 'Resume' : 'Retry'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => openSettings('localRuntime')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium ${theme.border} ${theme.hoverBg}`}
              >
                <Settings2 className="w-3 h-3" />
                <span>Local AI Settings</span>
              </button>
            </>
          )}

          {!isWorking && (
            <button
              type="button"
              onClick={dismissLocalSetup}
              aria-label="Dismiss setup status"
              className={`p-1 rounded-lg ${theme.hoverBg}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {(isWorking || isPaused) && (
        <div className={`mt-2 h-1.5 rounded-full overflow-hidden ${theme.progressTrack}`}>
          <div
            className={`h-full transition-all duration-200 ${
              isPaused
                ? 'bg-amber-400'
                : localSetup.stage === 'loadingModel' || isVerifying
                ? 'w-full animate-pulse bg-emerald-500'
                : 'bg-emerald-500'
            }`}
            style={
              localSetup.stage === 'loadingModel' || isVerifying
                ? undefined
                : { width: `${Math.min(100, Math.max(4, pct))}%` }
            }
          />
        </div>
      )}

      {isReady && localTestResult && (
        <div
          className={`mt-2 rounded-lg px-2.5 py-1.5 text-[11px] flex items-start gap-2 border ${
            localTestResult.ok ? theme.accentSoft : theme.dangerSoft
          }`}
        >
          <Cpu className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="font-semibold">{localTestResult.message}</span>
            {localTestResult.reply && (
              <span className="block opacity-90 mt-0.5">“{localTestResult.reply}”</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
