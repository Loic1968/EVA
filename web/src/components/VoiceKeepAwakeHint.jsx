import { isMobileDevice } from '../utils/mobileNav';

/**
 * Gentle reminder during voice sessions — iOS suspends mic when screen locks.
 */
export default function VoiceKeepAwakeHint({ active, lang = 'fr' }) {
  if (!active || !isMobileDevice()) return null;
  const text = lang === 'fr'
    ? "Garde l'écran allumé pendant la voix"
    : 'Keep the screen on during voice';
  return (
    <p
      role="status"
      className="fixed bottom-0 left-0 right-0 z-[180] px-4 py-2 text-center text-xs text-amber-200/90 bg-amber-950/80 border-t border-amber-800/50 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      {text}
    </p>
  );
}
