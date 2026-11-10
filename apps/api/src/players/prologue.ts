/** How the new-pilot opening ended: the pilot played it through or skipped it. */
export const PROLOGUE_OUTCOMES = ['played', 'skipped'] as const;
export type PrologueOutcome = (typeof PROLOGUE_OUTCOMES)[number];

const PERCENT = 100;

/**
 * The opening's payouts: each share of the starting credits, rounded down, with the last one taking the rounding
 * remainder, so the payouts always add up to exactly `startCredits` (a pilot who skips the opening starts with the same
 * money as one who played it).
 */
export function prologuePayouts(startCredits: number, shares: readonly number[]): number[] {
  const payouts = shares.map((share) => Math.floor((startCredits * share) / PERCENT));
  if (payouts.length === 0) return payouts;
  const paid = payouts.reduce((sum, payout) => sum + payout, 0);
  payouts[payouts.length - 1] = (payouts[payouts.length - 1] ?? 0) + (startCredits - paid);
  return payouts;
}
