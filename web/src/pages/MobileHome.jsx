import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { refreshLocationForChat } from '../utils/geolocation';
import { openUrl, prefersSameWindowNav } from '../utils/mobileNav';

const lang = navigator.language?.startsWith('fr') ? 'fr' : 'en';
const FETCH_TIMEOUT_MS = 15000;
const EVA2_LOGIN_URL = 'https://eva-vps.halisoft.biz/auth/login?local=1';

function greetingName(user) {
  if (user?.display_name) return user.display_name.split(/\s+/)[0];
  if (user?.email) return user.email.split('@')[0];
  return null;
}

const copy = {
  fr: {
    greeting: (name) => (name ? `Bonjour ${name}` : 'Bonjour'),
    tagline: 'Ton assistant 24/7 — un bouton pour Eva 2.',
    eva2Title: 'Eva 2',
    eva2Subtitle: 'WhatsApp · Gmail · 24/7',
    eva2Opening: 'Connexion Eva 2…',
    more: 'Plus',
    moreHint: 'EVA 1 sur ce site — pas Eva 2',
    chat: 'EVA 1 — Chat texte',
    chatDesc: 'Comme ChatGPT, sur eva.halisoft.biz',
    voice: 'Alice — Voix EVA 1',
    voiceDesc: 'Parler à Alice (push-to-talk)',
    call: 'EVA 1 — Temps réel',
    callDesc: 'Appel vocal live (pas Eva 2)',
    pwaTip: 'Astuce : ajoute EVA à l’écran d’accueil pour une app plein écran.',
    lockTip: 'Écran verrouillé pendant le chat ? Déverrouille et appuie sur « Reprendre ».',
    error: 'Impossible d’ouvrir Eva 2 — réessaie.',
    ssoFailed: 'Lien Eva 2 expiré — retouche le bouton Eva 2.',
    directLogin: 'Connexion directe Eva 2',
  },
  en: {
    greeting: (name) => (name ? `Hi ${name}` : 'Hi'),
    tagline: 'Your 24/7 assistant — one tap for Eva 2.',
    eva2Title: 'Eva 2',
    eva2Subtitle: 'WhatsApp · Gmail · 24/7',
    eva2Opening: 'Connecting to Eva 2…',
    more: 'More',
    moreHint: 'EVA 1 on this site — not Eva 2',
    chat: 'EVA 1 — Text chat',
    chatDesc: 'Like ChatGPT, on eva.halisoft.biz',
    voice: 'Alice — EVA 1 voice',
    voiceDesc: 'Talk to Alice (push-to-talk)',
    call: 'EVA 1 — Realtime call',
    callDesc: 'Live voice call (not Eva 2)',
    pwaTip: 'Tip: add EVA to your home screen for a full-screen app.',
    lockTip: 'Screen locked during chat? Unlock and tap Tap to resume.',
    error: 'Could not open Eva 2 — try again.',
    ssoFailed: 'Eva 2 link expired — tap Eva 2 again.',
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

function MoreLink({ to, title, desc }) {
  return (
    <Link
      to={to}
      className="block w-full text-left rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-eva-panel px-4 py-3.5 min-h-[56px] touch-manipulation"
    >
      <div className="font-medium text-sm text-slate-900 dark:text-white">{title}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{desc}</div>
    </Link>
  );
}

export default function MobileHome() {
  const { user } = useAuth();
  const t = copy[lang];
  const name = greetingName(user);
  const [searchParams] = useSearchParams();
  const ssoFailed = searchParams.get('vps') === 'sso-failed' || searchParams.get('vps') === 'sso-expired';
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

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
    <div className="max-w-lg mx-auto space-y-8 pb-8 pt-2">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{t.greeting(name)}</h1>
        <p className="mt-1.5 text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{t.tagline}</p>
      </header>

      <button
        type="button"
        onClick={openEva2Chat}
        disabled={opening}
        className="w-full text-center rounded-3xl border-2 border-eva-accent/50 bg-gradient-to-br from-[var(--eva-accent-bg)]/80 to-eva-accent/5 p-8 min-h-[148px] touch-manipulation transition-opacity disabled:opacity-60 shadow-sm"
      >
        <div className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
          {opening ? t.eva2Opening : t.eva2Title}
        </div>
        <div className="text-base text-slate-600 dark:text-slate-300 mt-2 font-medium">
          {t.eva2Subtitle}
        </div>
      </button>

      {ssoFailed && (
        <p className="text-sm text-amber-600 dark:text-amber-400">{t.ssoFailed}</p>
      )}

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

      <section>
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          className="flex w-full items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/40 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 touch-manipulation min-h-[48px]"
          aria-expanded={moreOpen}
        >
          <span>{t.more}</span>
          <span className="text-slate-400 text-xs" aria-hidden>{moreOpen ? '▲' : '▼'}</span>
        </button>
        {moreOpen && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400 px-1">{t.moreHint}</p>
            <MoreLink to="/chat" title={t.chat} desc={t.chatDesc} />
            <MoreLink to="/voice" title={t.voice} desc={t.voiceDesc} />
            <MoreLink to="/voice/realtime" title={t.call} desc={t.callDesc} />
          </div>
        )}
      </section>

      <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 px-1">
        <p>{t.pwaTip}</p>
        <p>{t.lockTip}</p>
      </div>
    </div>
  );
}
