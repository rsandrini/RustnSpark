import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { fuelCost } from '../../economy/fuel-cost.calculator.js';
import type { ShipSheet } from '../../ships/sheet.types.js';
import { resolveEncounter } from '../encounter/encounter.resolver.js';
import type { EncounterOutcome } from '../encounter/encounter.resolver.js';
import type { EscapePreset } from '../encounter/escape.resolver.js';
import type {
  FactionRelation,
  MissionType,
  PolicyDecision,
  Stance,
} from '../encounter/encounter-policy.js';
import { generatePirate } from '../encounter/pirate.generator.js';
import type { CombatSheet } from '../combat/combat.types.js';
import {
  applyIntegrityLoss,
  combatIntegrityLoss,
  environmentIntegrityLoss,
  escortIntegrity,
} from '../object/integrity.js';
import type { MiningStop, MinerRig, MiningYield } from '../mining/mining.resolver.js';
import { resolveMining, toMiningLootEvents } from '../mining/mining.resolver.js';
import { missionEvent } from '../events/mission-event.js';
import type { MissionActors, MissionEvent, MissionLoot } from '../events/mission-event.js';
import { applyWear, missionWear, defeatWear } from '../wear/wear.calculator.js';
import { rollChokes, type FailureEvent } from '../wear/failure.resolver.js';
import { roundHalfEven } from '../numeric/round-half-even.js';

export type LegStatus =
  'completed' | 'motor_abort' | 'adrift' | 'escort_destroyed' | 'defeat_failed';

export interface PartSnapshot {
  readonly id: string;
  readonly partClass: string;
  readonly providesEsc: boolean;
  readonly condition: number;
}

export interface LegRoute {
  // Present on every filler-generated leg (S7.2 dispatch keys RoutePresence by it);
  // optional so resolution fixtures and hand-built legs stay minimal.
  readonly routeId?: string;
  readonly distance: number;
  readonly danger: number;
  readonly zone: number;
  readonly env: {
    readonly id: string;
    readonly level: number;
    readonly fuelMult: number;
  };
}

export interface EscortClient {
  readonly shipId: string;
  readonly maxHp: number;
  readonly hp: number;
}

export interface LegMissionContext {
  readonly type: MissionType;
  readonly tier: number;
  readonly isolation: number;
  readonly factionRelation: string;
  readonly relation: FactionRelation;
  readonly stance: Stance | null;
  readonly preset: EscapePreset;
  readonly missionOwner: 'player' | 'enemy' | null;
  readonly missionForcesFlee: boolean;
  /** Cargo / passengers / rescuee aboard — combat defeat fails the mission. */
  readonly objectCarried: boolean;
  readonly client: EscortClient | null;
  readonly mining: { readonly stop: MiningStop; readonly miner: MinerRig } | null;
}

export interface LegShipState {
  readonly shipId: string;
  readonly parts: readonly PartSnapshot[];
  readonly sheet: ShipSheet;
  /** Remaining fuel units on board. */
  readonly fuel: number;
  readonly hp: number;
  readonly esc: number;
}

export interface LegInput {
  readonly index: number;
  readonly route: LegRoute;
  readonly ship: LegShipState;
  readonly context: LegMissionContext;
  /** Current object integrity 0–100 (cargo/passenger/rescuee). */
  readonly objectIntegrity: number;
}

export interface LegChokeFlags {
  readonly sensorAlive: boolean;
  readonly shieldOffline: boolean;
  readonly nextHitBypasses: boolean;
  readonly weaponJam: boolean;
}

export interface LegOutcome {
  readonly index: number;
  readonly status: LegStatus;
  readonly events: readonly MissionEvent[];
  readonly ship: LegShipState;
  readonly objectIntegrity: number;
  readonly client: EscortClient | null;
  readonly loot: readonly MissionLoot[];
  readonly chokeFlags: LegChokeFlags;
  readonly encounter: EncounterOutcome | null;
  readonly combatResult: 'win' | 'loss' | 'escape' | 'ignore' | null;
  readonly combatCredits: number;
}

const NO_FLAGS: LegChokeFlags = {
  sensorAlive: true,
  shieldOffline: false,
  nextHitBypasses: false,
  weaponJam: false,
};

/**
 * Client absorbs `escort.client_target_share` of incoming attacks (Appendix E
 * ESCORT_SHARE_CASES, tagged [S5.9]). Integer totals are pinned; other
 * totals use half-even rounding.
 */
