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
        <h3 className="text-sm font-semibold">Appearance &amp; Themes</h3>
        <p className={`mt-0.5 ${theme.textMuted}`}>
          Switch themes instantly across the entire app — including high-contrast Obsidian Dark, Studio Light, Cream, and Navy Blue.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {APPEARANCE_OPTIONS.map((opt) => {
          const selected = current === opt.key;
          const swatch = THEMES[opt.key].swatch;
          return (
            <button
              key={opt.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setTheme(opt.key)}
              className={`text-left rounded-xl border p-3.5 transition-colors flex items-start justify-between gap-3 ${theme.surfaceBg} ${
                selected
                  ? `${theme.accentSoft} ring-1 ring-current/30`
                  : `${theme.border} ${theme.hoverBg}`
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center gap-0.5 p-0.5 rounded-full border border-current/20"
                  >
                    {swatch.map((hex, i) => (
                      <span
                        key={`${opt.key}-swatch-${i}`}
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </span>
                  <span className="font-semibold text-[13px]">{opt.label}</span>
                </div>
                <div className={`text-[11px] mt-1 ${selected ? 'opacity-90' : theme.textMuted}`}>
                  {opt.description}
                </div>
              </div>
              {selected && <Check className="w-4 h-4 shrink-0 mt-0.5" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
