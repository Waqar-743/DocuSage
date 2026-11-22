import { useState } from 'react';
import {
  ChevronRight,
  Cpu,
  Database,
  FileText,
  Sparkles,
  WifiOff,
  Zap,
} from 'lucide-react';
import { FORMAT_BADGES, IMAGES, PIPELINE_PRESETS } from './data';

const SIZE_STEPS = [2000, 4000, 5800, 8500, 10900, 12000, 28000, 64000, 142000, 320000, 620000];

function nearestStepIndex(chars: number): number {
  let best = 0;
  let minDiff = Math.abs(SIZE_STEPS[0] - chars);
  for (let i = 1; i < SIZE_STEPS.length; i += 1) {
    const diff = Math.abs(SIZE_STEPS[i] - chars);
    if (diff < minDiff) {
      minDiff = diff;
      best = i;
    }
  }
  return best;
}

export function PipelineLab() {
  const [stepIdx, setStepIdx] = useState<number>(8);
  const [activeExt, setActiveExt] = useState<string>('.pdf');
  const [offlineOnly, setOfflineOnly] = useState<boolean>(false);

  const chars = SIZE_STEPS[stepIdx] ?? 142000;
  const isFullContext = chars <= 12000;
  const routeMode = isFullContext
    ? 'Full Context'
    : offlineOnly
      ? 'FTS5 Offline'
      : 'Hybrid RAG';

  const routeNote = isFullContext
    ? '≤12k chars — injected verbatim. Zero chunk loss.'
    : offlineOnly
      ? 'Zero-dependency SQLite FTS5 BM25. Instant offline.'
      : 'SQLite FTS5 BM25 + Cosine Vector merged via RRF.';

  const tokenBudgetUsed = isFullContext
    ? Math.min(92, Math.max(14, Math.round((chars / 12000) * 84)))
    : 34;

  const formattedChars =
    chars >= 1000 ? `${(chars / 1000).toFixed(chars >= 100000 ? 0 : 1)}k chars` : `${chars} chars`;

  return (
    <div className="pipeline-lab">
      <div className="pipeline-controls">
        <div className="preset-row" role="group" aria-label="Sample document presets">
          {PIPELINE_PRESETS.map((preset) => {
            const isSelected = activeExt === preset.ext && chars === preset.chars;
            return (
              <button
                key={preset.id}
                type="button"
                className={`preset-chip ${isSelected ? 'active' : ''}`}
                aria-pressed={isSelected}
                onClick={() => {
                  setStepIdx(nearestStepIndex(preset.chars));
                  setActiveExt(preset.ext);
                }}
              >
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>

        <div className="slider-bar">
          <div className="slider-wrap">
            <label htmlFor="doc-size-slider">
              Document size: <strong>{formattedChars}</strong>
            </label>
            <input
              id="doc-size-slider"
              type="range"
              min={0}
              max={SIZE_STEPS.length - 1}
              step={1}
              value={stepIdx}
              onChange={(event) => setStepIdx(Number(event.target.value))}
            />
            <div className="slider-ticks" aria-hidden="true">
              <span>2k (Full Context)</span>
              <span>12k threshold</span>
              <span>620k (Hybrid RAG)</span>
            </div>
          </div>

          <button
            type="button"
            className={`offline-pill ${offlineOnly ? 'is-offline' : ''}`}
            aria-pressed={offlineOnly}
            onClick={() => setOfflineOnly((value) => !value)}
          >
            {offlineOnly ? (
              <WifiOff size={15} aria-hidden="true" />
            ) : (
              <Sparkles size={15} aria-hidden="true" />
            )}
            <span>{offlineOnly ? 'Embeddings Off (FTS5)' : 'Embeddings Active'}</span>
          </button>
        </div>
      </div>

      <div className="pipeline-stage">
        <div className="pipeline-nodes" aria-live="polite">
          <div className="pipe-node is-lit">
            <span className="pipe-icon">
              <FileText size={20} aria-hidden="true" />
            </span>
            <small>Step 01</small>
            <strong>Local Parse ({activeExt})</strong>
            <span>Up to 50 MB · Cached</span>
          </div>

          <ChevronRight className="pipe-arrow" size={20} aria-hidden="true" />

          <div className={`pipe-node is-active pipe-mode-${routeMode.toLowerCase().replace(/\s+/g, '-')}`}>
            <span className="pipe-icon">
              {isFullContext ? (
                <Zap size={20} aria-hidden="true" />
              ) : (
                <Database size={20} aria-hidden="true" />
              )}
            </span>
            <small>Smart Router</small>
            <strong>{routeMode}</strong>
            <span>{routeNote}</span>
          </div>

          <ChevronRight className="pipe-arrow" size={20} aria-hidden="true" />

          <div className="pipe-node is-lit">
            <span className="pipe-icon">
              <Cpu size={20} aria-hidden="true" />
            </span>
            <small>Step 03</small>
            <strong>{offlineOnly ? 'llama-server GGUF' : 'Local or Cloud'}</strong>
            <span>Streamed · Cancellable</span>
          </div>

          <ChevronRight className="pipe-arrow" size={20} aria-hidden="true" />

          <div className="pipe-node is-lit">
            <span className="pipe-icon">
              <Sparkles size={20} aria-hidden="true" />
            </span>
            <small>Token Budget</small>
            <strong>{tokenBudgetUsed}% Window</strong>
            <div className="budget-meter" aria-hidden="true">
              <span style={{ width: `${tokenBudgetUsed}%` }} />
            </div>
          </div>
        </div>

        <div className="pipeline-mascot-bar">
          <img
            src={IMAGES.teaching}
            alt="DocuSage mascot pointing to the retrieval pipeline"
            width="128"
            height="128"
            loading="lazy"
            decoding="async"
          />
          <div className="format-cloud" aria-label="Supported file formats">
            {FORMAT_BADGES.map((ext) => (
              <span key={ext} className={ext === activeExt ? 'is-highlighted' : ''}>
                {ext}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
