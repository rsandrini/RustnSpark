import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { roundHalfEven } from '../numeric/round-half-even.js';

export type EscapePreset = 'CRUISE' | 'COMBAT' | 'ESCAPE';

export interface EscapeEvaluation {
  readonly d20: number;
  /** Escape preset bonus applied to the roll (only ESCAPE is nonzero in v0.1). */
  readonly bonus: number;
  readonly roll: number;
  readonly dc: number;
  readonly success: boolean;
}

export interface EscapeAttempt extends EscapeEvaluation {
  /** Overload wear percent applied to motors on every attempt (Appendix E). */
  readonly motorOverloadPercent: number;
}

export interface EscapeRollInput {
  readonly playerMob: number;
  readonly enemyMob: number;
  readonly enemySen: number;
  readonly preset: EscapePreset;
  readonly d20: number;
}

/**
 * Escape check (Appendix E): success iff
 * `d20 + preset_bonus + roundHalfEven(MOB × dodge_factor)` meets
 * `dc_base + roundHalfEven(enemyMOB × dodge_factor) + enemySEN × enemy_sen_weight`.
 * Odd-MOB dodge uses half-to-even rounding (D16d).
 */
export function evaluateEscape(input: EscapeRollInput, rules: GameRules): EscapeEvaluation {
  const bonus = input.preset === 'ESCAPE' ? rules.escape.preset_bonus : 0;
  const roll = input.d20 + bonus + roundHalfEven(input.playerMob * rules.combat.dodge_factor);
  const dc =
    rules.combat.dc_base +
    roundHalfEven(input.enemyMob * rules.combat.dodge_factor) +
    input.enemySen * rules.escape.enemy_sen_weight;
  return { d20: input.d20, bonus, roll, dc, success: roll >= dc };
}

/**
 * Draws the d20 and the motor-overload wear percent (both every attempt,
 * success or failure), then evaluates the escape. RNG order: d20, overload.
 */
export function attemptEscape(
  player: { readonly mob: number },
  enemy: { readonly mob: number; readonly sen: number },
  preset: EscapePreset,
  rules: GameRules,
  rng: Rng,
): EscapeAttempt {
  const d20 = rng.int(1, rules.combat.attack_die);
  const motorOverloadPercent = rng.int(rules.wear.overload_min, rules.wear.overload_max);
  return {
    ...evaluateEscape(
      {
        playerMob: player.mob,
        enemyMob: enemy.mob,
        enemySen: enemy.sen,
        preset,
        d20,
      },
      rules,
    ),
    motorOverloadPercent,
  };
}
