/**
 * Appendix E — owner-approved rule defaults and table-driven cases (sign-off 2026-09-21).
 *
 * These tables are the S5.0 deliverable: independent copies of every number the owner
 * approved under D13/D16/D17/D18, plus the worked cases that S5.4–S5.6 write their tests
 * against. None of these rules has a numeric simulator oracle — Appendix E *is* the oracle.
 *
 * Nothing here reads GAME_CONFIG_DEFAULTS on purpose: the sign-off gate
 * (test/unit/config/appendix-e.spec.ts) fails if factory defaults drift from these values,
 * so a tuning change to an approved rule always requires a conscious table update.
 *
 * Float expectations are the mathematical ideals (0.3, 0.42, 1/9, …); compare them with
 * toBeCloseTo, not toBe — IEEE-754 noise in the last bits is not a balance change.
 *
 * Sources: plan Appendix E (owner-approved 2026-09-21), GDD §8/§9/§12.
 */

// ---------------------------------------------------------------------------
// Pinned defaults (dotted config keys → approved values)
// ---------------------------------------------------------------------------

export const APPENDIX_E_DEFAULTS = {
  // D16 / combat — referenced by the escape roll and the known-defect tests
  'combat.dodge_factor': 1.5,
  'combat.dc_base': 10,
  'combat.attack_die': 20,
  'combat.first_strike_bonus': 2,
  'combat.pierce_ratio': 0.35, // D16a: inert in v0.1 but read from config
  'wear.scale_mode': 'all_stats', // D13
  'economy.payout_floor_integrity': 0.5, // D13 / GDD §12
  'encounter.chance_divisor': 20, // D17

  // Appendix E — performance / choke inputs (S4.2 tables, consumed by S5.5/S5.6)
  'wear.performance_floor': 0.5,
  'wear.performance_slope': 0.5,
  'wear.choke_threshold': 30,
  'wear.choke_loss_min': 3,
  'wear.choke_loss_max': 8,
  'wear.dead_at_or_below': 1,

  // Appendix E — escape
  'escape.enemy_sen_weight': 1,
  'escape.preset_bonus': 2,
  'wear.overload_min': 8,
  'wear.overload_max': 15,

  // Appendix E — ambush / detection
  'detection.ambush_per_sen_point': 0.1,
  'detection.ambush_cap': 0.5,

  // Appendix E — neutral stance
  'stance.neutral_attack_ratio': 1.2,
  'stance.rating_armor_weight': 5,

  // Appendix E — part-failure consequences
  'failure.tank_leak_min': 0.3,
  'failure.tank_leak_max': 0.5,
  'failure.weapon_skip_ratio': 0.5,

  // Appendix E — object integrity damage
  'integrity.combat_factor': 0.6,
  'integrity.env_factor': 0.4,

  // Appendix E — mining (material_price is provisional: not in the approved table)
  'mining.richness': { open: 0.2, radiation: 0.35, gravitational: 0.3, debris: 0.6 },
  'mining.rarity': { common: 0.3, uncommon: 0.6, rare: 0.85 },
  'mining.attempts_per_stop': 10,

  // Appendix E — rescue deadline
  'rescue.reference_mob': 3,
  'rescue.deadline_factor_min': 1.25,
  'rescue.deadline_factor_max': 2.0,

  // Appendix E — escort
  'escort.encounter_multiplier': 1.5,
  'escort.client_target_share': 0.4,

  // Appendix E — ship class thresholds (display label only)
  'ship_class.cargo_share': 0.3,
  'ship_class.pressurized_share': 0.15,
  'ship_class.combat_share': 0.45,
} as const;

// ---------------------------------------------------------------------------
// Structural rules (no numbers, but the order is the rule)
// ---------------------------------------------------------------------------

/** S5.4 pipeline order — a test asserts resolvers run these in exactly this order. */
export const ENCOUNTER_PIPELINE = [
  'encounter_roll',
  'detection',
  'policy',
  'escape',
  'combat',
] as const;

/** D16b / S5.4 slot-A precedence — first match wins. */
export const SLOT_A_PRECEDENCE = [
  'ambushed',
  'failed_escape',
  'aggressor',
  'mission_owner',
  'equal_sen_coin_flip',
] as const;

