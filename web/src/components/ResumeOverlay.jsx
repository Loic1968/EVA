/**
 * Full-screen tap-to-resume after iOS screen lock (PWA / Safari).
 */
export default function ResumeOverlay({ visible, onResume, title, subtitle }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onResume}
      aria-label={title || 'Appuyez pour reprendre'}
      className="fixed inset-0 z-[250] flex flex-col items-center justify-center gap-3 m-0 p-6 border-0 bg-slate-950/92 text-slate-100 font-semibold text-lg text-center cursor-pointer touch-manipulation pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <span className="text-4xl leading-none" aria-hidden>↻</span>
      <span>{title || 'Appuyez pour reprendre'}</span>
      {subtitle && (
        <span className="text-sm font-normal text-slate-400 max-w-xs">{subtitle}</span>
      )}
    </button>
  );
}
