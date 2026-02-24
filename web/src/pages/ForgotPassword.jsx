import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetUrl, setResetUrl] = useState(null);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResetUrl(null);
    setLoading(true);
    try {
      const res = await api.forgotPassword(email.trim());
      if (res?.exists === false) {
        navigate('/signup', { state: { email: email.trim() }, replace: true });
        return;
      }
      setSent(true);
      if (res?.resetUrl) setResetUrl(res.resetUrl);
    } catch (err) {
      setError(err.body?.error || err.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-eva-dark p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white font-bold text-xl mx-auto mb-3">E</div>
          <h1 className="text-2xl font-semibold text-white">Forgot password</h1>
          <p className="text-eva-muted text-sm">We'll send you a reset link</p>
        </div>
        <div className="bg-eva-panel rounded-xl border border-slate-700/40 p-6">
          {sent ? (
            <div className="text-center py-4 space-y-2">
              <p className="text-emerald-400">A reset link has been sent to your email.</p>
              <p className="text-eva-muted text-sm">Check your inbox (and spam folder).</p>
              {resetUrl && (
                <p className="text-sm mt-4 pt-4 border-t border-slate-700/40">
                  <span className="text-slate-500">Dev mode (no SMTP) — </span>
                  <a href={resetUrl} className="text-cyan-400 hover:text-cyan-300 underline break-all">
                    Click here to reset
                  </a>
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <div className="text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2">{error}</div>}
              <div>
                <label className="block text-sm text-slate-400 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium rounded-lg hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all"
              >
                {loading ? 'Sending...' : 'Send link'}
              </button>
            </form>
          )}
        </div>
        <p className="text-center text-eva-muted text-sm mt-6">
          <Link to="/login" className="text-cyan-400 hover:text-cyan-300">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
