import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { resolveCombat } from '../combat/combat.resolver.js';
import type { CombatResult, CombatSheet } from '../combat/combat.types.js';
import { ambushChance, rollAmbush } from './detection.js';
import { attemptEscape, type EscapeAttempt, type EscapePreset } from './escape.resolver.js';
import { encounterChance, pvpAllowed, rollEncounter } from './encounter-chance.js';
import {
  decidePolicy,
  resolveSlotA,
  type FactionRelation,
  type MissionType,
  type PolicyDecision,
  type SlotARule,
  type Stance,
} from './encounter-policy.js';
import { rating } from './stance.js';

/**
 * Fixed encounter pipeline order (S5.4) — stages run in exactly this sequence;
 * a skipped stage is simply absent from the recorded stages. A test pins the
 * order against Appendix E's `ENCOUNTER_PIPELINE`.
 */
export const ENCOUNTER_PIPELINE = [
  'encounter_roll',
  'detection',
  'policy',
  'escape',
  'combat',
] as const;

export type EncounterStage = (typeof ENCOUNTER_PIPELINE)[number];

export interface EncounterInput {
  readonly zone: number;
  readonly danger: number;
  readonly escortLeg: boolean;
  /** Another player's ship — the zone gate applies only to PvP contacts. */
  readonly isPvp: boolean;
  readonly player: {
    readonly sheet: CombatSheet;
    readonly preset: EscapePreset;
    /** False when the radar/sensor choke fired this leg (S5.5). */
    readonly sensorAlive: boolean;
  };
  readonly enemy: { readonly sheet: CombatSheet };
  readonly relation: FactionRelation;
  readonly mission: MissionType;
  readonly missionForcesFlee: boolean;
  readonly huntTargetMatch: boolean;
  readonly stance: Stance | null;
  /** The enemy side's policy (generated pirates always ATTACK). */
  readonly enemyDecision: PolicyDecision;
  /** Who owns the contested mission; null for an open-space contact. */
  readonly missionOwner: 'player' | 'enemy' | null;
}

export interface EncounterCombat {
  readonly result: CombatResult;
  readonly playerIsA: boolean;
  readonly winner: 'player' | 'enemy' | 'draw';
}

export interface EncounterOutcome {
  readonly stages: readonly EncounterStage[];
  readonly encountered: boolean;
  readonly pvpBlocked: boolean;
  readonly ambushed: boolean;
  readonly decision: PolicyDecision | null;
  readonly escape: EscapeAttempt | null;
  readonly escaped: boolean;
  readonly slotA: 'player' | 'enemy' | null;
  readonly slotARule: SlotARule | null;
  readonly combat: EncounterCombat | null;
}

function emptyOutcome(
  stages: readonly EncounterStage[],
  patch: Partial<EncounterOutcome> = {},
): EncounterOutcome {
  return {
    stages,
    encountered: false,
    pvpBlocked: false,
    ambushed: false,
    decision: null,
    escape: null,
    escaped: false,
    slotA: null,
    slotARule: null,
    combat: null,
    ...patch,
  };
}

/**
 * Runs the S5.4 pipeline in fixed order: encounter roll → detection → zone
 * gate → policy → escape (flee, skipped when ambushed) → combat (unless
 * ignored or escaped). Slot A follows `SLOT_A_PRECEDENCE`; combat receives
 * `firstStrikeSide: 'A'` so the slot-A holder always keeps the first strike
 * (D16b / Appendix E ambush and escape-failure consequences).
 *
 * RNG order (stage by stage): encounter `float`, detection `float`, escape
 * `int(1, attack_die)` + `int(overload_min, overload_max)`, slot-A coin flip
 * `int(0, 1)` when needed, then combat draws.
 */
export function resolveEncounter(
  input: EncounterInput,
  rules: GameRules,
  rng: Rng,
): EncounterOutcome {
  const stages: EncounterStage[] = [];

  stages.push('encounter_roll');
  const chance = encounterChance(input.danger, rules, input.escortLeg);
  if (!rollEncounter(chance, rng)) {
    return emptyOutcome(stages);
  }

  stages.push('detection');
  const ambushed = rollAmbush(
    ambushChance(
      input.player.sheet.sen,
      input.enemy.sheet.sen,
      input.player.sensorAlive,
      rules.detection,
    ),
    rng,
  );

  // Zone gate sits before the policy tree: zones 0–1 produce no PvP.
  if (input.isPvp && !pvpAllowed(input.zone)) {
    return emptyOutcome(stages, { encountered: true, pvpBlocked: true, ambushed });
  }

  stages.push('policy');
  const decision = decidePolicy(
    {
      relation: input.relation,
      mission: input.mission,
      missionForcesFlee: input.missionForcesFlee,
      huntTargetMatch: input.huntTargetMatch,
      stance: input.stance,
      selfRating: rating(input.player.sheet, rules.stance),
      enemyRating: rating(input.enemy.sheet, rules.stance),
    },
    rules.stance,
  );
  // A pirate that attacks cannot be "ignored" by the ship it attacks: the player's policy only
  // decides how they answer (fight or flee); it never makes an attack disappear.
  if (decision === 'IGNORE' && input.enemyDecision !== 'ATTACK') {
    return emptyOutcome(stages, { encountered: true, ambushed, decision });
  }

  let escape: EscapeAttempt | null = null;
  let escaped = false;
  if (decision === 'FLEE' && !ambushed) {
    stages.push('escape');
    escape = attemptEscape(input.player.sheet, input.enemy.sheet, input.player.preset, rules, rng);
    escaped = escape.success;
  }
  if (escaped) {
    return emptyOutcome(stages, {
      encountered: true,
      ambushed,
      decision,
      escape,
      escaped: true,
    });
  }

  stages.push('combat');
  const slot = resolveSlotA(
    {
      ambushed,
      escapeFailed: escape !== null && !escape.success,
      playerAggressor: decision === 'ATTACK',
      enemyAggressor: input.enemyDecision === 'ATTACK',
      missionOwner: input.missionOwner,
      playerSen: input.player.sheet.sen,
      enemySen: input.enemy.sheet.sen,
    },
    rng,
  );

  const playerIsA = slot.side === 'player';
  const result = resolveCombat(
    playerIsA ? input.player.sheet : input.enemy.sheet,
    playerIsA ? input.enemy.sheet : input.player.sheet,
    rules.combat,
    rng,
    { firstStrikeSide: 'A' },
  );
  const winner =
    result.outcome === 'draw'
      ? 'draw'
      : (result.outcome === 'A') === playerIsA
        ? 'player'
        : 'enemy';

  return emptyOutcome(stages, {
    encountered: true,
    ambushed,
    decision,
    escape,
    escaped: false,
    slotA: slot.side,
    slotARule: slot.rule,
    combat: { result, playerIsA, winner },
  });
}
