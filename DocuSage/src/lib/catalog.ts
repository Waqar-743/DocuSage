import type { AiProviderKind, ProviderModelInfo } from '../types';

export type MajorCloudProviderKind = 'anthropic' | 'openAi' | 'googleGemini';

export type MajorCloudProviderMeta = {
  kind: MajorCloudProviderKind;
  canonicalId: string;
  name: string;
  shortLabel: string;
  keyPlaceholder: string;
  docsHint: string;
  defaultBaseUrl: string;
  defaultModel: string;
};

export const MAJOR_CLOUD_PROVIDERS: MajorCloudProviderMeta[] = [
  {
    kind: 'anthropic',
    canonicalId: 'anthropic',
    name: 'Anthropic',
    shortLabel: 'Claude',
    keyPlaceholder: 'sk-ant-api03-…',
    docsHint: 'console.anthropic.com',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5-5',
  },
  {
    kind: 'openAi',
    canonicalId: 'openai',
    name: 'OpenAI (ChatGPT)',
    shortLabel: 'ChatGPT',
    keyPlaceholder: 'sk-proj-…',
    docsHint: 'platform.openai.com',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6.2-sol',
  },
  {
    kind: 'googleGemini',
    canonicalId: 'google-gemini',
    name: 'Google Gemini',
    shortLabel: 'Gemini',
    keyPlaceholder: 'AIzaSy…',
    docsHint: 'aistudio.google.com',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-4-hydrogen',
  },
];

