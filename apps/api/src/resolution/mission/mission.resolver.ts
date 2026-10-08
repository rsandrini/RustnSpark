import type { Rng } from '../../common/rng/rng.js';
import { createRng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import {
  contractedMiningPayout,
  integrityPayout,
  rewardBase,
} from '../../economy/reward.calculator.js';
import { settleContractedMining } from '../mining/mining.resolver.js';
import { missionEvent } from '../events/mission-event.js';
import type { MissionEvent, MissionLoot } from '../events/mission-event.js';
import {
  resolveLeg,
  type LegInput,
  type LegOutcome,
  type LegRoute,
  type LegShipState,
  type LegMissionContext,
  type EscortClient,
} from '../leg/leg.resolver.js';
import type { EscapePreset } from '../encounter/escape.resolver.js';
import type { FactionRelation, MissionType, Stance } from '../encounter/encounter-policy.js';
import type { MinerRig, MiningStop } from '../mining/mining.resolver.js';
import type { StoredPart } from '../encounter/pirate-motive.js';
import { rollScavengeFinds, type ScavengeContext } from '../scavenge/scavenge.resolver.js';
import { rawMobility } from '../../ships/sheet.deriver.js';
import { resolveRace, type RaceCompetitor } from '../race/race.resolver.js';

export type MissionStatus = 'success' | 'failed' | 'adrift' | 'partial_failure';

export interface MissionSnapshot {
  readonly shipId: string;
  readonly parts: LegShipState['parts'];
  readonly sheet: LegShipState['sheet'];
  readonly fuel: number;
  readonly hp: number;
  readonly esc: number;
  readonly energyMode?: LegShipState['energyMode'];
  readonly weaponEnergyDraw: LegShipState['weaponEnergyDraw'];
  readonly shieldEnergyDraw: LegShipState['shieldEnergyDraw'];
  /** Layered damage model (see LegShipState): the armor pool and the shield's regeneration. */
  readonly armor?: number;
  readonly escRegen?: number;
  readonly escRegenEnergy?: number;
  /** Layered model: energy in the batteries at departure (full at the port) and their recharge per leg. */
  readonly battery?: number;
  readonly batteryRecharge?: number;
  /** Loose parts at dispatch (a frozen copy, D19): the only parts a pirate can take. */
  readonly storage?: readonly StoredPart[];
}

export interface MissionInput {
  readonly id: string;
  readonly type: MissionType;
  readonly legs: readonly LegRoute[];
  readonly tier: number;
  readonly isolation: number;
  readonly factionRelation: string;
  readonly relation: FactionRelation;
  readonly stance: Stance | null;
  readonly preset: EscapePreset;
  readonly missionOwner: 'player' | 'enemy' | null;
  readonly missionForcesFlee: boolean;
  readonly objectCarried: boolean;
  readonly client: EscortClient | null;
  /** Present on mining legs/stops (D30). */
  readonly mining?: { readonly stop: MiningStop; readonly miner: MinerRig };
  readonly contractedMining?: {
    readonly materialId: string;
    readonly requiredQuantity: number;
  };
  /** SCAVENGE jobs: what the place can give (frozen with the run, D19). */
  readonly scavenge?: ScavengeContext;
  /** RACE missions: the rival ships generated with the offer (frozen in its cargo). */
  readonly race?: { readonly competitors: readonly RaceCompetitor[]; readonly overdrive?: boolean };
}

export interface ResolveMissionInput {
  readonly seed: number | string;
  readonly snapshot: MissionSnapshot;
  readonly mission: MissionInput;
  readonly rules: GameRules;
}

export interface MissionOutcome {
  readonly missionId: string;
  readonly seed: number | string;
  readonly status: MissionStatus;
  /** ADRIFT only when fuel ran out — never death (S5.9). */
  readonly shipStatus: 'ON_MISSION' | 'ADRIFT';
  readonly events: readonly MissionEvent[];
  readonly legs: readonly LegOutcome[];
  /** Net credits from mission payment + combat spoils + fuel transits. */
  readonly creditsDelta: number;
  readonly integrity: number;
  readonly loot: readonly MissionLoot[];
  readonly parts: LegShipState['parts'];
  readonly fuel: number;
  readonly hp: number;
  readonly esc: number;
  readonly client: EscortClient | null;
}

/**
 * Deterministic mission resolution (plan S5.9):
 * - same `{seed, snapshot, mission, rules}` twice → deep-equal outcomes;
 * - per-leg / per-purpose RNG streams via `rng.child(label)`;
 * - fuel exhaustion → `ADRIFT`, ship HP untouched;
 * - pure — no I/O (enforced by ESLint `no-restricted-imports`).
 */
export function resolveMission(input: ResolveMissionInput): MissionOutcome {
  const root: Rng = createRng(input.seed);
  const legContexts = buildLegContexts(input.mission);
  const events: MissionEvent[] = [];
  const legs: LegOutcome[] = [];

  let ship: LegShipState = {
    shipId: input.snapshot.shipId,
    parts: input.snapshot.parts,
    sheet: input.snapshot.sheet,
    fuel: input.snapshot.fuel,
    hp: input.snapshot.hp,
    esc: input.snapshot.esc,
    energyMode: input.snapshot.energyMode,
    weaponEnergyDraw: input.snapshot.weaponEnergyDraw,
    shieldEnergyDraw: input.snapshot.shieldEnergyDraw,
    ...(input.snapshot.armor !== undefined
      ? {
          armor: input.snapshot.armor,
          armorMax: input.snapshot.armor,
          hpMax: input.snapshot.hp,
          escMax: input.snapshot.esc,
          escRegen: input.snapshot.escRegen ?? 0,
          escRegenEnergy: input.snapshot.escRegenEnergy ?? 0,
          ...(input.snapshot.battery !== undefined
            ? {
                battery: input.snapshot.battery,
                batteryMax: input.snapshot.battery,
                batteryRecharge: input.snapshot.batteryRecharge ?? 0,
              }
            : {}),
        }
      : {}),
  };
  let integrity = 100;
  let client = input.mission.client;
  let status: MissionStatus = 'success';
  let shipStatus: MissionOutcome['shipStatus'] = 'ON_MISSION';
  const loot: MissionLoot[] = [];
  // Storage parts still on the shelf: a part taken by a pirate on one leg cannot be taken again.
  let storage: readonly StoredPart[] = input.snapshot.storage ?? [];

  for (let index = 0; index < input.mission.legs.length; index += 1) {
    const legRng = root.child(`leg:${index}`);
    const route = input.mission.legs[index];
    if (route === undefined) {
      continue;
    }
    const context = legContexts[index];
    if (context === undefined) {
      continue;
    }
    // Mining only on the final leg so earlier travel does not consume the stop.
    const isLast = index === input.mission.legs.length - 1;
    const legInput: LegInput = {
      index,
      route,
      ship,
      context: {
        ...context,
        client,
        storage,
        mining: isLast ? (input.mission.mining ?? null) : null,
      },
      objectIntegrity: integrity,
    };
    const outcome = resolveLeg(legInput, input.rules, legRng);
    legs.push(outcome);
    events.push(...outcome.events);
    ship = outcome.ship;
    integrity = outcome.objectIntegrity;
    client = outcome.client;
    loot.push(...outcome.loot);
    const taken = new Set(outcome.events.flatMap((event) => event.stolen ?? []));
    if (taken.size > 0) storage = storage.filter((part) => !taken.has(part.id));

    if (outcome.status === 'adrift') {
      status = 'adrift';
      shipStatus = 'ADRIFT';
      break;
    }
    if (
      outcome.status === 'motor_abort' ||
      outcome.status === 'escort_destroyed' ||
      outcome.status === 'defeat_failed'
    ) {
      status = 'failed';
      break;
    }
  }

  const actors = { playerShipId: input.snapshot.shipId };
  const lastLeg = Math.max(0, legs.length - 1);
  // Combat spoils/penalties only: fuel left the tank (inventory) on leg_travel with
  // credits 0, and payment events append below. A negative total (combat loss with
  // no payout) is debited by the resolve service — it is not dropped.
  let creditsDelta = legs.reduce((sum, leg) => sum + leg.combatCredits, 0);

  // A scavenging job that came back turns up its finds (seeded, on its own stream).
  if (status === 'success' && input.mission.scavenge !== undefined) {
    for (const find of rollScavengeFinds(
      input.mission.scavenge,
      input.rules,
      root.child('scavenge'),
    )) {
      events.push(
        missionEvent({
          leg: lastLeg,
          category: 'loot',
          type: 'scavenge_find',
          actors,
          magnitude: find.kind === 'part' ? find.condition : 0,
          found: find,
        }),
      );
    }
  }

  // Payment only when every leg completed. Trips and scavenging jobs pay nothing, so they write
  // no payment line either.
  const paysNothing = input.mission.type === 'TRAVEL' || input.mission.type === 'SCAVENGE';
  // A race pays by finishing place, not by integrity: settled below.
  const isRace = input.mission.type === 'RACE' && input.mission.race !== undefined;
  if (status === 'success' && !paysNothing && !isRace) {
    const totalDistance = input.mission.legs.reduce((sum, leg) => sum + leg.distance, 0);
    const maxDanger = input.mission.legs.reduce(
      (peak, leg) => (leg.danger > peak ? leg.danger : peak),
      0,
    );
    const base = rewardBase(
      {
        tier: input.mission.tier,
        danger: maxDanger,
        distance: totalDistance,
        missionType: input.mission.type ?? 'delivery',
      },
      input.rules,
    );

    if (input.mission.contractedMining !== undefined) {
      const mined = loot
        .filter((entry) => entry.materialId === input.mission.contractedMining?.materialId)
        .reduce((sum, entry) => sum + entry.quantity, 0);
      const { settled } = settleContractedMining(
        mined,
        input.mission.contractedMining.requiredQuantity,
      );
      const payout = contractedMiningPayout(base, settled);
      creditsDelta += payout;
      events.push(
        missionEvent({
          leg: lastLeg,
          category: 'payment',
          type: settled ? 'mining_paid' : 'mining_partial_failure',
          actors,
          magnitude: payout,
          credits: payout,
        }),
      );
      if (!settled) {
        status = 'partial_failure';
      }
    } else {
      const payout = integrityPayout(base, integrity, input.rules);
      creditsDelta += payout;
      events.push(
        missionEvent({
          leg: lastLeg,
          category: 'payment',
          type: 'mission_payout',
          actors,
          magnitude: payout,
          credits: payout,
        }),
      );
    }
  }

  // A race the ship finished: everyone's time, the player's place, and the place's prize.
  if (status === 'success' && isRace && input.mission.race !== undefined) {
    const totalDistance = input.mission.legs.reduce((sum, leg) => sum + leg.distance, 0);
    const result = resolveRace({
      competitors: input.mission.race.competitors,
      // The unrounded speed: a rival's 2.6 must not be beaten or tied by a ship rounded up to 3.
      playerMobility: rawMobility(input.snapshot.sheet.pot, input.snapshot.sheet.mass, input.rules),
      overdrive: input.mission.race.overdrive === true,
      totalDistance,
      rules: input.rules,
      rng: root.child('race'),
    });
    events.push(
      missionEvent({
        leg: lastLeg,
        category: 'transit',
        type: 'race_result',
        actors,
        magnitude: result.place,
        race: {
          place: result.place,
          timeScale: input.rules.missions.time_scale,
          standings: result.standings,
        },
      }),
    );
    if (result.prizeShare > 0) {
      const maxDanger = input.mission.legs.reduce(
        (peak, leg) => (leg.danger > peak ? leg.danger : peak),
        0,
      );
      const base = rewardBase(
        {
          tier: input.mission.tier,
          danger: maxDanger,
          distance: totalDistance,
          missionType: 'race',
        },
        input.rules,
      );
      const payout = base * result.prizeShare;
      creditsDelta += payout;
      events.push(
        missionEvent({
          leg: lastLeg,
          category: 'payment',
          type: 'mission_payout',
          actors,
          magnitude: payout,
          credits: payout,
        }),
      );
    } else {
      // Finished, but off the podium: nothing to collect.
      status = 'partial_failure';
    }
  }

  return {
    missionId: input.mission.id,
    seed: input.seed,
    status,
    shipStatus,
    events,
    legs,
    creditsDelta,
    integrity,
    loot,
    parts: ship.parts,
    fuel: ship.fuel,
    hp: ship.hp,
    esc: ship.esc,
    client,
  };
}

function buildLegContexts(mission: MissionInput): LegMissionContext[] {
  return mission.legs.map(() => ({
    type: mission.type,
    tier: mission.tier,
    isolation: mission.isolation,
    factionRelation: mission.factionRelation,
    relation: mission.relation,
    stance: mission.stance,
    preset: mission.preset,
    missionOwner: mission.missionOwner,
    missionForcesFlee: mission.missionForcesFlee,
    objectCarried: mission.objectCarried,
    client: mission.client,
    mining: mission.mining ?? null,
    storage: [],
  }));
}
