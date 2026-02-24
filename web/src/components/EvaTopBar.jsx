/**
 * EvaTopBar - HaliSoft-branded top bar for EVA Digital Twin
 * Styled like LandingTopBar; links to HaliSoft ecosystem
 */
export default function EvaTopBar() {
  return (
    <div className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/40">
      <nav className="flex items-center justify-between px-4 md:px-6 h-12">
        {/* Logo / Brand */}
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
            <span className="text-sm text-cyan-400 font-medium ml-1.5">EVA</span>
          </div>
        </a>

        {/* Right: links */}
        <div className="flex items-center gap-4">
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
