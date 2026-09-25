import { useRef } from 'react';
import { newIdempotencyKey } from './client';

/**
 * One Idempotency-Key per player intent (R21). Spending POSTs must carry a key, and a
 * retry of the SAME action must reuse it so a lost response can never charge twice; a
 * DIFFERENT action (other listing, other repair targets) must get a fresh key or the
 * server rejects the reused key against its stored body hash.
 *
 * `keyFor(signature)` returns the current key while the signature is unchanged and mints
 * a new one when it changes; `clear()` drops it after a success so the next purchase of
 * the same thing is a new action.
 */
export function useIntentKey(): { keyFor: (signature: string) => string; clear: () => void } {
  const current = useRef<{ signature: string; key: string } | null>(null);
  return {
    keyFor(signature: string): string {
      if (current.current?.signature !== signature) {
        current.current = { signature, key: newIdempotencyKey() };
      }
      return current.current.key;
    },
    clear(): void {
      current.current = null;
    },
  };
}
