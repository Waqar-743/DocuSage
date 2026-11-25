import React from 'react';
import { Check } from 'lucide-react';
import { APPEARANCE_OPTIONS, THEMES } from '../../lib/themes';
import { useUiStore } from '../../stores/useUiStore';

export const AppearanceTab: React.FC = () => {
  const current = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const appOpacity = useUiStore((s) => s.appOpacity);
  const setAppOpacity = useUiStore((s) => s.setAppOpacity);
  const theme = THEMES[current];
  const opacityPct = Math.round(appOpacity * 100);

  return (
    <div className="space-y-5 text-xs">
      <div>
        <h3 className="text-sm font-semibold">Appearance &amp; Themes</h3>
        <p className={`mt-0.5 ${theme.textMuted}`}>
          Switch themes instantly across the entire app — every theme uses a solid, high-contrast palette tuned for comfortable reading.
        </p>
      </div>

      {/* Whole-App Transparency / Opacity Control */}
      <div className={`rounded-xl border p-3.5 space-y-2.5 ${theme.surfaceBg} ${theme.border}`}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="font-semibold text-[13px]">Window Transparency</div>
            <p className={`text-[11px] mt-0.5 ${theme.textMuted}`}>
              Adjust opacity anytime with <kbd className={`px-1.5 py-0.5 rounded border font-mono text-[10px] ${theme.badgeBg}`}>Shift + -</kbd> (more transparent) or <kbd className={`px-1.5 py-0.5 rounded border font-mono text-[10px] ${theme.badgeBg}`}>Shift + +</kbd> (less transparent). While typing, use <kbd className={`px-1.5 py-0.5 rounded border font-mono text-[10px] ${theme.badgeBg}`}>Ctrl + Shift + +/-</kbd>.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded-md ${theme.badgeBg}`}>
              {opacityPct}%
            </span>
            {opacityPct < 100 && (
              <button
                type="button"
                onClick={() => setAppOpacity(1)}
                className={`px-2 py-1 rounded-lg border text-[11px] font-medium ${theme.border} ${theme.hoverBg}`}
              >
                Reset 100%
              </button>
            )}
          </div>
        </div>
        <input
          type="range"
          aria-label="Window opacity"
          min={35}
          max={100}
          step={5}
          value={opacityPct}
          onChange={(e) => setAppOpacity(Number(e.target.value) / 100)}
          className="w-full cursor-pointer"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {APPEARANCE_OPTIONS.map((opt) => {
          const selected = current === opt.key;
          const preview = THEMES[opt.key];
          const [bgHex, surfaceHex, accentHex] = preview.swatch;
          return (
            <button
              key={opt.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setTheme(opt.key)}
              className={`text-left rounded-xl border p-3.5 transition-colors flex flex-col gap-2.5 ${
                selected
                  ? `${theme.accentSoft} ring-1 ring-current/30`
                  : `${theme.surfaceBg} ${theme.border} ${theme.hoverBg}`
              }`}
            >
              <div className="flex items-start justify-between gap-2 w-full">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-flex items-center gap-0.5 p-0.5 rounded-full border border-current/25 shrink-0"
                    >
                      {preview.swatch.map((hex, i) => (
                        <span
                          key={`${opt.key}-swatch-${i}`}
                          className="w-3 h-3 rounded-full border border-black/15"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </span>
                    <span className="font-semibold text-[13px] truncate">{opt.label}</span>
                  </div>
                  <div className={`text-[11px] mt-1 leading-snug ${selected ? 'opacity-90' : theme.textMuted}`}>
                    {opt.description}
                  </div>
                </div>
                {selected && <Check className="w-4 h-4 shrink-0 mt-0.5" />}
              </div>

              {/* Compact solid theme preview strip */}
              <div
                aria-hidden="true"
                className="w-full h-5 rounded-lg border border-black/15 overflow-hidden flex items-center px-1.5 gap-1.5"
                style={{ backgroundColor: bgHex }}
              >
                <span
                  className="w-8 h-2.5 rounded-sm"
                  style={{ backgroundColor: surfaceHex }}
                />
                <span
                  className="flex-1 h-2.5 rounded-sm opacity-90"
                  style={{ backgroundColor: surfaceHex }}
                />
                <span
                  className="w-6 h-2.5 rounded-sm"
                  style={{ backgroundColor: accentHex }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
