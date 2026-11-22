export const LINKS = {
  release: 'https://github.com/Waqar-743/DocuSage/releases/latest',
  source: 'https://github.com/Waqar-743/DocuSage',
  releaseNotes: 'https://github.com/Waqar-743/DocuSage/blob/main/DocuSage/docs/releases/v2.0.0.md',
  docs: 'https://github.com/Waqar-743/DocuSage/blob/main/README.md',
  portfolio: 'https://waqarahmed.live',
} as const;

const media = (name: string) => `${import.meta.env.BASE_URL}media/${name}`;

export const IMAGES = {
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
} as const;

export type SandboxDoc = {
  id: string;
  name: string;
  ext: string;
  sizeLabel: string;
  chars: number;
  route: 'Full Context' | 'Hybrid RAG';
  question: string;
  answer: string;
  citationLabel: string;
  excerpt: string;
  tokens: number;
  latencyMs: number;
};

export const SANDBOX_DOCS: SandboxDoc[] = [
  {
    id: 'aurora',
    name: 'Aurora_field_guide.pdf',
    ext: 'PDF',
    sizeLabel: '4.2 MB',
    chars: 84200,
    route: 'Hybrid RAG',
    question: 'When does the station open, and where is visitor check-in?',
    answer:
      'The Aurora field station opens at 08:30, with visitor check-in located in the east hall [1]. Blue field notebooks stay in cabinet seven.',
    citationLabel: '[1] Aurora_field_guide.pdf · Chunk 4 · RRF 0.94',
    excerpt:
      'Aurora field station opens at 08:30. Visitor check-in is in the east hall. Blue notebooks stay in cabinet seven. Weekly instrument maintenance takes place on Friday.',
    tokens: 312,
    latencyMs: 38,
  },
  {
    id: 'rag-rs',
    name: 'hybrid_search.rs',
    ext: 'RS',
    sizeLabel: '8.4 KB',
    chars: 8400,
    route: 'Full Context',
    question: 'How does v2 merge keyword and semantic scores?',
    answer:
      'Small files under 12,000 characters inject verbatim. Larger files merge SQLite FTS5 BM25 ranks with in-Rust cosine similarity using Reciprocal Rank Fusion (k = 60) [1].',
    citationLabel: '[1] hybrid_search.rs · Lines 42–58 · Full Context',
    excerpt:
      'pub fn rrf_score(bm25_rank: usize, vec_rank: usize) -> f32 { 1.0 / (60.0 + bm25_rank as f32) + 1.0 / (60.0 + vec_rank as f32) }',
    tokens: 245,
    latencyMs: 11,
  },
  {
    id: 'release',
    name: 'security_notes.md',
    ext: 'MD',
    sizeLabel: '5.1 KB',
    chars: 5100,
    route: 'Full Context',
    question: 'Where are cloud API keys stored?',
    answer:
      'API keys are stored exclusively in the native OS keyring — never written to localStorage, SQLite, or plain config files [1].',
    citationLabel: '[1] security_notes.md · Section 2 · Full Context',
    excerpt:
      'Credentials use the platform keyring service (Windows Credential Manager / Keychain / Secret Service). Local vectors.db runs in WAL mode inside user app data.',
    tokens: 188,
    latencyMs: 9,
  },
];

export type StoryMoment = {
  id: string;
  num: string;
  title: string;
  caption: string;
  reliefTitle: string;
  reliefCaption: string;
  image: string;
  reliefImage: string;
  alt: string;
};

export const STORY_MOMENTS: StoryMoment[] = [
  {
    id: 'tabs',
    num: '01',
    title: 'Fourteen open tabs.',
    caption: 'One answer buried somewhere inside.',
    reliefTitle: 'One calm workspace.',
    reliefCaption: '36 formats indexed into one local vault.',
    image: IMAGES.frustration,
    reliefImage: IMAGES.observing,
    alt: 'DocuSage mascot overwhelmed by scattered documents',
  },
  {
    id: 'search',
    num: '02',
    title: 'Ctrl+F misses meaning.',
    caption: 'Right concept, slightly different words.',
    reliefTitle: 'Hybrid SQLite RAG.',
    reliefCaption: 'Keywords + vectors fused in milliseconds.',
    image: IMAGES.searching,
    reliefImage: IMAGES.teaching,
    alt: 'DocuSage mascot squinting at a laptop searching files',
  },
  {
    id: 'cloud',
    num: '03',
    title: 'Uploads break trust.',
    caption: 'Private drafts sent to someone else’s server.',
    reliefTitle: 'Zero files uploaded.',
    reliefCaption: 'Run offline GGUF or send excerpts only.',
    image: IMAGES.bored,
    reliefImage: IMAGES.privacy,
    alt: 'DocuSage mascot waiting beside a clock',
  },
];

export type RhythmStep = {
  id: string;
  num: string;
  keycap: string;
  title: string;
  line: string;
  mascot: string;
  mascotAlt: string;
  stageBadge: string;
  stageTitle: string;
  stageDetail: string;
};

