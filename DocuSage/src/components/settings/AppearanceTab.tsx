import React from 'react';
import { Check } from 'lucide-react';
import { APPEARANCE_OPTIONS, THEMES } from '../../lib/themes';
import { useUiStore } from '../../stores/useUiStore';

export const AppearanceTab: React.FC = () => {
  const current = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const theme = THEMES[current];

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h3 className="text-sm font-semibold">Appearance & Themes</h3>
        <p className={theme.textMuted}>
          Choose a surface palette tuned for Spotlight overlays or long reading sessions.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {APPEARANCE_OPTIONS.map((opt) => {
          const selected = current === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setTheme(opt.key)}
              className={`text-left rounded-xl border p-3.5 transition-colors flex items-start justify-between gap-2 ${theme.surfaceBg} ${
                selected ? 'border-emerald-500 ring-1 ring-emerald-500/40' : theme.border
              }`}
            >
              <div>
                <div className="font-semibold text-[13px]">{opt.label}</div>
                <div className={`text-[11px] mt-0.5 ${theme.textMuted}`}>{opt.description}</div>
              </div>
              {selected && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
