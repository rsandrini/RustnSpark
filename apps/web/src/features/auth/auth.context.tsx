import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
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
    navigate('/login');
  }, [navigate]);

  useEffect(() => {
    setOnUnauthorized(handleUnauthorized);
  }, [handleUnauthorized]);

  const loadProfile = useCallback(
    async (token: string) => {
      try {
        const profile = await authApi.me();
        setState({ user: profile, accessToken: token, isLoading: false });
        if (profile.locale && i18n.language !== profile.locale) {
          await i18n.changeLanguage(profile.locale);
        }
      } catch {
        handleUnauthorized();
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

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      const { accessToken } = await authApi.login(credentials);
      setAccessToken(accessToken);
      await loadProfile(accessToken);
      navigate('/');
    },
    [loadProfile, navigate],
  );

  const register = useCallback(
    async (data: RegisterData) => {
      const { accessToken } = await authApi.register(data);
      setAccessToken(accessToken);
      await loadProfile(accessToken);
      navigate('/');
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
    navigate('/login');
  }, [navigate]);

  const value = useMemo(
    () => ({ ...state, login, register, logout, refresh: refreshSession }),
    [state, login, register, logout, refreshSession],
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
