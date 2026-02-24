import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requireAuth, setRequireAuth] = useState(true);

  const getTokenStorage = () => localStorage.getItem('eva_token') || sessionStorage.getItem('eva_token');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await api.getAuthConfig();
        const needAuth = c.requireAuth !== false;
        setRequireAuth(needAuth);
        if (!needAuth) {
          setUser({ skipAuth: true });
          setLoading(false);
          return;
        }
        const token = getTokenStorage();
        if (!token) {
          setLoading(false);
          return;
        }
        const u = await api.getAuthMe(token);
        if (!cancelled) setUser(u);
      } catch {
        setRequireAuth(true);
        localStorage.removeItem('eva_token');
        sessionStorage.removeItem('eva_token');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const storeToken = (token, remember) => {
    localStorage.removeItem('eva_token');
    sessionStorage.removeItem('eva_token');
    if (remember) {
      localStorage.setItem('eva_token', token);
    } else {
      sessionStorage.setItem('eva_token', token);
    }
  };

  const login = async (email, password, remember = true) => {
    const { token, user: u } = await api.login(email, password);
    storeToken(token, remember);
    setUser(u);
  };

  const signup = async (email, password, displayName, remember = true) => {
    const { token, user: u } = await api.signup(email, password, displayName);
    storeToken(token, remember);
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem('eva_token');
    sessionStorage.removeItem('eva_token');
    setUser(null);
  };

  const resetPassword = async (token, email, password, remember = true) => {
    const { token: newToken, user: u } = await api.resetPassword(token, email, password);
    storeToken(newToken, remember);
    setUser(u);
  };

  const getToken = () => getTokenStorage();

  const isAuthenticated = !!user;
  return (
    <AuthContext.Provider value={{ user, loading, requireAuth, isAuthenticated, login, signup, logout, resetPassword, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
