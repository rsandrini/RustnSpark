import { useEffect, useRef, useState } from 'react';

/** The count runs in this many steps over about COUNT_MS; the flash lasts FLASH_MS. */
const COUNT_MS = 600;
const STEP_MS = 30;
const FLASH_MS = 900;

export interface CountUpOptions {
  durationMs?: number;
  stepMs?: number;
  /** Where the first count starts when `animateOnMount` is on (default 0). */
  from?: number;
  /** Count from `from` to `value` on the first render too (default: the first render shows the value as is). */
  animateOnMount?: boolean;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * The number to show for `value`: when it changes it counts from the number on screen to the new one (ease-out
 * by steps, ends exactly on it), and `direction` says rise or fall until the flash is over. A newer value takes
 * over from the displayed number. With reduced motion the value is shown at once.
 */
export function useCountUp(
  value: number,
  options: CountUpOptions = {},
): { shown: number; direction: 'rise' | 'fall' | null } {
  const { durationMs = COUNT_MS, stepMs = STEP_MS, from, animateOnMount = false } = options;
  const start = animateOnMount ? (from ?? 0) : value;
  const [shown, setShown] = useState(start);
  const [direction, setDirection] = useState<'rise' | 'fall' | null>(null);
  const current = useRef(start);

  useEffect(() => {
    const begin = current.current;
    if (begin === value) return undefined;
    if (prefersReducedMotion()) {
      current.current = value;
      setShown(value);
      return undefined;
    }
    setDirection(value > begin ? 'rise' : 'fall');
    const steps = Math.max(1, Math.round(durationMs / stepMs));
    let step = 0;
    const counter = window.setInterval(() => {
      step += 1;
      // ease-out: fast at first, settling on the target
      const eased = 1 - (1 - step / steps) ** 2;
      const next = step >= steps ? value : Math.round(begin + (value - begin) * eased);
      current.current = next;
      setShown(next);
      if (step >= steps) window.clearInterval(counter);
    }, stepMs);
    const flasher = window.setTimeout(() => setDirection(null), FLASH_MS);
    return () => {
      window.clearInterval(counter);
      window.clearTimeout(flasher);
    };
  }, [value, durationMs, stepMs]);

  return { shown, direction };
}
