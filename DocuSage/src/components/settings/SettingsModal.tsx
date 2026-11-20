import React from 'react';
import { Cloud, Cpu, Database, Download, Keyboard, Palette, X } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useUiStore } from '../../stores/useUiStore';
import type { SettingsTab } from '../../types';
import { AppearanceTab } from './AppearanceTab';
import { BackupTab } from './BackupTab';
import { LocalRuntimeTab } from './LocalRuntimeTab';
import { ProvidersTab } from './ProvidersTab';
import { RagContextTab } from './RagContextTab';
import { ShortcutsTab } from './ShortcutsTab';

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'providers', label: 'Providers', icon: <Cloud className="w-4 h-4" /> },
  { id: 'localRuntime', label: 'Local AI & GGUF', icon: <Cpu className="w-4 h-4" /> },
  { id: 'ragContext', label: 'RAG & Context', icon: <Database className="w-4 h-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
  { id: 'shortcuts', label: 'Shortcuts & Tray', icon: <Keyboard className="w-4 h-4" /> },
  { id: 'backup', label: 'Export & Backup', icon: <Download className="w-4 h-4" /> },
];

export const SettingsModal: React.FC = () => {
  const open = useUiStore((s) => s.settingsOpen);
  const close = useUiStore((s) => s.closeSettings);
  const tab = useUiStore((s) => s.settingsTab);
  const setTab = useUiStore((s) => s.setSettingsTab);
  const theme = useUiStore((s) => THEMES[s.theme]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      onClick={close}
      role="dialog"
      aria-label="Settings"
    >
      <div
        className={`w-full max-w-4xl h-[82vh] rounded-2xl border shadow-2xl flex flex-col sm:flex-row overflow-hidden ${theme.surfaceElevated} ${theme.border}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Navigation */}
        <nav className={`sm:w-52 shrink-0 border-b sm:border-b-0 sm:border-r p-3 flex sm:flex-col gap-1 overflow-x-auto ${theme.sidebarBg} ${theme.border}`}>
          <div className="hidden sm:flex items-center justify-between px-2 pb-2 mb-1">
            <span className="text-sm font-semibold">Settings</span>
          </div>
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium shrink-0 transition-colors ${
                  active ? theme.accentSoft + ' border' : 'border border-transparent hover:bg-zinc-500/10'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Tab Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className={`flex items-center justify-between px-5 py-3 border-b ${theme.border}`}>
            <span className="text-sm font-semibold">
              {TABS.find((t) => t.id === tab)?.label}
            </span>
            <button
              type="button"
              onClick={close}
              aria-label="Close Settings"
              className="p-1.5 rounded-lg hover:bg-zinc-500/15"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {tab === 'providers' && <ProvidersTab />}
            {tab === 'localRuntime' && <LocalRuntimeTab />}
            {tab === 'ragContext' && <RagContextTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'shortcuts' && <ShortcutsTab />}
            {tab === 'backup' && <BackupTab />}
          </div>
        </div>
      </div>
    </div>
  );
};