export const CURATED_PROVIDER_MODELS: Record<MajorCloudProviderKind, ProviderModelInfo[]> = {
  anthropic: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  ],
  openAi: [
    { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' },
    { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra' },
    { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
  ],
  googleGemini: [
    { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
    { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon' },
    { id: 'gemini-4-neon', label: 'Gemini 4 Neon' },
    { id: 'gemini-4-argon', label: 'Gemini 4 Argon' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
  ],
};

const OUTDATED_MODEL_PATTERNS = [
  /^gpt-3/i,
  /^gpt-4(?!\.5)/i,
  /^o1/i,
  /^o3/i,
  /^o4/i,
  /^claude-2/i,
  /^claude-3/i,
  /^claude-instant/i,
  /^gemini-1\./i,
  /^gemini-2\./i,
  /^gemini-pro$/i,
  /(embedding|whisper|tts-|dall-e|babbage|davinci|moderation|audio-preview)/i,
];

function isOutdatedOrNonChatModel(id: string): boolean {
  return OUTDATED_MODEL_PATTERNS.some((re) => re.test(id));
}

export function isMajorCloudKind(kind: AiProviderKind): kind is MajorCloudProviderKind {
  return kind === 'anthropic' || kind === 'openAi' || kind === 'googleGemini';
}

export function getMergedProviderModels(
  kind: MajorCloudProviderKind,
  fetched?: ProviderModelInfo[],
): ProviderModelInfo[] {
  const curated = CURATED_PROVIDER_MODELS[kind];
  if (!fetched || fetched.length === 0) return curated;
  const byId = new Map<string, ProviderModelInfo>();
  for (const m of curated) byId.set(m.id, m);
  for (const m of fetched) {
    if (!byId.has(m.id) && !isOutdatedOrNonChatModel(m.id)) {
      byId.set(m.id, m);
    }
  }
  return Array.from(byId.values());
}

export function getModelDisplayName(
  kind: AiProviderKind,
  modelId: string | null | undefined,
  fetched?: ProviderModelInfo[],
): string {
  if (!modelId) return '';
  if (kind === 'local') {
    const match = findCatalogEntryByFilename(modelId);
    return match ? match.name : modelId.replace(/\.gguf$/i, '');
  }
  if (isMajorCloudKind(kind)) {
    const curated = CURATED_PROVIDER_MODELS[kind].find((m) => m.id === modelId);
    if (curated) return curated.label;
  }
  const live = fetched?.find((m) => m.id === modelId);
  return live ? live.label : modelId;
}

export type ModelTag =
  | 'Tiny'
  | 'Fast'
  | 'Balanced'
  | 'Smart'
  | 'Specialist'
  | 'Legacy'
  | 'Embedding';

export type ModelReasoning = 'none' | 'optional' | 'always';

export type ModelCatalogEntry = {
  id: string;
  name: string;
  size: string;
  sizeBytes: number;
  kind: 'chat' | 'embedding';
  tag: ModelTag;
  company: string;
  parameters: string;
  quantization: string;
  bestFor: string[];
  contextLength: number;
  minRamGb: number;
  quality: number;
  speed: number;
  reasoning: ModelReasoning;
  released: string;
  legacy?: boolean;
  hfRepo: string;
  sha256?: string;
  description: string;
  downloadUrl: string;
  directDownloadUrl: string;
  filename: string;
  recommended?: boolean;
};

export const STORE_FILTER_TAGS: readonly ('All' | ModelTag)[] = [
  'All',
  'Tiny',
  'Fast',
  'Balanced',
  'Smart',
  'Specialist',
  'Legacy',
];

function hfEntry(
  params: Omit<ModelCatalogEntry, 'downloadUrl' | 'directDownloadUrl'>,
): ModelCatalogEntry {
  return {
    ...params,
    downloadUrl: `https://huggingface.co/${params.hfRepo}`,
    directDownloadUrl: `https://huggingface.co/${params.hfRepo}/resolve/main/${params.filename}`,
  };
}

/**
 * Full local GGUF catalog aligned with Neurix's curated store (current + specialist + legacy)
 * so every model carries complete specs, RAM fit ratings, and SHA-256 verification checksums.
 */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  // ── Ultra-Small & Fastest Offline Models (instant download, 2-3 GB RAM) ───
  hfEntry({
    id: 'lfm-2-350m',
    name: 'LFM 2 350M',
    size: '229 MB',
    sizeBytes: 229_000_000,
    kind: 'chat',
    tag: 'Tiny',
    company: 'Liquid AI',
    parameters: '350M',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Instant replies', 'Ultra-low RAM', 'Quick summaries'],
    contextLength: 8192,
    minRamGb: 2,
    quality: 2,
    speed: 5,
    reasoning: 'none',
    released: '2025-07',
    hfRepo: 'LiquidAI/LFM2-350M-GGUF',
    filename: 'LFM2-350M-Q4_K_M.gguf',
    description:
      'Ultra-tiny 229 MB model built for instant responses on any laptop or older PC. Downloads in seconds and runs effortlessly with just 2 GB RAM.',
  }),
  hfEntry({
    id: 'gemma-3-270m',
    name: 'Gemma 3 270M',
    size: '241 MB',
    sizeBytes: 253_000_000,
    kind: 'chat',
    tag: 'Tiny',
    company: 'Google',
    parameters: '270M',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Ultra-fast chat', 'Extraction', 'Low-spec PCs'],
    contextLength: 8192,
    minRamGb: 2,
    quality: 2,
    speed: 5,
    reasoning: 'none',
    released: '2025-08',
    hfRepo: 'unsloth/gemma-3-270m-it-GGUF',
    filename: 'gemma-3-270m-it-Q4_K_M.gguf',
    description:
      "Google's smallest Gemma 3 instruction model. Blazing fast token generation for quick rewrites, extraction, and lightweight offline Q&A.",
  }),
  hfEntry({
    id: 'smollm2-360m',
    name: 'SmolLM2 360M Instruct',
    size: '271 MB',
    sizeBytes: 271_000_000,
    kind: 'chat',
    tag: 'Tiny',
    company: 'HuggingFace',
    parameters: '360M',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Blazing speed', 'Rewriting', 'Older laptops'],
    contextLength: 8192,
    minRamGb: 2,
    quality: 2,
    speed: 5,
    reasoning: 'none',
    released: '2025-02',
    hfRepo: 'bartowski/SmolLM2-360M-Instruct-GGUF',
    filename: 'SmolLM2-360M-Instruct-Q4_K_M.gguf',
    description:
      'Featherweight HuggingFace model tuned for fast on-device chat, formatting, and short summaries on virtually any CPU.',
  }),
  hfEntry({
    id: 'qwen-3-0.6b',
    name: 'Qwen 3 0.6B',
    size: '397 MB',
    sizeBytes: 397_000_000,
    kind: 'chat',
    tag: 'Tiny',
    company: 'Alibaba',
    parameters: '0.6B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Fast thinking', 'Multilingual', 'Low RAM'],
    contextLength: 8192,
    minRamGb: 2,
    quality: 3,
    speed: 5,
    reasoning: 'optional',
    released: '2025-04',
    hfRepo: 'unsloth/Qwen3-0.6B-GGUF',
    filename: 'Qwen3-0.6B-Q4_K_M.gguf',
    description:
      'Ultra-compact Qwen 3 release under 400 MB with optional thinking mode, strong instruction following, and rapid CPU inference.',
  }),
  // ── Current Neurix Store Models (smallest first) ──────────────────────────
  hfEntry({
    id: 'qwen-3.5-0.8b',
    name: 'Qwen 3.5 0.8B',
    size: '640 MB',
    sizeBytes: 639_029_504,
    kind: 'chat',
    tag: 'Tiny',
    company: 'Alibaba',
    parameters: '0.8B',
    quantization: 'Q6_K (6-bit)',
    bestFor: ['Quick answers', 'Older devices', 'Many languages'],
    contextLength: 8192,
    minRamGb: 3,
    quality: 2,
    speed: 5,
    reasoning: 'optional',
    released: '2026-02',
    hfRepo: 'unsloth/Qwen3.5-0.8B-GGUF',
    filename: 'Qwen3.5-0.8B-Q6_K.gguf',
    sha256: '8408c5c222111cec253682b49eece2a02ed641ded68490001ec4ee160e71098e',
    description:
      'The smallest model that still holds a real conversation. Starts instantly and runs on almost any device; best for quick questions, rewording and short summaries.',
  }),
  hfEntry({
    id: 'gemma-3-1b',
    name: 'Gemma 3 1B',
    size: '806 MB',
    sizeBytes: 806_000_000,
    kind: 'chat',
    tag: 'Fast',
    company: 'Google',
    parameters: '1B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Fast everyday chat', 'Document Q&A', 'Clean writing'],
    contextLength: 8192,
    minRamGb: 3,
    quality: 3,
    speed: 5,
    reasoning: 'none',
    released: '2025-03',
    hfRepo: 'unsloth/gemma-3-1b-it-GGUF',
    filename: 'gemma-3-1b-it-Q4_K_M.gguf',
    description:
      "Google's snappy 1B model with crisp writing and fast responses — an ideal speed-first upgrade over sub-500M models.",
  }),
  hfEntry({
    id: 'lfm-2.5-1.2b',
    name: 'LFM 2.5 1.2B',
    size: '840 MB',
    sizeBytes: 843_354_944,
    kind: 'chat',
    tag: 'Fast',
    company: 'Liquid AI',
    parameters: '1.2B',
    quantization: 'Q5_K_M (5-bit)',
    bestFor: ['Fast replies', 'Summaries', 'Following instructions'],
    contextLength: 8192,
    minRamGb: 3,
    quality: 2,
    speed: 5,
    reasoning: 'none',
    released: '2026-01',
    hfRepo: 'LiquidAI/LFM2.5-1.2B-Instruct-GGUF',
    filename: 'LFM2.5-1.2B-Instruct-Q5_K_M.gguf',
    sha256: 'fa03f3ac4da941a53a0cd4450aacf6a80804c6a1ff885d2fdcbe9406c03215c4',
    description:
      "Liquid AI's model built for small devices. Very fast for its quality, and good at following instructions and pulling facts out of text.",
  }),
  hfEntry({
    id: 'qwen-3.5-2b',
    name: 'Qwen 3.5 2B',
    size: '1.3 GB',
    sizeBytes: 1_280_835_840,
    kind: 'chat',
    tag: 'Balanced',
    company: 'Alibaba',
    parameters: '2B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Everyday chat', 'Writing help', 'Many languages'],
    contextLength: 8192,
    minRamGb: 4,
    quality: 3,
    speed: 4,
    reasoning: 'optional',
    released: '2026-02',
    hfRepo: 'unsloth/Qwen3.5-2B-GGUF',
    filename: 'Qwen3.5-2B-Q4_K_M.gguf',
    sha256: 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
    description:
      'The best all-rounder for most devices. Clear writing, solid general knowledge and strong multilingual support, and it can think a problem through when you ask it to.',
    recommended: true,
  }),
  hfEntry({
    id: 'lfm-2.5-2.6b',
    name: 'LFM 2.5 2.6B',
    size: '1.7 GB',
    sizeBytes: 1_674_455_040,
    kind: 'chat',
    tag: 'Balanced',
    company: 'Liquid AI',
    parameters: '2.6B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Step-by-step reasoning', 'Maths and logic', 'Planning'],
    contextLength: 8192,
    minRamGb: 6,
    quality: 4,
    speed: 3,
    reasoning: 'always',
    released: '2026-07',
    hfRepo: 'LiquidAI/LFM2.5-2.6B-GGUF',
    filename: 'LFM2.5-2.6B-Q4_K_M.gguf',
    sha256: '02a8b7e17487d326e46d68ce0ba24211e1b80a14c4cd0597fa73c1cd697f52ed',
    description:
      'A reasoning model that works through a question step by step before it answers. Slower to start replying, but more careful with logic, maths and multi-step tasks.',
  }),
  hfEntry({
    id: 'qwen-3.5-4b',
    name: 'Qwen 3.5 4B',
    size: '2.7 GB',
    sizeBytes: 2_740_937_888,
    kind: 'chat',
    tag: 'Smart',
    company: 'Alibaba',
    parameters: '4B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Code', 'Analysis', 'Long, detailed answers'],
    contextLength: 8192,
    minRamGb: 8,
    quality: 5,
    speed: 2,
    reasoning: 'optional',
    released: '2026-02',
    hfRepo: 'unsloth/Qwen3.5-4B-GGUF',
    filename: 'Qwen3.5-4B-Q4_K_M.gguf',
    sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
    description:
      'The most capable of the everyday models. Noticeably better at code, analysis and long answers; needs a recent device with 8 GB of memory.',
  }),
  hfEntry({
    id: 'gemma-4-e2b',
    name: 'Gemma 4 E2B',
    size: '3.3 GB',
    sizeBytes: 3_349_516_256,
    kind: 'chat',
    tag: 'Smart',
    company: 'Google',
    parameters: '2B effective',
    quantization: 'Q4_0 (QAT, 4-bit)',
    bestFor: ['Natural writing', 'Explanations', 'Creative work'],
    contextLength: 8192,
    minRamGb: 8,
    quality: 4,
    speed: 3,
    reasoning: 'optional',
    released: '2026-03',
    hfRepo: 'google/gemma-4-E2B-it-qat-q4_0-gguf',
    filename: 'gemma-4-E2B_q4_0-it.gguf',
    sha256: 'fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634',
    description:
      "Google's on-device model, in the quantization-aware build Google publishes itself. Natural, well-structured writing; a large download for how fast it runs.",
  }),
  hfEntry({
    id: 'gemma-4-e4b',
    name: 'Gemma 4 E4B',
    size: '5.2 GB',
    sizeBytes: 5_154_941_280,
    kind: 'chat',
    tag: 'Smart',
    company: 'Google',
    parameters: '4B effective',
    quantization: 'Q4_0 (QAT, 4-bit)',
    bestFor: ['Desktop use', 'Hard questions', 'Long documents'],
    contextLength: 8192,
    minRamGb: 12,
    quality: 5,
    speed: 1,
    reasoning: 'optional',
    released: '2026-03',
    hfRepo: 'google/gemma-4-E4B-it-qat-q4_0-gguf',
    filename: 'gemma-4-E4B_q4_0-it.gguf',
    sha256: '676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee',
    description:
      'The larger Gemma 4. The strongest writing and reasoning in the catalog, but it needs a computer with 12 GB of memory or more.',
  }),

  // ── Specialist Neurix Models ──────────────────────────────────────────────
  hfEntry({
    id: 'lfm-2.5-1.2b-thinking',
    name: 'LFM 2.5 1.2B Thinking',
    size: '840 MB',
    sizeBytes: 843_358_848,
    kind: 'chat',
    tag: 'Specialist',
    company: 'Liquid AI',
    parameters: '1.2B',
    quantization: 'Q5_K_M (5-bit)',
    bestFor: ['Step-by-step reasoning', 'Maths', 'Small devices'],
    contextLength: 8192,
    minRamGb: 3,
    quality: 3,
    speed: 4,
    reasoning: 'always',
    released: '2026-01',
    hfRepo: 'LiquidAI/LFM2.5-1.2B-Thinking-GGUF',
    filename: 'LFM2.5-1.2B-Thinking-Q5_K_M.gguf',
    sha256: 'babe5939c947665fd57d02357661329990e9b9f7b8b3015d1c40e8621602467d',
    description:
      "Liquid AI's own reasoning version of LFM 2.5 1.2B. It always thinks a question through before it answers, which makes it the smallest careful model in the store.",
  }),
  hfEntry({
    id: 'lfm-2.5-1.2b-function-calling',
    name: 'LFM 2.5 1.2B Function Calling',
    size: '840 MB',
    sizeBytes: 843_354_688,
    kind: 'chat',
    tag: 'Specialist',
    company: 'NovachronoAI',
    parameters: '1.2B',
    quantization: 'Q5_K_M (5-bit)',
    bestFor: ['Tool calls', 'Structured output', 'Automations'],
    contextLength: 8192,
    minRamGb: 3,
    quality: 2,
    speed: 5,
    reasoning: 'none',
    released: '2026-01',
    hfRepo: 'NovachronoAI/LFM2.5-1.2B-Nova-Function-Calling-GGUF',
    filename: 'LFM2.5-1.2B-Nova-Function-Calling.Q5_K_M.gguf',
    sha256: '027bf0a0b22267843e5b2142e890a3f8367244b9a9a0a0f3f0f8c096c06c14cd',
    description:
      'LFM 2.5 1.2B tuned by NovachronoAI to call tools and answer in structured JSON. A community fine-tune, best for automations rather than open conversation.',
  }),
  hfEntry({
    id: 'lfm-2.5-1.2b-jp',
    name: 'LFM 2.5 1.2B Japanese',
    size: '840 MB',
    sizeBytes: 843_354_400,
    kind: 'chat',
    tag: 'Specialist',
    company: 'Liquid AI',
    parameters: '1.2B',
    quantization: 'Q5_K_M (5-bit)',
    bestFor: ['Japanese', 'Translation', 'Fast replies'],
    contextLength: 8192,
    minRamGb: 3,
    quality: 2,
    speed: 5,
    reasoning: 'none',
    released: '2026-06',
    hfRepo: 'LiquidAI/LFM2.5-1.2B-JP-202606-GGUF',
    filename: 'LFM2.5-1.2B-JP-202606-Q5_K_M.gguf',
    sha256: '8f7b42aafe57c51e1f6453b6488a801e9fe255558f4a91ac3f823c105b00decf',
    description:
      "Liquid AI's Japanese edition of LFM 2.5 1.2B, trained further on Japanese text. Pick it when you mostly chat or write in Japanese.",
  }),
  hfEntry({
    id: 'qwen-3.5-2b-artemis',
    name: 'Qwen 3.5 2B Artemis',
    size: '1.4 GB',
    sizeBytes: 1_394_786_208,
    kind: 'chat',
    tag: 'Specialist',
    company: 'TurinTech',
    parameters: '2B',
    quantization: 'Q5_K_M (5-bit)',
    bestFor: ['Tool calls', 'Maths', 'Following instructions'],
    contextLength: 8192,
    minRamGb: 4,
    quality: 3,
    speed: 4,
    reasoning: 'optional',
    released: '2026-10',
    hfRepo: 'turintech/Qwen3.5-2B-Artemis-GGUF',
    filename: 'Qwen3.5-2B-Artemis-Q5_K_M.gguf',
    sha256: '00643c030243fd097ea7e3b3877f06c740562b4ed066964b2cd6d13c23c9820d',
    description:
      'Qwen 3.5 2B rebuilt by TurinTech to use about half the memory while getting more tool calls right than a standard build. A strong pick for maths and precise instructions.',
  }),
  hfEntry({
    id: 'qwen-3.5-2b-cybersec',
    name: 'Qwen 3.5 2B CyberSec',
    size: '1.3 GB',
    sizeBytes: 1_312_164_576,
    kind: 'chat',
    tag: 'Specialist',
    company: 'reaperdoesntknow',
    parameters: '2B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Security questions', 'Hardening advice', 'Incident notes'],
    contextLength: 8192,
    minRamGb: 4,
    quality: 2,
    speed: 4,
    reasoning: 'optional',
    released: '2026-08',
    hfRepo: 'reaperdoesntknow/Qwen3.5-2B-CyberSec-GGUF',
    filename: 'Qwen3.5-2B.Q4_K_M.gguf',
    sha256: '35cb3a5a72ef06911a391dfb9924ab7b009c2e69718f2a92974b0c61e468974d',
    description:
      'Qwen 3.5 2B tuned on a cybersecurity instruction dataset, for questions about threats, hardening and incident response.',
  }),
  hfEntry({
    id: 'qwen-3.5-4b-3d-coder',
    name: 'Qwen 3.5 4B 3D Coder',
    size: '2.7 GB',
    sizeBytes: 2_708_804_096,
    kind: 'chat',
    tag: 'Specialist',
    company: 'CCORE',
    parameters: '4B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Code', '3D scenes', 'Three.js'],
    contextLength: 8192,
    minRamGb: 8,
    quality: 4,
    speed: 2,
    reasoning: 'optional',
    released: '2026-10',
    hfRepo: 'ccore/Qwen3.5-4B-3D-Coder',
    filename: 'Qwen3.5-4B-3D-Coder-Q4_K_M.gguf',
    sha256: '32c37c83d3ca055d30aefa679f1a1670d3e2eb889ee7cc805792d53f219cfae8',
    description:
      'Qwen 3.5 4B tuned by CCORE for general coding, and especially for building interactive 3D scenes with Three.js.',
  }),
  hfEntry({
    id: 'qwen-3.5-4b-reasoning-distill',
    name: 'Qwen 3.5 4B Reasoning Distill',
    size: '2.7 GB',
    sizeBytes: 2_707_510_080,
    kind: 'chat',
    tag: 'Specialist',
    company: 'Jackrong',
    parameters: '4B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Step-by-step reasoning', 'Hard problems', 'Planning'],
    contextLength: 8192,
    minRamGb: 8,
    quality: 5,
    speed: 1,
    reasoning: 'always',
    released: '2026-03',
    hfRepo: 'Jackrong/Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-GGUF',
    filename: 'Qwen3.5-4B.Q4_K_M.gguf',
    sha256: 'e1a4a9886699fecb153747ae97aeb413a7e6bd69da80037aa66cef9a3c656d85',
    description:
      'Qwen 3.5 4B trained by Jackrong on reasoning written by a much larger model. It always thinks before it answers, in a longer and more structured way.',
  }),
  hfEntry({
    id: 'gemma-4-e2b-security',
    name: 'Gemma 4 E2B Security',
    size: '3.4 GB',
    sizeBytes: 3_427_880_384,
    kind: 'chat',
    tag: 'Specialist',
    company: 'entrick',
    parameters: '2B effective',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Security work', 'SOC triage', 'Explanations'],
    contextLength: 8192,
    minRamGb: 8,
    quality: 3,
    speed: 3,
    reasoning: 'none',
    released: '2026-05',
    hfRepo: 'entrick/Security-SLM-Gemma-4-E2B-it-GGUF',
    filename: 'security-gemma-4-e2b-it.Q4_K_M.gguf',
    sha256: '9046894db49c38390088d151dd73397ce1a948480862b3fb8fcbb1b9e977ee5e',
    description:
      'Gemma 4 E2B tuned by entrick as an assistant for authorised red-team, blue-team and SOC work.',
  }),

  // ── Legacy Models (earlier catalog — fully supported if downloaded) ────────
  hfEntry({
    id: 'qwen-2.5-0.5b',
    name: 'Qwen 2.5 0.5B Instruct',
    size: '~380 MB',
    sizeBytes: 400_000_000,
    kind: 'chat',
    tag: 'Legacy',
    legacy: true,
    company: 'Alibaba',
    parameters: '0.5B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Ultra-lightweight', 'Older hardware'],
    contextLength: 4096,
    minRamGb: 2,
    quality: 1,
    speed: 5,
    reasoning: 'none',
    released: '2024-09',
    hfRepo: 'bartowski/Qwen2.5-0.5B-Instruct-GGUF',
    filename: 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
    description:
      'Earlier compact Qwen 2.5 release. Still works cleanly offline, though Qwen 3.5 0.8B delivers stronger replies.',
  }),
  hfEntry({
    id: 'llama-3.2-1b',
    name: 'Llama 3.2 1B Instruct',
    size: '~700 MB',
    sizeBytes: 700_000_000,
    kind: 'chat',
    tag: 'Legacy',
    legacy: true,
    company: 'Meta',
    parameters: '1B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Fast replies', 'Already installed'],
    contextLength: 4096,
    minRamGb: 3,
    quality: 1,
    speed: 5,
    reasoning: 'none',
    released: '2024-09',
    hfRepo: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    description:
      'Fast, compact Meta instruction model from an earlier catalog — still runs natively offline.',
  }),
  hfEntry({
    id: 'qwen2.5-1.5b',
    name: 'Qwen 2.5 1.5B Instruct',
    size: '~940 MB',
    sizeBytes: 990_000_000,
    kind: 'chat',
    tag: 'Legacy',
    legacy: true,
    company: 'Alibaba',
    parameters: '1.5B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Multilingual Q&A', 'Already installed'],
    contextLength: 4096,
    minRamGb: 3,
    quality: 2,
    speed: 4,
    reasoning: 'none',
    released: '2024-09',
    hfRepo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    description:
      'Strong multilingual reasoning and document Q&A quality from the Qwen 2.5 generation.',
  }),
  hfEntry({
    id: 'smollm2-1.7b',
    name: 'SmolLM2 1.7B Instruct',
    size: '~1.0 GB',
    sizeBytes: 1_000_000_000,
    kind: 'chat',
    tag: 'Legacy',
    legacy: true,
    company: 'HuggingFace',
    parameters: '1.7B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Lightweight chat', 'Already installed'],
    contextLength: 4096,
    minRamGb: 4,
    quality: 2,
    speed: 4,
    reasoning: 'none',
    released: '2024-11',
    hfRepo: 'bartowski/SmolLM2-1.7B-Instruct-GGUF',
    filename: 'SmolLM2-1.7B-Instruct-Q4_K_M.gguf',
    description:
      'Compact HuggingFace instruction model from an earlier catalog; newer models of similar size score higher.',
  }),
  hfEntry({
    id: 'gemma-2-2b',
    name: 'Gemma 2 2B IT',
    size: '~1.5 GB',
    sizeBytes: 1_500_000_000,
    kind: 'chat',
    tag: 'Legacy',
    legacy: true,
    company: 'Google',
    parameters: '2B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Summaries', 'Already installed'],
    contextLength: 4096,
    minRamGb: 4,
    quality: 2,
    speed: 4,
    reasoning: 'none',
    released: '2024-07',
    hfRepo: 'bartowski/gemma-2-2b-it-GGUF',
    filename: 'gemma-2-2b-it-Q4_K_M.gguf',
    description: 'Google 2B instruction model with crisp summaries and clean tone.',
  }),
  hfEntry({
    id: 'qwen2.5-3b',
    name: 'Qwen 2.5 3B Instruct',
    size: '~1.8 GB',
    sizeBytes: 1_930_000_000,
    kind: 'chat',
    tag: 'Legacy',
    legacy: true,
    company: 'Alibaba',
    parameters: '3B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Coding', 'Document RAG'],
    contextLength: 4096,
    minRamGb: 6,
    quality: 3,
    speed: 3,
    reasoning: 'none',
    released: '2024-09',
    hfRepo: 'Qwen/Qwen2.5-3B-Instruct-GGUF',
    filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    description: 'Sharp technical synthesis, coding, and multi-document RAG groundedness.',
  }),
  hfEntry({
    id: 'llama-3.2-3b',
    name: 'Llama 3.2 3B Instruct',
    size: '2.0 GB',
    sizeBytes: 2_019_377_696,
    kind: 'chat',
    tag: 'Legacy',
    legacy: true,
    company: 'Meta',
    parameters: '3B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Analysis', 'Structured writing'],
    contextLength: 4096,
    minRamGb: 6,
    quality: 3,
    speed: 3,
    reasoning: 'none',
    released: '2024-09',
    hfRepo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    description: 'Balanced 3B Meta model for deeper offline analysis and structured writing.',
  }),
  hfEntry({
    id: 'phi-3.5-mini',
    name: 'Phi-3.5 Mini Instruct',
    size: '~2.2 GB',
    sizeBytes: 2_200_000_000,
    kind: 'chat',
    tag: 'Legacy',
    legacy: true,
    company: 'Microsoft',
    parameters: '3.8B',
    quantization: 'Q4_K_M (4-bit)',
    bestFor: ['Logical reasoning', 'Code'],
    contextLength: 4096,
    minRamGb: 6,
    quality: 3,
    speed: 2,
    reasoning: 'none',
    released: '2024-08',
    hfRepo: 'bartowski/Phi-3.5-mini-instruct-GGUF',
    filename: 'Phi-3.5-mini-instruct-Q4_K_M.gguf',
    description: 'Microsoft small reasoning & code model with strong logical fidelity.',
  }),
];

