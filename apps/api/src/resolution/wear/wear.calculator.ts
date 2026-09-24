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
