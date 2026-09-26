import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { roundHalfEven } from '../numeric/round-half-even.js';
import type { CombatSheet } from '../combat/combat.types.js';

/**
 * Pirate NPC generator (D16 / plan S5.7). Anchored to the player's own sheet
 * with the validated strength/jitter tables — the construction that yielded
 * the ~55% winrate in the focused sweep. The pirate is embedded in the
 * encounter log; no `NPC` table is needed (D23).
 *
 * RNG order (sim `uma_vida` dict evaluation): strength `choice`,
 * MOB jitter `choice`, SEN jitter `choice`. PDF/BLI/HP use half-even rounding
 * only — no draws.
 *
 * Formulas (sweep oracle):
 * - MOB = max(1, player.mob + mobJitter)
 * - PDF = max(pirate_min_pdf, roundHalfEven(player.pdf × strength))
 * - BLI = max(0, roundHalfEven(player.bli × strength × pirate_bli_ratio))
 * - ESC = 0
 * - SEN = max(0, player.sen + senJitter)
 * - HP = max(pirate_min_hp, roundHalfEven(player.hp × strength))
 */
export function generatePirate(
  player: CombatSheet,
  rules: GameRules,
  rng: Rng,
  /** Zone cap on the strength multiplier (safer zones, weaker pirates); absent = no cap. */
  maxStrength?: number,
): CombatSheet {
  const e = rules.encounter;
  const allowed =
    maxStrength === undefined
      ? e.pirate_strength_options
      : e.pirate_strength_options.filter((option) => option <= maxStrength);
  // A cap below every option still leaves the weakest pirate, never nobody.
  const options = allowed.length > 0 ? allowed : [Math.min(...e.pirate_strength_options)];
  const strength = rng.pick(options);
  const mobJitter = rng.pick(e.pirate_mob_jitter);
  const senJitter = rng.pick(e.pirate_sen_jitter);

  return {
    mob: Math.max(1, player.mob + mobJitter),
    pdf: Math.max(e.pirate_min_pdf, roundHalfEven(player.pdf * strength)),
    bli: Math.max(0, roundHalfEven(player.bli * strength * e.pirate_bli_ratio)),
    esc: 0,
    sen: Math.max(0, player.sen + senJitter),
    hp: Math.max(e.pirate_min_hp, roundHalfEven(player.hp * strength)),
  };
}
