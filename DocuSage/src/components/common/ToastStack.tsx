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
          className={`pointer-events-auto flex items-start gap-2 px-3.5 py-2.5 rounded-xl border shadow-lg text-xs backdrop-blur-md ${
            t.kind === 'error'
              ? 'bg-rose-950/90 border-rose-500/40 text-rose-100'
              : t.kind === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-100'
              : 'bg-zinc-900/90 border-zinc-700 text-zinc-100'
          }`}
        >
          {t.kind === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          ) : t.kind === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          )}
          <span className="flex-1 leading-relaxed">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            className="opacity-70 hover:opacity-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
