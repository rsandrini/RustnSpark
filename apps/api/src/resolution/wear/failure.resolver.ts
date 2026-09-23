import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { chokeChance, isDead } from '../../parts/condition.js';
import { applyWear, chokeWear } from './wear.calculator.js';

export type FailureCategory = 'motor' | 'battery' | 'tank' | 'shield' | 'weapon' | 'sensor';

export type FailureConsequence =
  | 'leg_aborted_mission_failed'
  | 'shield_offline_for_leg'
  | 'fuel_leak'
  | 'next_hit_bypasses_shield'
  | 'weapon_skips_half_attacks'
  | 'guaranteed_ambush';

/** GDD §9 failure table — first match wins; non-critical classes return null. */
export const FAILURE_CONSEQUENCE: Readonly<Record<FailureCategory, FailureConsequence>> = {
  motor: 'leg_aborted_mission_failed',
  battery: 'shield_offline_for_leg',
  tank: 'fuel_leak',
  shield: 'next_hit_bypasses_shield',
  weapon: 'weapon_skips_half_attacks',
  sensor: 'guaranteed_ambush',
};

/**
 * Maps an installed part to its failure category. Shield selects DEFENSE parts
 * that provide ESC; armor plates (DEFENSE without ESC) are not choke-critical.
 */
export function failureCategory(partClass: string, providesEsc: boolean): FailureCategory | null {
  if (partClass === 'ENGINE') return 'motor';
  if (partClass === 'BATTERY') return 'battery';
  if (partClass === 'TANK') return 'tank';
  if (partClass === 'DEFENSE') return providesEsc ? 'shield' : null;
  if (partClass === 'WEAPON') return 'weapon';
  if (partClass === 'SENSOR') return 'sensor';
  return null;
}

export interface ChokeCandidate {
  readonly partId: string;
  readonly partClass: string;
  readonly condition: number;
  /** True for DEFENSE parts that provide ESC (shield), false for armor plates. */
  readonly providesEsc: boolean;
  /** Remaining fuel; only read for tank fuel-leak magnitude. */
  readonly remainingFuel?: number;
}

/**
 * A part-failure event. Purely mechanical: the shape intentionally has no
 * credits field, so a failure can never embed a credit effect (GDD §12 / D13).
 */
export interface FailureEvent {
  readonly category: 'failure';
  readonly type: FailureCategory;
  readonly partId: string;
  readonly consequence: FailureConsequence;
  readonly conditionLost: number;
  readonly conditionAfter: number;
  /** Fuel lost to a tank leak; absent for every other category. */
  readonly fuelLost?: number;
}

/** Fraction of remaining fuel lost on a tank leak (`failure.tank_leak_min..max`). */
export function tankLeakFraction(rules: GameRules, rng: Rng): number {
  return rng.uniform(rules.failure.tank_leak_min, rules.failure.tank_leak_max);
}

/** Share of attacks a jammed weapon skips (`failure.weapon_skip_ratio`). */
export function weaponSkipRatio(rules: GameRules): number {
  return rules.failure.weapon_skip_ratio;
}

/**
 * Rolls one critical part's choke for a leg (Appendix E): skipped when the
 * part is non-critical, already dead (≤1%), or at/above the choke threshold
 * (no RNG draw in those cases). A triggered choke costs
 * `wear.choke_loss_min..max` condition; tanks also roll the leak fraction.
 *
 * RNG order when the choke fires: choke `float`, choke-loss `uniform`, then
 * tank-only leak `uniform`.
 */
export function rollChoke(
  candidate: ChokeCandidate,
  rules: GameRules,
  rng: Rng,
): FailureEvent | null {
  const category = failureCategory(candidate.partClass, candidate.providesEsc);
  if (category === null || isDead(candidate.condition, rules)) {
    return null;
  }
  if (candidate.condition >= rules.wear.choke_threshold) {
    return null;
  }
  const chance = chokeChance(candidate.condition, rules);
  if (rng.float() >= chance) {
    return null;
  }

  const conditionLost = chokeWear(rules, rng);
  const event: FailureEvent = {
    category: 'failure',
    type: category,
    partId: candidate.partId,
    consequence: FAILURE_CONSEQUENCE[category],
    conditionLost,
    conditionAfter: applyWear(candidate.condition, conditionLost),
  };
  if (category === 'tank') {
    const fraction = tankLeakFraction(rules, rng);
    return { ...event, fuelLost: (candidate.remainingFuel ?? 0) * fraction };
  }
  return event;
}

/** Rolls chokes for every candidate in order; only fired chokes become events. */
export function rollChokes(
  candidates: readonly ChokeCandidate[],
  rules: GameRules,
  rng: Rng,
): FailureEvent[] {
  const events: FailureEvent[] = [];
  for (const candidate of candidates) {
    const event = rollChoke(candidate, rules, rng);
    if (event !== null) {
      events.push(event);
    }
  }
  return events;
}