export const RHYTHM_STEPS: RhythmStep[] = [
  {
    id: 'tray',
    num: '01',
    keycap: 'Tray',
    title: 'Starts invisible.',
    line: 'Waits quietly in your tray. Zero taskbar clutter.',
    mascot: IMAGES.hiddenFile,
    mascotAlt: 'DocuSage mascot peeking softly behind a locked folder',
    stageBadge: 'Background · <10 MB',
    stageTitle: 'Sleeping in System Tray',
    stageDetail: 'SQLite WAL index & keyring armed. Ready on keystroke.',
  },
  {
    id: 'spotlight',
    num: '02',
    keycap: 'Alt+Space',
    title: 'Appears at your cursor.',
    line: 'A crisp 440×560 Spotlight floats right over your work.',
    mascot: IMAGES.hiddenWorkflow,
    mascotAlt: 'DocuSage mascot stealthily carrying a locked folder',
    stageBadge: 'Spotlight · Floating',
    stageTitle: 'Cursor-Summoned Answer',
    stageDetail: 'Ask a PDF, paste clipboard with Ctrl+Shift+V, get citations.',
  },
  {
    id: 'dashboard',
    num: '03',
    keycap: 'Expand',
    title: 'Opens for deep work.',
    line: 'Compare 2–4 models, branch threads, and inspect chunks.',
    mascot: IMAGES.observing,
    mascotAlt: 'DocuSage mascot researching with a laptop and magnifying glass',
    stageBadge: 'Dashboard · Full',
    stageTitle: 'Research & Compare Studio',
    stageDetail: 'Side-by-side GGUF vs Claude/Gemini + Ctrl+K palette.',
  },
  {
    id: 'escape',
    num: '04',
    keycap: 'Esc',
    title: 'Vanishes cleanly.',
    line: 'Hides to tray with every draft and index untouched.',
    mascot: IMAGES.protected,
    mascotAlt: 'DocuSage mascot holding a green security shield asking for quiet',
    stageBadge: 'Preserved · Silent',
    stageTitle: 'Back in Your Flow',
    stageDetail: 'Zero context lost. Summon again whenever needed.',
  },
];

export type PipelinePreset = {
  id: string;
  label: string;
  ext: string;
  sizeKb: number;
  chars: number;
};

export const PIPELINE_PRESETS: PipelinePreset[] = [
  { id: 'notes', label: 'meeting_notes.md', ext: '.md', sizeKb: 6, chars: 5800 },
  { id: 'code', label: 'engine.rs', ext: '.rs', sizeKb: 11, chars: 10900 },
  { id: 'contract', label: 'vendor_contract.pdf', ext: '.pdf', sizeKb: 4200, chars: 142000 },
  { id: 'data', label: 'telemetry_2026.csv', ext: '.csv', sizeKb: 18500, chars: 620000 },
];

export const FORMAT_BADGES = [
  '.pdf',
  '.md',
  '.txt',
  '.ts',
  '.rs',
  '.py',
  '.json',
  '.csv',
  '.yaml',
  '.sql',
  '.html',
  '+25 more',
];

export type GalleryTab = {
  id: string;
  label: string;
  caption: string;
  image?: string;
  alt: string;
  hasThemeSwitch?: boolean;
};

export const GALLERY_TABS: GalleryTab[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    caption: 'Local RAG chat with expandable retrieved excerpts.',
    alt: 'DocuSage desktop workspace with private document RAG chat',
    hasThemeSwitch: true,
  },
  {
    id: 'models',
    label: 'Model Catalog',
    caption: 'One-click GGUF downloads via on-demand llama-server.',
    image: IMAGES.modelCatalog,
    alt: 'DocuSage local GGUF model catalog',
  },
  {
    id: 'providers',
    label: 'AI Providers',
    caption: '8 providers. Verify & Fetch models. OS keyring secrets.',
    image: IMAGES.providerSettings,
    alt: 'DocuSage AI provider configuration panel',
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    caption: 'Global Alt+Space toggle, tray lifecycle, and window modes.',
    image: IMAGES.shortcutSettings,
    alt: 'DocuSage global shortcut and hidden assistant settings',
  },
];

export const V2_HIGHLIGHTS = [
  { title: 'Compare 2–4 Models', detail: 'Race local GGUF against cloud side-by-side.' },
  { title: 'Branch Any Chat', detail: 'Fork a reply without losing the original thread.' },
  { title: 'Command Palette', detail: 'Hit Ctrl+K to jump, switch, or quote clipboard.' },
  { title: 'Under 10 MB', detail: 'Native Rust + SQLite. No heavy bundled runtimes.' },
];

export const INSTALL_STEPS = [
  { num: '01', title: 'Download', line: 'Grab the <10 MB Windows .exe or .msi.' },
  { num: '02', title: 'Launch once', line: 'Starts silently in your system tray.' },
  { num: '03', title: 'Press Alt+Space', line: 'Spotlight appears right at your cursor.' },
  { num: '04', title: 'Drop a file', line: 'Ask anything — offline or with your key.' },
];

export const FAQ_ITEMS = [
  {
    q: 'What do I need for 100% offline use?',
    a: 'Download the lightweight llama-server runtime and a GGUF model once inside DocuSage. After that, search and chat run completely offline with zero network calls.',
  },
  {
    q: 'Which documents can I import?',
    a: '36 text, document, and code formats up to 50 MB — including text-based PDFs, Markdown, CSV, JSON, Python, TypeScript, and Rust. Image-only scans need OCR before import.',
  },
  {
    q: 'Does cloud mode upload my full files?',
    a: 'No. Parsing, SQLite indexing, and retrieval stay on your machine. Cloud providers only receive your prompt, chat history, and retrieved excerpts.',
  },
  {
    q: 'How do I summon or quit DocuSage?',
    a: 'Press Alt+Space anywhere to toggle Spotlight at your cursor, or use the system tray. Pressing Escape hides it without losing state; choose Quit from the tray to exit.',
  },
  {
    q: 'Are AI answers and citations guaranteed accurate?',
    a: 'No AI model is infallible. DocuSage includes an expandable Smart Context Inspector so you can verify the exact retrieved excerpts against your original file.',
  },
  {
    q: 'Which platforms are supported?',
    a: 'Windows x64 (.exe and .msi) installers publish on GitHub Releases, and full source builds are documented for Windows, Linux, and macOS.',
  },
];