/** GDD §8 policy tree, top-down; the resolver stops at the first applicable rule. */
export const POLICY_TREE_ORDER = [
  'ally_ignore',
  'mission_forces_flee',
  'hunt_target_attack',
  'faction_stance',
  'default_ignore',
] as const;

export type PolicyDecision = 'IGNORE' | 'FLEE' | 'ATTACK';
export type Stance = 'DEFENSIVE' | 'NEUTRAL' | 'AGGRESSIVE';

export interface PolicyCase {
  readonly name: string;
  /** Faction relation toward the other ship. */
  readonly relation: 'ALLY' | 'HOSTILE' | 'NEUTRAL';
  /** v0.1 mission types plus HUNT (GDD §8 rule 3); null when not on a mission. */
  readonly mission: 'DELIVERY' | 'TRANSPORT' | 'ESCORT' | 'MINING' | 'RESCUE' | 'HUNT' | null;
  /** Delivery/transport legs force flee regardless of stance (mission context wins). */
  readonly missionForcesFlee: boolean;
  /** Hunt missions attack only when the other ship is the target. */
  readonly huntTargetMatch: boolean;
  /** Ship stance; required when relation is HOSTILE (Prisma default is NEUTRAL). */
  readonly stance: Stance | null;
  /** Ratings for the NEUTRAL-stance power test (only read for HOSTILE + NEUTRAL). */
  readonly selfRating: number | null;
  readonly enemyRating: number | null;
  readonly expected: PolicyDecision;
}

/** Table-driven cases for the GDD §8 policy tree (S5.4). Ratings follow Appendix E:
 * rating = PDF × (HP + ESC + rating_armor_weight × BLI), attack iff self ≥ ratio × enemy. */
export const POLICY_CASES: readonly PolicyCase[] = [
  {
    name: 'ally is ignored before any other rule',
    relation: 'ALLY',
    mission: 'DELIVERY',
    missionForcesFlee: true,
    huntTargetMatch: false,
    stance: 'AGGRESSIVE',
    selfRating: 900,
    enemyRating: 100,
    expected: 'IGNORE',
  },
  {
    name: 'delivery flees even with an aggressive stance',
    relation: 'HOSTILE',
    mission: 'DELIVERY',
    missionForcesFlee: true,
    huntTargetMatch: false,
    stance: 'AGGRESSIVE',
    selfRating: 900,
    enemyRating: 100,
    expected: 'FLEE',
  },
  {
    name: 'transport flees even with an aggressive stance',
    relation: 'HOSTILE',
    mission: 'TRANSPORT',
    missionForcesFlee: true,
    huntTargetMatch: false,
    stance: 'AGGRESSIVE',
    selfRating: 100,
    enemyRating: 900,
    expected: 'FLEE',
  },
  {
    name: 'hunt with matching target attacks before the faction rule',
    relation: 'NEUTRAL',
    mission: 'HUNT',
    missionForcesFlee: false,
    huntTargetMatch: true,
    stance: null,
    selfRating: 100,
    enemyRating: 900,
    expected: 'ATTACK',
  },
  {
    name: 'hunt without a target match falls through to default ignore',
    relation: 'NEUTRAL',
    mission: 'HUNT',
    missionForcesFlee: false,
    huntTargetMatch: false,
    stance: null,
    selfRating: 900,
    enemyRating: 100,
    expected: 'IGNORE',
  },
  {
    name: 'hostile aggressive stance attacks',
    relation: 'HOSTILE',
    mission: null,
    missionForcesFlee: false,
    huntTargetMatch: false,
    stance: 'AGGRESSIVE',
    selfRating: 100,
    enemyRating: 900,
    expected: 'ATTACK',
  },
  {
    name: 'hostile defensive stance does not initiate',
    relation: 'HOSTILE',
    mission: null,
    missionForcesFlee: false,
    huntTargetMatch: false,
    stance: 'DEFENSIVE',
    selfRating: 900,
    enemyRating: 100,
    expected: 'IGNORE',
  },
  {
    name: 'hostile neutral stance attacks when rating ratio allows',
    relation: 'HOSTILE',
    mission: null,
    missionForcesFlee: false,
    huntTargetMatch: false,
    stance: 'NEUTRAL',
    selfRating: 900,
    enemyRating: 700,
    expected: 'ATTACK',
  },
  {
    name: 'hostile neutral stance stands down when out-rated',
    relation: 'HOSTILE',
    mission: null,
    missionForcesFlee: false,
    huntTargetMatch: false,
    stance: 'NEUTRAL',
    selfRating: 700,
    enemyRating: 900,
    expected: 'IGNORE',
  },
  {
    name: 'unknown neutral contact without mission is ignored',
    relation: 'NEUTRAL',
    mission: null,
    missionForcesFlee: false,
    huntTargetMatch: false,
    stance: null,
    selfRating: 900,
    enemyRating: 100,
    expected: 'IGNORE',
  },
  {
    name: 'escort mission has no forced flee — faction rule decides',
    relation: 'HOSTILE',
    mission: 'ESCORT',
    missionForcesFlee: false,
    huntTargetMatch: false,
    stance: 'AGGRESSIVE',
    selfRating: 100,
    enemyRating: 900,
    expected: 'ATTACK',
  },
];