export function findCatalogEntryByFilename(filename: string): ModelCatalogEntry | undefined {
  const lower = filename.toLowerCase();
  return MODEL_CATALOG.find((m) => m.filename.toLowerCase() === lower);
}

export type DeviceFit = 'good' | 'tight' | 'too_big' | 'unknown';

const GIB = 1024 ** 3;
const ASSUMED_RAM_GB = 8;

export function nominalRamGb(totalMemoryBytes: number | null | undefined): number | null {
  if (totalMemoryBytes == null || totalMemoryBytes <= 0) return null;
  return Math.ceil(totalMemoryBytes / GIB);
}

export function modelFit(
  model: ModelCatalogEntry,
  totalMemoryBytes: number | null | undefined,
): DeviceFit {
  const ram = nominalRamGb(totalMemoryBytes);
  if (ram === null) return 'unknown';
  if (ram >= model.minRamGb) return 'good';
  if (ram + 2 >= model.minRamGb) return 'tight';
  return 'too_big';
}

export function fitSummary(
  model: ModelCatalogEntry,
  totalMemoryBytes: number | null | undefined,
): string {
  const ram = nominalRamGb(totalMemoryBytes);
  switch (modelFit(model, totalMemoryBytes)) {
    case 'good':
      return `Runs well on this device (${ram} GB memory)`;
    case 'tight':
      return `Tight fit: built for ${model.minRamGb} GB, this device has ${ram} GB`;
    case 'too_big':
      return `Needs ${model.minRamGb} GB of memory; this device has ${ram} GB`;
    default:
      return `Needs about ${model.minRamGb} GB of memory`;
  }
}

