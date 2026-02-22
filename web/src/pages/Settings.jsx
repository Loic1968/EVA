import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const setKillSwitch = async (enabled) => {
    setSaving(true);
    try {
      await api.setSetting('kill_switch', { enabled, updated_at: new Date().toISOString() });
      setSettings((s) => ({ ...s, kill_switch: { enabled } }));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-eva-muted">Loading...</div>;
  if (error) return <div className="text-red-400">Error: {error}</div>;

  const killSwitchOn = settings.kill_switch?.enabled === true;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-white">Settings</h1>

      <div className="bg-eva-panel rounded-lg border border-slate-700/50 p-6 max-w-xl">
        <h2 className="text-lg font-medium text-white mb-2">Kill switch</h2>
        <p className="text-eva-muted text-sm mb-4">Pause all autonomous EVA operations immediately. No drafts will be sent without your approval.</p>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setKillSwitch(true)}
            disabled={saving}
            className={`px-4 py-2 rounded font-medium ${killSwitchOn ? 'bg-amber-600 text-white' : 'bg-slate-600 text-slate-300'}`}
          >
            Pause EVA
          </button>
          <button
            onClick={() => setKillSwitch(false)}
            disabled={saving}
            className={`px-4 py-2 rounded font-medium ${!killSwitchOn ? 'bg-emerald-600 text-white' : 'bg-slate-600 text-slate-300'}`}
          >
            Resume EVA
          </button>
          {saving && <span className="text-eva-muted text-sm">Saving...</span>}
        </div>
        <p className="text-slate-400 text-xs mt-3">Status: {killSwitchOn ? 'Autonomous mode paused' : 'Active'}</p>
      </div>

      <div className="bg-eva-panel rounded-lg border border-slate-700/50 p-6 max-w-xl">
        <h2 className="text-lg font-medium text-white mb-2">Permission tiers</h2>
        <p className="text-eva-muted text-sm">Configure read / draft / send permissions per channel (Phase 3+). Coming soon.</p>
      </div>
    </div>
  );
}