/** Zones 0–1 produce no PvP (S5.4 / S7.5); zone is a gate before the policy tree. */
export const PVP_ZONE_CASES: readonly { zone: number; pvpAllowed: boolean }[] = [
  { zone: 0, pvpAllowed: false },
  { zone: 1, pvpAllowed: false },
  { zone: 2, pvpAllowed: true },
  { zone: 3, pvpAllowed: true },
];

// ---------------------------------------------------------------------------
// Escape [S5.4]
// ---------------------------------------------------------------------------

export type EscapePreset = 'CRUISE' | 'COMBAT' | 'ESCAPE';

export interface EscapeCase {
  readonly name: string;
  readonly mob: number;
  readonly enemyMob: number;
  readonly enemySen: number;
  readonly preset: EscapePreset;
  readonly d20: number;
  readonly success: boolean;
}

/** success ⟺ d20 + bonus + roundHalfEven(MOB × dodge_factor)
 *            ≥ dc_base + roundHalfEven(enemyMOB × dodge_factor) + enemySEN × enemy_sen_weight.
 * Odd MOB cases pin D16d: Python round() is half-to-even (3 × 1.5 = 4.5 → 4, not 5). */
export const ESCAPE_CASES: readonly EscapeCase[] = [
  {
    name: 'even MOB meets the DC exactly',
    mob: 4,
    enemyMob: 4,
    enemySen: 5,
    preset: 'CRUISE',
    d20: 15,
    success: true,
  },
  {
    name: 'even MOB one point below the DC fails',
    mob: 4,
    enemyMob: 4,
    enemySen: 5,
    preset: 'CRUISE',
    d20: 14,
    success: false,
  },
  {
    name: 'odd MOB rounds half-to-even: 3 × 1.5 = 4.5 → 4, meets DC exactly',
    mob: 3,
    enemyMob: 3,
    enemySen: 0,
    preset: 'CRUISE',
    d20: 10,
    success: true,
  },
  {
    name: 'odd MOB one point below the DC fails',
    mob: 3,
    enemyMob: 3,
    enemySen: 0,
    preset: 'CRUISE',
    d20: 9,
    success: false,
  },
  {
    name: 'escape preset +2 rescues a roll that would otherwise fail',
    mob: 3,
    enemyMob: 3,
    enemySen: 0,
    preset: 'ESCAPE',
    d20: 8,
    success: true,
  },
  {
    name: 'combat preset grants no escape bonus (shield always-on sim, D18)',
    mob: 3,
    enemyMob: 3,
    enemySen: 0,
    preset: 'COMBAT',
    d20: 8,
    success: false,
  },
  {
    name: 'high enemy SEN meets the weighted DC exactly',
    mob: 4,
    enemyMob: 4,
    enemySen: 10,
    preset: 'CRUISE',
    d20: 20,
    success: true,
  },
  {
    name: 'one more enemy SEN point breaks the same roll',
    mob: 4,
    enemyMob: 4,
    enemySen: 11,
    preset: 'CRUISE',
    d20: 20,
    success: false,
  },
  {
    name: 'fast ship escapes a slow well-sensed target on a modest roll',
    mob: 6,
    enemyMob: 2,
    enemySen: 0,
    preset: 'CRUISE',
    d20: 8,
    success: true,
  },
  {
    name: 'slow ship with max roll still loses to a fast sentinel',
    mob: 2,
    enemyMob: 6,
    enemySen: 4,
    preset: 'CRUISE',
    d20: 19,
    success: false,
  },
];

