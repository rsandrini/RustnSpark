import { useCallback, useEffect, useState } from 'react';

/** Milliseconds per character: quick enough not to make anyone wait, slow enough to read as speech. */
const MS_PER_CHAR = 22;

/** True when the pilot asked the system for less motion; false where `matchMedia` does not exist (tests). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * The text of a dialogue node appearing letter by letter. `finish()` shows the rest at once (a click or a key);
 * with reduced motion the whole text is there from the start. The text is the same string either way: the effect is
 * only what the eye sees (the box keeps the full text for screen readers).
 */
export function useTypewriter(
  text: string,
  enabled: boolean,
): {
  shown: string;
  done: boolean;
  finish: () => void;
} {
  const instant = !enabled || prefersReducedMotion();
  const [count, setCount] = useState(instant ? text.length : 0);

  useEffect(() => {
    if (instant) {
      setCount(text.length);
      return undefined;
    }
    setCount(0);
    const timer = window.setInterval(() => {
      setCount((was) => {
        if (was + 1 >= text.length) window.clearInterval(timer);
        return Math.min(text.length, was + 1);
      });
    }, MS_PER_CHAR);
    return () => window.clearInterval(timer);
  }, [text, instant]);

  const finish = useCallback(() => setCount(text.length), [text]);
  return { shown: text.slice(0, count), done: count >= text.length, finish };
}
