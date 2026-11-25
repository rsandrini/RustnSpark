import { hapticsEnabled } from './use-haptics-setting';

export type HapticKind = 'tap' | 'success' | 'warn' | 'error';

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 15,
  success: [20, 40, 30],
  warn: 40,
  error: [60, 40, 60],
};

/** A short buzz where the browser allows it (Android; iPhones do not support it); never throws. */
export function haptic(kind: HapticKind): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (!hapticsEnabled()) return;
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // not available here
  }
}
