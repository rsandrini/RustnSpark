import type { Rng } from '../../common/rng/rng.js';
import type { CoreDrop, GameRules } from '../../config/game-config.types.js';
import type { MissionLoot } from '../events/mission-event.js';

export type CoreDropSource = 'scavenge' | 'mission';

/** The drops that apply at a zone: the entry with the highest zone key not above it (none for the safe core). */
export function dropsAtZone(
  source: CoreDropSource,
  zone: number,
  rules: GameRules,
): readonly CoreDrop[] {
  const bySource = rules.economy.core_drops[source] ?? {};
  const keys = Object.keys(bySource)
    .map(Number)
    .filter((key) => Number.isFinite(key) && key <= zone)
    .sort((a, b) => b - a);
  const best = keys[0];
  return best === undefined ? [] : (bySource[String(best)] ?? []);
}

/**
 * The cores and fragments a run turns up (`economy.core_drops`): each listed drop rolls its own
 * chance on the given stream, in list order, so the same seed always finds the same things.
 */
export function rollCoreDrops(
  source: CoreDropSource,
  zone: number,
  rules: GameRules,
  rng: Rng,
): MissionLoot[] {
  const found: MissionLoot[] = [];
  dropsAtZone(source, zone, rules).forEach((drop, index) => {
    if (rng.child(`drop-${index}`).float() < drop.chance) {
      found.push({ materialId: drop.material, quantity: drop.quantity });
    }
  });
  return found;
}
