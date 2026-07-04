import { useEffect, type CSSProperties } from 'react';
import {
  CheckCircle,
  Cloud,
  Command,
  Cpu,
  Database,
  Download,
  FileText,
  HardDrive,
  Keyboard,
  Link,
  MessageSquare,
  Monitor,
  Search,
  Settings,
  ShieldCheck,
  Sliders,
  type LucideIcon,
} from 'lucide-react';
import './MarketingSite.css';

const releaseUrl = 'https://github.com/Waqar-743/DocuSage/releases';
const sourceUrl = 'https://github.com/Waqar-743/DocuSage';
const portfolioUrl = 'https://waqarahmed.live';

const asset = (name: string) => `${import.meta.env.BASE_URL}brand/${name}`;

const assets = {
  logo: asset('doc-stylish.png'),
  chatbot: asset('chatbot.png'),
  document: asset('document-1.png'),
  documentFlow: asset('document-2.png'),
  rag: asset('document-with-rag.png'),
  privateAi: asset('private.png'),
  appLight: asset('app-light.png'),
  appDark: asset('app-dark.png'),
};

type IconItem = {
  icon: LucideIcon;
  title: string;
  copy: string;
};

const coreFeatures: IconItem[] = [
  {
    icon: MessageSquare,
    title: 'Local AI chat with GGUF models',
    copy: 'Run private desktop conversations through mistral.rs without a hosted chat server, account, or cloud upload.',
  },
  {
    icon: Database,
    title: 'Local RAG for PDF question answering',
    copy: 'Ingest PDFs, generate embeddings, and search a LanceDB vector index that stays on your own machine.',
  },
  {
    icon: Cloud,
    title: 'Optional cloud and remote AI providers',
    copy: 'Use Gemini, OpenAI, Anthropic, OpenRouter, Ollama, LM Studio, or custom OpenAI-compatible APIs when you choose.',
  },
  {
    icon: Keyboard,
    title: 'Hidden desktop assistant mode',
    copy: 'Keep DocuSage ready in the background and summon the compact assistant instantly with a global shortcut.',
  },
];

const workflowSteps = [
  {
    number: '01',
    title: 'Connect a model or provider',
    copy: 'Use a local GGUF model for offline AI, or add a provider key for cloud and remote model access.',
    icon: Cpu,
  },
  {
    number: '02',
    title: 'Ingest private documents',
    copy: 'Drop in PDFs. DocuSage extracts text, chunks it, embeds it locally, and writes it to your LanceDB index.',
    icon: FileText,
  },
  {
    number: '03',
    title: 'Ask grounded questions',
    copy: 'Search local document chunks and answer with the retrieved context, not loose guesses about the file.',
    icon: Search,
  },
  {
    number: '04',
    title: 'Scale only the final answer',
    copy: 'When cloud mode is active, retrieval remains local and only selected prompt context leaves the device.',
    icon: Link,
  },
];

const technicalProof: IconItem[] = [
  {
    icon: ShieldCheck,
    title: 'Privacy-first document intelligence',
    copy: 'Ingestion, embeddings, retrieval, model files, settings, and session history are designed around local control.',
  },
  {
    icon: Sliders,
    title: 'RAG tuning controls',
    copy: 'Tune chunk size, overlap, top-k retrieval, and source context display from the desktop settings panel.',
  },
  {
    icon: HardDrive,
    title: 'Model download and management',
    copy: 'Download, connect, disconnect, and delete local GGUF models without leaving the DocuSage interface.',
  },
  {
    icon: Settings,
    title: 'Provider credential settings',
    copy: 'Manage API keys, base URLs, model names, timeouts, and active providers through a focused settings flow.',
  },
  {
    icon: Monitor,
    title: 'Compact, medium, and full modes',
    copy: 'Switch between assistant sizes with monitor-aware placement for quick lookups or deeper document sessions.',
  },
  {
    icon: Command,
    title: 'Desktop workflow controls',
    copy: 'Use tray actions, restart the AI engine, check for updates, and keep the app ready in the background.',
  },
];

const installSteps = [
  'Download the latest Windows installer from GitHub Releases.',
  'Open DocuSage and connect a local GGUF model or configure an AI provider.',
  'Ingest a PDF, ask a question, and choose local or cloud answer generation per workflow.',
];

const stackRows = [
  ['Desktop shell', 'Tauri v2', 'Native Windows desktop app with a smaller footprint than Electron.'],
  ['Frontend', 'React 19 + Vite', 'Fast interface for chat, RAG, settings, provider management, and assistant modes.'],
  ['Backend', 'Rust 2021', 'Tauri commands for model loading, document ingestion, chat, RAG, and provider calls.'],
  ['Local inference', 'mistral.rs + GGUF', 'On-device model execution for offline private AI chat.'],
  ['Embeddings', 'fastembed + bge-small-en-v1.5', 'Local vector generation for PDF semantic search.'],
  ['Vector store', 'LanceDB', 'Persistent local retrieval for private document question answering.'],
];

