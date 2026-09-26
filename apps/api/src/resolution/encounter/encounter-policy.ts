import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';

export type PolicyDecision = 'IGNORE' | 'FLEE' | 'ATTACK';
export type FactionRelation = 'ALLY' | 'HOSTILE' | 'NEUTRAL';
export type Stance = 'DEFENSIVE' | 'NEUTRAL' | 'AGGRESSIVE';
export type MissionType =
  'DELIVERY' | 'TRANSPORT' | 'ESCORT' | 'MINING' | 'RESCUE' | 'TRAVEL' | 'HUNT' | null;

/**
 * GDD §8 policy tree, top-down; `decidePolicy` stops at the first applicable
 * rule. The order is the rule — a test pins it against Appendix E.
 */
export const POLICY_TREE_ORDER = [
  'ally_ignore',
  'mission_forces_flee',
  'hunt_target_attack',
  'faction_stance',
  'default_ignore',
] as const;

/** D16b / S5.4 slot-A precedence — first match wins. */
export const SLOT_A_PRECEDENCE = [
  'ambushed',
  'failed_escape',
  'aggressor',
  'mission_owner',
  'equal_sen_coin_flip',
] as const;

export type SlotARule = (typeof SLOT_A_PRECEDENCE)[number];

export interface PolicyContext {
  readonly relation: FactionRelation;
  readonly mission: MissionType;
  /** Delivery/transport legs force flee regardless of stance (mission context wins). */
  readonly missionForcesFlee: boolean;
  /** Hunt missions attack only when the other ship is the target. */
  readonly huntTargetMatch: boolean;
  readonly stance: Stance | null;
  /** Ratings for the NEUTRAL power test (Appendix E formula). */
  readonly selfRating: number;
  readonly enemyRating: number;
}

/** Top-down first-match evaluation of the GDD §8 policy tree. */
export function decidePolicy(context: PolicyContext, rules: GameRules['stance']): PolicyDecision {
  if (context.relation === 'ALLY') {
    return 'IGNORE';
  }
  if (context.missionForcesFlee) {
    return 'FLEE';
  }
  if (context.mission === 'HUNT' && context.huntTargetMatch) {
    return 'ATTACK';
  }
  if (context.relation === 'HOSTILE') {
    if (context.stance === 'AGGRESSIVE') {
      return 'ATTACK';
    }
    if (context.stance === 'NEUTRAL') {
      return context.selfRating >= rules.neutral_attack_ratio * context.enemyRating
        ? 'ATTACK'
        : 'IGNORE';
    }
    return 'IGNORE';
  }
  return 'IGNORE';
}

export interface SlotAInput {
  readonly ambushed: boolean;
  readonly escapeFailed: boolean;
  readonly playerAggressor: boolean;
  readonly enemyAggressor: boolean;
  readonly missionOwner: 'player' | 'enemy' | null;
  readonly playerSen: number;
  readonly enemySen: number;
}

export interface SlotAResolution {
  readonly side: 'player' | 'enemy';
  readonly rule: SlotARule;
}

/**
 * Resolves who takes combat slot A (first strike), first match over
 * `SLOT_A_PRECEDENCE`: ambush and failed escape hand it to the enemy; a unique
 * aggressor takes it; otherwise the mission owner; a mutual attack without an
 * owner is decided by SEN, equal SEN by a seeded coin flip (D16b).
 */
export function resolveSlotA(input: SlotAInput, rng: Rng): SlotAResolution {
  if (input.ambushed) {
    return { side: 'enemy', rule: 'ambushed' };
  }
  if (input.escapeFailed) {
    return { side: 'enemy', rule: 'failed_escape' };
  }
  if (input.playerAggressor && !input.enemyAggressor) {
    return { side: 'player', rule: 'aggressor' };
  }
  if (input.enemyAggressor && !input.playerAggressor) {
    return { side: 'enemy', rule: 'aggressor' };
  }
  if (input.missionOwner !== null) {
    return { side: input.missionOwner, rule: 'mission_owner' };
  }
  // Mutual attack with no mission owner: SEN elects the effective aggressor;
  // equal SEN is the D16b coin flip.
  if (input.playerSen > input.enemySen) {
    return { side: 'player', rule: 'aggressor' };
  }
  if (input.enemySen > input.playerSen) {
    return { side: 'enemy', rule: 'aggressor' };
  }
  return {
    side: rng.int(0, 1) === 0 ? 'player' : 'enemy',
    rule: 'equal_sen_coin_flip',
  };
}
