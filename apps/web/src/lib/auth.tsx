'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import Cookies from 'js-cookie';
import { api, ApiError, TOKEN_COOKIE } from './api';
import type { PublicUser } from './types';

interface AuthContextValue {
  user: PublicUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: { email: string; username: string; password: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function setTokenCookie(token: string): void {
  Cookies.set(TOKEN_COOKIE, token, {
    expires: 7,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const existing = Cookies.get(TOKEN_COOKIE);
    if (!existing) {
      setLoading(false);
      return;
    }
    setToken(existing);
    api
      .me()
      .then((u) => setUser(u))
      .catch((err) => {
        // Invalid token: clear it.
        if (err instanceof ApiError && err.status === 401) {
          Cookies.remove(TOKEN_COOKIE);
          setToken(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: u, token: t } = await api.login({ email, password });
    setTokenCookie(t);
    setUser(u);
    setToken(t);
  }, []);

  const signup = useCallback(
    async (input: { email: string; username: string; password: string }) => {
      const { user: u, token: t } = await api.signup(input);
      setTokenCookie(t);
      setUser(u);
      setToken(t);
    },
    [],
  );

  const logout = useCallback(() => {
    Cookies.remove(TOKEN_COOKIE);
    setUser(null);
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
