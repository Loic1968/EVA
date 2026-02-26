import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import EvaLogo from '../components/EvaLogo';
import { useAuth } from '../context/AuthContext';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const emailFromUrl = searchParams.get('email') || '';
  const [email, setEmail] = useState(emailFromUrl);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { resetPassword } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await resetPassword(token, email.trim(), password);
      navigate('/voice', { replace: true });
    } catch (err) {
      setError(err.body?.error || err.message || 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-eva-dark p-4">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400">Invalid or expired link.</p>
          <Link to="/forgot-password" className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 mt-4 inline-block">Request a new link</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-eva-dark p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <EvaLogo size="md" variant="icon" className="mx-auto mb-2" />
          <p className="text-sm font-medium -mt-1 mb-2 flex items-center justify-center gap-1"><EvaLogo variant="text" /> <span className="text-[10px] text-slate-500 font-normal">by HaliSoft</span></p>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">New password</h1>
        </div>
        <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="text-red-600 dark:text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2">{error}</div>}
            <div>
              <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">New password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 pr-10 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1"
                  title={showPassword ? 'Hide' : 'Show'}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-red-600 to-red-700 text-white font-medium rounded-lg hover:from-red-500 hover:to-red-600 disabled:opacity-50 transition-all"
            >
              {loading ? 'Saving...' : 'Reset'}
            </button>
          </form>
        </div>
        <p className="text-center text-slate-600 dark:text-eva-muted text-sm mt-6">
          <Link to="/login" className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