export function escortAttackShare(
  incomingAttacks: number,
  rules: GameRules,
): { readonly clientTakes: number; readonly playerTakes: number } {
  const clientTakes = roundHalfEven(incomingAttacks * rules.escort.client_target_share);
  return { clientTakes, playerTakes: incomingAttacks - clientTakes };
}

function applyChokeFlags(events: readonly FailureEvent[]): LegChokeFlags {
  let flags = { ...NO_FLAGS };
  for (const event of events) {
    if (event.type === 'sensor') {
      flags = { ...flags, sensorAlive: false };
    } else if (event.type === 'battery') {
      flags = { ...flags, shieldOffline: true };
    } else if (event.type === 'shield') {
      flags = { ...flags, nextHitBypasses: true };
    } else if (event.type === 'weapon') {
      flags = { ...flags, weaponJam: true };
    }
  }
  return flags;
}

function combatSheetFor(ship: LegShipState, flags: LegChokeFlags): CombatSheet {
  return {
    pdf: ship.sheet.pdf,
    bli: ship.sheet.bli,
    esc: flags.shieldOffline ? 0 : ship.esc,
    sen: ship.sheet.sen,
    hp: ship.hp,
    mob: ship.sheet.mob,
  };
}

/**
 * Resolves one leg: fuel gate → chokes → encounter/combat → wear/integrity
 * (→ mining when configured). Purpose-separated child streams are created by
 * the mission resolver; `rng` is the leg-level stream (ScriptedRng flattens
 * children for tape parity).
 *
 * Fuel exhaustion ends the leg as `adrift` — the ship never dies (S5.9).
 * Motor choke aborts the leg and fails the mission: fuel still burned, wear
 * still applied, no pay (Appendix E).
 */
