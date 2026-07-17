import { useEffect, useState, type ComponentType } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronRight,
  Command,
  Cpu,
  Database,
  Download,
  FileSearch,
  FileText,
  Github,
  HardDrive,
  KeyRound,
  Menu,
  MonitorUp,
  Network,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import './MarketingSite.css';

const releaseUrl = 'https://github.com/Waqar-743/DocuSage/releases/latest';
const sourceUrl = 'https://github.com/Waqar-743/DocuSage';
const portfolioUrl = 'https://waqarahmed.live';

const media = (name: string) => `${import.meta.env.BASE_URL}media/${name}`;

const images = {
  logo: media('docusage-logo.png'),
  dashboardDark: media('dashboard-dark.png'),
  dashboardLight: media('dashboard-light.png'),
  modelCatalog: media('model-catalog.png'),
  providerSettings: media('provider-settings.png'),
  shortcutSettings: media('shortcut-settings.png'),
  bored: media('bored.png'),
  frustration: media('frustration.png'),
  searching: media('searching.png'),
  observing: media('observing.png'),
  teaching: media('teaching.png'),
  privacy: media('privacy.png'),
  hiddenWorkflow: media('hidden-workflow.png'),
  hiddenFile: media('hidden-file.png'),
  protected: media('protected.png'),
};

type Icon = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;

type ProofRow = {
  icon: Icon;
  title: string;
  copy: string;
  tag: string;
};

const proofRows: ProofRow[] = [
  {
    icon: FileSearch,
    title: 'Ask questions across private PDF documents',
    copy: 'DocuSage parses, chunks, embeds, and searches your PDFs locally so answers are grounded in the material you selected.',
    tag: 'Local RAG',
  },
  {
    icon: Cpu,
    title: 'Run offline AI chat with GGUF models',
    copy: 'Connect a local model through mistral.rs and keep both the conversation and generation on your own computer.',
    tag: 'On-device',
  },
  {
    icon: Network,
    title: 'Choose cloud power only when it helps',
    copy: 'Use Gemini, OpenAI, Anthropic, OpenRouter, Ollama, LM Studio, or a compatible endpoint while retrieval remains local.',
    tag: '10 profiles',
  },
  {
    icon: Command,
    title: 'Call the assistant without leaving your work',
    copy: 'DocuSage starts hidden, lives in the system tray, and appears with Alt+Space in compact, medium, or full mode.',
    tag: 'Alt+Space',
  },
];

const lifecycle = [
  ['01', 'Start quietly', 'Launch hidden with the Rust backend ready and no dashboard interrupting your desktop.'],
  ['02', 'Call it', 'Press Alt+Space from any application to open the compact assistant beside your work.'],
  ['03', 'Go deeper', 'Move through compact, medium, and full modes when a quick answer becomes a research session.'],
  ['04', 'Leave no mess', 'Escape or close hides DocuSage to the tray while drafts, documents, sessions, and model state remain intact.'],
];

const architecture = [
  { icon: FileText, label: 'Your PDF', detail: 'Local parsing' },
  { icon: Sparkles, label: 'Embeddings', detail: 'fastembed' },
  { icon: Database, label: 'Vector search', detail: 'LanceDB' },
  { icon: Cpu, label: 'Answer', detail: 'Local or chosen provider' },
];

const installSteps = [
  ['Download', 'Get the current Windows installer from GitHub Releases.'],
  ['Open once', 'DocuSage starts in the tray with its background services ready.'],
  ['Press Alt+Space', 'Open the compact assistant from anywhere on your desktop.'],
  ['Add knowledge', 'Connect a GGUF model or provider, ingest a PDF, and ask your first grounded question.'],
];

function Brand() {
  return (
    <a className="site-brand" href="#top" aria-label="DocuSage home">
      <img src={images.logo} alt="" />
      <span>DocuSage</span>
    </a>
  );
}

function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="site-nav">
      <nav className="site-shell nav-inner" aria-label="Primary navigation">
        <Brand />
        <button
          className="nav-toggle"
          type="button"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <div className={`nav-links ${open ? 'is-open' : ''}`}>
          <a href="#story" onClick={() => setOpen(false)}>Why DocuSage</a>
          <a href="#product" onClick={() => setOpen(false)}>Product</a>
          <a href="#privacy" onClick={() => setOpen(false)}>Privacy</a>
          <a href="#architecture" onClick={() => setOpen(false)}>Architecture</a>
          <a className="nav-github" href={sourceUrl} target="_blank" rel="noreferrer">
            <Github size={17} aria-hidden="true" /> GitHub
          </a>
          <a className="nav-install" href={releaseUrl} target="_blank" rel="noreferrer">
            <Download size={16} aria-hidden="true" /> Download
          </a>
        </div>
      </nav>
    </header>
  );
}