/** Failure of any escape attempt (Appendix E): enemy takes slot A and the first strike. */
export const ESCAPE_FAILURE_CONSEQUENCE = {
  enemyTakesSlotA: true,
  enemyGetsFirstStrikeBonus: true,
} as const;

/** Every escape attempt overloads the motors, regardless of preset (Appendix E). */
export const ESCAPE_ATTEMPT_WEAR = {
  appliesToPartClass: 'ENGINE',
  minPercent: 8,
  maxPercent: 15,
} as const;

/** Only ESCAPE has a numeric effect in v0.1; the other presets are recorded as events. */
export const PRESET_CASES: readonly {
  preset: EscapePreset;
  escapeRollBonus: number;
  combatNumericEffect: null;
}[] = [
  { preset: 'CRUISE', escapeRollBonus: 0, combatNumericEffect: null },
  { preset: 'COMBAT', escapeRollBonus: 0, combatNumericEffect: null },
  { preset: 'ESCAPE', escapeRollBonus: 2, combatNumericEffect: null },
];

// ---------------------------------------------------------------------------
// Ambush / detection [S5.4]
// ---------------------------------------------------------------------------

export interface DetectionCase {
  readonly name: string;
  readonly sensorAlive: boolean;
  readonly playerSen: number;
  readonly enemySen: number;
  /** Ambush probability; a dead sensor guarantees 1. */
  readonly ambushChance: number;
}

/** chance = min((enemySEN − playerSEN) × ambush_per_sen_point, ambush_cap)
 *  when enemySEN > playerSEN, else 0; dead sensor → guaranteed ambush. */
export const DETECTION_CASES: readonly DetectionCase[] = [
  {
    name: 'dead sensor guarantees the ambush',
    sensorAlive: false,
    playerSen: 10,
    enemySen: 0,
    ambushChance: 1,
  },
  {
    name: 'equal SEN gives no ambush chance',
    sensorAlive: true,
    playerSen: 5,
    enemySen: 5,
    ambushChance: 0,
  },
  {
    name: 'player with better SEN gives no ambush chance',
    sensorAlive: true,
    playerSen: 10,
    enemySen: 5,
    ambushChance: 0,
  },
  {
    name: 'three SEN points of disadvantage → 0.3',
    sensorAlive: true,
    playerSen: 5,
    enemySen: 8,
    ambushChance: 0.3,
  },
  {
    name: 'five points of disadvantage lands exactly on the cap',
    sensorAlive: true,
    playerSen: 5,
    enemySen: 10,
    ambushChance: 0.5,
  },
  {
    name: 'ten points of disadvantage is capped, not 1.0',
    sensorAlive: true,
    playerSen: 5,
    enemySen: 15,
    ambushChance: 0.5,
  },
  {
    name: 'single SEN point of disadvantage → 0.1',
    sensorAlive: true,
    playerSen: 9,
    enemySen: 10,
    ambushChance: 0.1,
  },
];

/** Structural consequences of an ambushed encounter (dead sensor or successful roll). */
export const AMBUSH_CONSEQUENCES = {
  enemyTakesSlotA: true,
  playerLosesFirstStrike: true,
  escapeAllowed: false,
} as const;

// ---------------------------------------------------------------------------
// Neutral stance [S5.4]
// ---------------------------------------------------------------------------

export interface ShipPower {
  readonly pdf: number;
  readonly hp: number;
  readonly esc: number;
  readonly bli: number;
}

export interface StanceCase {
  readonly name: string;
  readonly self: ShipPower;
  readonly enemy: ShipPower;
  readonly attack: boolean;
}

