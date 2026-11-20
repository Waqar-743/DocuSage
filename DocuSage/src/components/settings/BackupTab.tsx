import React, { useRef } from 'react';
import { Download, FileText, Upload } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useChatStore } from '../../stores/useChatStore';
import { useUiStore } from '../../stores/useUiStore';

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const BackupTab: React.FC = () => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const chats = useChatStore((s) => s.chats);
  const activeChat = useChatStore((s) => s.getActiveChat());
  const exportBackupJson = useChatStore((s) => s.exportBackupJson);
  const importBackupJson = useChatStore((s) => s.importBackupJson);
  const exportChatMarkdown = useChatStore((s) => s.exportChatMarkdown);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        importBackupJson(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h3 className="text-sm font-semibold">Export & Backup</h3>
        <p className={theme.textMuted}>
          All conversations, folders, and branches are stored locally. Export portable JSON backups or Markdown transcripts anytime.
        </p>
      </div>

      <div className={`rounded-xl border p-4 space-y-3 ${theme.surfaceBg} ${theme.border}`}>
        <div className="font-medium">Full Workspace Backup ({chats.length} chats)</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              triggerDownload(
                `docusage-backup-${new Date().toISOString().slice(0, 10)}.json`,
                exportBackupJson(),
                'application/json',
              )
            }
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium ${theme.accent}`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON Backup</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${theme.border}`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import JSON Backup</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </div>
      </div>

      <div className={`rounded-xl border p-4 space-y-3 ${theme.surfaceBg} ${theme.border}`}>
        <div className="font-medium">Export Current Chat as Markdown</div>
        <p className={`text-[11px] ${theme.textMuted}`}>Active chat: {activeChat.name}</p>
        <button
          type="button"
          onClick={() =>
            triggerDownload(
              `${activeChat.name.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40) || 'chat'}.md`,
              exportChatMarkdown(activeChat.id),
              'text/markdown',
            )
          }
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${theme.border}`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Download Markdown (.md)</span>
        </button>
      </div>
    </div>
  );
};
