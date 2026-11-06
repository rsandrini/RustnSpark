/**
 * A guest pilot has no email or password: the browser keeps a random key and signs the guest back in with it.
 * Clearing the browser's data loses the key, and with it the pilot (unless it was saved with an email).
 */
const GUEST_KEY = 'rs.guestKey';

export function readGuestKey(): string | null {
  try {
    return window.localStorage.getItem(GUEST_KEY);
  } catch {
    return null;
  }
}

export function writeGuestKey(key: string): void {
  try {
    window.localStorage.setItem(GUEST_KEY, key);
  } catch {
    // storage blocked: the guest keeps playing until the session ends
  }
}

export function clearGuestKey(): void {
  try {
    window.localStorage.removeItem(GUEST_KEY);
  } catch {
    // nothing to clear
  }
}