export function recommendModel(
  catalog: ModelCatalogEntry[],
  totalMemoryBytes: number | null | undefined,
): ModelCatalogEntry | null {
  const ram = nominalRamGb(totalMemoryBytes) ?? ASSUMED_RAM_GB;
  const offered = catalog.filter(
    (m) => m.kind === 'chat' && !m.legacy && m.tag !== 'Specialist',
  );
  if (offered.length === 0) return null;
  const everyday = offered.filter((m) => m.reasoning !== 'always');
  const pool = everyday.length > 0 ? everyday : offered;

  const better = (a: ModelCatalogEntry, b: ModelCatalogEntry) =>
    b.quality - a.quality || b.speed - a.speed || b.sizeBytes - a.sizeBytes;

  const comfortable = pool.filter((m) => m.minRamGb + 2 <= ram);
  if (comfortable.length > 0) return [...comfortable].sort(better)[0];

  const fits = pool.filter((m) => m.minRamGb <= ram);
  if (fits.length > 0) return [...fits].sort(better)[0];

  return [...pool].sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
}

export function releaseLabel(released: string): string {
  const [year, month] = released.split('-').map(Number);
  if (!year || !month) return released;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export const REASONING_LABELS: Record<ModelReasoning, string> = {
  none: 'Answers directly',
  optional: 'Can think first (optional)',
  always: 'Always thinks step-by-step',
};

export const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  local: 'Offline models',
  openAi: 'OpenAI (ChatGPT)',
  anthropic: 'Anthropic Claude',
  googleGemini: 'Google Gemini',
  openRouter: 'OpenRouter',
  ollamaLocal: 'Ollama (Local)',
  ollamaRemote: 'Ollama (Remote)',
  lmStudio: 'LM Studio (Local)',
  lmStudioRemote: 'LM Studio (Remote)',
  customOpenAiCompatible: 'Custom OpenAI-Compatible',
};

