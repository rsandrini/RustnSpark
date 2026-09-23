import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';

/**
 * Ambush chance (Appendix E): a dead sensor guarantees the ambush; otherwise
 * `(enemySEN − playerSEN) × ambush_per_sen_point` when the enemy outsenses the
 * player, capped at `ambush_cap`, else 0.
 */
export function ambushChance(
  playerSen: number,
  enemySen: number,
  sensorAlive: boolean,
  rules: GameRules['detection'],
): number {
  if (!sensorAlive) {
    return 1;
  }
  if (enemySen <= playerSen) {
    return 0;
  }
  return Math.min((enemySen - playerSen) * rules.ambush_per_sen_point, rules.ambush_cap);
}

/** One `float()` draw; chance 1 always ambushes (float is in [0, 1)). */
export function rollAmbush(chance: number, rng: Rng): boolean {
  return rng.float() < chance;
}
