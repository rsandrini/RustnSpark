import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { setAccessToken, setOnUnauthorized } from '../../api/client';
import { authApi } from './auth.api';
import type { LoginCredentials, RegisterData, UserProfile } from './auth.types';

interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Re-reads the profile (wallet, faction) without touching the session tokens. */
  reloadProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
  });

  const handleUnauthorized = useCallback(() => {
    setAccessToken(null);
    setState({ user: null, accessToken: null, isLoading: false });
    void navigate('/login');
  }, [navigate]);

  useEffect(() => {
    setOnUnauthorized(handleUnauthorized);
  }, [handleUnauthorized]);

  const loadProfile = useCallback(
    async (token: string): Promise<UserProfile | null> => {
      try {
        const profile = await authApi.me();
        setState({ user: profile, accessToken: token, isLoading: false });
        if (profile.locale && i18n.language !== profile.locale) {
          await i18n.changeLanguage(profile.locale);
        }
        return profile;
      } catch {
        handleUnauthorized();
        return null;
      }
    },
    [handleUnauthorized, i18n],
  );

  const refreshSession = useCallback(async () => {
    try {
      const { accessToken } = await authApi.refresh();
      setAccessToken(accessToken);
      await loadProfile(accessToken);
    } catch {
      handleUnauthorized();
    }
  }, [handleUnauthorized, loadProfile]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  // After a trade the wallet must update, but a full session refresh would rotate the
  // refresh token on every purchase and log the player out on a transient failure. The
  // profile read alone is enough; a failure here just leaves the previous balance shown.
  const reloadProfile = useCallback(async () => {
    try {
      const profile = await authApi.me();
      setState((current) => ({ ...current, user: profile }));
    } catch {
      // keep the last known profile
    }
  }, []);

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      const { accessToken } = await authApi.login(credentials);
      setAccessToken(accessToken);
      const profile = await loadProfile(accessToken);
      // loadProfile already sent the player back to /login when the profile failed to
      // load; navigating again here would override that redirect.
      if (profile === null) return;
      // A pilot without a faction has no ship yet: onboarding first (S10.2).
      void navigate(profile.factionId ? '/' : '/onboarding');
    },
    [loadProfile, navigate],
  );

  const register = useCallback(
    async (data: RegisterData) => {
      const { accessToken } = await authApi.register(data);
      setAccessToken(accessToken);
      const profile = await loadProfile(accessToken);
      if (profile === null) return;
      void navigate('/onboarding');
    },
    [loadProfile, navigate],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout failures; the session cookie will expire anyway.
    }
    setAccessToken(null);
    setState({ user: null, accessToken: null, isLoading: false });
    void navigate('/login');
  }, [navigate]);

  const value = useMemo(
    () => ({ ...state, login, register, logout, refresh: refreshSession, reloadProfile }),
    [state, login, register, logout, refreshSession, reloadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used inside AuthProvider');
  }
  return context;
}
