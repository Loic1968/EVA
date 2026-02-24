/**
 * EvaTopBar - HaliSoft-branded top bar for EVA Digital Twin
 * Shows auth state (logged in / out), hamburger on mobile, links to HaliSoft ecosystem
 */
import { useAuth } from '../context/AuthContext';

export default function EvaTopBar({ onMenuClick }) {
  const { user, isAuthenticated, logout, requireAuth } = useAuth();

  return (
    <div className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/40 pt-[env(safe-area-inset-top)]">
      <nav className="flex items-center justify-between px-4 md:px-6 h-12 min-h-[48px]">
        {/* Left: hamburger (mobile) + Logo */}
        <div className="flex items-center gap-3">
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-white rounded-lg"
              aria-label="Open menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
        <a
          href="https://halisoft.biz"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 hover:opacity-90 transition-opacity"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
            E
          </div>
          <div>
            <span className="font-bold text-base text-white">
              Hali<span className="text-[#3B82F6]">Soft</span>
            </span>
            <span className="text-slate-400 text-sm ml-1.5">·</span>
            <span className="text-sm text-cyan-400 font-medium ml-1.5">EVA            </span>
          </div>
        </a>
        </div>

        {/* Right: auth state + links */}
        <div className="flex items-center gap-3 sm:gap-6">
          {isAuthenticated && (
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="text-xs text-emerald-400/90 truncate max-w-[120px] sm:max-w-[180px]" title={user?.email}>
                {user?.skipAuth ? 'Guest' : (user?.email || '')}
              </span>
              {requireAuth && (
                <button
                  onClick={() => logout()}
                  className="text-xs px-2 py-1 rounded bg-slate-700/60 text-slate-400 hover:text-red-400 hover:bg-slate-700/80 transition-colors"
                >
                  Log out
                </button>
              )}
            </div>
          )}
          <a
            href="https://halisoft.biz"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline text-xs text-slate-400 hover:text-white transition-colors"
          >
            halisoft.biz
          </a>
          <a
            href="https://halitrade.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline text-xs text-slate-400 hover:text-white transition-colors"
          >
            HaliTrade
          </a>
        </div>
      </nav>
    </div>
  );
}