/** rating = PDF × (HP + ESC + rating_armor_weight × BLI);
 *  neutral attacks iff rating(self) ≥ neutral_attack_ratio × rating(enemy). */
export const STANCE_CASES: readonly StanceCase[] = [
  {
    name: 'equal ships are never attacked by a neutral',
    self: { pdf: 10, hp: 50, esc: 14, bli: 1 },
    enemy: { pdf: 10, hp: 50, esc: 14, bli: 1 },
    attack: false,
  },
  {
    name: 'exactly at the 1.2 ratio attacks (boundary is ≥)',
    self: { pdf: 10, hp: 62, esc: 10, bli: 0 },
    enemy: { pdf: 10, hp: 50, esc: 10, bli: 0 },
    attack: true,
  },
  {
    name: 'one point of HP below the ratio stands down',
    self: { pdf: 10, hp: 61, esc: 10, bli: 0 },
    enemy: { pdf: 10, hp: 50, esc: 10, bli: 0 },
    attack: false,
  },
  {
    name: 'three BLI points (weight 5) push the rating over the ratio',
    self: { pdf: 10, hp: 50, esc: 10, bli: 3 },
    enemy: { pdf: 10, hp: 50, esc: 10, bli: 0 },
    attack: true,
  },
  {
    name: 'two BLI points are not enough',
    self: { pdf: 10, hp: 50, esc: 10, bli: 2 },
    enemy: { pdf: 10, hp: 50, esc: 10, bli: 0 },
    attack: false,
  },
  {
    name: 'overwhelming superiority attacks',
    self: { pdf: 20, hp: 100, esc: 20, bli: 5 },
    enemy: { pdf: 5, hp: 30, esc: 5, bli: 1 },
    attack: true,
  },
  {
    name: 'zero-PDF vs zero-PDF satisfies ≥ trivially (0 ≥ 0)',
    self: { pdf: 0, hp: 50, esc: 0, bli: 0 },
    enemy: { pdf: 0, hp: 50, esc: 0, bli: 0 },
    attack: true,
  },
];

// ---------------------------------------------------------------------------
// Encounter chance [S5.4, D17]
// ---------------------------------------------------------------------------

export interface EncounterChanceCase {
  readonly name: string;
  /** Location danger, 0–10 in seeded worlds. */
  readonly danger: number;
  readonly escortLeg: boolean;
  readonly chance: number;
}

/** chance = danger / chance_divisor, × escort.encounter_multiplier on escort legs. */
export const ENCOUNTER_CHANCE_CASES: readonly EncounterChanceCase[] = [
  { name: 'zone danger 0 → no encounters', danger: 0, escortLeg: false, chance: 0 },
  { name: 'danger 4 over divisor 20 → 0.2', danger: 4, escortLeg: false, chance: 0.2 },
  { name: 'danger 10 over divisor 20 → 0.5', danger: 10, escortLeg: false, chance: 0.5 },
  { name: 'escort multiplies danger 4 by 1.5 → 0.3', danger: 4, escortLeg: true, chance: 0.3 },
  { name: 'escort multiplies danger 10 by 1.5 → 0.75', danger: 10, escortLeg: true, chance: 0.75 },
];

// ---------------------------------------------------------------------------
// Part choke and failure [S5.5]
// ---------------------------------------------------------------------------

export interface ChokeCase {
  readonly condition: number;
  readonly chokeChance: number;
  readonly dead: boolean;
}

/** choke chance = ((choke_threshold − condition) / choke_threshold)² below the
 *  threshold, 0 at or above it; condition ≤ dead_at_or_below is dead (not rolled). */
export const CHOKE_CASES: readonly ChokeCase[] = [
  { condition: 100, chokeChance: 0, dead: false },
  { condition: 30, chokeChance: 0, dead: false },
  { condition: 20, chokeChance: 0.1111111111111111, dead: false },
  { condition: 10, chokeChance: 0.4444444444444444, dead: false },
  { condition: 5, chokeChance: 0.6944444444444444, dead: false },
  { condition: 2, chokeChance: 0.8711111111111111, dead: false },
  { condition: 1, chokeChance: 0.9344444444444444, dead: true },
  { condition: 0, chokeChance: 1, dead: true },
];