export function resolveLeg(input: LegInput, rules: GameRules, rng: Rng): LegOutcome {
  const events: MissionEvent[] = [];
  const actors: MissionActors = {
    playerShipId: input.ship.shipId,
    ...(input.context.client ? { clientShipId: input.context.client.shipId } : {}),
  };
  const chokeRng = rng.child('choke');
  const encounterRng = rng.child('encounter');
  const wearRng = rng.child('wear');
  const miningRng = rng.child('mining');

  const fuelUnits = fuelCost(
    {
      fuelUse: input.ship.sheet.fuelUse,
      distance: input.route.distance,
      envFuelMult: input.route.env.fuelMult,
      isolation: input.context.isolation,
      factionRelation: input.context.factionRelation,
    },
    rules,
  );

  // 1. Fuel gate — exhausted before the leg starts → adrift, not death.
  if (fuelUnits > input.ship.fuel) {
    events.push(
      missionEvent({
        leg: input.index,
        category: 'transit',
        type: 'fuel_exhausted',
        actors,
        magnitude: input.ship.fuel,
        credits: 0,
      }),
    );
    return {
      index: input.index,
      status: 'adrift',
      events,
      ship: { ...input.ship, fuel: 0 },
      objectIntegrity: input.objectIntegrity,
      client: input.context.client,
      loot: [],
      chokeFlags: NO_FLAGS,
      encounter: null,
      combatResult: null,
      combatCredits: 0,
    };
  }

  // 2. Chokes — once per leg per critical part (Appendix E).
  const chokeEvents = rollChokes(
    input.ship.parts.map((part) => ({
      partId: part.id,
      partClass: part.partClass,
      condition: part.condition,
      providesEsc: part.providesEsc,
      remainingFuel: input.ship.fuel - fuelUnits,
    })),
    rules,
    chokeRng,
  );

  let parts = input.ship.parts.map((part) => ({ ...part }));
  let fuel = input.ship.fuel - fuelUnits;
  const motorAbort = chokeEvents.some((event) => event.type === 'motor');

  for (const event of chokeEvents) {
    const idx = parts.findIndex((part) => part.id === event.partId);
    const existing = idx >= 0 ? parts[idx] : undefined;
    if (existing !== undefined) {
      parts[idx] = { ...existing, condition: event.conditionAfter };
    }
    if (event.fuelLost !== undefined) {
      fuel = Math.max(0, fuel - event.fuelLost);
    }
    events.push(
      missionEvent({
        leg: input.index,
        category: 'failure',
        type: event.type,
        actors,
        magnitude: event.conditionLost,
        condByPart: { [event.partId]: event.conditionAfter },
        credits: 0,
      }),
    );
  }

  events.push(
    missionEvent({
      leg: input.index,
      category: 'transit',
      type: 'leg_travel',
      actors,
      magnitude: input.route.distance,
      credits: -fuelUnits,
    }),
  );

  const chokeFlags = applyChokeFlags(chokeEvents);
  let ship: LegShipState = {
    ...input.ship,
    parts,
    fuel,
  };
  let objectIntegrity = input.objectIntegrity;
  let client = input.context.client;
  let loot: MissionLoot[] = [];
  let combatResult: LegOutcome['combatResult'] = null;
  let combatCredits = 0;

  // Motor abort: fuel burned + wear still apply; no encounter, no pay path.
  if (motorAbort) {
    const wearMap = applyPartsWear(parts, input.route.env.level, rules, wearRng);
    parts = mergeConditions(parts, wearMap);
    ship = { ...ship, parts };
    objectIntegrity = applyIntegrityLoss(
      objectIntegrity,
      environmentIntegrityLoss(input.route.env.level, rules),
    );
    events.push(...wearEvents(input.index, actors, parts, wearMap));
    return {
      index: input.index,
      status: 'motor_abort',
      events,
      ship,
      objectIntegrity,
      client,
      loot,
      chokeFlags,
      encounter: null,
      combatResult: null,
      combatCredits: 0,
    };
  }

  // 3. Encounter (D17: per leg).
  const pirate = generatePirate(combatSheetFor(ship, chokeFlags), rules, encounterRng);
  const encounter: EncounterOutcome = resolveEncounter(
    {
      zone: input.route.zone,
      danger: input.route.danger,
      escortLeg: input.context.type === 'ESCORT',
      isPvp: false,
      player: {
        sheet: combatSheetFor(ship, chokeFlags),
        preset: input.context.preset,
        sensorAlive: chokeFlags.sensorAlive,
      },
      enemy: { sheet: pirate },
      relation: input.context.relation,
      mission: input.context.type,
      missionForcesFlee: input.context.missionForcesFlee,
      huntTargetMatch: false,
      stance: input.context.stance,
      enemyDecision: 'ATTACK' satisfies PolicyDecision,
      missionOwner: input.context.missionOwner,
    },
    rules,
    encounterRng,
  );

  const hpBefore = ship.hp;

  if (encounter.combat !== null) {
    const { result, playerIsA, winner } = encounter.combat;
    const final = playerIsA
      ? { hp: result.final.hpA, esc: result.final.escA }
      : { hp: result.final.hpB, esc: result.final.escB };
    const hpLost = Math.max(0, hpBefore - final.hp);
    let hp: number;
    let esc: number;

    // Escort: client absorbs share of incoming damage (Appendix E).
    if (client !== null && hpLost > 0) {
      const { clientTakes } = escortAttackShare(hpLost, rules);
      const toPlayer = hpLost - clientTakes;
      hp = hpBefore - toPlayer;
      esc = final.esc;
      client = { ...client, hp: Math.max(0, client.hp - clientTakes) };
      events.push(
        missionEvent({
          leg: input.index,
          category: 'combat',
          type: 'escort_absorbed',
          actors,
          magnitude: clientTakes,
          hp: -toPlayer,
        }),
      );
      if (client.hp <= 0) {
        events.push(
          missionEvent({
            leg: input.index,
            category: 'failure',
            type: 'escort_client_destroyed',
            actors,
            magnitude: client.maxHp,
          }),
        );
        return {
          index: input.index,
          status: 'escort_destroyed',
          events,
          ship: { ...ship, hp, esc },
          objectIntegrity: 0,
          client,
          loot,
          chokeFlags,
          encounter,
          combatResult: 'loss',
          combatCredits: 0,
        };
      }
    } else {
      hp = final.hp;
      esc = final.esc;
    }

    if (winner === 'player') {
      combatResult = 'win';
      combatCredits =
        rules.economy.combat_win_base + input.context.tier * rules.economy.combat_win_per_tier;
      events.push(
        missionEvent({
          leg: input.index,
          category: 'combat',
          type: 'combat_win',
          actors: { ...actors, enemy: 'pirate' },
          magnitude: combatCredits,
          hp: hp - hpBefore,
          credits: combatCredits,
        }),
      );
      objectIntegrity = applyIntegrityLoss(
        objectIntegrity,
        combatIntegrityLoss(hpBefore, Math.max(0, hpBefore - hp), rules),
      );
    } else if (winner === 'enemy') {
      combatResult = 'loss';
      combatCredits = -rules.economy.combat_loss_penalty;
      const defeatLoss = defeatWear(rules, wearRng.child('defeat'));
      parts = parts.map((part) => ({
        ...part,
        condition: applyWear(part.condition, defeatLoss),
      }));
      events.push(
        missionEvent({
          leg: input.index,
          category: 'combat',
          type: 'combat_loss',
          actors: { ...actors, enemy: 'pirate' },
          magnitude: combatCredits,
          hp: hp - hpBefore,
          credits: combatCredits,
          condByPart: Object.fromEntries(parts.map((part) => [part.id, part.condition])),
        }),
      );
      objectIntegrity = applyIntegrityLoss(
        objectIntegrity,
        combatIntegrityLoss(hpBefore, Math.max(0, hpBefore - hp), rules),
      );
      ship = { ...ship, parts, hp, esc };
      if (input.context.objectCarried) {
        return {
          index: input.index,
          status: 'defeat_failed',
          events,
          ship,
          objectIntegrity,
          client,
          loot,
          chokeFlags,
          encounter,
          combatResult,
          combatCredits,
        };
      }
    } else {
      combatResult = winner === 'draw' ? 'loss' : 'escape';
      if (encounter.escaped) {
        combatResult = 'escape';
        events.push(
          missionEvent({
            leg: input.index,
            category: 'combat',
            type: 'escaped',
            actors: { ...actors, enemy: 'pirate' },
            magnitude: 0,
            hp: hp - hpBefore,
          }),
        );
      }
    }
    ship = { ...ship, hp, esc };
  } else if (encounter.escaped) {
    combatResult = 'escape';
  } else if (encounter.encountered && encounter.decision === 'IGNORE') {
    combatResult = 'ignore';
  }

  // 4. Environment wear + integrity (production per-part draws).
  const wearMap = applyPartsWear(ship.parts, input.route.env.level, rules, wearRng);
  parts = mergeConditions(ship.parts, wearMap);
  ship = { ...ship, parts };
  objectIntegrity = applyIntegrityLoss(
    objectIntegrity,
    environmentIntegrityLoss(input.route.env.level, rules),
  );
  events.push(...wearEvents(input.index, actors, parts, wearMap));

  // Escort object integrity IS the client HP share (Appendix E identity).
  if (input.context.type === 'ESCORT' && client !== null) {
    objectIntegrity = escortIntegrity(client.hp, client.maxHp);
  }

  // 5. Mining (purpose stream) — free or contracted stops.
  if (input.context.mining !== null) {
    const yields = resolveMining(
      input.context.mining.stop,
      input.context.mining.miner,
      rules,
      miningRng,
    );
    loot = [...loot, ...yields.flatMap((entry: MiningYield) => [{ ...entry }])];
    for (const lootEvent of toMiningLootEvents(yields)) {
      events.push(
        missionEvent({
          leg: input.index,
          category: 'loot',
          type: lootEvent.type,
          actors,
          magnitude: lootEvent.quantity,
          loot: [{ materialId: lootEvent.materialId, quantity: lootEvent.quantity }],
        }),
      );
    }
  }

  return {
    index: input.index,
    status: 'completed',
    events,
    ship,
    objectIntegrity,
    client,
    loot,
    chokeFlags,
    encounter,
    combatResult,
    combatCredits,
  };
}

