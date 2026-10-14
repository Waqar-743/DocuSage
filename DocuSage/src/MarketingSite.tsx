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
  dashboardDark: media('desktop-dark.webp'),
  dashboardLight: media('desktop-light.webp'),
  modelCatalog: media('desktop-models.webp'),
  providerSettings: media('desktop-providers.webp'),
  shortcutSettings: media('desktop-shortcuts.webp'),
  bored: media('bored.webp'),
  frustration: media('frustration.webp'),
  searching: media('searching.webp'),
  observing: media('research-guide.webp'),
  teaching: media('teaching.webp'),
  privacy: media('privacy-guide.webp'),
  hiddenWorkflow: media('hidden-workflow.webp'),
  hiddenFile: media('hidden-file.webp'),
  protected: media('protected.webp'),
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
    title: 'Ask questions about your selected PDF',
    copy: 'Import a text-based PDF, select it, and ask a question. DocuSage searches that file locally and supplies relevant excerpts to your model.',
    tag: 'Local RAG',
  },
  {
    icon: Cpu,
    title: 'Run offline AI chat with GGUF models',
    copy: 'Download a compatible GGUF model once, then generate answers on your computer. Document search needs a separate embedding-model download on first use.',
    tag: 'On-device',
  },
  {
    icon: Network,
    title: 'Choose cloud power only when it helps',
    copy: 'Use Gemini, OpenAI, Anthropic, OpenRouter, Ollama, LM Studio, or a compatible endpoint while retrieval remains local.',
    tag: 'Optional providers',
  },
  {
    icon: Command,
    title: 'Call the assistant without leaving your work',
    copy: 'DocuSage starts hidden, lives in the system tray, and appears with Alt+Space in compact, medium, or full mode.',
    tag: 'Alt+Space',
  },
];

const lifecycle = [
  ['01', 'Start quietly', 'By default, DocuSage opens in the tray. Connect a model or configure a provider when you are ready.'],
  ['02', 'Call it', 'Press Alt+Space to open the assistant. If that shortcut is occupied, try the fallback shown in Settings or open it from the tray.'],
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
  ['Download', 'Get the Windows .exe or .msi installer from GitHub Releases.'],
  ['Open once', 'DocuSage starts in the tray with its background services ready.'],
  ['Press Alt+Space', 'Open the compact assistant from anywhere on your desktop.'],
  ['Add knowledge', 'Connect a model or provider, import a text-based PDF, select it, and ask your first question.'],
];

