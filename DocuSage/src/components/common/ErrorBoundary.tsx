import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

/**
 * Prevents any uncaught React rendering error from leaving a transparent Tauri
 * desktop window blank/invisible.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('DocuSage UI error boundary caught:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="h-screen w-screen flex items-center justify-center p-6 bg-slate-950 text-slate-100 rounded-2xl border border-slate-800"
      >
        <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3 shadow-2xl">
          <div className="flex items-center gap-2.5 text-rose-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h2 className="text-sm font-semibold">DocuSage recovered from a display error</h2>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Your downloaded models and chats are safe. Click below to reload the workspace.
          </p>
          <pre className="text-[11px] font-mono bg-slate-950/80 border border-slate-800 rounded-lg p-2.5 text-rose-300 overflow-x-auto max-h-28">
            {this.state.error.message || String(this.state.error)}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-semibold text-xs hover:bg-emerald-400 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reload Workspace</span>
          </button>
        </div>
      </div>
    );
  }
}
