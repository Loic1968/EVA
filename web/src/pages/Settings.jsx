import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then(setSettings)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex gap-1">
          <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
          <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
          <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
        </div>
      </div>
    );
  }

  if (error) return <div className="text-red-400 p-4">Error: {error}</div>;

  const killSwitchOn = settings.kill_switch?.enabled === true;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="text-eva-muted text-sm mt-1">Control EVA's behavior and security settings</p>
      </div>

      {/* Kill Switch */}
      <div className={`rounded-xl border p-6 max-w-2xl transition-colors ${
        killSwitchOn ? 'bg-amber-500/5 border-amber-500/30' : 'bg-eva-panel border-slate-700/40'
      }`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-white flex items-center gap-2">
              Kill Switch
              <span className={`text-xs px-2 py-0.5 rounded-full ${killSwitchOn ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                {killSwitchOn ? 'PAUSED' : 'ACTIVE'}
              </span>
            </h2>
            <p className="text-eva-muted text-sm mt-2">
              Instantly pause all autonomous EVA operations. When paused, EVA will not send any drafts, respond to messages, or take any action without your explicit approval.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
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
          {saving && <span className="text-eva-muted text-sm">Saving...</span>}
          {saved && <span className="text-emerald-400 text-sm">Saved</span>}
        </div>
      </div>

      {/* Permission Tiers */}
      <div className="bg-eva-panel rounded-xl border border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-white mb-2">Permission Tiers</h2>
        <p className="text-eva-muted text-sm mb-4">
          Configure what EVA can do per channel. Each action (read, draft, send) requires explicit authorization.
        </p>
        <div className="space-y-3">
          {[
            { channel: 'Email (Gmail)', read: true, draft: true, send: false },
            { channel: 'WhatsApp', read: false, draft: false, send: false },
            { channel: 'LinkedIn', read: false, draft: false, send: false },
            { channel: 'SMS', read: false, draft: false, send: false },
          ].map((tier) => (
            <div key={tier.channel} className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-0">
              <span className="text-sm text-slate-300">{tier.channel}</span>
              <div className="flex gap-3">
                {['read', 'draft', 'send'].map((perm) => (
                  <span key={perm} className={`text-xs px-2 py-0.5 rounded ${
                    tier[perm] ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'
                  }`}>
                    {perm}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-3">Phase 3+ — permission controls will be fully configurable</p>
      </div>

      {/* Security info */}
      <div className="bg-eva-panel rounded-xl border border-slate-700/40 p-6 max-w-2xl">
        <h2 className="text-lg font-medium text-white mb-2">Security & Privacy</h2>
        <div className="space-y-2 text-sm text-slate-400">
          <p>All EVA data is stored in a private PostgreSQL database (schema: eva).</p>
          <p>Every autonomous action is logged in the audit trail with full explainability.</p>
          <p>EVA never signs contracts, commits financial terms, or responds to legal correspondence autonomously.</p>
          <p>API access requires EVA_API_KEY when set in production.</p>
        </div>
      </div>
    </div>
  );
}
