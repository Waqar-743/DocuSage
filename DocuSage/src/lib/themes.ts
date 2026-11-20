import type { AppearanceTheme } from '../types';

export type ThemeTokens = {
  appBg: string;
  sidebarBg: string;
  surfaceBg: string;
  surfaceElevated: string;
  inputBg: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  userBubble: string;
  botBubble: string;
  isDark: boolean;
};

export const APPEARANCE_OPTIONS: { key: AppearanceTheme; label: string; description: string }[] = [
  { key: 'dark', label: 'Obsidian Dark', description: 'Low-glare charcoal workspace.' },
  { key: 'light', label: 'Studio Light', description: 'Crisp bright neutral workspace.' },
  { key: 'glass', label: 'Spotlight Glass', description: 'Translucent floating overlay.' },
  { key: 'paper', label: 'Warm Paper', description: 'Document-first soft parchment surface.' },
  { key: 'rose', label: 'Rose Quartz', description: 'Warm light palette with rose accents.' },
  { key: 'ocean', label: 'Deep Ocean', description: 'Cool twilight blue-slate palette.' },
];

export const THEMES: Record<AppearanceTheme, ThemeTokens> = {
  dark: {
    appBg: 'bg-[#111318] text-zinc-100',
    sidebarBg: 'bg-[#161922]',
    surfaceBg: 'bg-[#1a1e29]',
    surfaceElevated: 'bg-[#212634]',
    inputBg: 'bg-[#161922]',
    border: 'border-zinc-800/90',
    text: 'text-zinc-100',
    textMuted: 'text-zinc-400',
    accent: 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950',
    accentSoft: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    userBubble: 'bg-emerald-600/20 border border-emerald-500/30 text-zinc-100',
    botBubble: 'bg-[#191d27] border border-zinc-800/80 text-zinc-100',
    isDark: true,
  },
  light: {
    appBg: 'bg-[#f8f9fb] text-zinc-900',
    sidebarBg: 'bg-[#f1f3f6]',
    surfaceBg: 'bg-white',
    surfaceElevated: 'bg-white shadow-sm',
    inputBg: 'bg-white',
    border: 'border-zinc-200',
    text: 'text-zinc-900',
    textMuted: 'text-zinc-500',
    accent: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    accentSoft: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    userBubble: 'bg-emerald-600 text-white',
    botBubble: 'bg-white border border-zinc-200 text-zinc-900',
    isDark: false,
  },
  glass: {
    appBg: 'bg-zinc-950/85 backdrop-blur-2xl text-zinc-100',
    sidebarBg: 'bg-zinc-900/60 backdrop-blur-xl',
    surfaceBg: 'bg-zinc-900/55 backdrop-blur-lg',
    surfaceElevated: 'bg-zinc-800/65 backdrop-blur-xl',
    inputBg: 'bg-zinc-900/75',
    border: 'border-white/10',
    text: 'text-zinc-100',
    textMuted: 'text-zinc-400',
    accent: 'bg-emerald-400 hover:bg-emerald-300 text-zinc-950',
    accentSoft: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
    userBubble: 'bg-white/10 border border-white/15 text-white',
    botBubble: 'bg-zinc-900/70 border border-white/10 text-zinc-100',
    isDark: true,
  },
  paper: {
    appBg: 'bg-[#f6f3eb] text-stone-900',
    sidebarBg: 'bg-[#eee9dc]',
    surfaceBg: 'bg-[#fbf9f3]',
    surfaceElevated: 'bg-white',
    inputBg: 'bg-[#fffdf8]',
    border: 'border-stone-300/80',
    text: 'text-stone-900',
    textMuted: 'text-stone-500',
    accent: 'bg-amber-700 hover:bg-amber-600 text-white',
    accentSoft: 'bg-amber-100 text-amber-800 border-amber-300',
    userBubble: 'bg-stone-800 text-stone-50',
    botBubble: 'bg-[#fffdf8] border border-stone-300/70 text-stone-900',
    isDark: false,
  },
  rose: {
    appBg: 'bg-[#fdf7f8] text-rose-950',
    sidebarBg: 'bg-[#f8ebee]',
    surfaceBg: 'bg-white',
    surfaceElevated: 'bg-white',
    inputBg: 'bg-white',
    border: 'border-rose-200/80',
    text: 'text-rose-950',
    textMuted: 'text-rose-700/70',
    accent: 'bg-rose-600 hover:bg-rose-500 text-white',
    accentSoft: 'bg-rose-100 text-rose-700 border-rose-200',
    userBubble: 'bg-rose-600 text-white',
    botBubble: 'bg-white border border-rose-200/70 text-rose-950',
    isDark: false,
  },
  ocean: {
    appBg: 'bg-[#0b1320] text-slate-100',
    sidebarBg: 'bg-[#0f1a2b]',
    surfaceBg: 'bg-[#132238]',
    surfaceElevated: 'bg-[#192c47]',
    inputBg: 'bg-[#101c2e]',
    border: 'border-sky-900/60',
    text: 'text-slate-100',
    textMuted: 'text-slate-400',
    accent: 'bg-sky-400 hover:bg-sky-300 text-slate-950',
    accentSoft: 'bg-sky-400/15 text-sky-300 border-sky-400/30',
    userBubble: 'bg-sky-500/20 border border-sky-400/30 text-slate-50',
    botBubble: 'bg-[#122034] border border-sky-900/60 text-slate-100',
    isDark: true,
  },
};
