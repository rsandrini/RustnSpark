import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';

/** Breakdown of one part's mission wear (D12 / GDD §9). */
export interface MissionWear {
  readonly base: number;
  readonly environment: number;
  readonly total: number;
}

/**
 * Per-mission wear (validated sim): `uniform(wear.base_min, wear.base_max)
 * + env.nivel × wear.env_multiplier`. Overload (8–15%) and choke losses are
 * separate events — see `overloadWear` / `chokeWear`.
 */
export function missionWear(envNivel: number, rules: GameRules, rng: Rng): MissionWear {
  const base = rng.uniform(rules.wear.base_min, rules.wear.base_max);
  const environment = envNivel * rules.wear.env_multiplier;
  return { base, environment, total: base + environment };
}

/** Overload spike (GDD §9 / Appendix E): `wear.overload_min..max` in one hit. */
export function overloadWear(rules: GameRules, rng: Rng): number {
  return rng.int(rules.wear.overload_min, rules.wear.overload_max);
}

/** Condition lost when a part chokes (Appendix E / sim: `uniform(3, 8)`). */
export function chokeWear(rules: GameRules, rng: Rng): number {
  return rng.uniform(rules.wear.choke_loss_min, rules.wear.choke_loss_max);
}

/** Condition lost on combat defeat (sim: `uniform(8, 15)`). */
export function defeatWear(rules: GameRules, rng: Rng): number {
  return rng.uniform(rules.wear.defeat_loss_min, rules.wear.defeat_loss_max);
}

/** Apply a condition loss; condition never drops below 0. */
export function applyWear(condition: number, loss: number): number {
  return Math.max(0, condition - loss);
}

/**
 * Round-2 playtest fix: `missionWear` used to land on every part alike, so a bridge or a cargo
 * hold wore out from merely existing exactly as fast as an engine or the hull — a "simple,
 * direct" mission could cost a clean ship ~9% on parts that never did anything. The classes
 * below never fail from operational stress (`failureCategory` already never picks them as
 * choke-critical — see failure.resolver.ts): they only get old from being used, so they take a
 * tiny, near-flat `systemWear` instead of `missionWear`. Every other class (the ones the game
 * already treats as exposed — engine, tank, battery, weapon, defense, sensor) keeps taking real,
 * route-scaled wear via `dangerFactor`.
 */
const PASSIVE_WEAR_CLASSES: ReadonlySet<string> = new Set([
  'BRIDGE',
  'CARGO',
  'REACTOR',
  'UTILITY',
]);

export function isPassiveWearClass(partClass: string): boolean {
  return PASSIVE_WEAR_CLASSES.has(partClass);
}

const DEFENSE_WEAR_CLASS = 'DEFENSE';

/** How many DEFENSE-class parts (Hull Frame, shields) are installed — round-4 wear rework. */
export function countDefenseParts(parts: readonly { readonly partClass: string }[]): number {
  return parts.filter((part) => part.partClass === DEFENSE_WEAR_CLASS).length;
}

/**
 * Round-4 wear rework (owner: "hull frame absorbs more, other parts less"): a fixed total
 * "extra" bonus split evenly across however many DEFENSE parts are installed, so stacking
 * them never multiplies the total benefit — one Hull Frame gets the full bonus, two share it.
 * Every other exposed class absorbs correspondingly less while at least one DEFENSE part is
 * installed, to keep the ship's average wear roughly where it was before this rework. Passive
 * classes are untouched either way (their own tiny flat wear was never part of this).
 */
function wearMultiplierFor(partClass: string, defenseCount: number, rules: GameRules): number {
  if (isPassiveWearClass(partClass)) return 1;
  if (partClass === DEFENSE_WEAR_CLASS) {
    return defenseCount > 0 ? 1 + rules.wear.defense_wear_bonus / defenseCount : 1;
  }
  return defenseCount > 0 ? rules.wear.other_exposed_wear_factor : 1;
}

/**
 * How much a leg's own danger scales exposed-part wear: `clamp(danger / danger_ref,
 * danger_floor, danger_cap)`. A safe, simple leg (low danger) costs a small fraction of the base
 * roll; a genuinely dangerous one costs multiples of it — wear now tracks the difficulty of the
 * path, not just its mere existence.
 */
export function dangerFactor(danger: number, rules: GameRules): number {
  const raw = danger / rules.wear.danger_ref;
  return Math.min(rules.wear.danger_cap, Math.max(rules.wear.danger_floor, raw));
}

/** Flat per-leg "usage" wear for a passive-class part: `uniform(system_base_min, system_base_max)`. */
export function systemWear(rules: GameRules, rng: Rng): number {
  return rng.uniform(rules.wear.system_base_min, rules.wear.system_base_max);
}

/**
 * One part's ambient per-leg wear, routed by its class: passive classes take the tiny flat
 * `systemWear`; every exposed class takes `missionWear`'s base+environment roll scaled by the
 * leg's own danger.
 */
export function partAmbientWear(
  partClass: string,
  danger: number,
  envNivel: number,
  defenseCount: number,
  rules: GameRules,
  rng: Rng,
): number {
  if (isPassiveWearClass(partClass)) {
    return systemWear(rules, rng);
  }
  const { total } = missionWear(envNivel, rules, rng);
  return total * dangerFactor(danger, rules) * wearMultiplierFor(partClass, defenseCount, rules);
}

/**
 * A combat defeat still hits every part (losing a fight is "a reason"), but a passive-class part
 * only takes `system_defeat_share` of the roll — a lost fight dents the hull and the engine far
 * more than it dents the cargo hold's fixtures. DEFENSE parts take more of it (and other exposed
 * classes correspondingly less) per `wearMultiplierFor` — round-4 wear rework.
 */
export function partDefeatWear(
  partClass: string,
  defeatLoss: number,
  defenseCount: number,
  rules: GameRules,
): number {
  if (isPassiveWearClass(partClass)) return defeatLoss * rules.wear.system_defeat_share;
  return defeatLoss * wearMultiplierFor(partClass, defenseCount, rules);
}

/**
 * Apply independent mission wear to each part (production `scale_mode:
 * all_stats`). The parity harness uses one ship-wide draw instead.
 */
export function applyMissionWearToParts(
  parts: readonly { readonly id: string; readonly condition: number }[],
  envNivel: number,
  rules: GameRules,
  rng: Rng,
): ReadonlyMap<string, number> {
  const next = new Map<string, number>();
  for (const part of parts) {
    const { total } = missionWear(envNivel, rules, rng);
    next.set(part.id, applyWear(part.condition, total));
  }
  return next;
}
