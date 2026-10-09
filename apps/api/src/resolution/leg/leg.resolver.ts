import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { fuelUnits } from '../../economy/fuel-cost.calculator.js';
import type { ShipSheet } from '../../ships/sheet.types.js';
import { isDead } from '../../parts/condition.js';
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
import { rollPirateDemand, type StoredPart } from '../encounter/pirate-motive.js';
import type { CombatSheet, CombatSide } from '../combat/combat.types.js';
import {
  applyIntegrityLoss,
  combatIntegrityLoss,
  environmentIntegrityLoss,
  escortIntegrity,
} from '../object/integrity.js';
import type { MiningStop, MinerRig, MiningYield } from '../mining/mining.resolver.js';
import { resolveMining, toMiningLootEvents } from '../mining/mining.resolver.js';
import { missionEvent } from '../events/mission-event.js';
import type {
  MissionActors,
  MissionCombatRound,
  MissionDamageCascade,
  MissionEvent,
  MissionLoot,
} from '../events/mission-event.js';
import {
  applyWear,
  countDefenseParts,
  partAmbientWear,
  partDefeatWear,
  defeatWear,
} from '../wear/wear.calculator.js';
import { rollChokes, type FailureEvent } from '../wear/failure.resolver.js';
import { allocatePower, successChance, type PowerPart } from '../power/power.js';
import { roundHalfEven } from '../numeric/round-half-even.js';
import {
  applyHit,
  environmentDamage,
  settleLosses,
  type DamageLayers,
} from '../damage/layers.js';

export type LegStatus =
  'completed' | 'motor_abort' | 'adrift' | 'escort_destroyed' | 'defeat_failed';

export interface PartSnapshot {
  readonly id: string;
  readonly partClass: string;
  readonly providesEsc: boolean;
  readonly condition: number;
  /** The part adds to the armor pool (so armor lost wears it down). */
  readonly providesArmor?: boolean;
  /** What the part gives to or takes from the ship's power (layered model). */
  readonly power?: PowerPart;
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
  /** Parts kept in storage when the ship left port: what a pirate may take (never installed ones). */
  readonly storage: readonly StoredPart[];
  /** Scavenging on foot: the ship stays put, so nothing finds it and nothing wears. */
  readonly onFoot?: boolean;
}

