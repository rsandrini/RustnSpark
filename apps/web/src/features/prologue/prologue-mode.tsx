import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { client, setApiInterceptor } from '../../api/client';
import { useAuth } from '../auth/auth.hooks';
import { sandboxInterceptor } from './sandbox/sandbox-api';
import { createSandbox, type Sandbox } from './sandbox/sandbox-state';

/** What the server says about the opening's numbers (the sandbox is built from it). */
interface PrologueConfig {
  startCredits: number;
  refuelCost: number;
  purse?: number;
  moduleCost?: number;
  payouts: number[];
}

/** Defaults until the server sends its own (the opening's purse and module price). */
const DEFAULT_PURSE = 300;
const DEFAULT_MODULE_COST = 800;

/**
 * While the new-pilot opening runs on the sandbox (the real screens over a fake server in the browser), the build must
 * opt in: `VITE_PROLOGUE_SANDBOX=1`. It stays off until the director that tells the story is in, so the game keeps
 * working in between.
 */
export function sandboxEnabled(): boolean {
  return import.meta.env.VITE_PROLOGUE_SANDBOX === '1';
}

export interface PrologueMode {
  /** The pilot is in the opening: the game's real screens are answered by the sandbox. */
  readonly active: boolean;
  readonly sandbox: Sandbox | null;
  /** The routes the nav lets the pilot open (null = all of them). The director narrows it step by step. */
  readonly allowedPaths: readonly string[] | null;
  readonly setAllowedPaths: (paths: readonly string[] | null) => void;
}

const INACTIVE: PrologueMode = {
  active: false,
  sandbox: null,
  allowedPaths: null,
  setAllowedPaths: () => {},
};

const PrologueModeContext = createContext<PrologueMode>(INACTIVE);

export function usePrologueMode(): PrologueMode {
  return useContext(PrologueModeContext);
}

/**
 * Puts the pilot in the opening when the server says it has not ended (no faction yet, saved outcome null): it reads the
 * opening's numbers from the real API, builds the sandbox and installs the fake server on the API client. It takes both
 * away (and forgets everything the real screens cached from the fake server) as soon as the opening is over.
 */
export function PrologueModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const wants =
    sandboxEnabled() && user != null && user.factionId == null && user.prologueOutcome === null;
  const [sandbox, setSandbox] = useState<Sandbox | null>(null);
  const [allowedPaths, setAllowedPaths] = useState<readonly string[] | null>(null);
  const profile =
    user == null ? null : { id: user.id, name: user.name, locale: user.locale, role: user.role };

  useEffect(() => {
    if (!wants || profile === null) return undefined;
    let cancelled = false;
    let installed = false;
    void client.get<PrologueConfig>('/v1/players/me/prologue').then((config) => {
      if (cancelled) return;
      const next = createSandbox({
        payouts: config.payouts,
        purse: config.purse ?? DEFAULT_PURSE,
        refuelCost: config.refuelCost,
        moduleCost: config.moduleCost ?? DEFAULT_MODULE_COST,
        profile,
      });
      // what the real screens may already have cached from the real server must not leak in
      queryClient.clear();
      setApiInterceptor(sandboxInterceptor(next));
      installed = true;
      setSandbox(next);
    });
    return () => {
      cancelled = true;
      if (installed) {
        setApiInterceptor(null);
        // nothing the fake server said may outlive it
        queryClient.clear();
      }
      setSandbox(null);
    };
    // the pilot's identity is what the sandbox is made for; a new profile object must not rebuild it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wants, user?.id]);

  const value = useMemo<PrologueMode>(
    () =>
      sandbox === null
        ? { ...INACTIVE, setAllowedPaths }
        : { active: true, sandbox, allowedPaths, setAllowedPaths },
    [sandbox, allowedPaths],
  );

  // until the sandbox is ready the screens must not ask the real server for a pilot who has no ship
  if (wants && sandbox === null) return null;
  return <PrologueModeContext.Provider value={value}>{children}</PrologueModeContext.Provider>;
}
