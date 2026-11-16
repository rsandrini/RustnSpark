/** How the new-pilot opening ended: the pilot played it through or skipped it. */
export const PROLOGUE_OUTCOMES = ['played', 'skipped'] as const;
export type PrologueOutcome = (typeof PROLOGUE_OUTCOMES)[number];

const PERCENT = 100;

/**
 * The opening's payouts: each share of what the pilot has to spend in the opening (the refuel, module, repair and hull
 * upgrade), rounded down, with the last one taking the rounding remainder, so the payouts add up to exactly
 * `refuelCost + moduleCost + upgradeCost + repairCost`. The missions pay what jobs of this size really pay: the pilot
 * reaches the last mission with the purse they began with, and the rest of the start credits arrive after the rescue
 * (the server credits them when the opening ends, whether it was played or skipped).
 */
export function prologuePayouts(
  refuelCost: number,
  moduleCost: number,
  upgradeCost: number,
  shares: readonly number[],
  repairCost = 0,
): number[] {
  const pool = refuelCost + moduleCost + upgradeCost + repairCost;
  const payouts = shares.map((share) => Math.floor((pool * share) / PERCENT));
  if (payouts.length === 0) return payouts;
  const paid = payouts.reduce((sum, payout) => sum + payout, 0);
  payouts[payouts.length - 1] = (payouts[payouts.length - 1] ?? 0) + (pool - paid);
  return payouts;
}
