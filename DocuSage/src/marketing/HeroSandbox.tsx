import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  FileCode2,
  FileText,
  Globe,
  HardDrive,
  Send,
  Sparkles,
} from 'lucide-react';
import { SANDBOX_DOCS, type SandboxDoc } from './data';

type Props = {
  onSummonSpotlight: () => void;
};

export function HeroSandbox({ onSummonSpotlight }: Props) {
  const [selectedId, setSelectedId] = useState<string>(SANDBOX_DOCS[0].id);
  const [engine, setEngine] = useState<'local' | 'cloud'>('local');
  const [showCitation, setShowCitation] = useState<boolean>(true);
  const [visibleWords, setVisibleWords] = useState<number>(999);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);

  const activeDoc: SandboxDoc =
    SANDBOX_DOCS.find((doc) => doc.id === selectedId) ?? SANDBOX_DOCS[0];

  const words = activeDoc.answer.split(' ');

  useEffect(() => {
    setVisibleWords(0);
    setIsStreaming(true);

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      setVisibleWords(words.length);
      setIsStreaming(false);
      return;
    }

    let count = 0;
    const timer = window.setInterval(() => {
      count += 2;
      if (count >= words.length) {
        setVisibleWords(words.length);
        setIsStreaming(false);
        window.clearInterval(timer);
      } else {
        setVisibleWords(count);
      }
    }, 34);

    return () => window.clearInterval(timer);
  }, [activeDoc.id, engine]);

  const displayedAnswer = words.slice(0, visibleWords).join(' ');

  return (
    <div className="sandbox-frame" aria-label="Interactive DocuSage 2.0 demo">
      <div className="sandbox-chrome">
        <div className="chrome-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="chrome-title">
          <span className="status-pulse" aria-hidden="true" />
          DocuSage · Live Interactive Preview
        </div>
        <div className="chrome-engine" role="group" aria-label="Demo inference engine">
          <button
            type="button"
            className={engine === 'local' ? 'active' : ''}
            aria-pressed={engine === 'local'}
            onClick={() => setEngine('local')}
          >
            <HardDrive size={13} aria-hidden="true" /> Offline Models
          </button>
          <button
            type="button"
            className={engine === 'cloud' ? 'active' : ''}
            aria-pressed={engine === 'cloud'}
            onClick={() => setEngine('cloud')}
          >
            <Globe size={13} aria-hidden="true" /> Cloud
          </button>
        </div>
      </div>

      <div className="sandbox-body">
        <div className="sandbox-sidebar" aria-label="Sample local files">
          <p className="sandbox-label">Local Vault · Click a file</p>
          <div className="sandbox-files">
            {SANDBOX_DOCS.map((doc) => {
              const selected = doc.id === activeDoc.id;
              const Icon = doc.ext === 'PDF' ? FileText : FileCode2;
              return (
                <button
                  key={doc.id}
                  type="button"
                  className={`sandbox-file ${selected ? 'is-selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => setSelectedId(doc.id)}
                >
                  <span className="file-ext">{doc.ext}</span>
                  <span className="file-meta">
                    <strong>{doc.name}</strong>
                    <small>{doc.sizeLabel}</small>
                  </span>
                  <Icon size={14} aria-hidden="true" className="file-icon" />
                </button>
              );
            })}
          </div>

          <div className="sandbox-telemetry">
            <div>
              <span>Route</span>
              <strong className="telemetry-accent">{activeDoc.route}</strong>
            </div>
            <div>
              <span>Retrieval</span>
              <strong>{activeDoc.latencyMs} ms</strong>
            </div>
            <div>
              <span>Network</span>
              <strong>{engine === 'local' ? '0 B sent' : 'Excerpt only'}</strong>
            </div>
          </div>
        </div>

        <div className="sandbox-chat">
          <div className="chat-header-bar">
            <span className="route-pill">
              <Sparkles size={13} aria-hidden="true" />
              {activeDoc.route === 'Hybrid RAG'
                ? 'Hybrid RAG · SQLite FTS5 + Cosine RRF'
                : 'Full Context · Verbatim (≤12k chars)'}
            </span>
            <span className="token-pill">{activeDoc.tokens} tok</span>
          </div>

          <div className="chat-bubble-user">
            <span>{activeDoc.question}</span>
          </div>

          <div className="chat-bubble-ai" aria-live="polite">
            <div className="ai-meta">
              <Cpu size={14} aria-hidden="true" />
              <span>
                {engine === 'local'
                  ? 'Isolated llama.cpp · Qwen 3.5 2B'
                  : 'Gemini 4 · GPT-6.2 · Claude 5.5'}
              </span>
              <span className="ai-state">
                {isStreaming ? (
                  <>
                    <span className="sandbox-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    Streaming
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={13} aria-hidden="true" /> Cited
                  </>
                )}
              </span>
            </div>
            <p className="ai-text">
              {displayedAnswer}
              {isStreaming && <span className="typing-caret" aria-hidden="true" />}
            </p>

            <button
              type="button"
              className="citation-toggle"
              aria-expanded={showCitation}
              onClick={() => setShowCitation((value) => !value)}
            >
              <span>{activeDoc.citationLabel}</span>
              <span>{showCitation ? 'Hide excerpt' : 'Inspect excerpt'}</span>
            </button>

            {showCitation && (
              <blockquote className="citation-box">{activeDoc.excerpt}</blockquote>
            )}
          </div>

          <div className="sandbox-footer-bar">
            <button
              type="button"
              className="summon-inline-btn"
              onClick={onSummonSpotlight}
            >
              <Send size={14} aria-hidden="true" />
              <span>Ask your own question in Spotlight</span>
              <span className="mini-keys" aria-hidden="true">
                <kbd>Alt</kbd>+<kbd>Space</kbd>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
