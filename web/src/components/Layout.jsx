import { NavLink } from 'react-router-dom';

const nav = [
  { to: '/', label: 'Dashboard' },
  { to: '/chat', label: 'Parler à EVA' },
  { to: '/drafts', label: 'Drafts' },
  { to: '/audit', label: 'Audit log' },
  { to: '/sources', label: 'Data sources' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-eva-panel border-r border-slate-700/50 flex flex-col">
        <div className="p-4 border-b border-slate-700/50">
          <h1 className="text-lg font-semibold text-eva-accent">EVA</h1>
          <p className="text-xs text-eva-muted mt-0.5">Command Center</p>
        </div>
        <nav className="p-2 flex-1">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive ? 'bg-eva-accent/20 text-eva-accent' : 'text-slate-300 hover:bg-slate-700/50'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}
