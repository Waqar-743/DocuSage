import React from 'react';
import { Square } from 'lucide-react';

export const StopButton: React.FC<{ onStop: () => void; label?: string }> = ({
  onStop,
  label = 'Stop',
}) => (
  <button
    type="button"
    onClick={onStop}
    aria-label="Stop generation"
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/90 hover:bg-rose-500 text-white text-xs font-medium transition-colors shrink-0"
  >
    <Square className="w-3 h-3 fill-current" />
    <span>{label}</span>
  </button>
);
