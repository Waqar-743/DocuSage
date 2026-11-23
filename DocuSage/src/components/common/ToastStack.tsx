import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useUiStore } from '../../stores/useUiStore';

export const ToastStack: React.FC = () => {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-xl text-xs backdrop-blur-md ${
            t.kind === 'error'
              ? 'bg-rose-950/95 border-rose-500/55 text-rose-50'
              : t.kind === 'success'
              ? 'bg-emerald-950/95 border-emerald-500/55 text-emerald-50'
              : 'bg-zinc-900/95 border-zinc-700 text-zinc-100'
          }`}
        >
          {t.kind === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          ) : t.kind === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0 space-y-1.5">
            <span className="block leading-relaxed">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/15 hover:bg-white/25 text-white border border-white/20 transition-colors"
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            className="opacity-75 hover:opacity-100 p-0.5 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
