import { useEffect, useState } from 'react';
import EvaLoading from '../components/EvaLoading';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api';

// Reverse geocode via Nominatim (OSM). Requires User-Agent per usage policy.
async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'EVA-Halisoft/1.0 (location-settings)' },
  });
  const data = await res.json();
  const addr = data?.address || {};
  return addr.city || addr.town || addr.village || addr.municipality || addr.county || data?.display_name || null;
}

export default function Settings() {
  const { accentColor, setAccentColor } = useTheme();
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [location, setLocationState] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [pushStatus, setPushStatus] = useState({ subscribed: false, configured: false });
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState(null);
  const [activeTab, setActiveTab] = useState('general');
  const [controlError, setControlError] = useState(null);
  const [featureFlags, setFeatureFlags] = useState({});
  const [mcpStatus, setMcpStatus] = useState({ connected: false, tools_count: 0, tools: [] });
  const [mcpTriggering, setMcpTriggering] = useState(false);

  const TABS = [
    { id: 'general', label: 'General', icon: '⚙️' },
    { id: 'voice', label: 'Voice', icon: '🎙️' },
    { id: 'sync', label: 'Sync & Data', icon: '📧' },
    { id: 'notifications', label: 'Notifications', icon: '🔔' },
    { id: 'control', label: 'Control', icon: '🛡️' },
    { id: 'security', label: 'Security', icon: '🔒' },
  ];

  const [openaiAvailable, setOpenaiAvailable] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState(null);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceSaved, setVoiceSaved] = useState(false);
  const [voicePreview, setVoicePreview] = useState(null); // Audio element for preview

  useEffect(() => {
    api.getSettings()
      .then((st) => {
        setSettings(st);
        const ac = st?.accent_color?.color;
        if (['blue', 'red', 'purple', 'green', 'orange', 'pink'].includes(ac)) setAccentColor(ac);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [setAccentColor]);

  useEffect(() => {
    api.status().then((r) => setOpenaiAvailable(r.openai_available === true)).catch(() => {});
  }, []);

  // Refetch status when opening General tab (Chat AI) so GPT option is up to date
  useEffect(() => {
    if (activeTab === 'general') {
      api.status().then((r) => setOpenaiAvailable(r.openai_available === true)).catch(() => {});
    }
  }, [activeTab]);

  useEffect(() => {
    api.getLocation()
      .then(({ location }) => setLocationState(location || ''))
      .catch(() => setLocationState(''));
  }, []);

  useEffect(() => {
    api.getFeatureFlags().then((f) => setFeatureFlags(f)).catch(() => setFeatureFlags({}));
  }, []);

  useEffect(() => {
    if (activeTab === 'control') {
      api.getMcpStatus().then((s) => setMcpStatus(s)).catch(() => setMcpStatus({ connected: false, tools_count: 0, tools: [] }));
    }
    if (activeTab === 'voice' && !voiceSettings) {
      api.getVoiceSettings().then((s) => setVoiceSettings(s)).catch(() => setVoiceSettings({
        tts_model: 'tts-1-hd', tts_voice_fr: 'nova', tts_voice_en: 'shimmer', tts_speed: 1.05,
        available_voices: ['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse'],
        available_models: ['tts-1','tts-1-hd'],
      }));
    }
  }, [activeTab]);

  useEffect(() => {
    api.getPushStatus().then((s) => setPushStatus(s)).catch(() => setPushStatus({ subscribed: false, configured: false }));
    // Check if THIS browser has a push subscription
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => {
        setPushStatus((prev) => ({ ...prev, thisDeviceSubscribed: !!sub }));
      }).catch(() => {});
    }
  }, []);

  const urlBase64ToUint8Array = (base64) => {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  };

  const enablePushNotifications = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setPushError('Push notifications not supported in this browser');
      return;
    }
    if (!window.isSecureContext) {
      setPushError('Push requires HTTPS');
      return;
    }
    setPushLoading(true);
    setPushError(null);
    try {
      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }
      if (permission !== 'granted') {
        setPushError('Notification permission denied');
        setPushLoading(false);
        return;
      }
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const reg = await navigator.serviceWorker.ready;
      if (!reg?.pushManager) {
        throw new Error('Push not supported in this browser. Use HTTPS and a supported browser.');
      }
      const vapid = await api.getPushVapidPublic();
      if (!vapid?.publicKey) throw new Error('Push not configured on server');
      const keyStr = String(vapid.publicKey).trim();
      const key = urlBase64ToUint8Array(keyStr);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await api.subscribePush(sub.toJSON());
      setPushStatus((prev) => ({ ...prev, subscribed: true, configured: true, thisDeviceSubscribed: true }));
    } catch (e) {
      const msg = e?.message || 'Failed to enable push';
      setPushError(msg.includes('subscribe') ? 'Push not available. Use HTTPS and Chrome/Firefox/Edge.' : msg);
    } finally {
      setPushLoading(false);
    }
  };

  const saveLocation = async () => {
    const city = location?.trim();
    if (!city) return;
    setLocationLoading(true);
    setLocationError(null);
    try {
      await api.setLocation(city);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setLocationError(e.message);
    } finally {
      setLocationLoading(false);
    }
  };

  const useGpsLocation = () => {
    setLocationLoading(true);
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported');
      setLocationLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const city = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          if (city) {
            setLocationState(city);
            await api.setLocation(city);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          } else {
            setLocationError('Could not determine city from coordinates');
          }
        } catch (e) {
          setLocationError(e.message || 'Reverse geocoding failed');
        } finally {
          setLocationLoading(false);
        }
      },
      (err) => {
        setLocationError(err.message || 'Location access denied');
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const setShadowMode = async (enabled) => {
    setSaving(true);
    setSaved(false);
    try {
      await api.setSetting('shadow_mode', { enabled, updated_at: new Date().toISOString() });
      setSettings((s) => ({ ...s, shadow_mode: { enabled } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const setKillSwitch = async (enabled) => {
    setSaving(true);
    setSaved(false);
    try {
      await api.setSetting('kill_switch', { enabled, updated_at: new Date().toISOString() });
      setSettings((s) => ({ ...s, kill_switch: { enabled } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const aiProvider = settings.ai_provider?.provider ?? settings.ai_provider ?? 'gpt';

  const setAIPProviderSave = async (provider) => {
    setSaving(true);
    setSaved(false);
    try {
      await api.setSetting('ai_provider', { provider, updated_at: new Date().toISOString() });
      setSettings((s) => ({ ...s, ai_provider: { provider } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const setAccentColorSave = async (color) => {
    setSaving(true);
    setSaved(false);
    try {
      await api.setSetting('accent_color', { color, updated_at: new Date().toISOString() });
      setSettings((s) => ({ ...s, accent_color: { color } }));
      setAccentColor(color);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const setChatLanguage = async (lang) => {
    setSaving(true);
    setSaved(false);
    try {
      await api.setSetting('chat_language', { lang });
      setSettings((s) => ({ ...s, chat_language: { lang } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const setSyncFrequency = async (minutes) => {
    setSaving(true);
    setSaved(false);
    try {
      await api.setSetting('sync_frequency_minutes', { minutes });
      setSettings((s) => ({ ...s, sync_frequency_minutes: { minutes } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const setNotificationPrefs = async (enabled, leadMinutes) => {
    setSaving(true);
    setSaved(false);
    try {
      await api.setSetting('notification_preferences', {
        enabled: enabled ?? settings.notification_preferences?.enabled,
        leadMinutes: leadMinutes ?? settings.notification_preferences?.leadMinutes ?? [15, 60, 1440],
        updated_at: new Date().toISOString(),
      });
      setSettings((s) => ({
        ...s,
        notification_preferences: {
          enabled: enabled ?? s.notification_preferences?.enabled,
          leadMinutes: leadMinutes ?? s.notification_preferences?.leadMinutes ?? [15, 60, 1440],
        },
      }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const toggleLead = (min) => {
    const current = settings.notification_preferences?.leadMinutes ?? [15, 60, 1440];
    const next = current.includes(min)
      ? current.filter((m) => m !== min)
      : [...current, min].sort((a, b) => a - b);
    if (next.length === 0) return;
    setNotificationPrefs(null, next);
  };

  const setEmailImportancePrefs = async (enabled, priorityLevel) => {
    setSaving(true);
    setSaved(false);
    try {
      await api.setSetting('email_importance_preferences', {
        enabled: enabled ?? settings.email_importance_preferences?.enabled,
        priorityLevel: priorityLevel ?? settings.email_importance_preferences?.priorityLevel ?? 'gmail_only',
        updated_at: new Date().toISOString(),
      });
      setSettings((s) => ({
        ...s,
        email_importance_preferences: {
          enabled: enabled ?? s.email_importance_preferences?.enabled,
          priorityLevel: priorityLevel ?? s.email_importance_preferences?.priorityLevel ?? 'gmail_only',
        },
      }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const setEmailSyncDays = async (days) => {
    setSaving(true);
    setSaved(false);
    try {
      await api.setSetting('email_sync_days', { days });
      setSettings((s) => ({ ...s, email_sync_days: { days } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const setStyleProfile = async (text) => {
    setSaving(true);
    setSaved(false);
    try {
      await api.setSetting('voice_profile', { text: text || '', updated_at: new Date().toISOString() });
      setSettings((s) => ({ ...s, voice_profile: { text: text || '' } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const setAutonomousMode = async (enabled) => {
    setControlError(null);
    setSaving(true);
    setSaved(false);
    try {
      await api.setSetting('autonomous_mode', { enabled, updated_at: new Date().toISOString() });
      setSettings((s) => ({ ...s, autonomous_mode: { enabled } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setControlError(e?.message || 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const DEFAULT_TIERS = {
    gmail: { channel: 'Email (Gmail)', read: true, draft: true, send: false },
    whatsapp: { channel: 'WhatsApp', read: false, draft: false, send: false, soon: true },
    linkedin: { channel: 'LinkedIn', read: false, draft: false, send: false, soon: true },
    sms: { channel: 'SMS', read: false, draft: false, send: false, soon: true },
  };

  const tiers = { ...DEFAULT_TIERS, ...(settings.permission_tiers || {}) };
  const tierKeys = Object.keys(DEFAULT_TIERS);

  const setPermission = async (key, perm, value) => {
    const def = DEFAULT_TIERS[key];
    if (def?.soon) return; // non-clickable for "soon" channels
    const next = { ...(tiers[key] || def), [perm]: value };
    const nextTiers = { ...tiers, [key]: next };
    const cleanTiers = tierKeys.reduce((acc, k) => ({ ...acc, [k]: nextTiers[k] || DEFAULT_TIERS[k] }), {});
    setSaving(true);
    setSaved(false);
    try {
      await api.setSetting('permission_tiers', cleanTiers);
      setSettings((s) => ({ ...s, permission_tiers: cleanTiers }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <EvaLoading />
      </div>
    );
  }

  if (error) return <div className="text-red-600 dark:text-red-400 p-4">Error: {error}</div>;

  const killSwitchOn = settings.kill_switch?.enabled === true;
  const shadowModeOn = settings.shadow_mode?.enabled === true;
  const autonomousModeOn = settings.autonomous_mode?.enabled === true;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Settings</h1>
        <p className="text-slate-500 dark:text-eva-muted text-sm mt-1">Control EVA's behavior and security settings</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700/40 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
              activeTab === t.id
                ? 'bg-white dark:bg-eva-panel border border-slate-200 dark:border-slate-700/40 border-b-0 -mb-px text-eva-accent'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50'
            }`}
          >
            <span className="mr-1.5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* General */}
      {activeTab === 'general' && (
      <div className="space-y-6">
      {/* Accent Color */}
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Accent color</h2>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
          Choose the accent color for buttons, links, and highlights across EVA.
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'blue', color: '#06b6d4', label: 'Blue' },
            { id: 'red', color: '#DC2626', label: 'Red' },
            { id: 'purple', color: '#8B5CF6', label: 'Purple' },
            { id: 'green', color: '#10B981', label: 'Green' },
            { id: 'orange', color: '#F59E0B', label: 'Orange' },
            { id: 'pink', color: '#EC4899', label: 'Pink' },
          ].map(({ id, color, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setAccentColorSave(id)}
              disabled={saving}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 font-medium text-sm transition-colors ${
                accentColor === id
                  ? 'border-current'
                  : 'border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-400'
              } disabled:opacity-50`}
              style={accentColor === id ? { borderColor: color, color, backgroundColor: `${color}20` } : undefined}
            >
              <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
              {label}
            </button>
          ))}
        </div>
        {saved && <span className="text-emerald-600 dark:text-emerald-400 text-sm mt-2 block">Saved</span>}
      </div>

      {/* AI Provider */}
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Chat AI</h2>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
          One choice for all voice: <strong>Claude</strong> or <strong>GPT</strong> powers EVA chat, <strong>Alice Voice</strong> (push-to-talk), and <strong>Realtime</strong> (call UI). With Claude, Realtime uses the same Alice engine; with GPT, Realtime uses the OpenAI Realtime API. Claude has calendar &amp; memory tools; GPT requires OPENAI_API_KEY.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setAIPProviderSave('claude')}
            disabled={saving}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 font-medium transition-colors ${
              aiProvider === 'claude'
                ? 'border-amber-600 bg-amber-500/15 text-amber-700 dark:text-amber-400'
                : 'border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-400'
            } disabled:opacity-50`}
          >
            <span className="text-amber-600 dark:text-amber-400 font-bold">Claude</span>
          </button>
          <button
            type="button"
            onClick={() => setAIPProviderSave('gpt')}
            disabled={saving || !openaiAvailable}
            title={!openaiAvailable ? 'Set OPENAI_API_KEY in server config to use GPT' : ''}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 font-medium transition-colors ${
              aiProvider === 'gpt'
                ? 'border-emerald-600 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-400'
            } disabled:opacity-50`}
          >
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">GPT</span>
          </button>
        </div>
        {!openaiAvailable && <p className="text-amber-600 dark:text-amber-400 text-xs mt-2">GPT unavailable — OPENAI_API_KEY not set.</p>}
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={() => api.status().then((r) => { setOpenaiAvailable(r.openai_available === true); }).catch(() => {})}
            className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Vérifier OpenAI
          </button>
        </div>
        {saved && <span className="text-emerald-600 dark:text-emerald-400 text-sm mt-2 block">Saved</span>}
      </div>

      {/* Chat Language */}
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Chat language</h2>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
          Auto: EVA replies in the same language you speak. Or force English/French.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={settings.chat_language?.lang ?? 'auto'}
            onChange={(e) => setChatLanguage(e.target.value)}
            disabled={saving}
            className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-eva-accent focus:border-transparent disabled:opacity-50"
          >
            <option value="auto">Auto (match your language)</option>
            <option value="en">English</option>
            <option value="fr">French</option>
          </select>
          {saving && <span className="text-slate-500 dark:text-eva-muted text-sm">Saving...</span>}
          {saved && <span className="text-emerald-600 dark:text-emerald-400 text-sm">Saved</span>}
        </div>
      </div>

      {/* Location */}
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Location</h2>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
          Your city or area helps EVA answer questions like &quot;Where am I?&quot; or &quot;What time is it there?&quot;
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={location}
            onChange={(e) => setLocationState(e.target.value)}
            placeholder="e.g. Dubai, Paris"
            disabled={locationLoading}
            className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-eva-accent focus:border-transparent disabled:opacity-50 min-w-[180px]"
          />
          <button
            type="button"
            onClick={saveLocation}
            disabled={locationLoading || !location?.trim()}
            className="px-4 py-2 rounded-lg bg-slate-600 text-white hover:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save
          </button>
          <button
            type="button"
            onClick={useGpsLocation}
            disabled={locationLoading}
            className="px-4 py-2 rounded-lg bg-eva-accent text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Use GPS
          </button>
        </div>
        {locationError && <p className="text-red-600 dark:text-red-400 text-sm mt-2">{locationError}</p>}
        {locationLoading && <span className="text-slate-500 dark:text-eva-muted text-sm mt-2">Getting location...</span>}
        {saved && <span className="text-emerald-600 dark:text-emerald-400 text-sm mt-2">Saved</span>}
      </div>

      {/* P4: Style / Voice Profile */}
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2 flex items-center gap-2">
          Style (P4)
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--eva-accent-bg)] text-eva-accent">Fine-tuned model</span>
        </h2>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
          Describe how you write: tone, phrases, formality. EVA will match this style when responding.
        </p>
        <textarea
          value={settings.voice_profile?.text ?? ''}
          onChange={(e) => setSettings((s) => ({ ...s, voice_profile: { ...(s.voice_profile || {}), text: e.target.value } }))}
          placeholder="e.g. I write short, direct emails. I use « tu » in French. I avoid jargon. I often start with « Bonjour » and end with « Cordialement »."
          rows={4}
          disabled={saving}
          className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-eva-accent focus:border-transparent disabled:opacity-50 resize-y"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={() => setStyleProfile(settings.voice_profile?.text ?? '')}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-eva-accent text-white hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
          {saving && <span className="text-slate-500 dark:text-eva-muted text-sm">Saving...</span>}
          {saved && <span className="text-emerald-600 dark:text-emerald-400 text-sm">Saved</span>}
        </div>
      </div>
      </div>
      )}

      {/* Voice Settings */}
      {activeTab === 'voice' && voiceSettings && (
      <div className="space-y-6">
        <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
          <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-1">Alice Voice</h2>
          <p className="text-slate-500 dark:text-eva-muted text-sm mb-5">
            Choose the TTS model, voice, and speed for Alice. HD model sounds more natural but is slightly slower per sentence.
          </p>

          {/* TTS Model */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">TTS Model</label>
            <div className="flex gap-3">
              {(voiceSettings.available_models || ['tts-1', 'tts-1-hd']).map((m) => (
                <button
                  key={m}
                  onClick={() => setVoiceSettings((s) => ({ ...s, tts_model: m }))}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${voiceSettings.tts_model === m
                    ? 'bg-eva-accent/10 border-eva-accent text-eva-accent'
                    : 'bg-slate-100 dark:bg-slate-700/40 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-400'
                  }`}
                >
                  {m === 'tts-1-hd' ? 'HD (recommended)' : 'Standard (faster)'}
                </button>
              ))}
            </div>
          </div>

          {/* Voice FR */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Voice (French)</label>
            <div className="flex flex-wrap gap-2">
              {(voiceSettings.available_voices || []).map((v) => (
                <button
                  key={v}
                  onClick={() => setVoiceSettings((s) => ({ ...s, tts_voice_fr: v }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${voiceSettings.tts_voice_fr === v
                    ? 'bg-violet-500/10 border-violet-500 text-violet-600 dark:text-violet-400'
                    : 'bg-slate-100 dark:bg-slate-700/40 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-400'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Voice EN */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Voice (English)</label>
            <div className="flex flex-wrap gap-2">
              {(voiceSettings.available_voices || []).map((v) => (
                <button
                  key={v}
                  onClick={() => setVoiceSettings((s) => ({ ...s, tts_voice_en: v }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${voiceSettings.tts_voice_en === v
                    ? 'bg-cyan-500/10 border-cyan-500 text-cyan-600 dark:text-cyan-400'
                    : 'bg-slate-100 dark:bg-slate-700/40 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-400'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Speed */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Speed: <span className="text-eva-accent">{voiceSettings.tts_speed?.toFixed(2) || '1.05'}x</span>
            </label>
            <input
              type="range"
              min="0.7"
              max="1.5"
              step="0.05"
              value={voiceSettings.tts_speed || 1.05}
              onChange={(e) => setVoiceSettings((s) => ({ ...s, tts_speed: parseFloat(e.target.value) }))}
              className="w-full max-w-xs accent-eva-accent"
            />
            <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-600 max-w-xs mt-1">
              <span>Slow</span><span>Normal</span><span>Fast</span>
            </div>
          </div>

          {/* Preview + Save */}
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={async () => {
                setVoiceSaving(true);
                setVoiceSaved(false);
                try {
                  const result = await api.saveVoiceSettings({
                    tts_model: voiceSettings.tts_model,
                    tts_voice_fr: voiceSettings.tts_voice_fr,
                    tts_voice_en: voiceSettings.tts_voice_en,
                    tts_speed: voiceSettings.tts_speed,
                  });
                  setVoiceSettings((s) => ({ ...s, ...result }));
                  setVoiceSaved(true);
                  setTimeout(() => setVoiceSaved(false), 2000);
                } catch (e) {
                  setControlError(e.message || 'Save failed');
                } finally {
                  setVoiceSaving(false);
                }
              }}
              disabled={voiceSaving}
              className="px-5 py-2 rounded-lg bg-eva-accent text-white hover:opacity-90 disabled:opacity-50 text-sm font-medium"
            >
              {voiceSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={async () => {
                if (voicePreview) { voicePreview.pause(); setVoicePreview(null); return; }
                try {
                  const sample = voiceSettings.tts_voice_fr === voiceSettings.tts_voice_en
                    ? 'Bonjour, je suis Alice, votre assistante.'
                    : 'Bonjour, je suis Alice.';
                  const blob = await api.voiceTts(sample);
                  const url = URL.createObjectURL(blob);
                  const a = new Audio(url);
                  a.onended = () => { URL.revokeObjectURL(url); setVoicePreview(null); };
                  setVoicePreview(a);
                  a.play();
                } catch (e) {
                  setControlError('Preview failed: ' + e.message);
                }
              }}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/40 text-sm"
            >
              {voicePreview ? '⏹ Stop' : '▶ Preview'}
            </button>
            {voiceSaved && <span className="text-emerald-600 dark:text-emerald-400 text-sm">Saved</span>}
          </div>
        </div>
      </div>
      )}

      {/* Sync & Data */}
      {activeTab === 'sync' && (
      <div className="space-y-6">
      {/* Sync Frequency */}
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Gmail sync (automatic)</h2>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
          How often EVA automatically fetches your new emails. More frequent = fresher data, but more API requests.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={settings.sync_frequency_minutes?.minutes ?? 15}
            onChange={(e) => setSyncFrequency(Number(e.target.value))}
            disabled={saving}
            className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-eva-accent focus:border-transparent disabled:opacity-50"
          >
            <option value={5}>5 minutes</option>
            <option value={10}>10 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={120}>2 hours</option>
          </select>
          {saving && <span className="text-slate-500 dark:text-eva-muted text-sm">Saving...</span>}
          {saved && <span className="text-emerald-600 dark:text-emerald-400 text-sm">Saved</span>}
        </div>
      </div>

      {/* Email sync period */}
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Email sync period</h2>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
          How many days of emails to fetch from Gmail (30–365). Sync runs automatically; change applies on next sync. For 180+ days, go to Data Sources → Sync Now after saving. First full sync may take a few minutes.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={settings.email_sync_days?.days ?? 90}
            onChange={(e) => setEmailSyncDays(Number(e.target.value))}
            disabled={saving}
            className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-eva-accent focus:border-transparent disabled:opacity-50"
          >
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>
          {saving && <span className="text-slate-500 dark:text-eva-muted text-sm">Saving...</span>}
          {saved && <span className="text-emerald-600 dark:text-emerald-400 text-sm">Saved</span>}
        </div>
      </div>
      </div>
      )}

      {/* Notifications */}
      {activeTab === 'notifications' && (
      <div className="space-y-6">
      {/* Push notifications (phone & laptop) */}
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Push notifications (phone & laptop)</h2>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
          Receive alerts on this device when important emails arrive or calendar reminders fire. Works even when the browser tab is in the background.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {pushStatus.thisDeviceSubscribed ? (
            <span className="px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-medium">Enabled on this device</span>
          ) : !pushStatus.configured ? (
            <span className="text-slate-500 dark:text-eva-muted text-sm">Server push not configured</span>
          ) : (
            <button
              onClick={enablePushNotifications}
              disabled={pushLoading}
              className="px-4 py-2 rounded-lg font-medium bg-eva-accent text-white hover:opacity-90 disabled:opacity-50"
            >
              {pushLoading ? 'Enabling...' : 'Enable notifications on this device'}
            </button>
          )}
        </div>
        {pushError && <p className="text-sm mt-2" style={{ color: '#dc2626' }}>{pushError}</p>}
      </div>

      {/* Notifications */}
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Calendar reminders</h2>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
          EVA sends reminders for upcoming calendar events. Prefers push; falls back to email if push not enabled. Sync Google Calendar in Data Sources first.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={() => setNotificationPrefs(settings.notification_preferences?.enabled !== false ? false : true)}
            disabled={saving}
            className={`px-4 py-2 rounded-lg font-medium ${
              settings.notification_preferences?.enabled !== false
                ? 'bg-eva-accent text-white hover:opacity-90'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
            } disabled:opacity-50`}
          >
            {settings.notification_preferences?.enabled !== false ? 'Notifications ON' : 'Notifications OFF'}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600 dark:text-slate-400">Remind me:</span>
            {[15, 60, 1440].map((m) => {
              const label = m < 60 ? `${m} min before` : m < 1440 ? `1 h before` : '24 h before';
              const active = (settings.notification_preferences?.leadMinutes ?? [15, 60, 1440]).includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleLead(m)}
                  disabled={saving}
                  className={`text-sm px-3 py-1.5 rounded-lg ${
                    active ? 'bg-[var(--eva-accent-bg)] text-eva-accent' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {saving && <span className="text-slate-500 dark:text-eva-muted text-sm">Saving...</span>}
          {saved && <span className="text-emerald-600 dark:text-emerald-400 text-sm">Saved</span>}
        </div>
      </div>

      {/* Email importance alerts */}
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Email importance alerts</h2>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
          EVA can notify you by email when an important message arrives. Requires Gmail sync in Data Sources.
        </p>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEmailImportancePrefs(settings.email_importance_preferences?.enabled !== true ? true : false)}
              disabled={saving}
              className={`px-4 py-2 rounded-lg font-medium cursor-pointer transition-colors border-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                settings.email_importance_preferences?.enabled === true
                  ? 'bg-red-600 border-red-600 text-white hover:bg-red-500'
                  : 'bg-transparent border-slate-500 text-slate-300 hover:border-red-500 hover:text-red-400'
              }`}
            >
              {settings.email_importance_preferences?.enabled === true ? 'Alerts ON' : 'Alerts OFF'}
            </button>
          </div>
          {settings.email_importance_preferences?.enabled === true && (
            <div className="flex flex-col gap-2 pt-2 border-t border-slate-200 dark:border-slate-700/40">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Priority level</span>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="email_priority"
                    checked={(settings.email_importance_preferences?.priorityLevel ?? 'gmail_only') === 'gmail_only'}
                    onChange={() => setEmailImportancePrefs(null, 'gmail_only')}
                    disabled={saving}
                    className="text-red-600"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">Gmail Important label only</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="email_priority"
                    checked={settings.email_importance_preferences?.priorityLevel === 'gmail_and_ai'}
                    onChange={() => setEmailImportancePrefs(null, 'gmail_and_ai')}
                    disabled={saving}
                    className="text-red-600"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">Gmail + AI analysis</span>
                </label>
              </div>
              <p className="text-xs text-slate-500 dark:text-eva-muted">
                Gmail only: uses Gmail&apos;s IMPORTANT label. AI: also analyzes unread emails to detect urgent messages.
              </p>
            </div>
          )}
          {saving && <span className="text-slate-500 dark:text-eva-muted text-sm">Saving...</span>}
          {saved && <span className="text-emerald-600 dark:text-emerald-400 text-sm">Saved</span>}
        </div>
      </div>
      </div>
      )}

      {/* Control */}
      {activeTab === 'control' && (
      <div className="space-y-6">
      {/* MCP Hub — visible trigger and status */}
      <div className="rounded-xl border p-6 max-w-2xl bg-white dark:bg-eva-panel border-slate-200 dark:border-slate-700/40" data-testid="mcp-hub-block">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-1">MCP Hub</h2>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
          Connect EVA to the platform MCP server (DB queries, file read, route scan, QA). When connected, <strong>EVA Chat and Alice</strong> (voice and text) can use MCP tools. Enable the runtime flag below, then trigger the connection.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-sm px-2 py-1 rounded ${mcpStatus.connected ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : mcpStatus.error ? 'bg-red-500/20 text-red-600 dark:text-red-400' : 'bg-slate-200 dark:bg-slate-600/40 text-slate-600 dark:text-slate-500'}`}>
            {mcpStatus.connected ? `Connected (${mcpStatus.tools_count} tools)` : mcpStatus.error ? 'Connection failed' : 'Not connected'}
          </span>
          <button
            type="button"
            onClick={async () => {
              setMcpTriggering(true);
              try {
                const res = await api.triggerMcpConnect();
                setMcpStatus({ connected: res.connected, tools_count: res.tools_count || 0, tools: res.tools || [] });
              } catch (e) {
                setMcpStatus({ connected: false, tools_count: 0, tools: [], error: e.message });
              } finally {
                setMcpTriggering(false);
              }
            }}
            disabled={mcpTriggering}
            className="px-4 py-2 rounded-lg bg-eva-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {mcpTriggering ? 'Connecting…' : 'Trigger MCP connection'}
          </button>
        </div>
        {mcpStatus.tools && mcpStatus.tools.length > 0 && (
          <p className="text-xs text-slate-500 dark:text-eva-muted mt-2">Tools: {mcpStatus.tools.map(t => t.name).join(', ')}</p>
        )}
        {mcpStatus.error && !mcpStatus.connected && (
          <p className="text-xs text-red-500 dark:text-red-400 mt-2">Error: {mcpStatus.error}</p>
        )}
      </div>

      {/* Feature flags — runtime ON/OFF */}
      <div className="rounded-xl border p-6 max-w-2xl bg-white dark:bg-eva-panel border-slate-200 dark:border-slate-700/40">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-medium text-slate-900 dark:text-white">Runtime flags</h2>
          {(() => {
            const FLAG_KEYS = ['assistant_mode','mcp_enabled','voice_safe_mode','memory_learning','conversation_learning','smart_context','auto_object_update','voice_memory_write'];
            const allOn = FLAG_KEYS.every(k => featureFlags[k]);
            return (
              <button
                type="button"
                onClick={async () => {
                  const next = !allOn;
                  for (const k of FLAG_KEYS) {
                    try {
                      await api.setFeatureFlag(k, next);
                    } catch (_) {}
                  }
                  setFeatureFlags(f => {
                    const copy = { ...f };
                    FLAG_KEYS.forEach(k => { copy[k] = next; });
                    return copy;
                  });
                }}
                className={`text-xs px-3 py-1 rounded-lg font-medium transition-all ${allOn ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'}`}
              >
                {allOn ? 'Disable All' : 'Enable All'}
              </button>
            );
          })()}
        </div>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">Toggle features without redeploy. All OFF = simple chat, no automatic learning.</p>
        <div className="space-y-3">
          {[
            { key: 'assistant_mode', label: 'Assistant Mode' },
            { key: 'mcp_enabled', label: 'MCP Hub', hint: 'Connect to platform MCP server (DB queries, file read, route scan, QA, deploy...)' },
            { key: 'voice_safe_mode', label: 'Voice Safe Mode', hint: 'Block memory writes from voice (recommended ON)' },
            { key: 'memory_learning', label: 'Memory Learning' },
            { key: 'conversation_learning', label: 'Conversation Learning' },
            { key: 'smart_context', label: 'Smart Context' },
            { key: 'auto_object_update', label: 'Auto Object Update' },
            { key: 'voice_memory_write', label: 'Voice Memory Write' },
          ].map(({ key, label, hint }) => (
            <div key={key} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700/40 last:border-0">
              <div>
                <span className="text-sm font-medium text-slate-900 dark:text-white">{label}</span>
                {hint && <p className="text-xs text-slate-500 dark:text-eva-muted mt-0.5">{hint}</p>}
              </div>
              <button
                type="button"
                onClick={async () => {
                  const next = !featureFlags[key];
                  try {
                    await api.setFeatureFlag(key, next);
                    setFeatureFlags((f) => ({ ...f, [key]: next }));
                  } catch (e) {
                    setControlError(e?.message || 'Failed');
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${featureFlags[key] ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-slate-200 dark:bg-slate-600/40 text-slate-600 dark:text-slate-500'}`}
              >
                {featureFlags[key] ? 'ON' : 'OFF'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* P5: Autonomous Mode */}
      <div className={`rounded-xl border p-6 max-w-2xl transition-colors ${
        autonomousModeOn ? 'bg-amber-500/5 border-amber-500/30' : 'bg-white dark:bg-eva-panel border-slate-200 dark:border-slate-700/40'
      } ${(killSwitchOn || shadowModeOn) ? 'ring-2 ring-amber-400/50' : ''}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-slate-900 dark:text-white flex items-center gap-2">
              Autonomous Mode (P5)
              <span className={`text-xs px-2 py-0.5 rounded-full ${autonomousModeOn ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-slate-300 dark:bg-slate-600/40 text-slate-600 dark:text-slate-500'}`}>
                {autonomousModeOn ? 'ON' : 'OFF'}
              </span>
            </h2>
            <p className="text-slate-500 dark:text-eva-muted text-sm mt-2">
              When ON, drafts are created as pre-approved (status: approved) instead of pending. Use only if you trust EVA to draft without explicit review. Kill Switch and Shadow Mode override this.
            </p>
          </div>
        </div>
        {(killSwitchOn || shadowModeOn) && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-800 dark:text-amber-200">
            <strong>Autonomous Mode is locked.</strong> Turn off Kill Switch and Shadow Mode first to enable or disable it.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button
            type="button"
            data-testid="autonomous-mode-toggle"
            onClick={() => setAutonomousMode(!autonomousModeOn)}
            disabled={saving || killSwitchOn || shadowModeOn}
            className={`px-5 py-2.5 rounded-lg font-medium transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
              autonomousModeOn
                ? 'bg-slate-600 text-white hover:bg-slate-500'
                : 'bg-amber-600 text-white hover:bg-amber-500'
            }`}
            title={killSwitchOn || shadowModeOn ? 'Disable Kill Switch and Shadow Mode first' : (autonomousModeOn ? 'Turn off autonomous mode' : 'Turn on autonomous mode')}
          >
            {autonomousModeOn ? 'Disable Autonomous Mode' : 'Enable Autonomous Mode'}
          </button>
          {(killSwitchOn || shadowModeOn) && <span className="text-slate-500 dark:text-eva-muted text-xs">Disable Kill Switch and Shadow Mode first</span>}
          {saving && <span className="text-slate-500 dark:text-eva-muted text-sm">Saving...</span>}
          {saved && <span className="text-emerald-600 dark:text-emerald-400 text-sm">Saved</span>}
          {controlError && <span className="text-red-600 dark:text-red-400 text-sm">{controlError}</span>}
        </div>
      </div>

      {/* Kill Switch */}
      <div className={`rounded-xl border p-6 max-w-2xl transition-colors ${
        killSwitchOn ? 'bg-amber-500/5 border-amber-500/30' : 'bg-white dark:bg-eva-panel border-slate-200 dark:border-slate-700/40'
      }`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-slate-900 dark:text-white flex items-center gap-2">
              Kill Switch
              <span className={`text-xs px-2 py-0.5 rounded-full ${killSwitchOn ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'}`}>
                {killSwitchOn ? 'PAUSED' : 'ACTIVE'}
              </span>
            </h2>
            <p className="text-slate-500 dark:text-eva-muted text-sm mt-2">
              Instantly pause all autonomous EVA operations. When paused, EVA will not send any drafts, respond to messages, or take any action without your explicit approval.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
            type="button"
            onClick={() => setKillSwitch(!killSwitchOn)}
            disabled={saving}
            className={`px-5 py-2.5 rounded-lg font-medium transition-all ${
              killSwitchOn
                ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                : 'bg-amber-600 text-white hover:bg-amber-500'
            } disabled:opacity-50`}
          >
            {killSwitchOn ? 'Resume EVA' : 'Pause EVA'}
          </button>
          {saving && <span className="text-slate-500 dark:text-eva-muted text-sm">Saving...</span>}
          {saved && <span className="text-emerald-600 dark:text-emerald-400 text-sm">Saved</span>}
        </div>
      </div>

      {/* Shadow Mode */}
      <div className={`rounded-xl border p-6 max-w-2xl transition-colors ${
        shadowModeOn ? 'bg-red-500/5 border-red-500/30' : 'bg-white dark:bg-eva-panel border-slate-200 dark:border-slate-700/40'
      }`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-slate-900 dark:text-white flex items-center gap-2">
              Shadow Mode
              <span className={`text-xs px-2 py-0.5 rounded-full ${shadowModeOn ? 'bg-[var(--eva-accent-bg)] text-eva-accent' : 'bg-slate-300 dark:bg-slate-600/40 text-slate-600 dark:text-slate-500'}`}>
                {shadowModeOn ? 'ON' : 'OFF'}
              </span>
            </h2>
            <p className="text-slate-500 dark:text-eva-muted text-sm mt-2">
              EVA observes and indexes your data (emails, documents). Chat works normally — but drafts, voice, and autonomous sends are disabled. Ideal for building memory while staying in control.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
            type="button"
            onClick={() => setShadowMode(!shadowModeOn)}
            disabled={saving || killSwitchOn}
            className={`px-5 py-2.5 rounded-lg font-medium transition-all ${
              shadowModeOn
                ? 'bg-slate-600 text-white hover:bg-slate-500'
                : 'bg-eva-accent text-white hover:opacity-90'
            } disabled:opacity-50`}
            title={killSwitchOn ? 'Resume EVA first' : ''}
          >
            {shadowModeOn ? 'Disable Shadow Mode' : 'Enable Shadow Mode'}
          </button>
          {killSwitchOn && <span className="text-slate-500 dark:text-eva-muted text-xs">Resume EVA first</span>}
          {saving && <span className="text-slate-500 dark:text-eva-muted text-sm">Saving...</span>}
          {saved && <span className="text-emerald-600 dark:text-emerald-400 text-sm">Saved</span>}
        </div>
      </div>

      {/* Permission Tiers */}
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Permission Tiers</h2>
        <p className="text-slate-500 dark:text-eva-muted text-sm mb-4">
          Control what EVA can do per channel. Click each badge to enable/disable.
        </p>
        <div className="space-y-3">
          {tierKeys.map((key) => {
            const tier = tiers[key] || DEFAULT_TIERS[key];
            return (
              <div key={key} className="flex items-center justify-between py-2 border-b border-slate-200 dark:border-slate-700/30 last:border-0">
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  {tier.channel}
                  {tier.soon && <span className="ml-2 text-xs text-slate-500">(soon)</span>}
                </span>
                <div className="flex gap-2">
                  {['read', 'draft', 'send'].map((perm) => (
                    tier.soon ? (
                      <span key={perm} className="text-xs px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-600 cursor-not-allowed">
                        {perm}
                      </span>
                    ) : (
                      <button
                        key={perm}
                        type="button"
                        onClick={() => setPermission(key, perm, !tier[perm])}
                        disabled={saving}
                        className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors disabled:opacity-50 hover:opacity-80 ${
                          tier[perm] ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-500'
                        }`}
                        title={`${tier[perm] ? 'Disable' : 'Enable'} ${perm}`}
                      >
                        {perm}
                      </button>
                    )
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {saving && <span className="text-eva-muted text-xs mt-2 block">Saving...</span>}
        {saved && <span className="text-emerald-400 text-xs mt-2 block">Saved</span>}
      </div>
      </div>
      )}

      {/* Security */}
      {activeTab === 'security' && (
      <div className="space-y-6">
      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Security & Privacy</h2>
        <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
          <p>All EVA data is stored in a private PostgreSQL database (schema: eva).</p>
          <p>Every autonomous action is logged in the audit trail with full explainability.</p>
          <p>EVA never signs contracts, commits financial terms, or responds to legal correspondence autonomously.</p>
          <p>API access requires EVA_API_KEY when set in production.</p>
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
