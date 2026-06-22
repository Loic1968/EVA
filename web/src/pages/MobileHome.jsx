import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { refreshLocationForChat } from '../utils/geolocation';
import { openUrl, prefersSameWindowNav } from '../utils/mobileNav';

const lang = navigator.language?.startsWith('fr') ? 'fr' : 'en';
const FETCH_TIMEOUT_MS = 15000;
const EVA2_LOGIN_URL = 'https://eva-vps.halisoft.biz/auth/login';

const copy = {
  fr: {
    title: 'EVA sur téléphone',
    subtitle: 'Raccourcis — tout en un écran, sans menu.',
    eva2Chat: 'Eva 2 — Chat OpenClaw',
    eva2ChatDesc: 'Assistant 24/7 (recommandé)',
    eva2Opening: 'Connexion Eva 2…',
    chat: 'EVA — Chat texte',
    chatDesc: 'Comme ChatGPT, avec voix',
    voice: 'Alice — Voix',
    voiceDesc: 'Parler à Alice (push-to-talk)',
    call: 'Appel EVA — Temps réel',
    callDesc: 'Conversation vocale live',
    eva2Hub: 'Paramètres Eva 2 / GPS',
    pwaTip: 'Ajoute EVA à l’écran d’accueil (Partager → Sur l’écran d’accueil) pour une app plein écran.',
    eva2PwaTip: 'Pour Eva 2 seul : ajoute eva-vps.halisoft.biz à l’écran d’accueil après connexion.',
    lockTip: 'Si l’écran se verrouille pendant le chat ou la voix : déverrouille et appuie sur « Reprendre ».',
    error: 'Impossible d’ouvrir Eva 2 — réessaie ou utilise la connexion directe.',
    directLogin: 'Connexion directe Eva 2',
  },
  en: {
    title: 'EVA on phone',
    subtitle: 'Shortcuts — one screen, no menu.',
    eva2Chat: 'Eva 2 — OpenClaw chat',
    eva2ChatDesc: '24/7 assistant (recommended)',
    eva2Opening: 'Connecting to Eva 2…',
    chat: 'EVA — Text chat',
    chatDesc: 'Like ChatGPT, with voice',
    voice: 'Alice — Voice',
    voiceDesc: 'Talk to Alice (push-to-talk)',
    call: 'Call EVA — Realtime',
    callDesc: 'Live voice conversation',
    eva2Hub: 'Eva 2 settings / GPS',
    pwaTip: 'Add EVA to your home screen (Share → Add to Home Screen) for a full-screen app.',
    eva2PwaTip: 'For Eva 2 only: add eva-vps.halisoft.biz to home screen after login.',
    lockTip: 'If the screen locks during chat or voice: unlock and tap « Resume ».',
    error: 'Could not open Eva 2 — try again or use direct login.',
    directLogin: 'Direct Eva 2 login',
  },
};

async function fetchEva2ChatUrl() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const data = await api.getEva2Access({ signal: controller.signal, next: '/app/' });
    if (!data?.sso || !data?.url) throw new Error('sso');
    return data.url;
  } finally {
    clearTimeout(timer);
  }
}

function ShortcutButton({ icon, title, desc, onClick, disabled, primary }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left rounded-2xl border p-5 min-h-[72px] touch-manipulation transition-opacity disabled:opacity-50 ${
        primary
          ? 'border-eva-accent/50 bg-[var(--eva-accent-bg)]/50'
          : 'border-slate-200 dark:border-slate-700/60 bg-white dark:bg-eva-panel'
      }`}
    >
      <div className="flex items-start gap-4">
        <span className="text-3xl shrink-0" aria-hidden>{icon}</span>
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 dark:text-white">{title}</div>
          <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{desc}</div>
        </div>
      </div>
    </button>
  );
}

function ShortcutLink({ to, icon, title, desc }) {
  return (
    <Link
      to={to}
      className="block w-full text-left rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-eva-panel p-5 min-h-[72px] touch-manipulation"
    >
      <div className="flex items-start gap-4">
        <span className="text-3xl shrink-0" aria-hidden>{icon}</span>
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 dark:text-white">{title}</div>
          <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{desc}</div>
        </div>
      </div>
    </Link>
  );
}

export default function MobileHome() {
  const t = copy[lang];
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void refreshLocationForChat('', { force: false }).catch(() => {});
  }, []);

  const openEva2Chat = async () => {
    setOpening(true);
    setError('');
    void refreshLocationForChat('où suis-je', { force: true }).catch(() => {});
    try {
      const url = await fetchEva2ChatUrl();
      openUrl(url);
    } catch {
      setError(t.error);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6 pb-8">
      <header className="pt-2">
        <p className="text-sm font-medium text-eva-accent mb-1">HaliSoft · Digital Twin</p>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{t.title}</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-400 text-sm">{t.subtitle}</p>
      </header>

      <div className="space-y-3">
        <ShortcutButton
          icon="⚡"
          title={opening ? t.eva2Opening : t.eva2Chat}
          desc={t.eva2ChatDesc}
          onClick={openEva2Chat}
          disabled={opening}
          primary
        />
        <ShortcutLink to="/chat" icon="◈" title={t.chat} desc={t.chatDesc} />
        <ShortcutLink to="/voice" icon="🎙️" title={t.voice} desc={t.voiceDesc} />
        <ShortcutLink to="/voice/realtime" icon="📞" title={t.call} desc={t.callDesc} />
        <ShortcutLink to="/eva2" icon="⚙️" title={t.eva2Hub} desc="GPS, SSO, canaux" />
      </div>

      {error && (
        <p className="text-sm text-red-500">
          {error}{' '}
          <a
            href={EVA2_LOGIN_URL}
            {...(prefersSameWindowNav() ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
            className="underline text-eva-accent"
          >
            {t.directLogin}
          </a>
        </p>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/40 p-4 space-y-2 text-xs text-slate-600 dark:text-slate-400">
        <p>{t.pwaTip}</p>
        <p>{t.eva2PwaTip}</p>
        <p>{t.lockTip}</p>
      </div>
    </div>
  );
}
