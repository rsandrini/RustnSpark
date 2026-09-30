import { stableUnit } from './deterministic.js';

/**
 * Whether a catalog part type is "in stock" in a location's new-parts shelf today (round-5
 * backlog: "almost nothing rare, epic really 1%, legendary no way" — high-rarity parts should be
 * scarce or absent from the market, obtainable mainly through drops or the upgrade mechanic).
 * Deterministic per (location, day, part type) the same way the used-parts shelf already rolls
 * (`used-offers.ts`'s `usedOffer`) — market() lists it and buy() re-derives it, so a listing and
 * its purchase can never disagree about whether it was ever actually on the shelf that day.
 */
export function inStockToday(
  locationId: string,
  day: string,
  partType: string,
  rarity: string,
  chanceByRarity: Readonly<Record<string, number>>,
): boolean {
  const chance = chanceByRarity[rarity] ?? 1;
  if (chance >= 1) return true;
  if (chance <= 0) return false;
  return stableUnit(`market-stock:${locationId}:${day}:${partType}`) < chance;
}
