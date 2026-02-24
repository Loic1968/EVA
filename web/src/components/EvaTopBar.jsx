/**
 * EvaTopBar - HaliSoft-branded top bar for EVA Digital Twin
 * Shows auth state, dark/light toggle, hamburger on mobile, links to HaliSoft ecosystem
 */
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

function SunIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path fillRule="evenodd" d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z" clipRule="evenodd" />
    </svg>
  );
}

export default function EvaTopBar({ onMenuClick }) {
  const { user, isAuthenticated, logout, requireAuth } = useAuth();
  const { darkMode, toggleTheme } = useTheme();

  return (
    <div className="sticky top-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/40 pt-[env(safe-area-inset-top)]">
      <nav className="flex items-center justify-between px-4 md:px-6 h-12 min-h-[48px]">
        {/* Left: hamburger (mobile) + Logo */}
        <div className="flex items-center gap-3">
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="lg:hidden p-2 -ml-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg"
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
            <span className="font-bold text-base text-slate-900 dark:text-white">
              Hali<span className="text-[#3B82F6]">Soft</span>
            </span>
            <span className="text-slate-500 dark:text-slate-400 text-sm ml-1.5">·</span>
            <span className="text-sm text-cyan-500 dark:text-cyan-400 font-medium ml-1.5">EVA</span>
          </div>
        </a>
        </div>

        {/* Right: theme toggle + auth + links */}
        <div className="flex items-center gap-2 sm:gap-6">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors touch-manipulation"
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            title={darkMode ? 'Clair' : 'Sombre'}
          >
            {darkMode ? <SunIcon /> : <MoonIcon />}
          </button>
          {isAuthenticated && (
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="text-xs text-emerald-600 dark:text-emerald-400/90 truncate max-w-[120px] sm:max-w-[180px]" title={user?.email}>
                {user?.skipAuth ? 'Guest' : (user?.email || '')}
              </span>
              {requireAuth && (
                <button
                  onClick={() => logout()}
                  className="text-xs px-2 py-1 rounded bg-slate-200 dark:bg-slate-700/60 text-slate-600 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-300 dark:hover:bg-slate-700/80 transition-colors"
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
            className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            halisoft.biz
          </a>
          <a
            href="https://halitrade.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            HaliTrade
          </a>
        </div>
      </nav>
    </div>
  );
}
