import { NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import EvaTopBar from './EvaTopBar';
import { useAuth } from '../context/AuthContext';

const nav = [
  { to: '/voice', label: 'Real-Time (Voice)', icon: '🎤', highlight: true },
  { to: '/dashboard', label: 'Dashboard', icon: '◉' },
  { to: '/chat', label: 'Chat EVA', icon: '◈' },
  { to: '/emails', label: 'Emails', icon: '✉' },
  { to: '/drafts', label: 'Drafts', icon: '◇' },
  { to: '/documents', label: 'Documents', icon: '◆' },
  { to: '/audit', label: 'Audit Log', icon: '◎' },
  { to: '/sources', label: 'Data Sources', icon: '◐' },
  { to: '/settings', label: 'Settings', icon: '◑' },
];

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout, requireAuth } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-eva-dark">
      <EvaTopBar />
      <div className="flex flex-1 min-h-0">
      <aside className={`${collapsed ? 'w-16' : 'w-60'} bg-eva-panel border-r border-slate-700/40 flex flex-col transition-all duration-200 shrink-0`}>
        <div className="p-4 border-b border-slate-700/40 flex items-center justify-between">
          <div className={`flex items-center gap-3 ${collapsed ? 'justify-center w-full' : ''}`}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">E</div>
            {!collapsed && (
              <div>
                <h1 className="text-base font-semibold text-white leading-tight">EVA</h1>
                <p className="text-[10px] text-eva-muted leading-tight">Digital Twin</p>
              </div>
            )}
          </div>
          {!collapsed && (
            <button onClick={() => setCollapsed(true)} className="text-eva-muted hover:text-white text-xs">‹‹</button>
          )}
        </div>
        <nav className="p-2 flex-1 space-y-0.5">
          {nav.map(({ to, label, icon, highlight }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive ? 'bg-eva-accent/15 text-eva-accent font-medium' :
                  highlight ? 'text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300 font-medium' :
                  'text-slate-400 hover:bg-slate-700/40 hover:text-slate-200'
                } ${collapsed ? 'justify-center' : ''}`
              }
            >
              <span className="text-base shrink-0">{icon}</span>
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-700/40">
          {collapsed ? (
            <button onClick={() => setCollapsed(false)} className="w-full text-eva-muted hover:text-white text-xs text-center">››</button>
          ) : (
            <div className="flex items-center gap-2 px-2">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-[10px] text-white font-medium">
                {(user?.email || user?.display_name || (user?.skipAuth ? 'G' : '?'))[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-eva-muted truncate">{user?.email || (user?.skipAuth ? 'Guest' : '')}</div>
                {requireAuth && (
                  <button onClick={() => { logout(); navigate('/login'); }} className="text-[10px] text-slate-500 hover:text-red-400">Log out</button>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-auto min-w-0">
        <div className="max-w-7xl mx-auto p-6">{children}</div>
      </main>
      </div>
    </div>
  );
}
