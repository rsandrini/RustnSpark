import { useEffect, useSyncExternalStore } from 'react';

/** The "visit" steps: ticked when the pilot opens that screen or tab. Kept in the browser, per account;
    whether the tutorial is skipped or finished lives on the server (the player's `tutorialDone`). */
export type VisitKey = 'yard' | 'report' | 'repair' | 'refuel' | 'scavenging' | 'mining';

const VISIT_KEYS: readonly VisitKey[] = [
  'yard',
  'report',
  'repair',
  'refuel',
  'scavenging',
  'mining',
];

const listeners = new Set<() => void>();
const cache = new Map<string, readonly VisitKey[]>();

const storageKey = (playerId: string) => `rs.tutorial.${playerId}`;

function read(playerId: string): readonly VisitKey[] {
  const cached = cache.get(playerId);
  if (cached !== undefined) return cached;
  let visited: VisitKey[] = [];
  try {
    const raw = window.localStorage.getItem(storageKey(playerId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (Array.isArray(parsed)) {
      visited = VISIT_KEYS.filter((key) => parsed.includes(key));
    }
  } catch {
    // storage blocked or unreadable: start with nothing visited
  }
  cache.set(playerId, visited);
  return visited;
}

export function markVisited(playerId: string, key: VisitKey): void {
  const current = read(playerId);
  if (current.includes(key)) return;
  const next = [...current, key];
  cache.set(playerId, next);
  try {
    window.localStorage.setItem(storageKey(playerId), JSON.stringify(next));
  } catch {
    // the tick still shows for this session
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The steps this pilot has opened so far. */
export function useVisited(playerId: string | undefined): readonly VisitKey[] {
  return useSyncExternalStore(
    subscribe,
    () => (playerId === undefined ? [] : read(playerId)),
    () => [],
  );
}

/** Call from a screen: opening it ticks the matching tutorial step. A null key does nothing. */
export function useTutorialVisit(playerId: string | undefined, key: VisitKey | null): void {
  useEffect(() => {
    if (playerId !== undefined && key !== null) markVisited(playerId, key);
  }, [playerId, key]);
}