export interface LegShipState {
  readonly shipId: string;
  readonly parts: readonly PartSnapshot[];
  readonly sheet: ShipSheet;
  /** Remaining fuel units on board. */
  readonly fuel: number;
  readonly hp: number;
  readonly esc: number;
  readonly energyMode?: 'BATTERY' | 'FULL' | 'OVERRIDE';
  readonly weaponEnergyDraw: number;
  readonly shieldEnergyDraw: number;
  /**
   * Layered damage model (absent = legacy per-part wear and flat armor). `hp`/`esc` above are the
   * hull and shield pools; these complete the picture: the armor pool, the sizes the pools
   * started at, the shield's regeneration and what has already been written back to the parts.
   */
  readonly armor?: number;
  readonly armorMax?: number;
  readonly hpMax?: number;
  readonly escMax?: number;
  readonly escRegen?: number;
  readonly escRegenEnergy?: number;
  readonly spill?: number;
  /** Engines generate this share of their power this leg (a failed tank pump makes them struggle). */
  readonly engineFactor?: number;
  /** Energy in the batteries now, their size, and how much they recharge per leg from spare power. */
  readonly battery?: number;
  readonly batteryMax?: number;
  readonly batteryRecharge?: number;
  readonly settled?: { readonly hp: number; readonly armor: number; readonly spill: number };
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

/** The ship's damage layers, or null when it plays by the legacy model. */
function layersOf(ship: LegShipState): DamageLayers | null {
  if (ship.armor === undefined) return null;
  const hpMax = ship.hpMax ?? ship.hp;
  const armorMax = ship.armorMax ?? ship.armor;
  return {
    hp: ship.hp,
    esc: ship.esc,
    armor: ship.armor,
    spill: ship.spill ?? 0,
    hpMax,
    armorMax,
    settled: ship.settled ?? { hp: hpMax, armor: armorMax, spill: 0 },
  };
}

function conditionsOf(parts: readonly PartSnapshot[]): Record<string, number> {
  return Object.fromEntries(parts.map((part) => [part.id, part.condition]));
}

/** How the ship's power sharing shows up in a fight: sensors, weapons and shield by what they get. */
function combatPowerFor(
  ship: LegShipState,
  rules: GameRules,
): { sen: number; weaponPower?: number; shieldPower?: number } {
  const powerParts = ship.parts.flatMap((part) => (part.power ? [part.power] : []));
  if (ship.armor === undefined || powerParts.length === 0) return { sen: ship.sheet.sen };
  const state = allocatePower(powerParts, 'combat', rules, ship.engineFactor ?? 1);
  return {
    sen: ship.sheet.sen * successChance(state.byKind.sensor, rules),
    weaponPower: successChance(state.byKind.weapon, rules),
    shieldPower: successChance(state.byKind.shield, rules),
  };
}

function combatSheetFor(ship: LegShipState, flags: LegChokeFlags, rules: GameRules): CombatSheet {
  const power = combatPowerFor(ship, rules);
  return {
    ...(power.weaponPower !== undefined
      ? { weaponPower: power.weaponPower, shieldPower: power.shieldPower ?? 1 }
      : {}),
    ...(ship.armor !== undefined
      ? {
          armor: ship.armor,
          escMax: ship.escMax ?? ship.esc,
          escRegen: ship.escRegen ?? 0,
          escRegenEnergy: ship.escRegenEnergy ?? 0,
          ...(ship.battery !== undefined ? { battery: ship.battery } : {}),
        }
      : {}),
    pdf: ship.sheet.pdf,
    bli: ship.sheet.bli,
    esc: flags.shieldOffline ? 0 : ship.esc,
    sen: power.sen,
    hp: ship.hp,
    mob: ship.sheet.mob,
    energyMode: ship.energyMode,
    batOutput: ship.sheet.batOutput,
    energyCont: ship.sheet.energyCont,
    weaponEnergyDraw: ship.weaponEnergyDraw,
    shieldEnergyDraw: ship.shieldEnergyDraw,
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

  // Scavenging on foot: the pilot searches the place without the ship, so nothing finds the
  // ship (no encounter), nothing wears it and no fuel is burned.
  if (input.context.onFoot === true) {
    return {
      index: input.index,
      status: 'completed',
      events,
      ship: input.ship,
      objectIntegrity: input.objectIntegrity,
      client: input.context.client,
      loot: [],
      chokeFlags: NO_FLAGS,
      encounter: null,
      combatResult: null,
      combatCredits: 0,
    };
  }

  // Tank burns raw units (sim fuel_gasto), not the credit-denominated fuelCost —
  // charging the priced figure to the tank drained it fuel_price× too fast and
  // double-spent the same units against the wallet.
  const baseBurn = fuelUnits({
    fuelUse: input.ship.sheet.fuelUse,
    distance: input.route.distance,
    envFuelMult: input.route.env.fuelMult,
  });

  // Power sharing (layered model). The tank pump rolls to push fuel this leg: if it fails, the
  // engines struggle (they generate less, which starves the rest further) and the leg wastes fuel.
  // Resolved once per leg, so a bad leg can only get a bounded amount worse.
  const powerRng = rng.child('power');
  const powerParts = input.ship.parts.flatMap((part) => (part.power ? [part.power] : []));
  const layeredPower = input.ship.armor !== undefined && powerParts.length > 0;
  const powerSituation = input.context.mining !== null ? 'mining' : 'cruise';
  let engineFactor = 1;
  let wastedFuel = 0;
  let cruisePower = layeredPower ? allocatePower(powerParts, powerSituation, rules) : null;
  if (cruisePower !== null && powerParts.some((part) => part.kind === 'pump')) {
    const chance = successChance(cruisePower.byKind.pump, rules);
    if (chance < 1 && powerRng.float() >= chance) {
      engineFactor = rules.power.pump_engine_factor;
      cruisePower = allocatePower(powerParts, powerSituation, rules, engineFactor);
      wastedFuel = baseBurn * (rules.power.pump_fuel_factor - 1);
    }
  }
  const fuelBurned = baseBurn + wastedFuel;

  // 1. Fuel gate — exhausted before the leg starts → adrift, not death.
  if (fuelBurned > input.ship.fuel) {
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
      remainingFuel: input.ship.fuel - fuelBurned,
    })),
    rules,
    chokeRng,
  );

  let parts = input.ship.parts.map((part) => ({ ...part }));
  let fuel = input.ship.fuel - fuelBurned;

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
        // S9.0: what the choke did. The simulation above deducts the exact
        // float fuel; missionEvent() stores fuelLost integer-normalized.
        consequence: event.consequence,
        fuelLost: event.fuelLost,
      }),
    );
  }

  // A chokeEvent of type 'motor' means ONE engine failed this leg, not that the ship is
  // dead in the water — a ship with a second, still-working engine keeps going. Abort only
  // when every installed ENGINE part is either already dead or just choked this leg
  // (owner playtest: lost a redundant engine and the mission failed anyway even though
  // another engine could still push the ship).
  const chokedMotorPartIds = new Set(
    chokeEvents.filter((event) => event.type === 'motor').map((event) => event.partId),
  );
  const engineParts = input.ship.parts.filter((part) => part.partClass === 'ENGINE');
  const motorAbort =
    engineParts.length > 0 &&
    engineParts.every(
      (part) => isDead(part.condition, rules) || chokedMotorPartIds.has(part.id),
    );

  events.push(
    missionEvent({
      leg: input.index,
      category: 'transit',
      type: 'leg_travel',
      actors,
      magnitude: input.route.distance,
      // Fuel left the tank (inventory), not the wallet — prepaid once S8.3 refuel
      // exists. Keeping credits at 0 stops creditsDelta from double-charging fuel
      // that already drained ship.fuel above.
      credits: 0,
    }),
  );

  const chokeFlags = applyChokeFlags(chokeEvents);
  if (wastedFuel > 0) {
    events.push(
      missionEvent({
        leg: input.index,
        category: 'failure',
        type: 'tank',
        actors,
        magnitude: 0,
        consequence: 'fuel_leak',
        fuelLost: wastedFuel,
      }),
    );
  }

  let ship: LegShipState = {
    ...input.ship,
    parts,
    fuel,
    ...(engineFactor < 1 ? { engineFactor } : {}),
    // Layered model: a shield fully recovers between legs (energy is free while nobody shoots),
    // and any spare power the ship generates tops the batteries up a little.
    ...(input.ship.armor !== undefined ? { esc: input.ship.escMax ?? input.ship.esc } : {}),
    ...(input.ship.battery !== undefined
      ? {
          battery: Math.min(
            input.ship.batteryMax ?? input.ship.battery,
            input.ship.battery +
              ((input.ship.sheet.energyCont ?? 0) > 0 ? (input.ship.batteryRecharge ?? 0) : 0),
          ),
        }
      : {}),
  };
  let objectIntegrity = input.objectIntegrity;
  let client = input.context.client;
  let loot: MissionLoot[] = [];
  let combatResult: LegOutcome['combatResult'] = null;
  let combatCredits = 0;

  // The journey's own damage for this leg. Layered model: one hit through shield, armor and
  // hull (written back onto the parts); legacy model: per-part ambient wear.
  const applyEnvironment = (): void => {
    const layers = layersOf(ship);
    const partsBeforeWear = ship.parts;
    // Scavenging is manual work at the place: the ship never travels, so no journey damage.
    if (input.context.type === 'SCAVENGE') return;
    if (layers !== null) {
      const damage = environmentDamage(
        input.route.danger,
        input.route.env.level,
        rules,
        wearRng,
        wearScaleFor(input.context.type, rules),
      );
      const hit = applyHit(layers, damage);
      const settled = settleLosses(ship.parts, hit.layers, rules);
      ship = {
        ...ship,
        hp: hit.layers.hp,
        esc: hit.layers.esc,
        armor: hit.layers.armor,
        spill: hit.layers.spill,
        parts: settled.parts,
        settled: settled.settled,
      };
      parts = [...settled.parts];
      events.push(
        ...wearEvents(
          input.index,
          actors,
          partsBeforeWear,
          new Map(settled.parts.map((part) => [part.id, part.condition])),
          { shield: hit.shield, armor: hit.armor, hp: hit.hull + hit.spill },
        ),
      );
      return;
    }
    const wearMap = applyPartsWear(
      ship.parts,
      input.route.danger,
      input.route.env.level,
      rules,
      wearRng,
      wearScaleFor(input.context.type, rules),
    );
    parts = mergeConditions(ship.parts, wearMap);
    ship = { ...ship, parts };
    events.push(...wearEvents(input.index, actors, partsBeforeWear, wearMap));
  };

  // Motor abort: fuel burned + wear still apply; no encounter, no pay path.
  if (motorAbort) {
    applyEnvironment();
    objectIntegrity = applyIntegrityLoss(
      objectIntegrity,
      environmentIntegrityLoss(input.route.env.level, rules),
    );
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
  const pirate = generatePirate(
    combatSheetFor(ship, chokeFlags, rules),
    rules,
    encounterRng,
    rules.encounter.pirate_zone_strength[String(input.route.zone)],
  );
  const encounter: EncounterOutcome = resolveEncounter(
    {
      zone: input.route.zone,
      danger: input.route.danger,
      escortLeg: input.context.type === 'ESCORT',
      isPvp: false,
      player: {
        sheet: combatSheetFor(ship, chokeFlags, rules),
        preset: input.context.preset,
        sensorAlive: chokeFlags.sensorAlive,
      },
      enemy: { sheet: pirate },
      // The ship met is a generated pirate: hostile to everyone, whatever the employer thinks of
      // the player's faction (that relation is about the employer, not about who attacks).
      relation: 'HOSTILE',
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
      ? { hp: result.final.hpA, esc: result.final.escA, armor: result.final.armA }
      : { hp: result.final.hpB, esc: result.final.escB, armor: result.final.armB };
    const hpLost = Math.max(0, hpBefore - final.hp);
    // S9.0 / GDD §15: how the fight's damage split across the player's layers
    // (shields → armor → hull). One fight-level triple, attached to every
    // combat event of this fight; the escort share is a separate effect.
    const cascade = fightCascade(result.rounds, playerIsA ? 'A' : 'B', hpLost);
    // Round-4 playtest request: the raw attack-by-attack log, same attachment pattern as
    // cascade (cascade is just this array's own totals) — translated to player/enemy so the
    // report never has to know which side held slot A.
    const combatRounds: MissionCombatRound[] = result.rounds.map((attack) => ({
      round: attack.round,
      attacker: (attack.attacker === 'A') === playerIsA ? 'player' : 'enemy',
      roll: attack.roll,
      pdf: attack.pdf,
      bonus: attack.bonus,
      dc: attack.dc,
      hit: attack.hit,
      damage: attack.damage,
      armorAbsorbed: attack.armorAbsorbed,
      shieldAbsorbed: attack.shieldAbsorbed,
      // Layered model: the armor pool soaks real damage, so the hull only takes what is left.
      hullDamage:
        attack.armorAfter !== undefined
          ? attack.damage - attack.shieldAbsorbed - attack.armorAbsorbed
          : attack.damage - attack.shieldAbsorbed,
      // Pools after the hit, in the player's own terms (only defender-side hits move them).
      ...(attack.armorAfter !== undefined && (attack.attacker === 'A') !== playerIsA
        ? { shieldAfter: attack.escAfter, armorAfter: attack.armorAfter }
        : {}),
    }));
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
          cascade,
          rounds: combatRounds,
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

    // Layered model: what the fight cost in shield, armor and hull is written back onto the
    // parts right away, so the report attributes it to the fight (their condition rides on the
    // fight's own events). Nothing else wears the parts in a fight.
    let combatCondition: Record<string, number> | undefined;
    if (final.armor !== undefined) {
      const batteryLeft = playerIsA ? result.final.batA : result.final.batB;
      ship = {
        ...ship,
        hp,
        esc,
        armor: final.armor,
        ...(batteryLeft !== undefined ? { battery: batteryLeft } : {}),
      };
      const layers = layersOf(ship);
      if (layers !== null) {
        const settled = settleLosses(ship.parts, layers, rules);
        ship = { ...ship, parts: settled.parts, settled: settled.settled };
        parts = [...settled.parts];
        combatCondition = conditionsOf(parts);
      }
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
          ...(combatCondition !== undefined ? { condByPart: combatCondition } : {}),
          cascade,
          rounds: combatRounds,
        }),
      );
      objectIntegrity = applyIntegrityLoss(
        objectIntegrity,
        combatIntegrityLoss(hpBefore, Math.max(0, hpBefore - hp), rules),
      );
    } else if (winner === 'enemy') {
      combatResult = 'loss';
      combatCredits = -rules.economy.combat_loss_penalty;
      // Legacy model only: a lost fight wore every part directly. In the layered model the
      // hull, armor and shield it cost were already written back above.
      if (final.armor === undefined) {
        const defeatLoss = defeatWear(rules, wearRng.child('defeat'));
        const defenseCount = countDefenseParts(parts);
        parts = parts.map((part) => ({
          ...part,
          condition: applyWear(
            part.condition,
            partDefeatWear(part.partClass, defeatLoss, defenseCount, rules),
          ),
        }));
      }
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
          cascade,
          rounds: combatRounds,
        }),
      );
      objectIntegrity = applyIntegrityLoss(
        objectIntegrity,
        combatIntegrityLoss(hpBefore, Math.max(0, hpBefore - hp), rules),
      );
      // The pirate who won says what it wanted (seeded, on its own RNG stream so nothing else moves).
      const demand = rollPirateDemand(
        { objectCarried: input.context.objectCarried, storage: input.context.storage },
        rules,
        encounterRng.child('motive'),
      );
      events.push(
        missionEvent({
          leg: input.index,
          category: 'failure',
          type: 'pirate_demand',
          actors: { ...actors, enemy: 'pirate' },
          magnitude: demand.stolen.length,
          motive: demand.motive,
          stolen: demand.stolen,
        }),
      );
      ship = { ...ship, parts, hp, esc };
      // Cargo taken, or driven off their territory: the mission is over.
      if (input.context.objectCarried || demand.motive === 'territory') {
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
      if (winner === 'draw') {
        // Nobody won: the fight still happened and still cost hull, so the report says so.
        events.push(
          missionEvent({
            leg: input.index,
            category: 'combat',
            type: 'combat_draw',
            actors: { ...actors, enemy: 'pirate' },
            magnitude: 0,
            hp: hp - hpBefore,
            ...(combatCondition !== undefined ? { condByPart: combatCondition } : {}),
            cascade,
            rounds: combatRounds,
          }),
        );
      }
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
    // Slipping away is part of the story too: the report says so.
    events.push(
      missionEvent({
        leg: input.index,
        category: 'combat',
        type: 'escaped',
        actors: { ...actors, enemy: 'pirate' },
        magnitude: 0,
        hp: 0,
      }),
    );
  } else if (encounter.encountered && encounter.decision === 'IGNORE') {
    combatResult = 'ignore';
  }

  // 4. Environment damage + integrity.
  applyEnvironment();
  objectIntegrity = applyIntegrityLoss(
    objectIntegrity,
    environmentIntegrityLoss(input.route.env.level, rules),
  );

  // Escort object integrity IS the client HP share (Appendix E identity).
  if (input.context.type === 'ESCORT' && client !== null) {
    objectIntegrity = escortIntegrity(client.hp, client.maxHp);
  }

  // 5. Mining (purpose stream) — free or contracted stops.
  if (input.context.mining !== null) {
    // A rig that gets only part of its power digs less (or nothing).
    const rigPower = cruisePower === null ? 1 : successChance(cruisePower.byKind.rig, rules);
    const yields = resolveMining(
      input.context.mining.stop,
      { ...input.context.mining.miner, min: input.context.mining.miner.min * rigPower },
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

/** How much of the usual ambient wear a mission type's parts take (mining runs are eased). */
function wearScaleFor(type: MissionType, rules: GameRules): number {
  return type === 'MINING' ? rules.wear.mining_wear_factor : 1;
}

function applyPartsWear(
  parts: readonly PartSnapshot[],
  danger: number,
  envNivel: number,
  rules: GameRules,
  rng: Rng,
  scale = 1,
): ReadonlyMap<string, number> {
  const next = new Map<string, number>();
  const defenseCount = countDefenseParts(parts);
  for (const part of parts) {
    const loss =
      partAmbientWear(part.partClass, danger, envNivel, defenseCount, rules, rng) * scale;
    next.set(part.id, applyWear(part.condition, loss));
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

/**
 * S9.0 layer split: sums what the player's ship soaked across a fight —
 * attacks against `playerSide` only (misses contribute 0 by construction),
 * with `hpLost` = hull-pool damage taken (`hpBefore − finalHp`, pre escort share).
 */
function fightCascade(
  rounds: readonly {
    readonly attacker: CombatSide;
    readonly armorAbsorbed: number;
    readonly shieldAbsorbed: number;
  }[],
  playerSide: CombatSide,
  hpLost: number,
): MissionDamageCascade {
  let shield = 0;
  let armor = 0;
  for (const attack of rounds) {
    if (attack.attacker === playerSide) continue;
    shield += attack.shieldAbsorbed;
    armor += attack.armorAbsorbed;
  }
  return { shield, armor, hp: hpLost };
}

function wearEvents(
  leg: number,
  actors: MissionActors,
  parts: readonly PartSnapshot[],
  wearMap: ReadonlyMap<string, number>,
  cascade?: MissionDamageCascade,
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
      ...(cascade !== undefined ? { cascade } : {}),
    }),
  ];
}
