import { useSyncExternalStore } from 'react';
import { FIRST_STEP, isStepId, type StepId } from './director/steps';
import type { ModuleKind } from './sandbox/sandbox-world';

export type { StepId } from './director/steps';

/**
 * Where the pilot is in the new-pilot opening stays in the browser, per account (the server only knows how the opening
 * ENDED: `Player.prologueOutcome`): the step they are on and the kind of job they chose when they bought the module.
 */
interface Saved {
  step: StepId;
  kind: ModuleKind | null;
}

const listeners = new Set<() => void>();
const cache = new Map<string, Saved>();

const storageKey = (playerId: string) => `rs.prologue.${playerId}`;

function isKind(value: unknown): value is ModuleKind {
  return value === 'passengers' || value === 'crates';
}

function read(playerId: string): Saved {
  const cached = cache.get(playerId);
  if (cached !== undefined) return cached;
  let saved: Saved = { step: FIRST_STEP, kind: null };
  try {
    const raw = window.localStorage.getItem(storageKey(playerId));
    if (raw !== null) {
      // a bare step id is what the first version stored
      if (isStepId(raw)) saved = { step: raw, kind: null };
      else {
        const parsed = JSON.parse(raw) as { step?: unknown; kind?: unknown };
        if (isStepId(parsed.step)) {
          saved = { step: parsed.step, kind: isKind(parsed.kind) ? parsed.kind : null };
        }
      }
    }
  } catch {
    // storage blocked or unreadable: start from the top
  }
  cache.set(playerId, saved);
  return saved;
}

/** Forgets what was read from the browser's storage (tests clear the storage between cases). */
export function clearPrologueSteps(): void {
  cache.clear();
  listeners.forEach((listener) => listener());
}

function write(playerId: string, saved: Saved): void {
  cache.set(playerId, saved);
  try {
    window.localStorage.setItem(storageKey(playerId), JSON.stringify(saved));
  } catch {
    // the step still holds for this session
  }
  listeners.forEach((listener) => listener());
}

export function writeStep(playerId: string, step: StepId): void {
  write(playerId, { ...read(playerId), step });
}

export function writeKind(playerId: string, kind: ModuleKind): void {
  write(playerId, { ...read(playerId), kind });
}

export function readSaved(playerId: string): Saved {
  return read(playerId);
}

/** The opening is over for this pilot (the server has the outcome now): drop the saved step. */
export function forgetStep(playerId: string): void {
  cache.delete(playerId);
  try {
    window.localStorage.removeItem(storageKey(playerId));
  } catch {
    // nothing to remove
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Where this pilot is in the opening. */
export function usePrologueStep(playerId: string | undefined): StepId {
  return useSyncExternalStore(
    subscribe,
    () => (playerId === undefined ? FIRST_STEP : read(playerId).step),
    () => FIRST_STEP,
  );
}
