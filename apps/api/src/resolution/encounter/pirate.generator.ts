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
  /** How much stronger the pirate is made against this ship (its bridge rarity's entry); 1 = as drawn. */
  strengthMultiplier = 1,
): CombatSheet {
  const e = rules.encounter;
  const allowed =
    maxStrength === undefined
      ? e.pirate_strength_options
      : e.pirate_strength_options.filter((option) => option <= maxStrength);
  // A cap below every option still leaves the weakest pirate, never nobody.
  const options = allowed.length > 0 ? allowed : [Math.min(...e.pirate_strength_options)];
  // The draw (and so the rng order) is unchanged; the multiplier only scales what was drawn.
  const strength = rng.pick(options) * strengthMultiplier;
  const mobJitter = rng.pick(e.pirate_mob_jitter);
  const senJitter = rng.pick(e.pirate_sen_jitter);

  const bli = Math.max(0, roundHalfEven(player.bli * strength * e.pirate_bli_ratio));
  return {
    // Against a ship in the layered damage model the pirate is hit in layers too: its armor is a
    // pool of the same kind (and it has no shield).
    ...(player.armor !== undefined ? { armor: bli * rules.combat.armor_pool_factor } : {}),
    mob: Math.max(1, player.mob + mobJitter),
    pdf: Math.max(e.pirate_min_pdf, roundHalfEven(player.pdf * strength)),
    bli,
    esc: 0,
    sen: Math.max(0, player.sen + senJitter),
    hp: Math.max(e.pirate_min_hp, roundHalfEven(player.hp * strength)),
  };
}

/** How many tiers the second danger step adds (the first adds 1). */
const SECOND_STEP = 2;

/**
 * The pirate tier of a leg (fixed pirates, v0.1.3): the zone's tier, raised by 1 when the route is at least as
 * dangerous as the first danger step and by 2 at the second, and never past the last tier the config has.
 */
export function pirateTierFor(rules: GameRules, zone: number, danger: number): number {
  const e = rules.encounter;
  const zoneTiers = Object.values(e.pirate_zone_tier);
  const base =
    e.pirate_zone_tier[String(zone)] ?? (zoneTiers.length > 0 ? Math.max(...zoneTiers) : 0);
  const [first, second] = e.pirate_danger_steps;
  const raise =
    second !== undefined && danger >= second
      ? SECOND_STEP
      : first !== undefined && danger >= first
        ? 1
        : 0;
  const tiers = Object.keys(e.pirate_tiers).map((key) => Number(key.split('.')[0]));
  const last = tiers.length > 0 ? Math.max(...tiers) : 0;
  return Math.min(base + raise, last);
}

/**
 * A fixed pirate: its stats are the config's for the leg's tier, whatever ship it meets (no draws). Against a ship
 * in the layered damage model its armor is a pool of the same kind and its shield recovers `regen` per round.
 */
export function fixedPirateFor(
  rules: GameRules,
  zone: number,
  danger: number,
  layered: boolean,
): CombatSheet {
  const tier = pirateTierFor(rules, zone, danger);
  const stat = (name: string): number => rules.encounter.pirate_tiers[`${tier}.${name}`] ?? 0;
  const bli = stat('bli');
  const esc = stat('esc');
  return {
    ...(layered
      ? {
          armor: bli * rules.combat.armor_pool_factor,
          escMax: esc,
          escRegen: stat('regen'),
          escRegenEnergy: 0,
        }
      : {}),
    hp: stat('hp'),
    pdf: stat('pdf'),
    bli,
    esc,
    mob: stat('mob'),
    sen: stat('sen'),
  };
}
