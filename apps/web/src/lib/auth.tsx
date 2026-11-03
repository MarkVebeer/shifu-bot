import type { MeResponse } from '@shifubot/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api, ApiRequestError, setCsrfToken } from './api';

interface AuthValue {
  me: MeResponse | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<MeResponse>('/me')
      .then((result) => {
        setCsrfToken(result.csrfToken);
        setMe(result);
      })
      .catch((error) => {
        if (!(error instanceof ApiRequestError && error.status === 401)) console.error(error);
        setMe(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setMe(null);
    window.location.assign('/login');
  }, []);

  return <AuthContext.Provider value={{ me, loading, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export function RequireAuth({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <>{fallback}</>;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
