import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requireAuth, setRequireAuth] = useState(true);

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
        const token = localStorage.getItem('eva_token');
        if (!token) {
          setLoading(false);
          return;
        }
        const u = await api.getAuthMe(token);
        if (!cancelled) setUser(u);
      } catch {
        setRequireAuth(true);
        localStorage.removeItem('eva_token');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = async (email, password) => {
    const { token, user: u } = await api.login(email, password);
    localStorage.setItem('eva_token', token);
    setUser(u);
  };

  const signup = async (email, password, displayName) => {
    const { token, user: u } = await api.signup(email, password, displayName);
    localStorage.setItem('eva_token', token);
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem('eva_token');
    setUser(null);
  };

  const resetPassword = async (token, email, password) => {
    const { token: newToken, user: u } = await api.resetPassword(token, email, password);
    localStorage.setItem('eva_token', newToken);
    setUser(u);
  };

  const getToken = () => localStorage.getItem('eva_token');

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