export type ChokeConsequenceCategory =
  'motor' | 'battery' | 'tank' | 'shield' | 'weapon' | 'sensor';

export type ChokeConsequence =
  | 'leg_aborted_mission_failed'
  | 'shield_offline_for_leg'
  | 'fuel_leak'
  | 'next_hit_bypasses_shield'
  | 'weapon_skips_half_attacks'
  | 'guaranteed_ambush';

export interface ChokeConsequenceCase {
  readonly category: ChokeConsequenceCategory;
  /** PartClass hint for S5.5; shield selects DEFENSE parts that provide ESC
   *  (shield_basic), not armor plates, which share the DEFENSE class. */
  readonly partClass: 'ENGINE' | 'BATTERY' | 'TANK' | 'DEFENSE' | 'WEAPON' | 'SENSOR';
  readonly consequence: ChokeConsequence;
}

/** GDD §9 failure table — a failure event is purely mechanical, never a credit effect. */
export const CHOKE_CONSEQUENCE_CASES: readonly ChokeConsequenceCase[] = [
  { category: 'motor', partClass: 'ENGINE', consequence: 'leg_aborted_mission_failed' },
  { category: 'battery', partClass: 'BATTERY', consequence: 'shield_offline_for_leg' },
  { category: 'tank', partClass: 'TANK', consequence: 'fuel_leak' },
  { category: 'shield', partClass: 'DEFENSE', consequence: 'next_hit_bypasses_shield' },
  { category: 'weapon', partClass: 'WEAPON', consequence: 'weapon_skips_half_attacks' },
  { category: 'sensor', partClass: 'SENSOR', consequence: 'guaranteed_ambush' },
];

// ---------------------------------------------------------------------------
// Object integrity, payout and mining yield [S5.6]
// ---------------------------------------------------------------------------

export type IntegrityCase =
  | {
      readonly kind: 'combat';
      readonly maxHp: number;
      readonly hpLost: number;
      readonly pointsLost: number;
    }
  | { readonly kind: 'environment'; readonly envNivel: number; readonly pointsLost: number }
  | {
      readonly kind: 'escort';
      readonly clientHp: number;
      readonly clientMaxHp: number;
      readonly integrity: number;
    };

/** combat: combat_factor × (share of max HP lost) × 100;
 *  environment: env_factor × env.nivel per leg;
 *  escort: object integrity IS the client ship's HP share (identity, no factor). */
export const INTEGRITY_CASES: readonly IntegrityCase[] = [
  { kind: 'combat', maxHp: 100, hpLost: 100, pointsLost: 60 },
  { kind: 'combat', maxHp: 200, hpLost: 100, pointsLost: 30 },
  { kind: 'combat', maxHp: 100, hpLost: 10, pointsLost: 6 },
  { kind: 'combat', maxHp: 400, hpLost: 200, pointsLost: 30 },
  { kind: 'environment', envNivel: 1, pointsLost: 0.4 },
  { kind: 'environment', envNivel: 2, pointsLost: 0.8 },
  { kind: 'environment', envNivel: 3, pointsLost: 1.2 },
  { kind: 'escort', clientHp: 60, clientMaxHp: 100, integrity: 60 },
  { kind: 'escort', clientHp: 40, clientMaxHp: 100, integrity: 40 },
  { kind: 'escort', clientHp: 50, clientMaxHp: 200, integrity: 25 },
];

export interface PayoutCase {
  readonly integrity: number;
  readonly multiplier: number;
}

/** Prêmio = base × integrity: linear from 100→1.0 down to 50→0.5, zero below 50
 *  (payout_floor_integrity 0.5); mining is exempt (yield-based, S5.6). */
export const PAYOUT_CASES: readonly PayoutCase[] = [
  { integrity: 100, multiplier: 1.0 },
  { integrity: 90, multiplier: 0.9 },
  { integrity: 80, multiplier: 0.8 },
  { integrity: 50, multiplier: 0.5 },
  { integrity: 49, multiplier: 0 },
  { integrity: 0, multiplier: 0 },
];

