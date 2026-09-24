import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';

/**
 * Per-leg encounter chance (D17): `danger / chance_divisor`, multiplied by
 * `escort.encounter_multiplier` on escort legs (Appendix E — escort).
 */
export function encounterChance(danger: number, rules: GameRules, escortLeg: boolean): number {
  const base = danger / rules.encounter.chance_divisor;
  return escortLeg ? base * rules.escort.encounter_multiplier : base;
}

/** Zones 0–1 produce no PvP; the gate runs before the policy tree (S5.4 / S7.5). */
export function pvpAllowed(zone: number): boolean {
  return zone > 1;
}

/** One `float()` draw; a chance of 0 never triggers (float is in [0, 1)). */
export function rollEncounter(chance: number, rng: Rng): boolean {
  return rng.float() < chance;
}
