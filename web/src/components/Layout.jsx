import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import EvaTopBar from './EvaTopBar';
import EvaLogo from './EvaLogo';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

const nav = [
  { to: '/voice', label: 'Real-Time (Voice)', icon: '🎤', highlight: true },
  { to: '/dashboard', label: 'Dashboard', icon: '◉' },
  { to: '/chat', label: 'Chat EVA', icon: '◈' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/emails', label: 'Emails', icon: '✉' },
  { to: '/drafts', label: 'Drafts', icon: '◇' },
  { to: '/documents', label: 'Documents', icon: '◆' },
  { to: '/audit', label: 'Audit Log', icon: '◎' },
  { to: '/sources', label: 'Data Sources', icon: '◐' },
  { to: '/settings', label: 'Settings', icon: '◑' },
  { to: '/about', label: 'About', icon: 'ℹ' },
];

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const fullBleed = pathname === '/emails' || pathname === '/calendar';
  const [evaStatus, setEvaStatus] = useState(null); // null=loading, true=active, false=offline
  const { user, logout, requireAuth } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api.status().then((r) => setEvaStatus(r.eva_enabled !== false)).catch(() => setEvaStatus(false));
  }, []);

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-eva-dark overflow-x-hidden">
      <EvaTopBar onMenuClick={() => setMobileOpen(true)} />
      <div className="flex flex-1 min-h-0">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={closeMobile}>
          <div className="absolute inset-0 bg-black/60" />
        </div>
      )}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-out
        lg:transform-none
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${collapsed && !mobileOpen ? 'w-16' : 'w-60'}
        bg-white dark:bg-eva-panel border-r border-slate-200 dark:border-slate-700/40 flex flex-col shrink-0
        top-[calc(3rem+env(safe-area-inset-top,0px))] lg:top-0
      `}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700/40 flex items-center justify-between">
          <div className={`flex items-center gap-3 ${collapsed ? 'justify-center w-full' : ''}`}>
            <EvaLogo size="sm" variant="icon" className="shrink-0" />
            {!collapsed && (
              <div>
                <h1 className="text-base font-semibold leading-tight"><EvaLogo variant="text" className="text-base" /></h1>
                <p className="text-[10px] text-slate-500 dark:text-eva-muted leading-tight">by HaliSoft • Digital Twin</p>
                {evaStatus !== null && (
                  <span className={`inline-flex items-center gap-1 mt-1 text-[10px] ${evaStatus ? 'text-emerald-500' : 'text-amber-500'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${evaStatus ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    {evaStatus ? 'Active' : 'Offline'}
                  </span>
                )}
              </div>
            )}
          </div>
          {!collapsed && !mobileOpen && (
            <button onClick={() => setCollapsed(true)} className="hidden lg:block text-slate-500 dark:text-eva-muted hover:text-slate-900 dark:hover:text-white text-xs">‹‹</button>
          )}
          {mobileOpen && (
            <button onClick={closeMobile} className="lg:hidden text-slate-500 dark:text-eva-muted hover:text-slate-900 dark:hover:text-white text-sm p-2 min-w-[44px] min-h-[44px] touch-manipulation" aria-label="Close menu">✕</button>
          )}
        </div>
        <nav className="p-2 flex-1 space-y-0.5">
          {        nav.map(({ to, label, icon, highlight }) => (
            <NavLink
              key={to}
              to={to}
              onClick={closeMobile}
              title={collapsed && !mobileOpen ? label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-lg text-sm transition-all touch-manipulation ${
                  isActive ? 'bg-[var(--eva-accent-bg)] text-eva-accent font-medium' :
                  highlight ? 'text-eva-accent hover:bg-[var(--eva-accent-bg)] hover:text-eva-accent font-medium' :
                  'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/40 hover:text-slate-900 dark:hover:text-slate-200'
                } ${collapsed ? 'justify-center' : ''}`
              }
            >
              <span className="text-base shrink-0">{icon}</span>
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-200 dark:border-slate-700/40">
          {collapsed && !mobileOpen ? (
            <button onClick={() => setCollapsed(false)} className="hidden lg:block w-full text-slate-500 dark:text-eva-muted hover:text-slate-900 dark:hover:text-white text-xs text-center">››</button>
          ) : (
            <div className="flex items-center gap-2 px-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-white font-medium" style={{ background: `linear-gradient(135deg, var(--eva-accent), var(--eva-accent-dark))` }}>
                {(user?.email || user?.display_name || (user?.skipAuth ? 'G' : '?'))[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-500 dark:text-eva-muted truncate">{user?.email || (user?.skipAuth ? 'Guest' : '')}</div>
                {requireAuth && (
                  <button onClick={() => { logout(); navigate('/login'); }} className="text-[10px] text-slate-500 hover:text-eva-accent">Log out</button>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-auto min-w-0">
        <div className={fullBleed ? 'w-full min-h-[calc(100vh-3rem)] pb-[max(1rem,env(safe-area-inset-bottom))]' : 'max-w-7xl mx-auto p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))]'}>{children}</div>
      </main>
      </div>
    </div>
  );
}
