import type { GameRules } from '../config/game-config.types.js';
import { roundHalfEven } from '../resolution/numeric/round-half-even.js';

/**
 * GDD §9 `fator_local` = isolation × faction (mood is applied by the price
 * calculator in S8, not by repair/fuel). The parity harness pins this to 1.0
 * because the sim has no geography.
 */
export function locationFactor(
  isolation: number,
  factionRelation: string,
  rules: GameRules,
): number {
  const faction = rules.economy.faction_mult[factionRelation] ?? 1;
  return isolation * faction;
}

export interface RepairPartInput {
  readonly basePrice: number;
  readonly fromCondition: number;
  readonly toCondition: number;
}

/**
 * Repair cost for one action (plan S5.8 / sim `uma_vida` form):
 * `Σ basePrice × conditionLost% × repair_factor × repair_price / repair_price_ref`
 * `+ tier × maintenance_per_tier`, then × location factor.
 *
 * `conditionLost%` is `(toCondition − fromCondition) / 100` (the sim repairs
 * a ship-wide condition to 100, so that is `(100 − cond) / 100`).
 */
export function repairCost(
  parts: readonly RepairPartInput[],
  tier: number,
  isolation: number,
  factionRelation: string,
  rules: GameRules,
): number {
  const e = rules.economy;
  const priceRatio = e.repair_price / e.repair_price_ref;
  let partsSum = 0;
  for (const part of parts) {
    const conditionLost = Math.max(0, part.toCondition - part.fromCondition) / 100;
    partsSum += part.basePrice * conditionLost * e.repair_factor * priceRatio;
  }
  // Sim rounds the parts expression once, then adds maintenance unrounded.
  const base = roundHalfEven(partsSum) + tier * e.maintenance_per_tier;
  return base * locationFactor(isolation, factionRelation, rules);
}