function DashboardShowcase() {
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const source = mode === 'light' ? images.dashboardLight : images.dashboardDark;

  return (
    <div className={`dashboard-stage dashboard-stage-${mode}`}>
      <div className="dashboard-toolbar">
        <div>
          <span className="live-dot" /> Real DocuSage interface
        </div>
        <div className="theme-switch" aria-label="Dashboard screenshot theme">
          <button className={mode === 'light' ? 'active' : ''} type="button" onClick={() => setMode('light')}>Light</button>
          <button className={mode === 'dark' ? 'active' : ''} type="button" onClick={() => setMode('dark')}>Dark</button>
        </div>
      </div>
      <img src={source} alt={`DocuSage ${mode} mode dashboard showing private AI document chat`} loading="lazy" decoding="async" />
    </div>
  );
}

function SplitHeading({ text }: { text: string }) {
  const [first, ...rest] = text.split(' ');
  return <>{first} <span>{rest.join(' ')}</span></>;
}

function MarketingSite() {
  useEffect(() => {
    document.body.classList.add('marketing-body');
    return () => document.body.classList.remove('marketing-body');
  }, []);

  return (
    <div className="marketing-site" id="top">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <SiteNav />

      <main id="main-content">
        <section className="hero-section">
          <div className="site-shell hero-grid">
            <div className="hero-intro">
              <div className="hero-copy">
                <p className="section-kicker"><span /> Private AI document assistant</p>
                <h1><span>DocuSage.</span> Private answers from files that stay yours.</h1>
                <p className="hero-lede">
                  Read, search, and chat with private PDFs using local RAG and offline GGUF models.
                  DocuSage stays quietly in your tray until you press Alt+Space.
                </p>
                <div className="hero-actions">
                  <a className="primary-action" href={releaseUrl} target="_blank" rel="noreferrer">
                    <Download size={18} aria-hidden="true" /> Download for Windows
                  </a>
                  <a className="text-action" href={sourceUrl} target="_blank" rel="noreferrer">
                    <Github size={18} aria-hidden="true" /> Explore the source <ArrowRight size={16} aria-hidden="true" />
                  </a>
                </div>
                <div className="hero-trust" aria-label="Product highlights">
                  <span><Check size={15} /> Local PDF retrieval</span>
                  <span><Check size={15} /> Offline model support</span>
                  <span><Check size={15} /> Open source</span>
                </div>
              </div>
              <aside className="hero-aside" aria-label="DocuSage privacy summary">
                <span>Privacy boundary</span>
                <strong>Your documents remain on your computer.</strong>
                <p>Local parsing, local embeddings, local retrieval. A remote model is involved only when you choose one.</p>
                <a href="#privacy">See the architecture <ArrowRight size={15} /></a>
              </aside>
            </div>

            <div className="hero-visual" aria-label="DocuSage product preview">
              <div className="hero-product-meta"><span>Real desktop interface</span><span>React + Tauri + Rust</span></div>
              <div className="hero-window">
                <img src={images.dashboardDark} alt="DocuSage dark mode desktop AI dashboard" fetchPriority="high" />
              </div>
              <img className="hero-character" src={images.observing} alt="DocuSage document character working privately on a laptop" />
              <div className="shortcut-callout"><KeyRound size={16} /> <kbd>Alt</kbd><b>+</b><kbd>Space</kbd></div>
            </div>
          </div>
          <a className="scroll-cue" href="#story"><ArrowDown size={17} /> The story</a>
        </section>

        <section className="story-section" id="story">
          <div className="site-shell">
            <div className="story-opening">
              <p className="chapter-number">Chapter 01</p>
              <h2>Research should feel focused. <span>Not like a search party.</span></h2>
              <p>
                You open another PDF, try another keyword, and lose the thread between tabs. Hosted AI tools
                promise speed, then ask you to upload the documents you were trying to keep private.
              </p>
            </div>

            <div className="problem-reel" aria-label="Common document research frustrations">
              <figure className="problem-frame frame-left">
                <img src={images.frustration} alt="DocuSage character frustrated by difficult document research" loading="lazy" decoding="async" />
                <figcaption><strong>Too many files.</strong><span>The useful sentence is buried somewhere.</span></figcaption>
              </figure>
              <figure className="problem-frame frame-center">
                <img src={images.searching} alt="DocuSage character searching documents on a laptop" loading="lazy" decoding="async" />
                <figcaption><strong>Too much searching.</strong><span>Keywords miss what the document actually means.</span></figcaption>
              </figure>
              <figure className="problem-frame frame-right">
                <img src={images.bored} alt="Tired DocuSage document character waiting beside a clock" loading="lazy" decoding="async" />
                <figcaption><strong>Too much waiting.</strong><span>Your focus disappears before the answer appears.</span></figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="turning-point">
          <div className="site-shell turning-grid">
            <div className="turning-visual">
              <span className="orbit-label orbit-one">PDF</span>
              <span className="orbit-label orbit-two">RAG</span>
              <span className="orbit-label orbit-three">GGUF</span>
              <img src={images.teaching} alt="DocuSage character explaining private AI document question answering" loading="lazy" decoding="async" />
            </div>
            <div className="turning-copy">
              <p className="chapter-number">Chapter 02</p>
              <h2>Built from frustration. <span>Designed to stay beside you.</span></h2>
              <p className="founder-note">
                "DocuSage began with a simple frustration: my documents contained the context, but finding it
                interrupted the work. I wanted an assistant that could stay close to the files, stay out of the
                way, and let me decide when the cloud was involved."
              </p>
              <p className="founder-byline">Waqar Ahmed <span>Creator of DocuSage</span></p>
            </div>
          </div>
        </section>

        <section className="product-section" id="product">
          <div className="site-shell">
            <div className="product-heading">
              <div>
                <p className="chapter-number">Chapter 03</p>
                <h2>One private workspace. <span>No tab maze.</span></h2>
              </div>
              <p>
                Ingest a PDF, switch between general chat and document RAG, choose a local or remote model,
                and keep every research session in one desktop interface.
              </p>
            </div>
            <DashboardShowcase />

            <div className="proof-list">
              {proofRows.map((row, index) => {
                const Icon = row.icon;
                return (
                  <article className="proof-row" key={row.title}>
                    <span className="proof-index">0{index + 1}</span>
                    <Icon size={25} strokeWidth={1.7} aria-hidden={true} />
                    <div><h3><SplitHeading text={row.title} /></h3><p>{row.copy}</p></div>
                    <span className="proof-tag">{row.tag}</span>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="assistant-section">
          <div className="site-shell assistant-layout">
            <div className="assistant-sticky">
              <p className="section-kicker light"><span /> Hidden desktop assistant</p>
              <h2>Present when needed. <span>Invisible when it is not.</span></h2>
              <p>
                DocuSage is built around the rhythm of desktop work. It launches hidden, answers in a compact
                panel, expands for deeper sessions, and returns to the tray without throwing your context away.
              </p>
              <img src={images.hiddenWorkflow} alt="DocuSage character carrying a protected folder in hidden assistant mode" loading="lazy" decoding="async" />
            </div>
            <div className="lifecycle-track">
              {lifecycle.map(([number, title, copy]) => (
                <article key={number}>
                  <span>{number}</span>
                  <div><h3><SplitHeading text={title} /></h3><p>{copy}</p></div>
                </article>
              ))}
              <figure className="shortcut-proof">
                <img src={images.shortcutSettings} alt="DocuSage shortcut settings showing hidden desktop assistant controls" />
                <figcaption>Every shortcut is visible in Settings, including toggle, hide, new chat, and send.</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="privacy-section" id="privacy">
          <div className="site-shell privacy-layout">
            <div className="privacy-copy">
              <p className="chapter-number">Chapter 04</p>
              <h2>Your document stays yours. <span>The answer still arrives.</span></h2>
              <p className="privacy-lede">
                DocuSage keeps PDF parsing, chunking, embeddings, LanceDB retrieval, model files, settings,
                and history on your device. In provider mode, local retrieval still happens first and only the
                selected context is sent for synthesis.
              </p>
              <div className="privacy-facts">
                <div><HardDrive size={21} /><strong>Local by default</strong><span>Documents and indexes remain on your computer.</span></div>
                <div><ShieldCheck size={21} /><strong>You choose the boundary</strong><span>Use offline GGUF chat or an explicitly configured provider.</span></div>
                <div><KeyRound size={21} /><strong>Protected credentials</strong><span>Secrets use the platform keyring where available.</span></div>
              </div>
            </div>
            <div className="privacy-visual">
              <img className="privacy-main" src={images.privacy} alt="DocuSage character protecting a private document" loading="lazy" decoding="async" />
              <img className="privacy-secondary" src={images.protected} alt="DocuSage protected document assistant asking for quiet" loading="lazy" decoding="async" />
              <p><span>Local boundary</span> Your files stay here</p>
            </div>
          </div>
        </section>

        <section className="architecture-section" id="architecture">
          <div className="site-shell">
            <div className="architecture-heading">
              <p className="section-kicker"><span /> How local RAG works</p>
              <h2>A short local path. <span>From PDF to grounded answer.</span></h2>
              <p>Each stage has one job. The retrieval path stays visible, inspectable, and local.</p>
            </div>
            <div className="architecture-flow" aria-label="DocuSage local RAG architecture">
              {architecture.map((step, index) => {
                const Icon = step.icon;
                return (
                  <div className="architecture-step" key={step.label}>
                    <span className="architecture-icon"><Icon size={28} strokeWidth={1.6} /></span>
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                    {index < architecture.length - 1 && <ChevronRight className="architecture-arrow" size={24} />}
                  </div>
                );
              })}
            </div>
            <div className="architecture-note">
              <img src={images.hiddenFile} alt="DocuSage document character hiding safely behind a local folder" loading="lazy" decoding="async" />
              <p><strong>The important part:</strong> cloud providers never perform the retrieval step. DocuSage finds the relevant excerpts locally, then you decide which model writes the final response.</p>
            </div>
          </div>
        </section>

        <section className="inside-section">
          <div className="site-shell">
            <div className="inside-heading">
              <p className="chapter-number">Inside the product</p>
              <h2>Real controls. <span>Built for real desktop AI work.</span></h2>
            </div>
            <div className="screenshot-rail">
              <figure className="screen screen-wide">
                <img src={images.modelCatalog} alt="DocuSage local GGUF model catalog" />
                <figcaption><span>01</span><strong>Local model catalog</strong><p>Download and manage compact GGUF models in the app.</p></figcaption>
              </figure>
              <figure className="screen screen-tall">
                <img src={images.providerSettings} alt="DocuSage AI provider configuration settings" />
                <figcaption><span>02</span><strong>Provider control</strong><p>Set models, endpoints, timeouts, temperature, and credentials.</p></figcaption>
              </figure>
              <figure className="screen screen-wide">
                <img src={images.dashboardDark} alt="DocuSage dark mode chat interface" />
                <figcaption><span>03</span><strong>Focused document chat</strong><p>Move between general conversation and source-grounded RAG.</p></figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="install-section" id="install">
          <div className="site-shell install-layout">
            <div className="install-copy">
              <p className="section-kicker light"><span /> Open source Windows desktop app</p>
              <h2>Your next document <span>does not need to be uploaded.</span></h2>
              <p>Install DocuSage, keep your research close, and summon private document intelligence with one shortcut.</p>
              <div className="install-actions">
                <a className="primary-action light-action" href={releaseUrl} target="_blank" rel="noreferrer">
                  <Download size={19} /> Get the latest release
                </a>
                <a className="text-action light-link" href={sourceUrl} target="_blank" rel="noreferrer">
                  <Github size={18} /> View on GitHub <ArrowRight size={16} />
                </a>
              </div>
              <p className="release-note"><MonitorUp size={16} /> Windows installer available from GitHub Releases</p>
            </div>
            <ol className="install-steps">
              {installSteps.map(([title, copy], index) => (
                <li key={title}><span>0{index + 1}</span><div><strong>{title}</strong><p>{copy}</p></div></li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-shell footer-grid">
          <div><Brand /><p>Private document intelligence, built for your desktop.</p></div>
          <div className="footer-links">
            <a href={releaseUrl} target="_blank" rel="noreferrer">Download</a>
            <a href={sourceUrl} target="_blank" rel="noreferrer">GitHub</a>
            <a href={`${sourceUrl}/blob/main/README.md`} target="_blank" rel="noreferrer">Documentation</a>
            <a href={`${sourceUrl}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT License</a>
          </div>
          <p className="footer-credit">Designed and built by <a href={portfolioUrl} target="_blank" rel="noreferrer">Waqar Ahmed</a>.</p>
        </div>
      </footer>
    </div>
  );
}

export default MarketingSite;
