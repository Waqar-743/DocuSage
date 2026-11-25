import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Columns2,
  Command,
  Download,
  Feather,
  GitBranch,
  Github,
  Menu,
  Moon,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import {
  FAQ_ITEMS,
  GALLERY_TABS,
  IMAGES,
  INSTALL_STEPS,
  LINKS,
  RHYTHM_STEPS,
  STORY_MOMENTS,
  V2_HIGHLIGHTS,
} from './marketing/data';
import { HeroSandbox } from './marketing/HeroSandbox';
import { PipelineLab } from './marketing/PipelineLab';
import { PrivacyVault } from './marketing/PrivacyVault';
import { SpotlightModal } from './marketing/SpotlightModal';
import './MarketingSite.css';

const HIGHLIGHT_ICONS = [Columns2, GitBranch, Command, Feather];

function Brand() {
  return (
    <a className="brand-mark" href="#top" aria-label="DocuSage home">
      <img src={IMAGES.logo} alt="" width="34" height="34" />
      <span>DocuSage</span>
    </a>
  );
}

function MarketingSite() {
  const [navOpen, setNavOpen] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [storySolved, setStorySolved] = useState(false);
  const [rhythmIndex, setRhythmIndex] = useState(1);
  const [galleryTabId, setGalleryTabId] = useState(GALLERY_TABS[0].id);
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('dark');
  const [scrollProgress, setScrollProgress] = useState(0);

  const activeRhythm = RHYTHM_STEPS[rhythmIndex] ?? RHYTHM_STEPS[0];
  const activeGallery =
    GALLERY_TABS.find((tab) => tab.id === galleryTabId) ?? GALLERY_TABS[0];

  const galleryImageSrc = activeGallery.hasThemeSwitch
    ? previewTheme === 'light'
      ? IMAGES.dashboardLight
      : IMAGES.dashboardDark
    : activeGallery.image ?? IMAGES.dashboardDark;

  useEffect(() => {
    document.body.classList.add('marketing-body');
    return () => document.body.classList.remove('marketing-body');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && (event.code === 'Space' || event.key === ' ')) {
        event.preventDefault();
        setSpotlightOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) {
        setScrollProgress(0);
        return;
      }
      setScrollProgress(Math.min(100, Math.max(0, (window.scrollY / scrollable) * 100)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="ds-site" id="top">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="ds-nav">
        <div className="scroll-rail" aria-hidden="true">
          <span style={{ width: `${scrollProgress}%` }} />
        </div>
        <nav className="shell nav-row" aria-label="Primary navigation">
          <Brand />
          <button
            className="nav-burger"
            type="button"
            aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={navOpen}
            aria-controls="primary-nav-links"
            onClick={() => setNavOpen((value) => !value)}
          >
            {navOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>

          <div id="primary-nav-links" className={`nav-links ${navOpen ? 'is-open' : ''}`}>
            <a href="#story" onClick={() => setNavOpen(false)}>Story</a>
            <a href="#rhythm" onClick={() => setNavOpen(false)}>Spotlight</a>
            <a href="#how-it-works" onClick={() => setNavOpen(false)}>Hybrid RAG</a>
            <a href="#privacy" onClick={() => setNavOpen(false)}>Privacy</a>
            <a href="#product" onClick={() => setNavOpen(false)}>Workspace</a>
            <a
              className="nav-gh"
              href={LINKS.source}
              target="_blank"
              rel="noreferrer"
            >
              <Github size={16} aria-hidden="true" /> GitHub
            </a>
            <a
              className="nav-cta"
              href={LINKS.release}
              target="_blank"
              rel="noreferrer"
            >
              <Download size={15} aria-hidden="true" /> Download
            </a>
          </div>
        </nav>
      </header>

      <main id="main-content">
        {/* PROLOGUE: HERO + LIVE INTERACTIVE SANDBOX */}
        <section className="hero-band" aria-labelledby="hero-heading">
          <div className="shell hero-stack">
            <div className="hero-header">
              <div className="hero-copy">
                <p className="kicker">
                  <span className="kicker-dot" aria-hidden="true" />
                  DocuSage v2.0.5 · Local-First Desktop AI
                </p>
                <h1 id="hero-heading">
                  Ask your files. <em>Keep them yours.</em>
                </h1>
                <p className="hero-sub">
                  36 formats. Hybrid SQLite RAG. Summon anywhere with{' '}
                  <kbd className="inline-kbd">Alt+Space</kbd>.
                </p>

                <div className="hero-actions">
                  <a
                    className="btn-primary"
                    href={LINKS.release}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download size={17} aria-hidden="true" />
                    Download for Windows
                  </a>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setSpotlightOpen(true)}
                  >
                    <Sparkles size={16} aria-hidden="true" />
                    Try Alt+Space Live
                  </button>
                  <a
                    className="btn-ghost"
                    href={LINKS.source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Github size={16} aria-hidden="true" />
                    Source <ArrowRight size={15} aria-hidden="true" />
                  </a>
                </div>
              </div>

              <div className="hero-metrics" aria-label="DocuSage 2.0 key metrics">
                <div className="metric-card">
                  <strong>&lt;10 MB</strong>
                  <span>Installer target</span>
                </div>
                <div className="metric-card">
                  <strong>36</strong>
                  <span>File formats</span>
                </div>
                <div className="metric-card">
                  <strong>0 Bytes</strong>
                  <span>Sent in local mode</span>
                </div>
              </div>
            </div>

            <HeroSandbox onSummonSpotlight={() => setSpotlightOpen(true)} />
          </div>
        </section>

        {/* CHAPTER 01: VISUAL STORYTELLING — BEFORE / AFTER */}
        <section className="story-band" id="story" aria-labelledby="story-heading">
          <div className="shell">
            <div className="section-head-split">
              <div>
                <p className="chapter-tag">Chapter 01 · The Problem</p>
                <h2 id="story-heading">
                  The answer is on your disk. <em>Finding it breaks flow.</em>
                </h2>
              </div>

              <div className="story-switch" role="group" aria-label="Story state toggle">
                <button
                  type="button"
                  className={!storySolved ? 'active' : ''}
                  aria-pressed={!storySolved}
                  onClick={() => setStorySolved(false)}
                >
                  Without DocuSage
                </button>
                <button
                  type="button"
                  className={storySolved ? 'active' : ''}
                  aria-pressed={storySolved}
                  onClick={() => setStorySolved(true)}
                >
                  With DocuSage 2.0
                </button>
              </div>
            </div>

            <div className="story-grid" aria-live="polite">
              {STORY_MOMENTS.map((moment) => (
                <article
                  key={moment.id}
                  className={`story-card ${storySolved ? 'is-solved' : ''}`}
                >
                  <div className="story-card-top">
                    <span className="story-num">{moment.num}</span>
                    <span className="story-pill">
                      {storySolved ? 'Solved' : 'Friction'}
                    </span>
                  </div>
                  <div className="story-art">
                    <img
                      src={storySolved ? moment.reliefImage : moment.image}
                      alt={moment.alt}
                      width="320"
                      height="320"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <h3>{storySolved ? moment.reliefTitle : moment.title}</h3>
                  <p>{storySolved ? moment.reliefCaption : moment.caption}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* CHAPTER 02: THE SHIFT — INTERACTIVE SPOTLIGHT RHYTHM */}
        <section className="rhythm-band" id="rhythm" aria-labelledby="rhythm-heading">
          <div className="shell">
            <div className="section-head-dark">
              <p className="chapter-tag light">Chapter 02 · The Shift</p>
              <h2 id="rhythm-heading">
                Invisible in the tray. <em>Instant at your cursor.</em>
              </h2>
            </div>

            <div className="rhythm-layout">
              <div className="rhythm-steps" role="tablist" aria-label="Desktop assistant lifecycle">
                {RHYTHM_STEPS.map((step, index) => {
                  const selected = index === rhythmIndex;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      role="tab"
                      id={`rhythm-tab-${step.id}`}
                      aria-selected={selected}
                      aria-controls={`rhythm-panel-${step.id}`}
                      className={`rhythm-step ${selected ? 'is-active' : ''}`}
                      onClick={() => setRhythmIndex(index)}
                    >
                      <span className="rhythm-num">{step.num}</span>
                      <span className="rhythm-text">
                        <strong>{step.title}</strong>
                        <small>{step.line}</small>
                      </span>
                      <kbd className="rhythm-key">{step.keycap}</kbd>
                    </button>
                  );
                })}
              </div>

              <div
                className="rhythm-stage"
                role="tabpanel"
                id={`rhythm-panel-${activeRhythm.id}`}
                aria-labelledby={`rhythm-tab-${activeRhythm.id}`}
              >
                <div className="rhythm-stage-head">
                  <span className="stage-chip">{activeRhythm.stageBadge}</span>
                  <button
                    type="button"
                    className="stage-try-btn"
                    onClick={() => setSpotlightOpen(true)}
                  >
                    Launch Simulator <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </div>

                <div className="rhythm-visual-canvas">
                  <div className="mascot-medallion">
                    <img
                      src={activeRhythm.mascot}
                      alt={activeRhythm.mascotAlt}
                      width="240"
                      height="240"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div className="rhythm-caption">
                    <h3>{activeRhythm.stageTitle}</h3>
                    <p>{activeRhythm.stageDetail}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CHAPTER 03: UNDER THE HOOD — INTERACTIVE SMART CONTEXT & HYBRID RAG */}
        <section className="pipeline-band" id="how-it-works" aria-labelledby="pipeline-heading">
          <div className="shell">
            <div className="section-head">
              <p className="chapter-tag">Chapter 03 · Smart Context</p>
              <h2 id="pipeline-heading">
                One SQLite engine. <em>Zero guesswork.</em>
              </h2>
              <p className="section-sub">
                Pick a file or slide the size — watch DocuSage route automatically.
              </p>
            </div>

            <PipelineLab />
          </div>
        </section>

        {/* CHAPTER 04: PRIVACY BOUNDARY */}
        <section className="privacy-band" id="privacy" aria-labelledby="privacy-heading">
          <div className="shell">
            <div className="section-head centered">
              <p className="chapter-tag">Chapter 04 · Privacy Boundary</p>
              <h2 id="privacy-heading">
                Your files stay home. <em>Always.</em>
              </h2>
              <p className="section-sub">
                Flip the switch to inspect exactly what stays on disk and what crosses the wire.
              </p>
            </div>

            <PrivacyVault />
          </div>
        </section>

        {/* CHAPTER 05: INTERACTIVE PRODUCT WORKSPACE GALLERY */}
        <section className="product-band" id="product" aria-labelledby="product-heading">
          <div className="shell">
            <div className="section-head-split">
              <div>
                <p className="chapter-tag">Chapter 05 · Inside DocuSage</p>
                <h2 id="product-heading">
                  Fast for a question. <em>Built for deep work.</em>
                </h2>
              </div>

              <div className="gallery-tabs" role="tablist" aria-label="Desktop app views">
                {GALLERY_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`gallery-tab-${tab.id}`}
                    aria-selected={tab.id === activeGallery.id}
                    aria-controls={`gallery-panel-${tab.id}`}
                    className={tab.id === activeGallery.id ? 'active' : ''}
                    onClick={() => setGalleryTabId(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`gallery-stage gallery-theme-${activeGallery.hasThemeSwitch ? previewTheme : 'light'}`}
              role="tabpanel"
              id={`gallery-panel-${activeGallery.id}`}
              aria-labelledby={`gallery-tab-${activeGallery.id}`}
            >
              <div className="gallery-toolbar">
                <p>{activeGallery.caption}</p>
                {activeGallery.hasThemeSwitch && (
                  <div className="theme-toggle" role="group" aria-label="Workspace screenshot theme">
                    <button
                      type="button"
                      className={previewTheme === 'light' ? 'active' : ''}
                      aria-pressed={previewTheme === 'light'}
                      onClick={() => setPreviewTheme('light')}
                    >
                      <Sun size={14} aria-hidden="true" /> Light
                    </button>
                    <button
                      type="button"
                      className={previewTheme === 'dark' ? 'active' : ''}
                      aria-pressed={previewTheme === 'dark'}
                      onClick={() => setPreviewTheme('dark')}
                    >
                      <Moon size={14} aria-hidden="true" /> Dark
                    </button>
                  </div>
                )}
              </div>

              <a
                href={galleryImageSrc}
                target="_blank"
                rel="noreferrer"
                className="gallery-image-link"
                aria-label={`Open full-size ${activeGallery.label} capture`}
              >
                <img
                  src={galleryImageSrc}
                  alt={activeGallery.alt}
                  width="1440"
                  height="1000"
                  loading="lazy"
                  decoding="async"
                />
              </a>
            </div>

            <div className="highlights-grid" aria-label="DocuSage 2.0 capabilities">
              {V2_HIGHLIGHTS.map((item, idx) => {
                const Icon = HIGHLIGHT_ICONS[idx] ?? Sparkles;
                return (
                  <article key={item.title} className="highlight-tile">
                    <span className="tile-icon">
                      <Icon size={19} aria-hidden="true" />
                    </span>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* COMPACT FAQ */}
        <section className="faq-band" id="faq" aria-labelledby="faq-heading">
          <div className="shell faq-shell">
            <div className="faq-intro">
              <p className="chapter-tag">Before you install</p>
              <h2 id="faq-heading">
                Short answers. <em>No fine print.</em>
              </h2>
            </div>
            <div className="faq-list">
              {FAQ_ITEMS.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* EPILOGUE: FINAL CTA */}
        <section className="cta-band" id="install" aria-labelledby="install-heading">
          <div className="shell cta-layout">
            <div className="cta-copy">
              <p className="chapter-tag light">Windows x64 · Open Source</p>
              <h2 id="install-heading">
                Ready in ten seconds. <em>Private forever.</em>
              </h2>
              <div className="cta-actions">
                <a
                  className="btn-light"
                  href={LINKS.release}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={17} aria-hidden="true" /> Get Latest Release
                </a>
                <a
                  className="btn-outline-light"
                  href={LINKS.releaseNotes}
                  target="_blank"
                  rel="noreferrer"
                >
                  v2.0.5 Notes <ArrowRight size={15} aria-hidden="true" />
                </a>
              </div>
            </div>

            <ol className="install-rail">
              {INSTALL_STEPS.map((step) => (
                <li key={step.num}>
                  <span className="step-num">{step.num}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.line}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="ds-footer">
        <div className="shell footer-row">
          <div className="footer-brand">
            <Brand />
            <p>Private document intelligence for your desktop.</p>
          </div>
          <nav className="footer-links" aria-label="Footer links">
            <a href={LINKS.release} target="_blank" rel="noreferrer">Download</a>
            <a href={LINKS.source} target="_blank" rel="noreferrer">GitHub</a>
            <a href={LINKS.releaseNotes} target="_blank" rel="noreferrer">Release Notes</a>
            <a href={LINKS.docs} target="_blank" rel="noreferrer">Docs</a>
          </nav>
          <p className="footer-credit">
            Built by{' '}
            <a href={LINKS.portfolio} target="_blank" rel="noreferrer">
              Waqar Ahmed
            </a>
          </p>
        </div>
      </footer>

      <SpotlightModal open={spotlightOpen} onClose={() => setSpotlightOpen(false)} />
    </div>
  );
}

export default MarketingSite;
