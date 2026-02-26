import { useEffect, useState } from 'react';
import { api } from '../api';

const locale = navigator.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
const WEEKDAYS = locale.startsWith('fr')
  ? ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
  : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getMonthRange(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = new Date(first);
  const end = new Date(last);
  // Week starts Monday (1) for fr, Sunday (0) for en
  const weekStart = locale.startsWith('fr') ? 1 : 0;
  let dow = start.getDay(); // 0=Sun, 1=Mon, ...
  let back = weekStart === 1 ? (dow === 0 ? 6 : dow - 1) : dow;
  start.setDate(start.getDate() - back);
  dow = end.getDay();
  let fwd = weekStart === 1 ? (dow === 0 ? 0 : 7 - dow) : 6 - dow;
  end.setDate(end.getDate() + fwd);
  return { start, end };
}

export default function Calendar() {
  const [gmailAccounts, setGmailAccounts] = useState([]);
  const [filterAccount, setFilterAccount] = useState(null);
  const [syncing, setSyncing] = useState({ email: false, calendar: false });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [viewMode, setViewMode] = useState('agenda'); // 'month' | 'agenda' — agenda default for mobile
  const [showCalendarDrawer, setShowCalendarDrawer] = useState(false);
  const [current, setCurrent] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const loadAccounts = async () => {
    try {
      const res = await api.getGmailAccounts().catch(() => ({ accounts: [] }));
      setGmailAccounts(res.accounts || []);
    } catch (_) {}
  };

  const [allEvents, setAllEvents] = useState([]);
  const loadEvents = async () => {
    try {
      const { start, end } = getMonthRange(current.year, current.month);
      // Fetch a bit before/after for smooth nav
      const padStart = new Date(start);
      padStart.setDate(padStart.getDate() - 7);
      const padEnd = new Date(end);
      padEnd.setDate(padEnd.getDate() + 7);
      const params = {
        from: padStart.toISOString().slice(0, 10),
        to: padEnd.toISOString().slice(0, 10),
        limit: 200,
      };
      if (filterAccount) params.gmail_account_id = filterAccount;
      const res = await api.getCalendarEvents(params).catch(() => ({ events: [] }));
      setAllEvents(res.events || []);
    } catch (_) {
      setAllEvents([]);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    loadEvents();
  }, [current.year, current.month, filterAccount]);

  const events = allEvents; // already filtered by loadEvents when filterAccount is set

  const [autoSyncDone, setAutoSyncDone] = useState(false);
  useEffect(() => {
    if (autoSyncDone || gmailAccounts.length === 0 || allEvents.length > 0) return;
    setAutoSyncDone(true);
    setSyncing((s) => ({ ...s, calendar: true }));
    api
      .syncCalendar()
      .then(() => loadEvents())
      .finally(() => setSyncing((s) => ({ ...s, calendar: false })))
      .catch(() => {});
  }, [gmailAccounts.length, allEvents.length, autoSyncDone]);

  const syncCalendar = async () => {
    if (gmailAccounts.length === 0) {
      setError('Connect Gmail first in Data Sources.');
      return;
    }
    setSyncing((s) => ({ ...s, calendar: true }));
    setError(null);
    setSuccess(null);
    try {
      const res = await api.syncCalendar();
      setSuccess(`Synced ${res.accounts || 1} account(s), ${res.synced ?? 0} events.`);
      if (res.errors?.length) setError(res.errors.join(' '));
      await loadEvents();
    } catch (e) {
      setError(e?.body?.error || e?.message || 'Calendar sync failed.');
    } finally {
      setSyncing((s) => ({ ...s, calendar: false }));
    }
  };

  const hasGmail = gmailAccounts.length > 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const prevMonth = () => {
    setCurrent((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 }));
  };
  const nextMonth = () => {
    setCurrent((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 }));
  };
  const goToday = () => {
    const d = new Date();
    setCurrent({ year: d.getFullYear(), month: d.getMonth() });
  };

  const { start: gridStart } = getMonthRange(current.year, current.month);
  const days = [];
  const d = new Date(gridStart);
  for (let i = 0; i < 42; i++) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }

  const eventsByDay = {};
  for (const ev of events) {
    const key = new Date(ev.start_at).toDateString();
    if (!eventsByDay[key]) eventsByDay[key] = [];
    eventsByDay[key].push(ev);
  }
  for (const k of Object.keys(eventsByDay)) {
    eventsByDay[k].sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  }

  const formatTime = (ev) => {
    if (ev.is_all_day) return null;
    const start = new Date(ev.start_at);
    return start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  };

  const monthTitle = new Date(current.year, current.month).toLocaleDateString(locale, { month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] min-h-0 bg-slate-50 dark:bg-slate-900/50 overflow-hidden">
      {/* Header — responsive: stack on mobile */}
      <div className="shrink-0 py-3 px-3 sm:px-4 border-b border-slate-200 dark:border-slate-700/40 bg-white dark:bg-eva-panel">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex items-center shrink-0">
              <button onClick={prevMonth} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 touch-manipulation" aria-label="Previous month">‹</button>
              <button onClick={nextMonth} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 touch-manipulation" aria-label="Next month">›</button>
            </div>
            <h1 className="text-base sm:text-xl font-semibold text-slate-900 dark:text-white capitalize truncate flex-1 min-w-0">{monthTitle}</h1>
            <button onClick={goToday} className="shrink-0 min-w-[44px] min-h-[44px] px-3 flex items-center justify-center rounded-lg text-sm font-medium bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 touch-manipulation">Today</button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 shrink-0">
              <button onClick={() => setViewMode('month')} className={`min-h-[44px] px-3 sm:px-4 py-2 text-sm font-medium touch-manipulation ${viewMode === 'month' ? 'bg-red-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>Month</button>
              <button onClick={() => setViewMode('agenda')} className={`min-h-[44px] px-3 sm:px-4 py-2 text-sm font-medium touch-manipulation ${viewMode === 'agenda' ? 'bg-red-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>Agenda</button>
            </div>
            <button onClick={syncCalendar} disabled={syncing.calendar || !hasGmail} className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg bg-red-500/20 text-red-600 dark:text-eva-accent hover:bg-red-500/30 disabled:opacity-50 text-sm font-medium touch-manipulation">{syncing.calendar ? '…' : 'Sync'}</button>
            <a href="/sources" className="min-h-[44px] px-3 sm:px-4 py-2 flex items-center rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600 text-sm font-medium touch-manipulation">Sources</a>
            {/* Mobile: Calendars filter button */}
            <button onClick={() => setShowCalendarDrawer(true)} className="lg:hidden min-h-[44px] px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-sm font-medium touch-manipulation">
              Calendars
            </button>
          </div>
        </div>
      </div>

      {error && <div className="shrink-0 text-red-600 dark:text-red-400 text-sm bg-red-500/10 px-4 py-2">{error}</div>}
      {success && <div className="shrink-0 text-emerald-600 dark:text-emerald-400 text-sm bg-emerald-500/10 px-4 py-2">{success}</div>}

      {/* Mobile calendar filter drawer */}
      {showCalendarDrawer && (
        <>
          <div className="fixed inset-0 bg-black/40 z-[55] lg:hidden" onClick={() => setShowCalendarDrawer(false)} />
          <div className="fixed left-0 top-0 bottom-0 w-64 max-w-[85vw] bg-white dark:bg-eva-panel border-r border-slate-200 dark:border-slate-700/40 z-[60] flex flex-col shadow-xl lg:hidden">
            <div className="p-3 border-b border-slate-200 dark:border-slate-700/40 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-900 dark:text-white">Calendars</span>
              <button onClick={() => setShowCalendarDrawer(false)} className="p-2 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              <button onClick={() => { setFilterAccount(null); setShowCalendarDrawer(false); }} className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 ${!filterAccount ? 'bg-red-500/20 text-red-600 dark:text-eva-accent' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50'}`}>
                <span className="w-2 h-2 rounded-full bg-red-400" /> All
              </button>
              {gmailAccounts.map((a) => {
                const count = allEvents.filter((e) => e.gmail_account_id === a.id).length;
                const isActive = filterAccount === a.id;
                return (
                  <button key={a.id} onClick={() => { setFilterAccount(a.id); setShowCalendarDrawer(false); }} className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 truncate ${isActive ? 'bg-red-500/20 text-red-600 dark:text-eva-accent' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50'}`} title={a.gmail_address}>
                    <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                    <span className="truncate flex-1">{a.gmail_address}</span>
                    {count > 0 && <span className="text-xs text-slate-500">{count}</span>}
                  </button>
                );
              })}
              {!hasGmail && <p className="px-3 py-4 text-sm text-slate-500"><a href="/sources" className="text-red-600 hover:underline">Connect Gmail</a></p>}
            </div>
          </div>
        </>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Sidebar — hidden on mobile (drawer instead) */}
        <aside className="hidden lg:flex w-52 shrink-0 border-r border-slate-200 dark:border-slate-700/40 bg-white dark:bg-eva-panel flex-col">
          <div className="p-3 border-b border-slate-200 dark:border-slate-700/40">
            <h2 className="text-xs font-medium text-slate-500 dark:text-eva-muted uppercase tracking-wider">Calendars</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <button
              onClick={() => setFilterAccount(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${!filterAccount ? 'bg-red-500/20 text-red-600 dark:text-eva-accent' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50'}`}
            >
              <span className="w-2 h-2 rounded-full bg-red-400" />
              All
            </button>
            {gmailAccounts.map((a) => {
              const count = allEvents.filter((e) => e.gmail_account_id === a.id).length;
              const isActive = filterAccount === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setFilterAccount(a.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 truncate ${isActive ? 'bg-red-500/20 text-red-600 dark:text-eva-accent' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50'}`}
                  title={a.gmail_address}
                >
                  <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                  <span className="truncate flex-1">{a.gmail_address}</span>
                  {count > 0 && <span className="text-xs text-slate-500">{count}</span>}
                </button>
              );
            })}
            {!hasGmail && (
              <p className="px-3 py-4 text-sm text-slate-500">
                <a href="/sources" className="text-red-600 hover:underline">Connect Gmail</a>
              </p>
            )}
          </div>
          <div className="p-2 border-t border-slate-200 dark:border-slate-700/40">
            <button
              onClick={async () => {
                if (!hasGmail) return;
                setSyncing((s) => ({ ...s, email: true }));
                try {
                  for (const acct of gmailAccounts) await api.syncGmail(acct.id);
                  await loadAccounts();
                } finally {
                  setSyncing((s) => ({ ...s, email: false }));
                }
              }}
              disabled={syncing.email || !hasGmail}
              className="w-full px-3 py-2 rounded-lg text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 disabled:opacity-50"
            >
              {syncing.email ? 'Syncing…' : 'Sync Email'}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          {viewMode === 'month' ? (
            /* Month grid (Outlook-style) */
            <div className="flex-1 flex flex-col p-4 overflow-hidden">
              <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700/40 shrink-0">
                {WEEKDAYS.map((wd) => (
                  <div key={wd} className="py-2 px-1 text-center text-xs font-medium text-slate-500 dark:text-eva-muted">
                    {wd}
                  </div>
                ))}
              </div>
              <div className="flex-1 grid grid-cols-7 grid-rows-6 gap-px bg-slate-200 dark:bg-slate-700/40 overflow-auto min-h-0">
                {days.map((day) => {
                  const key = day.toDateString();
                  const dayEvents = eventsByDay[key] || [];
                  const isCurrentMonth = day.getMonth() === current.month;
                  const isToday = day.getTime() === today.getTime();
                  return (
                    <div
                      key={key}
                      className={`bg-white dark:bg-eva-panel flex flex-col min-h-[70px] sm:min-h-[80px] ${!isCurrentMonth ? 'opacity-50' : ''}`}
                    >
                      <div
                        className={`shrink-0 py-1 px-2 text-xs font-medium ${isToday ? 'bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center' : 'text-slate-600 dark:text-slate-400'}`}
                      >
                        {day.getDate()}
                      </div>
                      <div className="flex-1 overflow-y-auto p-1 space-y-0.5 min-h-0">
                        {dayEvents.slice(0, 3).map((ev) => (
                          <div
                            key={ev.id}
                            className="text-xs px-2 py-0.5 rounded truncate bg-red-500/15 text-red-700 dark:text-red-400 border-l-2 border-red-500"
                            title={`${ev.title || ''} ${ev.location ? '• ' + ev.location : ''}`}
                          >
                            {formatTime(ev) && <span className="text-slate-500 mr-1">{formatTime(ev)}</span>}
                            {ev.title || '(No title)'}
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <div className="text-xs text-slate-500 pl-2">+{dayEvents.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Agenda list — Outlook iOS style */
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-3xl mb-4">📅</div>
                  <p className="text-slate-600 dark:text-eva-muted font-medium">No events</p>
                  <p className="text-sm text-slate-500 mt-1">
                    {hasGmail ? 'Click Sync to import. If you see "insufficient scopes", disconnect and reconnect Gmail in Data Sources.' : 'Connect Gmail in Data Sources.'}
                  </p>
                </div>
              ) : (
                <div className="max-w-xl space-y-6">
                  {Object.entries(
                    events.reduce((acc, ev) => {
                      const d = new Date(ev.start_at);
                      d.setHours(0, 0, 0, 0);
                      const k = d.getTime();
                      if (!acc[k]) acc[k] = { date: d, events: [] };
                      acc[k].events.push(ev);
                      return acc;
                    }, {})
                  )
                    .sort((a, b) => {
                      const todayStart = today.getTime();
                      const aFuture = a[0] >= todayStart;
                      const bFuture = b[0] >= todayStart;
                      if (aFuture && bFuture) return a[0] - b[0]; // future: soonest first
                      if (!aFuture && !bFuture) return b[0] - a[0]; // past: most recent first
                      return aFuture ? -1 : 1; // future before past
                    })
                    .map(([, g]) => {
                      g.events.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
                      const isToday = g.date.getTime() === today.getTime();
                      const tomorrow = new Date(today);
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      const isTomorrow = g.date.getTime() === tomorrow.getTime();
                      const dayLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : g.date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
                      return (
                        <section key={g.date.getTime()}>
                          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2 sticky top-0 py-2 bg-slate-50 dark:bg-slate-900/80 backdrop-blur-sm -mx-2 px-4 border-b border-slate-200 dark:border-slate-700/30">
                            {dayLabel}
                          </h3>
                          <div className="space-y-1">
                            {g.events.map((ev) => (
                              <div
                                key={ev.id}
                                className="flex gap-3 p-3 min-h-[52px] rounded-lg bg-white dark:bg-eva-panel border border-slate-200 dark:border-slate-700/40 touch-manipulation active:bg-slate-50 dark:active:bg-slate-800/50"
                              >
                                <div className="shrink-0 w-14 text-xs text-slate-500 dark:text-slate-400">
                                  {ev.is_all_day ? 'All day' : `${new Date(ev.start_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} – ${new Date(ev.end_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`}
                                </div>
                                <div className="flex-1 min-w-0 py-0.5">
                                  <div className="font-medium text-slate-900 dark:text-white text-sm">{ev.title || '(No title)'}</div>
                                  {ev.location && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">📍 {ev.location}</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
