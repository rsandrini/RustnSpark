import { useEffect, useRef, useState } from 'react';

/** How long the wallet keeps its pulse and the amount floats. */
const WALLET_ANSWER_MS = 1400;

/**
 * The wallet answers every change of the pilot's credits (a purchase, a repair, a reward): a pulse and the amount
 * floating up from it. The first value is not a change, and nothing moves when it is the same.
 */
export function useWalletAnswer(
  credits: number | undefined,
  format: (amount: number) => string,
): { pulse: boolean; delta: string | null; key: number } {
  const last = useRef<number | undefined>(undefined);
  const [answer, setAnswer] = useState<{ delta: string; key: number } | null>(null);
  useEffect(() => {
    const before = last.current;
    last.current = credits;
    if (before === undefined || credits === undefined || before === credits) return undefined;
    setAnswer((current) => ({ delta: format(credits - before), key: (current?.key ?? 0) + 1 }));
    const timer = window.setTimeout(() => setAnswer(null), WALLET_ANSWER_MS);
    return () => window.clearTimeout(timer);
    // `format` changes with the language only; the answer is about the credits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credits]);
  return { pulse: answer !== null, delta: answer?.delta ?? null, key: answer?.key ?? 0 };
}
