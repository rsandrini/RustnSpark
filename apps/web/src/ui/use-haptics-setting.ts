import { useSyncExternalStore } from 'react';

const KEY = 'rs.haptics';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

// One store for every caller (the menu toggle and `haptic()`): a change is seen at once everywhere, and the
// browser's storage is the source of truth across tabs and visits.
let snapshot = read();
const listeners = new Set<() => void>();

function emit(next: boolean) {
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === KEY) emit(read());
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    emit(read());
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

function setHaptics(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Storage unavailable: the choice lasts until the page is closed.
  }
  emit(on);
}

/** Whether haptics are on right now (read synchronously by `haptic()`). */
export function hapticsEnabled(): boolean {
  return listeners.size > 0 ? snapshot : read();
}

/** The pilot's haptics choice (default on), kept in this browser. */
export function useHapticsSetting(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, () => snapshot), setHaptics];
}
