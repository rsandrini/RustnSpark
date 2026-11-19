import { useSyncExternalStore } from 'react';

/**
 * The hand-over from the opening to the faction page. The opening ends on black, but the opening's own layers go away
 * before the faction page is up (the game's screens show for a moment in between), so the black is a curtain that lives
 * above the whole app: the director raises it when the story is played out, the faction page lifts it once it is on the
 * screen and it fades away. A safety timer lifts it too, so a page that never comes cannot hold the screen black.
 */
export type CurtainState = 'down' | 'up' | 'lifting';

const LIFT_MS = 1800;
const SAFETY_MS = 15000;

let state: CurtainState = 'down';
let timer: number | undefined;
const listeners = new Set<() => void>();

function set(next: CurtainState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function raiseCurtain(): void {
  window.clearTimeout(timer);
  set('up');
  timer = window.setTimeout(liftCurtain, SAFETY_MS);
}

/** The faction page is up: the curtain fades away. */
export function liftCurtain(): void {
  if (state !== 'up') return;
  window.clearTimeout(timer);
  set('lifting');
  timer = window.setTimeout(() => set('down'), LIFT_MS);
}

/** Puts the curtain down at once (tests clear it between cases). */
export function resetCurtain(): void {
  window.clearTimeout(timer);
  set('down');
}

export function useCurtain(): CurtainState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => 'down',
  );
}
