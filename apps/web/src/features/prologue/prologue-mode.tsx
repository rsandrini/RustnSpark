import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { client, setApiInterceptor } from '../../api/client';
import { useAuth } from '../auth/auth.hooks';
import { sandboxInterceptor } from './sandbox/sandbox-api';
import { createSandbox, type Sandbox } from './sandbox/sandbox-state';
import { friendOf, type Guide } from './director/lines';
import { restoreSandbox } from './director/restore';
import { readSaved } from './prologue-state';

/** What the server says about the opening's numbers (the sandbox is built from it). */
interface PrologueConfig {
  startCredits: number;
  refuelCost: number;
  purse?: number;
  moduleCost?: number;
  upgradeCost?: number;
  repairCost?: number;
  payouts: number[];
  guides?: Guide[];
}

/** Defaults until the server sends its own (the opening's purse and module price). */
const DEFAULT_PURSE = 300;
const DEFAULT_MODULE_COST = 800;
const DEFAULT_UPGRADE_COST = 200;
const DEFAULT_REPAIR_COST = 100;

/**
 * The new-pilot opening runs on the sandbox (the real screens over a fake server in the browser). A build can switch it
 * off with `VITE_PROLOGUE_SANDBOX=0`: the pilot then goes straight to the faction picker.
 */
export function sandboxEnabled(): boolean {
  return import.meta.env.VITE_PROLOGUE_SANDBOX !== '0';
}

export interface PrologueMode {
  /** The pilot is in the opening: the game's real screens are answered by the sandbox. */
  readonly active: boolean;
  readonly sandbox: Sandbox | null;
  /** The routes the nav lets the pilot open (null = all of them). The director narrows it step by step. */
  readonly allowedPaths: readonly string[] | null;
  /** The guides who speak the story (from the Admin), and the friend's name. */
  readonly guides: readonly Guide[];
  readonly friendName: string;
  readonly setAllowedPaths: (paths: readonly string[] | null) => void;
}

const INACTIVE: PrologueMode = {
  active: false,
  sandbox: null,
  allowedPaths: null,
  guides: [],
  friendName: '',
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
  const { user, reloadProfile } = useAuth();
  const reloadProfileRef = useRef(reloadProfile);
  reloadProfileRef.current = reloadProfile;
  const queryClient = useQueryClient();
  const wants =
    sandboxEnabled() && user != null && user.factionId == null && user.prologueOutcome === null;
  const [sandbox, setSandbox] = useState<Sandbox | null>(null);
  const [allowedPaths, setAllowedPaths] = useState<readonly string[] | null>(null);
  const [guides, setGuides] = useState<readonly Guide[]>([]);
  // the server could not be asked: the pilot goes on to the faction picker instead of waiting on a story that cannot start
  const [failed, setFailed] = useState(false);
  const profile =
    user == null
      ? null
      : {
          id: user.id,
          name: user.name,
          locale: user.locale,
          role: user.role,
          isGuest: user.isGuest === true,
        };

  useEffect(() => {
    if (!wants || profile === null) return undefined;
    let cancelled = false;
    let installed = false;
    void client
      .get<PrologueConfig>('/v1/players/me/prologue')
      .then((config) => {
        if (cancelled) return;
        const found = config.guides ?? [];
        const next = createSandbox({
          friendName: friendOf(found)?.name,
          // the engine is the friend's to give: it is in the hold only once the pilot has taken it
          engineWaits: true,
          payouts: config.payouts,
          purse: config.purse ?? DEFAULT_PURSE,
          startCredits: config.startCredits,
          refuelCost: config.refuelCost,
          moduleCost: config.moduleCost ?? DEFAULT_MODULE_COST,
          upgradeCost: config.upgradeCost ?? DEFAULT_UPGRADE_COST,
          repairCost: config.repairCost ?? DEFAULT_REPAIR_COST,
          profile,
        });
        // back where the pilot left the story (a closed tab): the ship, the money and the jobs as they were then
        const saved = readSaved(profile.id);
        restoreSandbox(next, saved.step, saved.kind);
        // what the real screens may already have cached from the real server must not leak in
        queryClient.clear();
        setGuides(found);
        setApiInterceptor(sandboxInterceptor(next));
        installed = true;
        setSandbox(next);
        // the wallet the screens show is the profile's: it was read before the story's fake server was in place, so it
        // still holds the real account's credits (zero, after a reload) until it is read again from the sandbox
        void reloadProfileRef.current();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
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
        : {
            active: true,
            sandbox,
            allowedPaths,
            guides,
            friendName: friendOf(guides)?.name ?? '',
            setAllowedPaths,
          },
    [sandbox, allowedPaths, guides],
  );

  // until the sandbox is ready the screens must not ask the real server for a pilot who has no ship
  if (wants && sandbox === null && !failed) return null;
  return <PrologueModeContext.Provider value={value}>{children}</PrologueModeContext.Provider>;
}
