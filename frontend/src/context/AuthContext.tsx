import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import api from '../services/api';
import { Role } from '../types';

interface AuthUser {
  userId: string;
  email: string;
  role: Role;
  name: string;
}

interface LoginResult {
  requirePasswordChange: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  // Blocks rendering until the stored token is verified, so a tampered
  // localStorage role can't briefly drive the UI.
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, []);

  /**
   * Confirm the stored token with the server on boot.
   * The role always comes from this response, never from localStorage.
   */
  useEffect(() => {
    let cancelled = false;

    async function verify() {
      const stored = localStorage.getItem('token');
      if (!stored) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await api.get('/auth/me');
        if (cancelled) return;
        setUser({ userId: data.id, email: data.email, role: data.role, name: data.name });
      } catch {
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    verify();
    return () => { cancelled = true; };
  }, [clearSession]);

  const login = async (email: string, password: string): Promise<LoginResult> => {
    const { data } = await api.post('/auth/login', { email, password });
    const { token: newToken, user: userData, requirePasswordChange } = data;

    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(userData));
    setToken(newToken);
    setUser(userData);

    return { requirePasswordChange };
  };

  const logout = async () => {
    // Best-effort: records the event in the audit trail. The session is cleared regardless.
    try { await api.post('/auth/logout'); } catch { /* token may already be expired */ }
    clearSession();
  };

  // Re-pull identity after a profile change (email/name/avatar) so the UI stays in sync.
  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser({ userId: data.id, email: data.email, role: data.role, name: data.name });
    } catch { /* leave current user as-is */ }
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshUser, isAuthenticated: !!token && !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
