import React from 'react';
import { GitBranch, Trash2 } from 'lucide-react';
import { THEMES } from '../../lib/themes';
import { useChatStore } from '../../stores/useChatStore';
import { useUiStore } from '../../stores/useUiStore';

export const BranchSelector: React.FC = () => {
  const theme = useUiStore((s) => THEMES[s.theme]);
  const chat = useChatStore((s) => s.getActiveChat());
  const switchBranch = useChatStore((s) => s.switchBranch);
  const deleteBranch = useChatStore((s) => s.deleteBranch);

  if (chat.branches.length <= 1) return null;

  return (
    <div className={`flex items-center gap-1.5 px-4 py-1.5 border-b text-xs overflow-x-auto ${theme.border} ${theme.surfaceBg}`}>
      <GitBranch className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      <span className={`text-[11px] shrink-0 ${theme.textMuted}`}>Branches:</span>
      {chat.branches.map((branch) => {
        const active = branch.id === chat.activeBranchId;
        return (
          <div
            key={branch.id}
            className={`inline-flex items-center gap-1 rounded-full pl-2.5 pr-1 py-0.5 border text-[11px] transition-colors ${
              active ? theme.accentSoft : `${theme.border} opacity-75 hover:opacity-100`
            }`}
          >
            <button
              type="button"
              onClick={() => switchBranch(chat.id, branch.id)}
              className="font-medium"
            >
              {branch.name} ({branch.messages.length})
            </button>
            {chat.branches.length > 1 && (
              <button
                type="button"
                onClick={() => deleteBranch(chat.id, branch.id)}
                aria-label={`Delete branch ${branch.name}`}
                className="p-0.5 rounded-full hover:bg-black/20"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
