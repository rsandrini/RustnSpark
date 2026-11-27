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
  /** Rarity of the ship's bridge: scales the payout by `economy.reward_by_bridge` (absent = x1). */
  readonly bridgeRarity?: string;
  /** TRANSPORT: the head count of the group; each head above one adds `missions.transport_pay_per_extra_passenger`. */
  readonly passengers?: unknown;
}

/** The pay multiplier of a passenger group: 1 for one passenger (or none known), growing per extra head. */
export function passengerPayFactor(passengers: unknown, rules: GameRules): number {
  // `?? 0`: an old simulation snapshot predates the knob, and undefined would make the pay NaN.
  const perExtra: number | undefined = rules.missions.transport_pay_per_extra_passenger;
  return 1 + (headCountOf(passengers) - 1) * (perExtra ?? 0);
}

/** The one parse of a head count (the checker and the pay both use it): a positive whole number, else a group of one. */
export function headCountOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}

/** The payout multiplier for a ship's bridge rarity (x1 when the table has no entry). */
export function bridgeRewardMultiplier(bridgeRarity: string | undefined, rules: GameRules): number {
  if (bridgeRarity === undefined) return 1;
  return rules.economy.reward_by_bridge[bridgeRarity] ?? 1;
}

/** The rarity of the bridge among a ship's parts (undefined with no bridge). */
export function bridgeRarityOf(
  parts: readonly { readonly partClass: string; readonly rarity?: string }[],
): string | undefined {
  return parts.find((part) => part.partClass === 'BRIDGE')?.rarity;
}

/** The share of the usual pay a hop of seconds (the test pad's way back) earns; x1 on a normal trip. */
export function shortTripFactor(distance: number, rules: GameRules): number {
  return distance < rules.missions.short_trip_exempt_below
    ? rules.missions.short_trip_reward_factor
    : 1;
}

/**
 * D13 validated base (sim form, before the integrity multiplier):
 * `(reward_base + tier × reward_per_tier) × (1 + danger / reward_danger_divisor)
 *  × (1 + (distance − reward_distance_ref) / reward_distance_divisor) × type_bonus`,
 * then × `reward_by_bridge[bridge rarity]` (the part-price ladder: a better bridge pays more).
 */
export function rewardBase(input: RewardBaseInput, rules: GameRules): number {
  // A trip the pilot asked for pays nothing: it costs fuel and time, nothing more.
  const type = input.missionType.toUpperCase();
  if (type === 'TRAVEL' || type === 'SCAVENGE') return 0;
  const e = rules.economy;
  const tierBase = e.reward_base + input.tier * e.reward_per_tier;
  const dangerMod = 1 + input.danger / e.reward_danger_divisor;
  const distanceMod = 1 + (input.distance - e.reward_distance_ref) / e.reward_distance_divisor;
  const typeBonus = e.reward_type_bonus[input.missionType.toLowerCase()] ?? 1;
  // A hop of seconds (the test pad's way back) pays only a share of the usual reward.
  const shortTrip = shortTripFactor(input.distance, rules);
  return (
    tierBase *
    dangerMod *
    distanceMod *
    typeBonus *
    bridgeRewardMultiplier(input.bridgeRarity, rules) *
    (type === 'TRANSPORT' ? passengerPayFactor(input.passengers, rules) : 1) *
    shortTrip
  );
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
 * Contracted mining pays the contract in proportion to what was delivered (v0.1.3): all of it for
 * the full amount, a share for less, nothing for none. Free mining pays nothing here — the pilot
 * sells the ore.
 */
export function contractedMiningPayout(base: number, delivered: number, required: number): number {
  return sharePayout(base, delivered, required);
}

/** A job paid by the share done: all of `base` for the whole ask or more, a share for less, nothing for none. */
export function sharePayout(base: number, done: number, asked: number): number {
  if (!(asked > 0) || !(done > 0) || !Number.isFinite(base)) return 0;
  return base * Math.min(1, done / asked);
}