export interface MiningCase {
  readonly name: string;
  readonly env: 'open' | 'radiation' | 'gravitational' | 'debris';
  readonly material: 'common' | 'uncommon' | 'rare';
  /** Ship sheet MIN (sum of mining_rig `min` stats). */
  readonly minerMin: number;
  /** Miner part condition (%) feeding the S4.2 performance table. */
  readonly minerCondition: number;
  /** Per-attempt find chance. */
  readonly chance: number;
}

/** chance = richness(env) × (1 − rarity(material)) × efficiency,
 *  efficiency = MIN × performance(minerCondition), over mining.attempts_per_stop tries. */
export const MINING_CASES: readonly MiningCase[] = [
  {
    name: 'pristine miner on debris, common ore',
    env: 'debris',
    material: 'common',
    minerMin: 1,
    minerCondition: 100,
    chance: 0.42,
  },
  {
    name: 'starter-condition miner (80%) on debris, common ore',
    env: 'debris',
    material: 'common',
    minerMin: 1,
    minerCondition: 80,
    chance: 0.378,
  },
  {
    name: 'pristine miner on open field, rare ore',
    env: 'open',
    material: 'rare',
    minerMin: 1,
    minerCondition: 100,
    chance: 0.03,
  },
  {
    name: 'half-worn miner in radiation, uncommon ore',
    env: 'radiation',
    material: 'uncommon',
    minerMin: 1,
    minerCondition: 50,
    chance: 0.105,
  },
  {
    name: 'twin rigs on gravitational field, common ore',
    env: 'gravitational',
    material: 'common',
    minerMin: 2,
    minerCondition: 100,
    chance: 0.42,
  },
  {
    name: 'pristine miner on debris, rare ore',
    env: 'debris',
    material: 'rare',
    minerMin: 1,
    minerCondition: 100,
    chance: 0.09,
  },
];

// ---------------------------------------------------------------------------
// Rescue deadline [S6.2]
// ---------------------------------------------------------------------------

export interface RescueDeadlineCase {
  readonly roundTripSecondsAtReferenceMob: number;
  readonly factor: number;
  readonly deadlineSeconds: number;
}

/** deadline = round-trip time at rescue.reference_mob × uniform(factor_min, factor_max).
 *  The ≥1.5 case is Appendix E's calibration point: a MOB 2 ship needs factor ≥ 1.5. */
export const RESCUE_DEADLINE_CASES: readonly RescueDeadlineCase[] = [
  { roundTripSecondsAtReferenceMob: 600, factor: 1.25, deadlineSeconds: 750 },
  { roundTripSecondsAtReferenceMob: 600, factor: 1.5, deadlineSeconds: 900 },
  { roundTripSecondsAtReferenceMob: 600, factor: 2.0, deadlineSeconds: 1200 },
  { roundTripSecondsAtReferenceMob: 900, factor: 1.25, deadlineSeconds: 1125 },
];

// ---------------------------------------------------------------------------
// Escort [S5.9]
// ---------------------------------------------------------------------------

export interface EscortShareCase {
  readonly incomingAttacks: number;
  readonly clientTakes: number;
  readonly playerTakes: number;
}

/** The client absorbs escort.client_target_share of enemy attacks; the rest hit the player.
 *  Only totals whose share is an integer are pinned — rounding for other totals is S5.9's call. */
export const ESCORT_SHARE_CASES: readonly EscortShareCase[] = [
  { incomingAttacks: 0, clientTakes: 0, playerTakes: 0 },
  { incomingAttacks: 5, clientTakes: 2, playerTakes: 3 },
  { incomingAttacks: 10, clientTakes: 4, playerTakes: 6 },
  { incomingAttacks: 15, clientTakes: 6, playerTakes: 9 },
  { incomingAttacks: 20, clientTakes: 8, playerTakes: 12 },
];

// ---------------------------------------------------------------------------
// Ship class [S4.2] — display label only; first match wins
// ---------------------------------------------------------------------------

export const SHIP_CLASS_PRECEDENCE = [
  'HAULER',
  'TRANSPORT',
  'WARSHIP',
  'MINER',
  'MULTIROLE',
] as const;
