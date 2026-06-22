/**
 * Fixed banner for mobile reconnect / offline states (iOS PWA screen lock).
 */
export default function ConnectionBanner({ message, variant = 'warning' }) {
  if (!message) return null;
  const styles =
    variant === 'info'
      ? 'bg-sky-900/95 text-sky-100 border-sky-700'
      : 'bg-amber-900/95 text-amber-100 border-amber-700';
  return (
    <div
      role="status"
      className={`fixed top-0 left-0 right-0 z-[200] px-4 py-2.5 text-center text-sm font-medium border-b ${styles} pt-[max(0.5rem,env(safe-area-inset-top))]`}
    >
      {message}
    </div>
  );
}