function applyPartsWear(
  parts: readonly PartSnapshot[],
  envNivel: number,
  rules: GameRules,
  rng: Rng,
): ReadonlyMap<string, number> {
  const next = new Map<string, number>();
  for (const part of parts) {
    const { total } = missionWear(envNivel, rules, rng);
    next.set(part.id, applyWear(part.condition, total));
  }
  return next;
}

function mergeConditions(
  parts: readonly PartSnapshot[],
  wearMap: ReadonlyMap<string, number>,
): PartSnapshot[] {
  return parts.map((part) => {
    const condition = wearMap.get(part.id);
    return condition === undefined ? { ...part } : { ...part, condition };
  });
}

function wearEvents(
  leg: number,
  actors: MissionActors,
  parts: readonly PartSnapshot[],
  wearMap: ReadonlyMap<string, number>,
): MissionEvent[] {
  const condByPart = Object.fromEntries(
    parts.map((part) => [part.id, wearMap.get(part.id) ?? part.condition]),
  );
  const magnitude = parts.reduce((sum, part) => {
    const after = wearMap.get(part.id) ?? part.condition;
    return sum + Math.max(0, part.condition - after);
  }, 0);
  return [
    missionEvent({
      leg,
      category: 'environment',
      type: 'mission_wear',
      actors,
      magnitude,
      condByPart,
    }),
  ];
}
