import type { GameRules } from '../config/game-config.types.js';

/**
 * Pure reward math (D13 / GDD §12). Production payout is
 * `base × integrity`, linear from 100% down to the floor and zero below it;
 * mining is yield-based and never uses the integrity multiplier.
 */

export interface RewardBaseInput {
  readonly tier: number;
  readonly danger: number;
  readonly distance: number;
  /** Mission type key into `economy.reward_type_bonus` (case-insensitive). */
  readonly missionType: string;
}

/**
 * D13 validated base (sim form, before the integrity multiplier):
 * `(reward_base + tier × reward_per_tier) × (1 + danger / reward_danger_divisor)
 *  × (1 + (distance − reward_distance_ref) / reward_distance_divisor) × type_bonus`.
 */
export function rewardBase(input: RewardBaseInput, rules: GameRules): number {
  const e = rules.economy;
  const tierBase = e.reward_base + input.tier * e.reward_per_tier;
  const dangerMod = 1 + input.danger / e.reward_danger_divisor;
  const distanceMod = 1 + (input.distance - e.reward_distance_ref) / e.reward_distance_divisor;
  const typeBonus = e.reward_type_bonus[input.missionType.toLowerCase()] ?? 1;
  return tierBase * dangerMod * distanceMod * typeBonus;
}

/**
 * Integrity multiplier: linear `integrity / 100` at or above the floor
 * (`payout_floor_integrity × 100`, i.e. 50), hard zero below (GDD §12).
 */
export function integrityMultiplier(integrity: number, rules: GameRules): number {
  const floorPoints = rules.economy.payout_floor_integrity * 100;
  if (integrity < floorPoints) {
    return 0;
  }
  return integrity / 100;
}

/**
 * Payout for a mission whose payment follows object integrity.
 * Mining must not call this — see `contractedMiningPayout`.
 */
export function integrityPayout(base: number, integrity: number, rules: GameRules): number {
  return base * integrityMultiplier(integrity, rules);
}

/**
 * Contracted mining pays its fixed base only when the required quantity was
 * mined; otherwise the mission is a partial failure and pays nothing
 * (GDD §12 / design missoes §4). Free mining pays nothing here — the player
 * sells the ore.
 */
export function contractedMiningPayout(base: number, settled: boolean): number {
  return settled ? base : 0;
}
