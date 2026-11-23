import React from 'react';
import { AlertCircle, CheckCircle2, Cpu, Loader2, Play, Settings2, X } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useProviderStore } from '../../stores/useProviderStore';
import { useUiStore } from '../../stores/useUiStore';

export const LocalSetupBanner: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const openSettings = useUiStore((s) => s.openSettings);

  const localSetup = useProviderStore((s) => s.localSetup);
  const dismissLocalSetup = useProviderStore((s) => s.dismissLocalSetup);
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

  return (
    <div
      role="status"
      aria-label="Local model setup status"
      className={`border-b text-xs ${compact ? 'px-3 py-2' : 'px-4 py-2.5'} ${theme.border} ${
        isError ? theme.dangerSoft : theme.surfaceBg
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isWorking ? (
            <Loader2 className={`w-4 h-4 animate-spin shrink-0 ${theme.accentText}`} />
          ) : isReady ? (
            <CheckCircle2 className={`w-4 h-4 shrink-0 ${theme.accentText}`} />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-medium truncate">{localSetup.message}</div>
            {isError && localSetup.error && (
              <div className="text-[11px] opacity-90 truncate">{localSetup.error}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isWorking && localSetup.stage !== 'loadingModel' && (
            <span className="font-mono text-[11px] font-semibold">
              {Math.min(100, Math.max(0, localSetup.percent)).toFixed(0)}%
            </span>
          )}

          {isReady && localSetup.kind === 'chat' && (
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
          )}

          {isError && (
            <button
              type="button"
              onClick={() => openSettings('localRuntime')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium ${theme.border} ${theme.hoverBg}`}
            >
              <Settings2 className="w-3 h-3" />
              <span>Local AI Settings</span>
            </button>
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

      {isWorking && (
        <div className={`mt-2 h-1.5 rounded-full overflow-hidden ${theme.progressTrack}`}>
          <div
            className={`h-full transition-all duration-200 ${
              localSetup.stage === 'loadingModel'
                ? 'w-full animate-pulse bg-emerald-500'
                : 'bg-emerald-500'
            }`}
            style={
              localSetup.stage === 'loadingModel'
                ? undefined
                : { width: `${Math.min(100, Math.max(4, localSetup.percent))}%` }
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