function Brand() {
  return (
    <a className="site-brand" href="#top" aria-label="DocuSage home">
      <img src={images.logo} alt="" width="35" height="35" />
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
          aria-controls="primary-links"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <div id="primary-links" className={`nav-links ${open ? 'is-open' : ''}`}>
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
          <span className="live-dot" /> Desktop capture · Linux source build
        </div>
        <div className="theme-switch" role="group" aria-label="Dashboard screenshot theme">
          <button aria-pressed={mode === 'light'} className={mode === 'light' ? 'active' : ''} type="button" onClick={() => setMode('light')}>Light</button>
          <button aria-pressed={mode === 'dark'} className={mode === 'dark' ? 'active' : ''} type="button" onClick={() => setMode('dark')}>Dark</button>
        </div>
      </div>
      <a href={source} target="_blank" rel="noreferrer" aria-label={`Open full-size ${mode} desktop screenshot`}>
        <img src={source} alt={`DocuSage ${mode} desktop capture with a real local PDF conversation`} loading="lazy" decoding="async" width="1440" height="1000" />
      </a>
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
                <h1><span>Ask your PDFs.</span> Keep your files close.</h1>
                <p className="hero-lede">
                  Find useful passages in text-based PDFs and ask questions with a local AI model or a provider you choose.
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
                  <span><Check size={15} /> Source on GitHub</span>
                </div>
              </div>
              <aside className="hero-aside" aria-label="DocuSage privacy summary">
                <span>Privacy boundary</span>
                <strong>Local search. Your choice of AI.</strong>
                <p>PDFs are indexed on your device. Cloud mode sends your question, chat history, and retrieved excerpts to your selected provider.</p>
                <a href="#privacy">Understand the privacy boundary <ArrowRight size={15} /></a>
              </aside>
            </div>

            <div className="hero-visual" aria-label="DocuSage product preview">
              <div className="hero-product-meta"><span>Captured from the desktop app</span><span>Local PDF chat</span></div>
              <div className="hero-window">
                <img src={images.dashboardDark} alt="DocuSage dark mode desktop AI dashboard" fetchPriority="high" width="1440" height="1000" decoding="async" />
              </div>
              <img className="hero-character" src={images.observing} alt="" aria-hidden="true" width="640" height="640" decoding="async" />
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
                <img src={images.frustration} alt="DocuSage character frustrated by difficult document research" loading="lazy" decoding="async" width="800" height="800" />
                <figcaption><strong>Too many files.</strong><span>The useful sentence is buried somewhere.</span></figcaption>
              </figure>
              <figure className="problem-frame frame-center">
                <img src={images.searching} alt="DocuSage character searching documents on a laptop" loading="lazy" decoding="async" width="800" height="800" />
                <figcaption><strong>Too much searching.</strong><span>The right idea may use different words.</span></figcaption>
              </figure>
              <figure className="problem-frame frame-right">
                <img src={images.bored} alt="Tired DocuSage document character waiting beside a clock" loading="lazy" decoding="async" width="800" height="800" />
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
              <img src={images.teaching} alt="DocuSage character explaining private AI document question answering" loading="lazy" decoding="async" width="800" height="800" />
            </div>
            <div className="turning-copy">
              <p className="chapter-number">Chapter 02</p>
              <h2>Built from frustration. <span>Designed to stay beside you.</span></h2>
              <p className="founder-note">
                The useful passage is often already in your files. DocuSage brings local document search and
                conversation into a small desktop workspace, with a clear choice between on-device generation
                and a provider you configure.
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
                and keep your conversations in one desktop interface.
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
              <img src={images.hiddenWorkflow} alt="DocuSage character carrying a protected folder in hidden assistant mode" loading="lazy" decoding="async" width="800" height="800" />
            </div>
            <div className="lifecycle-track">
              {lifecycle.map(([number, title, copy]) => (
                <article key={number}>
                  <span>{number}</span>
                  <div><h3><SplitHeading text={title} /></h3><p>{copy}</p></div>
                </article>
              ))}
              <figure className="shortcut-proof">
                <img src={images.shortcutSettings} alt="DocuSage shortcut settings showing hidden desktop assistant controls" loading="lazy" decoding="async" width="1440" height="1000" />
                <figcaption>Set your global shortcut and window size in Settings. Shortcut availability depends on your operating system.</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="privacy-section" id="privacy">
          <div className="site-shell privacy-layout">
            <div className="privacy-copy">
              <p className="chapter-number">Chapter 04</p>
              <h2>Know what stays local. <span>Know what gets sent.</span></h2>
              <p className="privacy-lede">
                PDF parsing, indexing, semantic search, and history storage happen on your device. Local models
                generate answers there too. With a cloud or remote provider, your question, conversation history,
                and retrieved PDF excerpts leave your device. The original PDF is not uploaded by the indexing pipeline.
              </p>
              <div className="privacy-facts">
                <div><HardDrive size={21} /><strong>Local by default</strong><span>Documents and indexes remain on your computer.</span></div>
                <div><ShieldCheck size={21} /><strong>You choose the boundary</strong><span>Use offline GGUF chat or an explicitly configured provider.</span></div>
                <div><KeyRound size={21} /><strong>Protected credentials</strong><span>API keys require the native credential store. DocuSage reports when it is unavailable.</span></div>
              </div>
            </div>
            <div className="privacy-visual">
              <img className="privacy-main" src={images.privacy} alt="DocuSage character protecting a private document" loading="lazy" decoding="async" width="800" height="800" />
              <img className="privacy-secondary" src={images.protected} alt="DocuSage protected document assistant asking for quiet" loading="lazy" decoding="async" width="800" height="800" />
              <p><span>Local boundary</span> Your files stay here</p>
            </div>
          </div>
        </section>

        <section className="architecture-section" id="architecture">
          <div className="site-shell">
            <div className="architecture-heading">
              <p className="section-kicker"><span /> How local RAG works</p>
              <h2>A short local path. <span>From a passage to an answer.</span></h2>
              <p>Search happens locally. The selected model writes the answer. Review its citations against the source; AI can make mistakes.</p>
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
              <img src={images.hiddenFile} alt="DocuSage document character hiding safely behind a local folder" loading="lazy" decoding="async" width="800" height="800" />
              <p><strong>The important part:</strong> the PDF retrieval step happens on your device. DocuSage finds the relevant excerpts locally, then you decide which model writes the final response.</p>
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
                <img src={images.modelCatalog} alt="DocuSage local GGUF model catalog" loading="lazy" decoding="async" width="1440" height="1000" />
                <figcaption><span>01</span><strong>Local model catalog</strong><p>Download and manage compact GGUF models in the app.</p></figcaption>
              </figure>
              <figure className="screen screen-tall">
                <img src={images.providerSettings} alt="DocuSage AI provider configuration settings" loading="lazy" decoding="async" width="1440" height="1000" />
                <figcaption><span>02</span><strong>Provider control</strong><p>Set models, endpoints, timeouts, temperature, and credentials.</p></figcaption>
              </figure>
              <figure className="screen screen-wide">
                <img src={images.dashboardDark} alt="DocuSage dark mode chat interface" loading="lazy" decoding="async" width="1440" height="1000" />
                <figcaption><span>03</span><strong>Focused document chat</strong><p>Move between general conversation and document questions.</p></figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="faq-section site-shell" aria-labelledby="faq-heading">
          <p className="section-kicker"><span /> Before you download</p>
          <h2 id="faq-heading">A few useful details.</h2>
          <details><summary>What do I need for offline use?</summary><p>A compatible GGUF model for answers and the embedding model for PDF search. Both need an internet connection to download initially. Local model speed and memory use depend on your computer and model size.</p></details>
          <details><summary>Which documents can I import?</summary><p>Text-based PDFs. Image-only scans need OCR in another tool first. DocuSage does not currently provide OCR, Word import, or an in-app PDF reader.</p></details>
          <details><summary>Does cloud mode share my documents?</summary><p>It shares your prompt, chat history, and the PDF excerpts retrieved for the question with your configured provider. That provider’s privacy policy applies. The original PDF and local vector index are not uploaded by the retrieval pipeline.</p></details>
          <details><summary>How do I open the app after launch?</summary><p>Press Alt+Space, or choose Show Assistant from the tray. If the shortcut is already taken, DocuSage tries Ctrl+Space. You can change it in Settings. Closing or pressing Escape normally hides the app; use Tray → Quit to exit.</p></details>
          <details><summary>Are answers guaranteed to be correct?</summary><p>No. Retrieved excerpts help the model answer from your selected PDF, but answers and model-generated filename citations can be wrong. Enable Show Retrieved Context to inspect the passages the model received.</p></details>
          <details><summary>Which platforms are available?</summary><p>Windows installers are available on GitHub Releases. Screenshots and detailed functional tests use a Linux source build. Read the release notes for Windows package checks and remaining limits; macOS behavior has not been verified in this audit. Source-build requirements are documented on GitHub.</p></details>
        </section>

        <section className="install-section" id="install">
          <div className="site-shell install-layout">
            <div className="install-copy">
              <p className="section-kicker light"><span /> Windows desktop app · source on GitHub</p>
              <h2>A calmer way <span>to work with your documents.</span></h2>
              <p>Set up your model, import a text-based PDF, and start a conversation. Local mode works offline after the required models are downloaded.</p>
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
          </div>
          <p className="footer-credit">Designed and built by <a href={portfolioUrl} target="_blank" rel="noreferrer">Waqar Ahmed</a>.</p>
        </div>
      </footer>
    </div>
  );
}

export default MarketingSite;
