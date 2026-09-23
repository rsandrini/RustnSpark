import type { GameRules } from '../../config/game-config.types.js';

/**
 * Object integrity (0–100%) and the damage rules that feed payout (GDD §12,
 * Appendix E INTEGRITY_CASES). The mission object is cargo / passenger /
 * escorted NPC / rescuee — not the player's own ship.
 */

/** Points lost from combat: `combat_factor × (hpLost / maxHp) × 100`. */
export function combatIntegrityLoss(maxHp: number, hpLost: number, rules: GameRules): number {
  if (maxHp <= 0) {
    return 0;
  }
  return rules.integrity.combat_factor * (hpLost / maxHp) * 100;
}

/** Points lost from environment per leg: `env_factor × env.nivel`. */
export function environmentIntegrityLoss(envNivel: number, rules: GameRules): number {
  return rules.integrity.env_factor * envNivel;
}

/** Escorted NPC integrity IS the client ship's HP share (identity, no factor). */
export function escortIntegrity(clientHp: number, clientMaxHp: number): number {
  if (clientMaxHp <= 0) {
    return 0;
  }
  return (clientHp / clientMaxHp) * 100;
}

/** Apply a points loss; integrity stays in [0, 100]. */
export function applyIntegrityLoss(integrity: number, pointsLost: number): number {
  return Math.min(100, Math.max(0, integrity - pointsLost));
}

/**
 * Escorted NPC state (GDD §12): destroyed (HP ≤ 0) fails the mission;
 * below the payout floor pays zero but still succeeds; otherwise OK.
 */
export type EscortObjectStatus = 'ok' | 'zero_payout' | 'destroyed';

export function escortObjectStatus(
  clientHp: number,
  clientMaxHp: number,
  rules: GameRules,
): EscortObjectStatus {
  if (clientHp <= 0) {
    return 'destroyed';
  }
  if (escortIntegrity(clientHp, clientMaxHp) < rules.economy.payout_floor_integrity * 100) {
    return 'zero_payout';
  }
  return 'ok';
}
