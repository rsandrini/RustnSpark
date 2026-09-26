import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';

/**
 * What a pirate who wins a fight wants (owner decision, round 2): the mission's `cargo`, `parts`
 * kept in storage (never installed ones), or to defend `territory` (the ship is driven off and
 * the mission fails; nothing is taken). Weighted by `encounter.pirate_motive_weights`; a motive
 * that cannot apply (no cargo aboard, nothing in storage) is not offered. Pure and seeded, so a
 * replay picks the same motive and the same parts.
 */
export type PirateMotive = 'cargo' | 'parts' | 'territory';

export interface StoredPart {
  readonly id: string;
  readonly partType: string;
}

export interface PirateDemand {
  readonly motive: PirateMotive;
  /** Instance ids of the storage parts taken (`parts` only). */
  readonly stolen: readonly string[];
}

const MAX_STOLEN_PARTS = 2;
const SECOND_PART_CHANCE = 0.5;

export function rollPirateDemand(
  input: { readonly objectCarried: boolean; readonly storage: readonly StoredPart[] },
  rules: GameRules,
  rng: Rng,
): PirateDemand {
  const weights = rules.encounter.pirate_motive_weights;
  const options: Array<{ motive: PirateMotive; weight: number }> = [];
  if (input.objectCarried) options.push({ motive: 'cargo', weight: weights['cargo'] ?? 0 });
  if (input.storage.length > 0) options.push({ motive: 'parts', weight: weights['parts'] ?? 0 });
  options.push({ motive: 'territory', weight: weights['territory'] ?? 0 });

  const total = options.reduce((sum, option) => sum + Math.max(0, option.weight), 0);
  let motive: PirateMotive = 'territory';
  if (total > 0) {
    let roll = rng.float() * total;
    for (const option of options) {
      roll -= Math.max(0, option.weight);
      if (roll < 0) {
        motive = option.motive;
        break;
      }
    }
  }
  if (motive !== 'parts') return { motive, stolen: [] };

  const pool = [...input.storage];
  const count = Math.min(
    pool.length,
    1 + (MAX_STOLEN_PARTS > 1 && rng.float() < SECOND_PART_CHANCE ? 1 : 0),
  );
  const stolen: string[] = [];
  for (let taken = 0; taken < count; taken += 1) {
    const index = rng.int(0, pool.length - 1);
    stolen.push(pool[index]!.id);
    pool.splice(index, 1);
  }
  return { motive, stolen };
}
