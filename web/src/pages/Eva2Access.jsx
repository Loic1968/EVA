import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { refreshLocationForChat } from '../utils/geolocation';
import { isMobilePhone, openUrl, prefersSameWindowNav } from '../utils/mobileNav';

const lang = navigator.language?.startsWith('fr') ? 'fr' : 'en';
const EVA2_LOGIN_URL = 'https://eva-vps.halisoft.biz/auth/login?local=1';
const FETCH_TIMEOUT_MS = 15000;

async function fetchEva2AccessWithTimeout(next) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await api.getEva2Access({ signal: controller.signal, next });
  } catch (e) {
    if (controller.signal.aborted) throw new Error('timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const copy = {
  fr: {
    title: 'Eva 2 — OpenClaw',
    subtitle: 'Assistant 24/7 : Telegram, Gmail, skills, cron. WeChat et Claude Code restent sur le Mac mini.',
    eva1: 'EVA 1 (ici)',
    eva1Desc: 'Web eva.halisoft.biz — chat, voix Alice, emails, calendrier, documents.',
    eva2: 'Eva 2 (OpenClaw)',
    eva2Desc: 'VPS Singapour — Telegram @Halisoft2bot, dashboard OpenClaw, gog, GitHub, crons.',
    open: 'Ouvrir Eva 2',
    openChat: 'Chat Eva 2 (direct)',
    opening: 'Connexion…',
    redirecting: 'Ouverture Eva 2…',
    telegram: 'Telegram (sans login web)',
    channels: 'Canaux Eva 2',
    chTelegram: 'Telegram @Halisoft2bot — 24/7',
    chWechat: 'WeChat — Mac mini Dubai (gateway local)',
    chMac: 'Claude Code / browser — Mac mini',
    note: 'Tu es connecté à EVA 1 — Eva 2 s’ouvre dans un nouvel onglet (GPS synchronisé automatiquement).',
    notePwa: 'Tu es connecté à EVA 1 — Eva 2 s’ouvre ici (GPS synchronisé en arrière-plan).',
    gps: 'Position GPS',
    gpsPending: 'Autorise la géolocalisation dans le navigateur pour qu’Eva sache où tu es.',
    gpsRefresh: 'Actualiser GPS',
    fromLogin: 'Eva 2 (VPS) ouverte dans un nouvel onglet. Si rien ne s’affiche, clique ci-dessous.',
    ssoOff: 'SSO manquant sur Render. Ajoute EVA2_SSO_SECRET puis redéploie — le bouton sera actif ensuite.',
    ssoSteps: 'Render → service EVA → Environment → EVA2_PUBLIC_URL=https://eva-vps.halisoft.biz + EVA2_SSO_SECRET (voir VPS /opt/eva2/.env)',
    ssoFailed: 'Lien Eva 2 expiré ou refusé — réessaie le bouton (un nouveau lien est généré à chaque clic).',
    popupBlocked: 'Safari a bloqué le nouvel onglet — autorise les popups pour eva.halisoft.biz, ou utilise « Connexion directe ».',
    directLogin: 'Connexion directe Eva 2 (mot de passe)',
    ssoFix: 'Pour réparer le bouton depuis EVA 1 : Render → EVA → Environment → EVA2_SSO_SECRET doit être identique au VPS (/opt/eva2/.env).',
    error: 'Impossible de préparer l’accès Eva 2.',
    timeout: 'Connexion Eva 2 trop lente — réessaie ou utilise « Connexion directe ».',
  },
  en: {
    title: 'Eva 2 — OpenClaw',
    subtitle: '24/7 assistant: Telegram, Gmail, skills, cron. WeChat and Claude Code stay on the Mac mini.',
    eva1: 'EVA 1 (here)',
    eva1Desc: 'Web eva.halisoft.biz — chat, Alice voice, email, calendar, documents.',
    eva2: 'Eva 2 (OpenClaw)',
    eva2Desc: 'Singapore VPS — Telegram @Halisoft2bot, OpenClaw dashboard, gog, GitHub, crons.',
    open: 'Open Eva 2',
    openChat: 'Eva 2 chat (direct)',
    opening: 'Connecting…',
    redirecting: 'Opening Eva 2…',
    telegram: 'Telegram (no web login)',
    channels: 'Eva 2 channels',
    chTelegram: 'Telegram @Halisoft2bot — 24/7',
    chWechat: 'WeChat — Dubai Mac mini (local gateway)',
    chMac: 'Claude Code / browser — Mac mini',
    note: 'You are signed in to EVA 1 — Eva 2 opens in a new tab (GPS synced automatically).',
    notePwa: 'You are signed in to EVA 1 — Eva 2 opens here (GPS syncs in the background).',
    gps: 'GPS location',
    gpsPending: 'Allow browser geolocation so Eva knows where you are.',
    gpsRefresh: 'Refresh GPS',
    fromLogin: 'Eva 2 (VPS) opened in a new tab. If nothing appeared, click below.',
    ssoOff: 'SSO missing on Render. Add EVA2_SSO_SECRET and redeploy — then the button will work.',
    ssoSteps: 'Render → EVA service → Environment → EVA2_PUBLIC_URL=https://eva-vps.halisoft.biz + EVA2_SSO_SECRET (see VPS /opt/eva2/.env)',
    ssoFailed: 'Eva 2 link expired or refused — try again (a fresh link is generated on each click).',
    popupBlocked: 'Safari blocked the new tab — allow popups for eva.halisoft.biz, or use Direct login.',
    directLogin: 'Emergency password login (fallback)',
    ssoFix: 'To fix the button from EVA 1: Render → EVA → Environment → EVA2_SSO_SECRET must match VPS (/opt/eva2/.env).',
    error: 'Could not prepare Eva 2 access.',
    timeout: 'Eva 2 connection timed out — try again or use Direct login.',
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
  const [gps, setGps] = useState(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const fromLogin = searchParams.get('from') === 'login';
  const ssoFailed = searchParams.get('vps') === 'sso-failed' || searchParams.get('vps') === 'sso-expired';
  const skipRedirect = searchParams.get('skip') === '1';
  const [mobileRedirecting, setMobileRedirecting] = useState(false);

  useEffect(() => {
    api.getEva2Access()
      .then((data) => setAccess(data))
      .catch(() => setError(t.error))
      .finally(() => setLoading(false));
  }, [t.error]);

  const syncGps = async (force = false) => {
    setGpsBusy(true);
    try {
      const loc = await refreshLocationForChat(force ? 'où suis-je' : '', { force });
      if (loc) {
        const saved = await api.setLocation(loc);
        setGps(saved.location || loc);
      } else {
        const { location } = await api.getLocation();
        setGps(location && typeof location === 'object' ? location : null);
      }
    } catch {
      setGps(null);
    } finally {
      setGpsBusy(false);
    }
  };

  useEffect(() => {
    syncGps(false);
  }, []);

  useEffect(() => {
    if (loading || !access?.sso || skipRedirect || ssoFailed || autoOpened.current) return;
    if (!isMobilePhone()) return;
    autoOpened.current = true;
    setMobileRedirecting(true);
    void syncGps(true);
    fetchEva2AccessWithTimeout('/app/')
      .then((fresh) => {
        if (fresh?.sso && fresh?.url) {
          window.location.href = fresh.url;
          return;
        }
        throw new Error('sso');
      })
      .catch(() => {
        autoOpened.current = false;
        setMobileRedirecting(false);
      });
  }, [loading, access?.sso, skipRedirect, ssoFailed]);

  const navigateToEva2 = (url, tab) => {
    openUrl(url, tab);
  };

  const openEva2 = async (next) => {
    if (!access?.sso) return;
    setOpening(true);
    setError('');

    // GPS sync must not block SSO navigation (geolocation can hang 20s+ on mobile).
    void syncGps(true);

    const useSameWindow = prefersSameWindowNav();
    let tab = null;
    if (!useSameWindow) {
      tab = window.open('about:blank', '_blank');
    }

    try {
      const fresh = await fetchEva2AccessWithTimeout(next);
      if (!fresh?.sso || !fresh?.url) {
        throw new Error('sso');
      }
      navigateToEva2(fresh.url, tab);
    } catch (e) {
      if (tab) {
        try {
          tab.close();
        } catch {
          /* ignore */
        }
      }
      if (e?.message === 'timeout') {
        setError(t.timeout);
      } else if (e?.message === 'sso') {
        setError(t.ssoFailed);
      } else if (!useSameWindow && !tab) {
        setError(t.popupBlocked);
      } else {
        setError(t.error);
      }
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      {mobileRedirecting && (
        <div className="rounded-xl border border-eva-accent/30 bg-[var(--eva-accent-bg)]/40 p-6 text-center">
          <p className="text-slate-700 dark:text-slate-200 font-medium">{t.redirecting}</p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {lang === 'fr'
              ? 'Redirection SSO vers eva-vps.halisoft.biz…'
              : 'SSO redirect to eva-vps.halisoft.biz…'}
          </p>
        </div>
      )}
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
        <p className="text-sm text-slate-500 dark:text-slate-500">
          {fromLogin ? t.fromLogin : prefersSameWindowNav() ? t.notePwa : t.note}
        </p>
        <div className="rounded-lg border border-slate-200 dark:border-slate-700/50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-slate-600 dark:text-slate-400">
            <span className="font-medium text-slate-800 dark:text-slate-200">{t.gps}: </span>
            {gps?.city
              ? `${gps.city}${gps.timezone ? ` · ${gps.timezone}` : ''}`
              : t.gpsPending}
          </div>
          <button
            type="button"
            onClick={() => syncGps(true)}
            disabled={gpsBusy}
            className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            {gpsBusy ? '…' : t.gpsRefresh}
          </button>
        </div>
        {!loading && access && !access.sso && (
          <div className="text-sm text-amber-600 dark:text-amber-400 space-y-1">
            <p>{t.ssoOff}</p>
            <p className="text-xs opacity-90">{t.ssoSteps}</p>
          </div>
        )}
        {ssoFailed && (
          <div className="text-sm text-red-500 space-y-2">
            <p>{t.ssoFailed}</p>
            <p className="text-slate-600 dark:text-slate-400">{t.ssoFix}</p>
          </div>
        )}
        {error && (
          <div className="text-sm text-red-500 space-y-2">
            <p>{error}</p>
            <p>
              <a
                href={EVA2_LOGIN_URL}
                {...(prefersSameWindowNav() ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                className="font-medium text-eva-accent underline underline-offset-2"
              >
                {t.directLogin}
              </a>
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onClick={() => openEva2('/app/')}
            disabled={loading || opening || !access?.sso}
            className="px-5 py-2.5 rounded-lg bg-eva-accent text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {opening ? t.opening : t.openChat}
          </button>
          <button
            type="button"
            onClick={() => openEva2()}
            disabled={loading || opening || !access?.sso}
            className="px-5 py-2.5 rounded-lg border border-eva-accent/50 text-eva-accent hover:bg-[var(--eva-accent-bg)]/40 disabled:opacity-50 transition-colors"
          >
            {t.open}
          </button>
          <a
            href={EVA2_LOGIN_URL}
            {...(prefersSameWindowNav() ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
            className="px-5 py-2.5 rounded-lg border border-eva-accent/50 text-eva-accent hover:bg-[var(--eva-accent-bg)]/40 transition-colors"
          >
            {t.directLogin}
          </a>
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
