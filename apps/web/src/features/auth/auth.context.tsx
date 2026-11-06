import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, setAccessToken, setOnUnauthorized } from '../../api/client';
import { authApi } from './auth.api';
import { clearGuestKey, readGuestKey, writeGuestKey } from './guest-key';
import type { ClaimData, LoginCredentials, RegisterData, UserProfile } from './auth.types';

interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  isLoading: boolean;
}

/** Why a stored guest key no longer works: the pilot was frozen after a long time away, or cannot be found. */
export type GuestLost = 'frozen' | 'gone';

interface AuthContextValue extends AuthState {
  /** Set when the browser's guest key was refused; the sign-in page explains it. */
  guestLost: GuestLost | null;
  /** Starts a guest pilot (no email, no password) and goes to the faction choice. */
  playAsGuest: () => Promise<void>;
  /** Saves the guest pilot with an email and password; nothing the pilot owns moves. */
  claimPilot: (data: ClaimData) => Promise<void>;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Re-reads the profile (wallet, faction) without touching the session tokens. */
  reloadProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// The refresh cookie is httpOnly, so the page cannot see whether a session exists; asking costs a
// request that answers 401 (and the browser logs it in red) for every signed-out visitor. Once we
// KNOW there is no session (sign-out, or a refresh that failed), remember it and skip the probe
// until the next sign-in. Absent = unknown = ask, so nobody with a live cookie is locked out.
const SIGNED_OUT_KEY = 'rs.signedOut';

function knownSignedOut(): boolean {
  try {
    return window.localStorage.getItem(SIGNED_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSignedOut(signedOut: boolean): void {
  try {
    if (signedOut) window.localStorage.setItem(SIGNED_OUT_KEY, '1');
    else window.localStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // storage blocked: the probe simply keeps running
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
  });

  const [guestLost, setGuestLost] = useState<GuestLost | null>(null);
  const resuming = useRef(false);

  // Another pilot's ship, parts and scenes must never survive a sign-in or sign-out: a cached inventory from the
  // previous account made auto layout send parts the new pilot does not own (403).
  const queryClient = useQueryClient();

  const clearSession = useCallback(() => {
    queryClient.clear();
    rememberSignedOut(true);
    setAccessToken(null);
    setState({ user: null, accessToken: null, isLoading: false });
  }, [queryClient]);

  const applyProfile = useCallback(
    async (profile: UserProfile, token: string) => {
      rememberSignedOut(false);
      setState({ user: profile, accessToken: token, isLoading: false });
      if (profile.locale && i18n.language !== profile.locale) {
        await i18n.changeLanguage(profile.locale);
      }
    },
    [i18n],
  );

  // A guest signs back in with the key its browser kept. A key the server refuses (frozen, unknown) is
  // forgotten and remembered as lost, so the sign-in page can say why. A network failure keeps the key.
  const resumeWithKey = useCallback(
    async (key: string): Promise<boolean> => {
      try {
        const { accessToken } = await authApi.resumeGuest(key);
        setAccessToken(accessToken);
        const profile = await authApi.me();
        await applyProfile(profile, accessToken);
        setGuestLost(null);
        return true;
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          clearGuestKey();
          setGuestLost(error.code === 'GUEST_FROZEN' ? 'frozen' : 'gone');
        }
        return false;
      }
    },
    [applyProfile],
  );

  // A session that died mid-use (an API call answered 401 and the silent refresh failed): a guest
  // signs straight back in with its key; anyone else is cleared and sent to sign in.
  const handleUnauthorized = useCallback(() => {
    const key = readGuestKey();
    if (key !== null && !resuming.current) {
      resuming.current = true;
      void resumeWithKey(key).then((resumed) => {
        resuming.current = false;
        if (!resumed) {
          clearSession();
          void navigate('/login');
        }
      });
      return;
    }
    clearSession();
    void navigate('/login');
  }, [clearSession, navigate, resumeWithKey]);

  useEffect(() => {
    setOnUnauthorized(handleUnauthorized);
  }, [handleUnauthorized]);

  const loadProfile = useCallback(
    async (token: string): Promise<UserProfile | null> => {
      try {
        const profile = await authApi.me();
        await applyProfile(profile, token);
        return profile;
      } catch {
        handleUnauthorized();
        return null;
      }
    },
    [applyProfile, handleUnauthorized],
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

  // First load: try to restore a session from the refresh cookie. A visitor with no session is
  // simply signed out — NOT redirected: /login and /register are public, and the protected
  // routes send signed-out players to /login themselves (ProtectedRoute).
  useEffect(() => {
    void (async () => {
      const key = readGuestKey();
      if (knownSignedOut() && key === null) {
        clearSession();
        return;
      }
      if (!knownSignedOut()) {
        try {
          const { accessToken } = await authApi.refresh();
          setAccessToken(accessToken);
          await loadProfile(accessToken);
          return;
        } catch {
          // no live session: a guest's key may still sign it in
        }
      }
      if (key !== null && (await resumeWithKey(key))) return;
      clearSession();
    })();
    // Runs once on mount; the callbacks are stable for the provider's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      queryClient.clear();
      setAccessToken(accessToken);
      const profile = await loadProfile(accessToken);
      // loadProfile already sent the player back to /login when the profile failed to
      // load; navigating again here would override that redirect.
      if (profile === null) return;
      // A pilot without a faction has no ship yet: onboarding first (S10.2).
      void navigate(profile.factionId ? '/' : '/onboarding');
    },
    [loadProfile, navigate, queryClient],
  );

  const register = useCallback(
    async (data: RegisterData) => {
      const { accessToken } = await authApi.register(data);
      queryClient.clear();
      setAccessToken(accessToken);
      const profile = await loadProfile(accessToken);
      if (profile === null) return;
      void navigate('/onboarding');
    },
    [loadProfile, navigate, queryClient],
  );

  const playAsGuest = useCallback(async () => {
    const started = await authApi.startGuest(i18n.language.startsWith('pt') ? 'pt-BR' : 'en');
    queryClient.clear();
    writeGuestKey(started.guestKey);
    setGuestLost(null);
    setAccessToken(started.accessToken);
    const profile = await loadProfile(started.accessToken);
    if (profile === null) return;
    void navigate('/onboarding');
  }, [i18n.language, loadProfile, navigate, queryClient]);

  const claimPilot = useCallback(
    async (data: ClaimData) => {
      const saved = await authApi.claim(data);
      // The same pilot, now with an email: the key is retired and nothing else changes.
      clearGuestKey();
      setAccessToken(saved.accessToken);
      await applyProfile(saved.player, saved.accessToken);
    },
    [applyProfile],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout failures; the session cookie will expire anyway.
    }
    // Signing out on purpose forgets the guest key too (the caller asked the guest first).
    clearGuestKey();
    queryClient.clear();
    setAccessToken(null);
    setState({ user: null, accessToken: null, isLoading: false });
    void navigate('/login');
  }, [navigate, queryClient]);

  const value = useMemo(
    () => ({
      ...state,
      guestLost,
      playAsGuest,
      claimPilot,
      login,
      register,
      logout,
      refresh: refreshSession,
      reloadProfile,
    }),
    [
      state,
      guestLost,
      playAsGuest,
      claimPilot,
      login,
      register,
      logout,
      refreshSession,
      reloadProfile,
    ],
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
