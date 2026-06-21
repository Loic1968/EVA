import { useState } from 'react';
import { usePwaInstall } from '../hooks/usePwaInstall';

export default function PwaInstallPrompt({ variant = 'sidebar' }) {
  const { canInstall, isInstalled, isIOS, promptInstall, showInstallHint } = usePwaInstall();
  const [busy, setBusy] = useState(false);

  if (!showInstallHint) return null;

  const onInstall = async () => {
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
    }
  };

  if (variant === 'sidebar') {
    return (
      <div className="px-2 pb-2">
        {canInstall ? (
          <button
            type="button"
            onClick={onInstall}
            disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] rounded-lg text-sm font-medium bg-[var(--eva-accent-bg)] text-eva-accent hover:opacity-90 disabled:opacity-50 touch-manipulation"
          >
            <span className="text-base">📲</span>
            <span>{busy ? 'Installing…' : 'Install EVA app'}</span>
          </button>
        ) : isIOS ? (
          <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800/60 text-[11px] leading-snug text-slate-600 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-300">Install on iPhone:</span>{' '}
            Share → Add to Home Screen
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
      <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Install EVA app</h2>
      <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
        Add EVA to your home screen for quick access, full-screen mode, and push notifications — like a native app.
      </p>
      {isInstalled ? (
        <span className="inline-flex px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-medium text-sm">
          EVA is installed on this device
        </span>
      ) : canInstall ? (
        <button
          type="button"
          onClick={onInstall}
          disabled={busy}
          className="px-4 py-2 rounded-lg font-medium bg-eva-accent text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Installing…' : 'Install EVA app'}
        </button>
      ) : isIOS ? (
        <ol className="text-sm text-slate-600 dark:text-slate-400 space-y-2 list-decimal list-inside">
          <li>Open this page in Safari</li>
          <li>Tap the Share button</li>
          <li>Choose <span className="font-medium text-slate-800 dark:text-slate-200">Add to Home Screen</span></li>
        </ol>
      ) : (
        <p className="text-sm text-slate-500 dark:text-eva-muted">
          Use your browser menu to install EVA (Chrome/Edge: address bar install icon).
        </p>
      )}
    </div>
  );
}
