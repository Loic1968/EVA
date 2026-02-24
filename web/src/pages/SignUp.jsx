import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function SignUp() {
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signup(email.trim(), password, displayName.trim() || undefined);
      navigate('/voice', { replace: true });
    } catch (err) {
      setError(err.body?.error || err.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-eva-dark p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white font-bold text-xl mx-auto mb-3">E</div>
          <h1 className="text-2xl font-semibold text-white">EVA</h1>
          <p className="text-eva-muted text-sm">{location.state?.email ? 'This email is not registered. Create an account:' : 'Create an account'}</p>
        </div>
        <div className="bg-eva-panel rounded-xl border border-slate-700/40 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2">{error}</div>}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Name (optional)</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                placeholder="Loic"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                placeholder="toi@example.com"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                placeholder="8+ chars, uppercase, number, symbol"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium rounded-lg hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all"
            >
              {loading ? 'Signing up...' : 'Sign up'}
            </button>
          </form>
        </div>
        <p className="text-center text-eva-muted text-sm mt-6">
          Already have an account? <Link to="/login" className="text-cyan-400 hover:text-cyan-300">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