function MarketingNav() {
  return (
    <header className="marketing-nav">
      <nav className="marketing-wrap marketing-nav-inner" aria-label="Primary navigation">
        <a className="marketing-logo" href="#top" aria-label="DocuSage home">
          <img src={assets.logo} alt="DocuSage logo" />
          <span>Docu<em>Sage</em></span>
        </a>
        <div className="marketing-nav-links" aria-label="Website sections">
          <a href="#features">Features</a>
          <a href="#privacy">Privacy</a>
          <a href="#docs">Docs</a>
          <a href="#stack">Stack</a>
        </div>
        <a className="marketing-nav-cta" href={releaseUrl} target="_blank" rel="noreferrer">
          <Download size={15} aria-hidden="true" />
          Install
        </a>
      </nav>
    </header>
  );
}

function FeaturePanel({ item }: { item: IconItem }) {
  const Icon = item.icon;
  return (
    <article className="feature-panel">
      <Icon size={22} aria-hidden="true" />
      <h3>{item.title}</h3>
      <p>{item.copy}</p>
    </article>
  );
}

function MarketingSite() {
  useEffect(() => {
    document.body.classList.add('marketing-body');
    return () => document.body.classList.remove('marketing-body');
  }, []);

  const heroStyle = { '--hero-image': `url(${assets.appDark})` } as CSSProperties;

  return (
    <div className="marketing-site" id="top">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <MarketingNav />

      <main id="main-content">
        <section className="marketing-hero" style={heroStyle}>
          <div className="marketing-hero-shade" />
          <div className="marketing-wrap hero-content">
            <p className="eyebrow">Local-first desktop AI assistant</p>
            <h1>DocuSage private document intelligence for your desktop.</h1>
            <p className="hero-copy">
              Chat with local GGUF models, ask questions across private PDFs, run a local RAG pipeline,
              and switch to trusted cloud or remote providers only when stronger answer generation is worth it.
            </p>
            <div className="hero-actions" aria-label="DocuSage install actions">
              <a className="button button-primary" href={releaseUrl} target="_blank" rel="noreferrer">
                <Download size={18} aria-hidden="true" />
                Download Windows installer
              </a>
              <a className="button button-secondary" href="#docs">
                Read install guide
              </a>
            </div>
          </div>
        </section>

        <section className="metric-strip" aria-label="Product highlights">
          <div className="marketing-wrap">
            <dl className="hero-facts" aria-label="Product highlights">
              <div>
                <dt>v0.5.3</dt>
                <dd>Current release</dd>
              </div>
              <div>
                <dt>100%</dt>
                <dd>Local document indexing</dd>
              </div>
              <div>
                <dt>7+</dt>
                <dd>Provider options</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="icon-strip" aria-label="DocuSage product capabilities">
          <div className="marketing-wrap icon-strip-inner">
            <figure>
              <img src={assets.chatbot} alt="Black DocuSage chatbot icon" />
              <figcaption>AI chat</figcaption>
            </figure>
            <figure>
              <img src={assets.document} alt="Document assistant icon" />
              <figcaption>PDF RAG</figcaption>
            </figure>
            <figure>
              <img src={assets.privateAi} alt="Private AI shield icon" />
              <figcaption>Privacy</figcaption>
            </figure>
            <figure>
              <img src={assets.rag} alt="Document to AI retrieval icon" />
              <figcaption>Hybrid mode</figcaption>
            </figure>
          </div>
        </section>

        <section className="marketing-section product-proof" id="features">
          <div className="marketing-wrap">
            <div className="section-intro split-intro">
              <div>
                <p className="eyebrow">AI document assistant</p>
                <h2>Built for offline PDF chat, local RAG, and private AI research.</h2>
              </div>
              <p>
                DocuSage is a desktop AI assistant for people who want document question answering without
                uploading every file to a hosted service. It combines local model inference, local vector search,
                and optional cloud synthesis in one controlled workflow.
              </p>
            </div>

            <div className="product-showcase">
              <img src={assets.appLight} alt="DocuSage light mode desktop interface with RAG document controls" />
            </div>

            <div className="feature-grid">
              {coreFeatures.map((item) => (
                <FeaturePanel key={item.title} item={item} />
              ))}
            </div>
          </div>
        </section>

        <section className="marketing-section privacy-section" id="privacy">
          <div className="marketing-wrap privacy-grid">
            <div className="privacy-media">
              <img src={assets.privateAi} alt="Private AI shield for local document intelligence" />
            </div>
            <div className="privacy-copy">
              <p className="eyebrow">Private by architecture</p>
              <h2>Your documents stay local before any model writes an answer.</h2>
              <p>
                DocuSage keeps PDF parsing, chunking, embeddings, retrieval, local storage, and session history
                on-device. When a cloud or remote provider is active, the local retrieval step still happens first,
                so the app sends selected context instead of the full document.
              </p>
              <ul className="check-list">
                <li><CheckCircle size={17} aria-hidden="true" /> Offline local chat with GGUF model files.</li>
                <li><CheckCircle size={17} aria-hidden="true" /> Local LanceDB vector index for private PDF search.</li>
                <li><CheckCircle size={17} aria-hidden="true" /> Optional provider mode for Gemini, OpenAI, Anthropic, OpenRouter, Ollama, LM Studio, and custom APIs.</li>
                <li><CheckCircle size={17} aria-hidden="true" /> API keys and provider settings managed from the desktop app.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="marketing-section workflow-section">
          <div className="marketing-wrap">
            <div className="section-intro">
              <p className="eyebrow">How DocuSage works</p>
              <h2>From PDF to grounded AI answer in four controlled steps.</h2>
            </div>
            <div className="workflow-grid">
              {workflowSteps.map((step) => {
                const Icon = step.icon;
                return (
                  <article className="workflow-step" key={step.number}>
                    <span className="step-number">{step.number}</span>
                    <Icon size={24} aria-hidden="true" />
                    <h3>{step.title}</h3>
                    <p>{step.copy}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="marketing-section technical-section">
          <div className="marketing-wrap">
            <div className="section-intro split-intro">
              <div>
                <p className="eyebrow">Desktop features</p>
                <h2>More than a PDF chatbot: a complete local AI workspace.</h2>
              </div>
              <p>
                The current app includes hidden assistant mode, provider management, model download tools,
                RAG tuning, update checks, session persistence, and source-grounded document answers.
              </p>
            </div>
            <div className="technical-grid">
              {technicalProof.map((item) => (
                <FeaturePanel key={item.title} item={item} />
              ))}
            </div>
          </div>
        </section>

        <section className="marketing-section docs-section" id="docs">
          <div className="marketing-wrap docs-grid">
            <div className="docs-copy">
              <p className="eyebrow">Install DocuSage</p>
              <h2>Get the Windows desktop app or build from source.</h2>
              <p>
                The fastest path is the signed release artifact from GitHub Releases. Developers can clone the
                repository and run the Tauri app locally with Node.js, npm, Rust stable, and the Tauri v2
                system prerequisites installed.
              </p>
              <div className="docs-actions">
                <a className="button button-primary" href={releaseUrl} target="_blank" rel="noreferrer">
                  <Download size={18} aria-hidden="true" />
                  Install latest release
                </a>
                <a className="button button-secondary" href={sourceUrl} target="_blank" rel="noreferrer">
                  View source
                </a>
              </div>
            </div>
            <div className="install-ledger" aria-label="DocuSage install steps">
              {installSteps.map((step, index) => (
                <div className="install-row" key={step}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <p>{step}</p>
                </div>
              ))}
              <div className="command-block" aria-label="Build from source commands">
                <div><span># clone and run from source</span></div>
                <div>git clone https://github.com/Waqar-743/DocuSage.git</div>
                <div>cd DocuSage/DocuSage</div>
                <div>npm install</div>
                <div>npm run tauri dev</div>
              </div>
            </div>
          </div>
        </section>

        <section className="marketing-section stack-section" id="stack">
          <div className="marketing-wrap">
            <div className="section-intro split-intro">
              <div>
                <p className="eyebrow">Technical stack</p>
                <h2>Local-first AI software built with React, Rust, Tauri, GGUF, and LanceDB.</h2>
              </div>
              <p>
                Each layer is selected for a desktop AI workflow where private document search, local model
                execution, and optional remote answer generation can coexist without changing the privacy model.
              </p>
            </div>
            <div className="stack-table" role="table" aria-label="DocuSage technical stack">
              {stackRows.map(([layer, choice, reason]) => (
                <div className="stack-row" role="row" key={layer}>
                  <span role="cell">{layer}</span>
                  <strong role="cell">{choice}</strong>
                  <p role="cell">{reason}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="final-cta">
          <div className="marketing-wrap final-cta-inner">
            <img src={assets.documentFlow} alt="Stylized document intelligence icon" />
            <p className="eyebrow">Ready to install</p>
            <h2>Bring private AI document search to your desktop.</h2>
            <p>
              Install DocuSage for local PDF question answering, offline GGUF chat, and controlled cloud AI
              provider access from one desktop workspace.
            </p>
            <a className="button button-primary" href={releaseUrl} target="_blank" rel="noreferrer">
              <Download size={18} aria-hidden="true" />
              Download DocuSage
            </a>
          </div>
        </section>
      </main>

      <footer className="marketing-footer">
        <div className="marketing-wrap footer-inner">
          <span>DocuSage by Waqar Ahmed</span>
          <div>
            <a href={sourceUrl} target="_blank" rel="noreferrer">GitHub</a>
            <a href={releaseUrl} target="_blank" rel="noreferrer">Releases</a>
            <a href={portfolioUrl} target="_blank" rel="noreferrer">Portfolio</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default MarketingSite;
