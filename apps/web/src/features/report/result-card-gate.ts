import { useSyncExternalStore } from 'react';

/**
 * While the short result card of a finished mission is waiting or open, the story's guide holds their lines: the pilot sees
 * how the mission went first, then hears the guide. The director raises the hold when a flight arrives; the report page lowers
 * it when the card is closed (or when there is no card to show).
 */
let held = false;
/** The card has opened since the hold was raised: it is then the pilot's to close, however long they read. */
let cardShown = false;
const listeners = new Set<() => void>();

export function holdForResultCard(on: boolean): void {
  if (held === on) return;
  held = on;
  if (on) cardShown = false;
  listeners.forEach((listener) => listener());
}

/** The result card is on the screen. */
export function noteResultCardShown(): void {
  cardShown = true;
}

/**
 * A safety net for a report that never opens a card: after a while the guide is let in, unless the card is on the screen
 * (then only closing it lets the guide in).
 */
export function releaseUnlessCardShown(): void {
  if (!cardShown) holdForResultCard(false);
}

export function useResultCardHeld(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => held,
    () => false,
  );
}
