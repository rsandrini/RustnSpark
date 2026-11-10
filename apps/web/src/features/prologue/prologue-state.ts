import { useSyncExternalStore } from 'react';

/**
 * The steps of the new-pilot opening, in order. Where the pilot is stays in the browser, per account (the server only
 * knows how the opening ENDED: `Player.prologueOutcome`). The opening after the last step is the faction picker.
 */
export const PROLOGUE_STEPS = [
  'gift',
  'fit-engine',
  'race-board',
  'race',
  'stop-one',
  'offer-run-1',
  'fit-cargo',
  'stop-two',
  'offer-run-2',
  'final-board',
  'final-run',
  'loss',
  'rescue',
] as const;

export type StepId = (typeof PROLOGUE_STEPS)[number];

export const FIRST_STEP: StepId = PROLOGUE_STEPS[0];

/** The step after `step`, or null when it was the last one (the story is over). */
export function nextStep(step: StepId): StepId | null {
  return PROLOGUE_STEPS[PROLOGUE_STEPS.indexOf(step) + 1] ?? null;
}

const listeners = new Set<() => void>();
const cache = new Map<string, StepId>();

const storageKey = (playerId: string) => `rs.prologue.${playerId}`;

function isStep(value: unknown): value is StepId {
  return typeof value === 'string' && (PROLOGUE_STEPS as readonly string[]).includes(value);
}

function read(playerId: string): StepId {
  const cached = cache.get(playerId);
  if (cached !== undefined) return cached;
  let step: StepId = FIRST_STEP;
  try {
    const raw = window.localStorage.getItem(storageKey(playerId));
    if (isStep(raw)) step = raw;
  } catch {
    // storage blocked or unreadable: start from the top
  }
  cache.set(playerId, step);
  return step;
}

/** Forgets what was read from the browser's storage (tests clear the storage between cases). */
export function clearPrologueSteps(): void {
  cache.clear();
  listeners.forEach((listener) => listener());
}

export function writeStep(playerId: string, step: StepId): void {
  cache.set(playerId, step);
  try {
    window.localStorage.setItem(storageKey(playerId), step);
  } catch {
    // the step still holds for this session
  }
  listeners.forEach((listener) => listener());
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
    () => (playerId === undefined ? FIRST_STEP : read(playerId)),
    () => FIRST_STEP,
  );
}
