import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';

const lang = navigator.language?.startsWith('fr') ? 'fr' : 'en';

const copy = {
  fr: {
    title: 'Eva 2 — OpenClaw',
    subtitle: 'Assistant 24/7 : Telegram, Gmail, skills, cron. WeChat et Claude Code restent sur le Mac mini.',
    eva1: 'EVA 1 (ici)',
    eva1Desc: 'Web eva.halisoft.biz — chat, voix Alice, emails, calendrier, documents.',
    eva2: 'Eva 2 (OpenClaw)',
    eva2Desc: 'VPS Singapour — Telegram @Halisoft2bot, dashboard OpenClaw, gog, GitHub, crons.',
    open: 'Ouvrir Eva 2',
    opening: 'Connexion…',
    telegram: 'Telegram (sans login web)',
    channels: 'Canaux Eva 2',
    chTelegram: 'Telegram @Halisoft2bot — 24/7',
    chWechat: 'WeChat — Mac mini Dubai (gateway local)',
    chMac: 'Claude Code / browser — Mac mini',
    note: 'Tu es connecté à EVA 1 — Eva 2 (VPS) s’ouvre dans un nouvel onglet.',
    fromLogin: 'Eva 2 (VPS) ouverte dans un nouvel onglet. Si rien ne s’affiche, clique ci-dessous.',
    ssoOff: 'SSO non configuré sur le serveur — Eva 2 s’ouvrira avec son écran de login.',
    error: 'Impossible de préparer l’accès Eva 2.',
  },
  en: {
    title: 'Eva 2 — OpenClaw',
    subtitle: '24/7 assistant: Telegram, Gmail, skills, cron. WeChat and Claude Code stay on the Mac mini.',
    eva1: 'EVA 1 (here)',
    eva1Desc: 'Web eva.halisoft.biz — chat, Alice voice, email, calendar, documents.',
    eva2: 'Eva 2 (OpenClaw)',
    eva2Desc: 'Singapore VPS — Telegram @Halisoft2bot, OpenClaw dashboard, gog, GitHub, crons.',
    open: 'Open Eva 2',
    opening: 'Connecting…',
    telegram: 'Telegram (no web login)',
    channels: 'Eva 2 channels',
    chTelegram: 'Telegram @Halisoft2bot — 24/7',
    chWechat: 'WeChat — Dubai Mac mini (local gateway)',
    chMac: 'Claude Code / browser — Mac mini',
    note: 'You are signed in to EVA 1 — Eva 2 (VPS) opens in a new tab.',
    fromLogin: 'Eva 2 (VPS) opened in a new tab. If nothing appeared, click below.',
    ssoOff: 'SSO not configured on server — Eva 2 will show its login screen.',
    error: 'Could not prepare Eva 2 access.',
  },
};

export default function Eva2Access() {
  const t = copy[lang];
  const [searchParams] = useSearchParams();
  const autoOpened = useRef(false);
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const fromLogin = searchParams.get('from') === 'login';

  useEffect(() => {
    api.getEva2Access()
      .then(setAccess)
      .catch(() => setError(t.error))
      .finally(() => setLoading(false));
  }, [t.error]);

  useEffect(() => {
    if (!fromLogin || loading || !access?.url || autoOpened.current) return;
    autoOpened.current = true;
    window.open(access.url, '_blank', 'noopener,noreferrer');
  }, [fromLogin, loading, access]);

  const openEva2 = () => {
    if (!access?.url) return;
    setOpening(true);
    window.open(access.url, '_blank', 'noopener,noreferrer');
    setTimeout(() => setOpening(false), 1200);
  };

  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <p className="text-sm font-medium text-eva-accent mb-1">HaliSoft · Digital Twin</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white">{t.title}</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">{t.subtitle}</p>
      </header>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-eva-panel p-5">
          <h2 className="font-semibold text-slate-900 dark:text-white">{t.eva1}</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t.eva1Desc}</p>
        </div>
        <div className="rounded-xl border border-eva-accent/30 bg-[var(--eva-accent-bg)]/40 p-5">
          <h2 className="font-semibold text-slate-900 dark:text-white">{t.eva2}</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t.eva2Desc}</p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-eva-panel p-5 space-y-4">
        <h2 className="font-semibold text-slate-900 dark:text-white">{t.channels}</h2>
        <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-2 list-disc pl-5">
          <li>{t.chTelegram}</li>
          <li>{t.chWechat}</li>
          <li>{t.chMac}</li>
        </ul>
        <p className="text-sm text-slate-500 dark:text-slate-500">{fromLogin ? t.fromLogin : t.note}</p>
        {!loading && access && !access.sso && (
          <p className="text-sm text-amber-600 dark:text-amber-400">{t.ssoOff}</p>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onClick={openEva2}
            disabled={loading || opening || !access?.url}
            className="px-5 py-2.5 rounded-lg bg-eva-accent text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {opening ? t.opening : t.open}
          </button>
          <a
            href="https://t.me/Halisoft2bot"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            {t.telegram}
          </a>
        </div>
      </section>
    </div>
  );
}
