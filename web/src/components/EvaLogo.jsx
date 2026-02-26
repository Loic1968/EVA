/**
 * EVA logo by HaliSoft — bi-color like HaliTrade (E = red, VA = dark).
 * Use: <EvaLogo size="md" variant="icon" /> for icons, variant="full" for hero, variant="text" for inline wordmark.
 */
const sizes = { xs: 24, sm: 32, md: 48, lg: 80, xl: 120 };

export default function EvaLogo({ size = 'md', variant = 'icon', className = '', invert }) {
  const s = sizes[size] ?? sizes.md;
  const showWordmark = variant === 'full' || variant === 'wordmark';
  const showIcon = variant === 'icon' || variant === 'full';
  const showTextOnly = variant === 'text';

  const biColorEva = (
    <span className="font-bold tracking-tight">
      <span className={invert ? 'text-white' : 'text-[#DC2626] dark:text-red-500'}>E</span>
      <span className={invert ? 'text-white/90' : 'text-[#1F2937] dark:text-slate-300'}>VA</span>
    </span>
  );

  if (showTextOnly) {
    return <span className={`inline-flex items-center ${className}`}>{biColorEva}</span>;
  }

  return (
    <div className={`inline-flex flex-col items-center justify-center ${className}`}>
      {showIcon && (
        <svg
          viewBox="0 0 64 64"
          width={s}
          height={s}
          className="shrink-0"
          aria-hidden
        >
          <defs>
            <linearGradient id="eva-grad-icon" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#DC2626" />
              <stop offset="100%" stopColor="#B91C1C" />
            </linearGradient>
          </defs>
          {/* Rounded square — HaliSoft bi-color (red) */}
          <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#eva-grad-icon)" />
          {/* Bold E letterform */}
          <path
            d="M14 18h32v3H14v11h26v3H14v11h32v3H14V18z"
            fill="white"
          />
        </svg>
      )}
      {showWordmark && (
        <div className="flex flex-col items-center mt-0.5" style={{ fontSize: size === 'xl' ? '1.5rem' : size === 'lg' ? '1.25rem' : '1rem' }}>
          {biColorEva}
          <span className={`text-[10px] -mt-0.5 ${invert ? 'text-red-100' : 'text-slate-500 dark:text-slate-400'}`}>
            by HaliSoft
          </span>
        </div>
      )}
    </div>
  );
}
