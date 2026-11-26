import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Cpu, FileText, Lock, Send, Sparkles, X } from 'lucide-react';
import { SANDBOX_DOCS, type SandboxDoc } from './data';

type Props = {
  open: boolean;
  onClose: () => void;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citation?: string;
  route?: string;
};

function buildReply(doc: SandboxDoc, prompt: string): { text: string; citation: string } {
  const lower = prompt.toLowerCase();
  if (lower.includes('open') || lower.includes('time') || lower.includes('check')) {
    return {
      text: 'The Aurora field station opens at 08:30 with visitor check-in in the east hall [1].',
      citation: doc.citationLabel,
    };
  }
  if (lower.includes('key') || lower.includes('privacy') || lower.includes('upload') || lower.includes('safe')) {
    return {
      text: 'All parsing and SQLite indexing run on your computer. API keys stay in the OS keyring, and local GGUF sends 0 bytes to the cloud [1].',
      citation: '[1] security_notes.md · OS Keyring & Local WAL',
    };
  }
  if (lower.includes('size') || lower.includes('mb') || lower.includes('fast') || lower.includes('rag')) {
    return {
      text: 'DocuSage pairs a compact native desktop app with embedded SQLite FTS5 + in-Rust cosine RRF and a crash-isolated llama.cpp worker [1].',
      citation: '[1] hybrid_search.rs · RRF Fusion (k = 60)',
    };
  }
  return {
    text: `${doc.answer}`,
    citation: doc.citationLabel,
  };
}

export function SpotlightModal({ open, onClose }: Props) {
  const [docId, setDocId] = useState(SANDBOX_DOCS[0].id);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: SANDBOX_DOCS[0].answer,
      citation: SANDBOX_DOCS[0].citationLabel,
      route: SANDBOX_DOCS[0].route,
    },
  ]);

  const inputRef = useRef<HTMLInputElement>(null);
  const activeDoc = SANDBOX_DOCS.find((doc) => doc.id === docId) ?? SANDBOX_DOCS[0];

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 40);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const ask = (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed) return;
    const reply = buildReply(activeDoc, trimmed);
    setMessages((prev) => [
      ...prev.slice(-3),
      { id: `u-${Date.now()}`, role: 'user', text: trimmed },
      {
        id: `a-${Date.now() + 1}`,
        role: 'assistant',
        text: reply.text,
        citation: reply.citation,
        route: activeDoc.route,
      },
    ]);
    setInput('');
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    ask(input);
  };

  const quickPrompts = [
    'When does the station open?',
    'Is my file uploaded to the cloud?',
    'How does Hybrid RAG stay <10 MB?',
  ];

  return (
    <div
      className="spotlight-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="spotlight-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spotlight-title"
      >
        <div className="spotlight-head">
          <div className="spotlight-brand">
            <Sparkles size={15} aria-hidden="true" />
            <h2 id="spotlight-title">DocuSage Spotlight</h2>
            <span className="spotlight-badge">440×560 Simulator</span>
          </div>
          <button
            type="button"
            className="spotlight-close"
            onClick={onClose}
            aria-label="Close Spotlight simulator"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="spotlight-docs" role="group" aria-label="Select Spotlight file">
          {SANDBOX_DOCS.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className={doc.id === activeDoc.id ? 'active' : ''}
              aria-pressed={doc.id === activeDoc.id}
              onClick={() => setDocId(doc.id)}
            >
              <FileText size={13} aria-hidden="true" /> {doc.name}
            </button>
          ))}
        </div>

        <div className="spotlight-feed" aria-live="polite">
          {messages.map((msg) => (
            <div key={msg.id} className={`spotlight-msg spotlight-msg-${msg.role}`}>
              <p>{msg.text}</p>
              {msg.citation && (
                <div className="spotlight-cite">
                  <span>{msg.route}</span>
                  <code>{msg.citation}</code>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="spotlight-chips">
          {quickPrompts.map((prompt) => (
            <button key={prompt} type="button" onClick={() => ask(prompt)}>
              {prompt}
            </button>
          ))}
        </div>

        <form className="spotlight-form" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="spotlight-input">
            Ask a question in the Spotlight simulator
          </label>
          <input
            id="spotlight-input"
            ref={inputRef}
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={`Ask ${activeDoc.name}…`}
          />
          <button type="submit" aria-label="Send simulated question">
            <Send size={15} aria-hidden="true" />
          </button>
        </form>

        <div className="spotlight-foot">
          <span>
            <Lock size={12} aria-hidden="true" /> Local SQLite · 0 B uploaded
          </span>
          <span>
            <Cpu size={12} aria-hidden="true" /> Press <kbd>Esc</kbd> to hide
          </span>
        </div>
      </div>
    </div>
  );
}