export const PROVIDER_DEFAULTS: Record<AiProviderKind, { baseUrl: string; model: string; needsKey: boolean }> = {
  local: { baseUrl: '', model: '', needsKey: false },
  openAi: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.2-sol', needsKey: true },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', needsKey: true },
  googleGemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-4-hydrogen', needsKey: true },
  openRouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-6.2-sol', needsKey: true },
  ollamaLocal: { baseUrl: 'http://localhost:11434', model: 'llama3.2', needsKey: false },
  ollamaRemote: { baseUrl: 'http://localhost:11434', model: 'llama3.2', needsKey: false },
  lmStudio: { baseUrl: 'http://localhost:1234/v1', model: 'local-model', needsKey: false },
  lmStudioRemote: { baseUrl: 'http://localhost:1234/v1', model: 'local-model', needsKey: false },
  customOpenAiCompatible: { baseUrl: 'https://example.com/v1', model: '', needsKey: true },
};

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : i >= 3 ? 2 : 1)} ${units[i]}`;
}

export function formatSpeed(bps: number | undefined): string {
  if (!bps || bps <= 0) return '--';
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatEta(
  etaSecs: number | null | undefined,
  bytesRemaining?: number,
  speedBps?: number,
): string {
  let seconds = etaSecs ?? null;
  if (seconds == null && bytesRemaining && speedBps && speedBps > 0) {
    seconds = bytesRemaining / speedBps;
  }
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} hr`;
}
