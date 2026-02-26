/**
 * EVA logo by HaliSoft — colorful SVG, reusable.
 * Use: <EvaLogo size="md" variant="icon" /> for icons, variant="full" for hero/branding.
 */
const sizes = { xs: 24, sm: 32, md: 48, lg: 80, xl: 120 };

export default function EvaLogo({ size = 'md', variant = 'icon', className = '', invert }) {
  const s = sizes[size] ?? sizes.md;
  const showWordmark = variant === 'full' || variant === 'wordmark';
  const showIcon = variant === 'icon' || variant === 'full';

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
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="50%" stopColor="#0891b2" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>
          </defs>
          {/* Rounded square with gradient */}
          <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#eva-grad-icon)" />
          {/* Bold E letterform */}
          <path
            d="M14 18h32v3H14v11h26v3H14v11h32v3H14V18z"
            fill="white"
          />
        </svg>
      )}
      {showWordmark && (
        <div className="flex flex-col items-center mt-0.5">
          <span
            className={`font-bold tracking-tight ${
              invert ? 'text-white' : 'text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 via-cyan-600 to-blue-600 dark:from-cyan-400 dark:to-blue-500'
            }`}
            style={{ fontSize: size === 'xl' ? '1.5rem' : size === 'lg' ? '1.25rem' : '1rem' }}
          >
            EVA
          </span>
          <span className={`text-[10px] -mt-0.5 ${invert ? 'text-cyan-100' : 'text-slate-500 dark:text-slate-400'}`}>
            by HaliSoft
          </span>
        </div>
      )}
    </div>
  );
}
