import { useState } from 'react';
import {
  Check,
  Cloud,
  Database,
  FileText,
  HardDrive,
  KeyRound,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { IMAGES } from './data';

const CLOUD_PROVIDERS = ['Gemini', 'OpenAI', 'Claude', 'OpenRouter', 'Ollama', 'LM Studio'];

export function PrivacyVault() {
  const [mode, setMode] = useState<'local' | 'cloud'>('local');

  return (
    <div className="privacy-interactive">
      <div className="privacy-switch-wrap">
        <div className="privacy-switch" role="group" aria-label="Privacy boundary mode">
          <button
            type="button"
            className={mode === 'local' ? 'active' : ''}
            aria-pressed={mode === 'local'}
            onClick={() => setMode('local')}
          >
            <HardDrive size={16} aria-hidden="true" /> 100% Local (GGUF)
          </button>
          <button
            type="button"
            className={mode === 'cloud' ? 'active' : ''}
            aria-pressed={mode === 'cloud'}
            onClick={() => setMode('cloud')}
          >
            <Cloud size={16} aria-hidden="true" /> Cloud Provider
          </button>
        </div>
      </div>

      <div className="vault-grid" aria-live="polite">
        <div className="vault-zone vault-local">
          <div className="vault-head">
            <span className="vault-tag local">
              <Lock size={14} aria-hidden="true" /> Stays on Your Device
            </span>
            <strong>Local Machine</strong>
          </div>

          <ul className="vault-items">
            <li>
              <FileText size={16} aria-hidden="true" />
              <span>Original PDFs, code &amp; notes</span>
              <Check size={15} aria-hidden="true" className="check-ok" />
            </li>
            <li>
              <Database size={16} aria-hidden="true" />
              <span>SQLite vectors.db &amp; FTS5 index</span>
              <Check size={15} aria-hidden="true" className="check-ok" />
            </li>
            <li>
              <KeyRound size={16} aria-hidden="true" />
              <span>API keys in native OS Keyring</span>
              <Check size={15} aria-hidden="true" className="check-ok" />
            </li>
            {mode === 'local' && (
              <li className="highlight-row">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>llama-server GGUF inference</span>
                <Check size={15} aria-hidden="true" className="check-ok" />
              </li>
            )}
          </ul>
        </div>

        <div className={`vault-zone vault-network ${mode === 'local' ? 'is-sealed' : 'is-bridged'}`}>
          <div className="vault-head">
            <span className={`vault-tag ${mode === 'local' ? 'sealed' : 'bridged'}`}>
              {mode === 'local' ? '0 Bytes Sent' : 'Excerpts Only'}
            </span>
            <strong>{mode === 'local' ? 'Air-Gapped Offline' : 'Chosen Provider'}</strong>
          </div>

          <div className="vault-mascot-stage">
            <img
              src={mode === 'local' ? IMAGES.privacy : IMAGES.protected}
              alt={
                mode === 'local'
                  ? 'DocuSage mascot hugging a locked local folder'
                  : 'DocuSage mascot guarding files with a shield'
              }
              width="220"
              height="220"
              loading="lazy"
              decoding="async"
            />
            {mode === 'local' ? (
              <p className="vault-verdict">
                <strong>Airplane mode ready.</strong> Nothing leaves your disk.
              </p>
            ) : (
              <div className="vault-cloud-summary">
                <p className="vault-verdict">
                  <strong>Prompt + Top-K excerpts only.</strong> Raw files never upload.
                </p>
                <div className="provider-pills" aria-label="Supported providers">
                  {CLOUD_PROVIDERS.map((provider) => (
                    <span key={provider}>{provider}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
