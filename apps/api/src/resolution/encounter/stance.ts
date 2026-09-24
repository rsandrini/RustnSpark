import type { GameRules } from '../../config/game-config.types.js';

/** Combat-relevant stats the stance rating reads (structural subset of CombatSheet). */
export interface ShipPower {
  readonly pdf: number;
  readonly hp: number;
  readonly esc: number;
  readonly bli: number;
}

/** `PDF × (HP + ESC + rating_armor_weight × BLI)` (Appendix E — neutral stance). */
export function rating(ship: ShipPower, rules: GameRules['stance']): number {
  return ship.pdf * (ship.hp + ship.esc + rules.rating_armor_weight * ship.bli);
}

/** A NEUTRAL stance attacks only at `self ≥ neutral_attack_ratio × enemy` (boundary ≥). */
export function shouldAttackNeutral(
  self: ShipPower,
  enemy: ShipPower,
  rules: GameRules['stance'],
): boolean {
  return rating(self, rules) >= rules.neutral_attack_ratio * rating(enemy, rules);
}
