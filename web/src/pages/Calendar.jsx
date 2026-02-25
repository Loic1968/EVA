import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Calendar() {
  const [gmailAccounts, setGmailAccounts] = useState([]);
  const [syncing, setSyncing] = useState({ email: false, calendar: false });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const loadAccounts = async () => {
    try {
      const res = await api.getGmailAccounts().catch(() => ({ accounts: [] }));
      setGmailAccounts(res.accounts || []);
    } catch (_) {}
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const syncEmail = async () => {
    if (gmailAccounts.length === 0) {
      setError('Connect Gmail first in Data Sources.');
      return;
    }
    setSyncing((s) => ({ ...s, email: true }));
    setError(null);
    setSuccess(null);
    try {
      for (const acct of gmailAccounts) {
        await api.syncGmail(acct.id);
      }
      setSuccess(`Synced ${gmailAccounts.length} Gmail account(s).`);
      await loadAccounts();
    } catch (e) {
      setError('Email sync failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setSyncing((s) => ({ ...s, email: false }));
    }
  };

  const syncCalendar = async () => {
    if (gmailAccounts.length === 0) {
      setError('Connect Gmail first in Data Sources.');
      return;
    }
    setSyncing((s) => ({ ...s, calendar: true }));
    setError(null);
    try {
      const res = await api.syncCalendar();
      setSuccess(`Calendar synced. ${res.accounts || 1} account(s), ${res.synced ?? 0} events.`);
    } catch (e) {
      setError(e?.message || 'Calendar sync failed.');
    } finally {
      setSyncing((s) => ({ ...s, calendar: false }));
    }
  };

  const hasGmail = gmailAccounts.length > 0;
  const calendarReady = typeof api.syncCalendar === 'function' && hasGmail;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Calendar</h1>
        <p className="text-slate-600 dark:text-eva-muted text-sm mt-1">
          Sync Google Calendar and Gmail. EVA uses this for meetings, flights, schedules.
        </p>
      </div>

      {error && <div className="text-red-600 dark:text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2">{error}</div>}
      {success && <div className="text-emerald-600 dark:text-emerald-400 text-sm bg-emerald-500/10 rounded-lg px-4 py-2">{success}</div>}

      {/* Sync options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center text-xl">✉</div>
            <div>
              <h2 className="font-medium text-slate-900 dark:text-white">Sync Email</h2>
              <p className="text-xs text-slate-500 dark:text-eva-muted">Gmail inbox, sent, drafts</p>
            </div>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            Sync your Gmail to the Memory Vault. EVA will use emails when you chat.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={syncEmail}
              disabled={syncing.email || !hasGmail}
              className="px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-600 dark:text-eva-accent hover:bg-cyan-500/30 disabled:opacity-50 text-sm font-medium"
            >
              {syncing.email ? 'Syncing…' : hasGmail ? 'Sync Now' : 'Connect Gmail first'}
            </button>
            <a href="/sources" className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600 text-sm font-medium">
              Data Sources →
            </a>
          </div>
          {hasGmail && (
            <div className="mt-3 text-xs text-slate-500 dark:text-eva-muted">
              {gmailAccounts.length} account(s): {gmailAccounts.map((a) => a.gmail_address).join(', ')}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-xl">📅</div>
            <div>
              <h2 className="font-medium text-slate-900 dark:text-white">Sync Calendar</h2>
              <p className="text-xs text-slate-500 dark:text-eva-muted">Google Calendar events</p>
            </div>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            Sync Google Calendar so EVA knows your meetings and schedule.
          </p>
          <button
            onClick={syncCalendar}
            disabled={syncing.calendar || !calendarReady}
            className="px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-600 dark:text-eva-accent hover:bg-cyan-500/30 disabled:opacity-50 text-sm font-medium"
          >
            {syncing.calendar ? 'Syncing…' : calendarReady ? 'Sync Now' : 'Connect Gmail first'}
          </button>
        </div>
      </div>

      {/* Quick links */}
      <div className="bg-slate-100 dark:bg-slate-800/40 rounded-xl p-5">
        <h3 className="text-slate-700 dark:text-slate-300 font-medium mb-2">Quick links</h3>
        <div className="flex flex-wrap gap-3">
          <a href="/emails" className="text-sm text-cyan-600 dark:text-eva-accent hover:underline">View Emails →</a>
          <a href="/sources" className="text-sm text-cyan-600 dark:text-eva-accent hover:underline">Data Sources →</a>
        </div>
      </div>
    </div>
  );
}
