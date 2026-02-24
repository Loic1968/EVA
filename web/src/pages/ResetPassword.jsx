import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const emailFromUrl = searchParams.get('email') || '';
  const [email, setEmail] = useState(emailFromUrl);
  const [password, setPassword] = useState('');
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
      setError(err.body?.error || err.message || 'Réinitialisation échouée');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-eva-dark p-4">
        <div className="text-center">
          <p className="text-red-400">Lien invalide ou expiré.</p>
          <Link to="/forgot-password" className="text-cyan-400 hover:text-cyan-300 mt-4 inline-block">Demander un nouveau lien</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-eva-dark p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white font-bold text-xl mx-auto mb-3">E</div>
          <h1 className="text-2xl font-semibold text-white">Nouveau mot de passe</h1>
        </div>
        <div className="bg-eva-panel rounded-xl border border-slate-700/40 p-6">
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
            <div>
              <label className="block text-sm text-slate-400 mb-1">Nouveau mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium rounded-lg hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all"
            >
              {loading ? 'Enregistrement...' : 'Réinitialiser'}
            </button>
          </form>
        </div>
        <p className="text-center text-eva-muted text-sm mt-6">
          <Link to="/login" className="text-cyan-400 hover:text-cyan-300">← Retour connexion</Link>
        </p>
      </div>
    </div>
  );
}
