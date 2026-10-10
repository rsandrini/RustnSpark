import { engineGroupOf } from '../resolution/engine/engine.js';
import type { GameRules } from '../config/game-config.types.js';
import type { EscapePreset } from '../resolution/encounter/escape.resolver.js';
import type { FactionRelation, Stance } from '../resolution/encounter/encounter-policy.js';
import type { EscortClient, LegRoute, PartSnapshot } from '../resolution/leg/leg.resolver.js';
import type { ScavengeContext } from '../resolution/scavenge/scavenge.resolver.js';
import type { RaceCompetitor } from '../resolution/race/race.resolver.js';
import { resolveMission } from '../resolution/mission/mission.resolver.js';
import type { MissionInput, MissionSnapshot } from '../resolution/mission/mission.resolver.js';
import type { InstalledPart } from '../parts/part.types.js';
import { combatEnergyDraw, pierceShare } from '../ships/combat-energy.js';
import { isEnergyMode } from '../ships/energy-mode.types.js';
import { powerPartOf } from '../resolution/power/power.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import { shipTier } from '../ships/ship-tier.js';
import type { DispatchSnapshot } from './dispatch.service.js';
import { PROVISIONAL_TIER } from './generator/template.filler.js';

// ONE place that turns (mission, dispatch snapshot, resolution context, rules) into the engine's
// input. The worker (resolve.service) and the admin replay (replay.service) both call it, so a
// replay can never drift from the run it re-runs: before this existed the replay had its own
// copy that ignored mining stops and the snapshot's ship tier, and mismatched on those missions.

const OBJECT_CARRIED_TYPES: readonly string[] = ['DELIVERY', 'TRANSPORT', 'RESCUE'];

/**
 * The world facts a resolution read from the LIVE database (destination isolation, the employer's
 * relation to the player, the template's encounter policy, cargo, mined material rarity).
 * They are stored in the MissionLog next to the dispatch snapshot, because every one of them can
 * change afterwards (map re-tuned, relations edited) and a replay must see the run's own values.
 * Plain JSON on purpose: it goes into a jsonb column.
 */
export interface ResolutionContext {
  readonly isolation: number;
  /** 'ally' | 'neutral' | 'hostile' — the employer faction's view of the player's faction. */
  readonly factionRelation: string;
  readonly preset: string;
  readonly missionOwner: 'player' | 'enemy' | null;
  readonly missionForcesFlee: boolean;
  readonly client: EscortClient | null;
  /** MINING only. */
  readonly mining?: {
    readonly materialId: string;
    readonly materialRarity: string;
    readonly minimumYield?: number;
  };
  readonly contractedMining?: { readonly materialId: string; readonly requiredQuantity: number };
  /** SCAVENGE only: what the place can give, frozen with the run (D19). */
  readonly scavenge?: ScavengeContext;
  /** RACE only: the rivals generated with the offer, frozen with the run. */
  readonly race?: { readonly competitors: readonly RaceCompetitor[] };
}

/** The rival ships of a RACE offer, as stored in its cargo (`cargo.race.competitors`). */
export function parseCompetitors(cargo: Record<string, unknown>): RaceCompetitor[] {
  const race = cargo['race'];
  const raw =
    typeof race === 'object' && race !== null
      ? (race as { competitors?: unknown }).competitors
      : [];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (rival): rival is RaceCompetitor =>
      typeof rival === 'object' &&
      rival !== null &&
      typeof (rival as RaceCompetitor).id === 'string' &&
      typeof (rival as RaceCompetitor).name === 'string' &&
      typeof (rival as RaceCompetitor).mobility === 'number',
  );
}

export function relationOf(
  relations: unknown,
  factionId: string,
): { key: string; relation: FactionRelation } {
  let raw: unknown;
  if (typeof relations === 'object' && relations !== null && !Array.isArray(relations)) {
    raw = (relations as Record<string, unknown>)[factionId];
  }
  const normalized = typeof raw === 'string' ? raw.toLowerCase() : 'neutral';
  if (normalized === 'ally') return { key: 'ally', relation: 'ALLY' };
  if (normalized === 'hostile') return { key: 'hostile', relation: 'HOSTILE' };
  return { key: 'neutral', relation: 'NEUTRAL' };
}

export function parseClient(raw: unknown): EscortClient | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate['shipId'] !== 'string' ||
    typeof candidate['maxHp'] !== 'number' ||
    typeof candidate['hp'] !== 'number'
  ) {
    return null;
  }
  return { shipId: candidate['shipId'], maxHp: candidate['maxHp'], hp: candidate['hp'] };
}

export interface LiveContextSource {
  readonly type: string;
  readonly cargo: unknown;
  readonly encounterPolicy: unknown;
  readonly employerRelations: unknown;
  readonly playerFactionId: string | null;
  readonly destinationIsolation: number;
  /** Rarity of the mined material (lower-case), when the mission mines one. */
  readonly materialRarity?: string | null;
  /** What the mission pays: a paid mining quest is guaranteed at least one unit of ore. */
  readonly reward?: number;
  /** SCAVENGE jobs: the place's scavenging context. */
  readonly scavenge?: ScavengeContext | null;
}

/** Reads the context from live data at resolution time (and for logs stored before it existed). */
export function contextFromLive(source: LiveContextSource): ResolutionContext {
  const cargo = (source.cargo ?? {}) as Record<string, unknown>;
  const policy = (source.encounterPolicy ?? {}) as Record<string, unknown>;
  const employer = relationOf(source.employerRelations, source.playerFactionId ?? '');
  const materialId = typeof cargo['materialId'] === 'string' ? cargo['materialId'] : undefined;
  return {
    isolation: source.destinationIsolation,
    factionRelation: employer.key,
    preset: (policy['preset'] as string | undefined) ?? 'CRUISE',
    missionOwner: (policy['missionOwner'] as 'player' | 'enemy' | null | undefined) ?? null,
    missionForcesFlee: policy['missionForcesFlee'] === true,
    client: parseClient(cargo['client']),
    ...(source.type === 'MINING' && materialId !== undefined
      ? {
          mining: {
            materialId,
            materialRarity: source.materialRarity ?? 'common',
            ...((source.reward ?? 0) > 0 ? { minimumYield: 1 } : {}),
          },
        }
      : {}),
    ...(source.scavenge !== undefined && source.scavenge !== null
      ? { scavenge: source.scavenge }
      : {}),
    ...(source.type === 'RACE' ? { race: { competitors: parseCompetitors(cargo) } } : {}),
    ...(cargo['contracted'] === true &&
    materialId !== undefined &&
    typeof cargo['quantity'] === 'number'
      ? { contractedMining: { materialId, requiredQuantity: cargo['quantity'] } }
      : {}),
  };
}

const RELATIONS: Record<string, FactionRelation> = {
  ally: 'ALLY',
  hostile: 'HOSTILE',
  neutral: 'NEUTRAL',
};

const FULL_CONDITION = 100;

/** Starting shield, armor and hull of a ship at its parts' current condition, and the shield's recovery. */
function layeredPools(snapshot: DispatchSnapshot, rules: GameRules): LayeredPools {
  return startingPools(snapshot.parts, rules);
}

export interface LayeredPools {
  hp: number;
  esc: number;
  armor: number;
  escRegen: number;
  escRegenEnergy: number;
  battery: number;
  batteryRecharge: number;
}

/** The pools a ship starts a fight with, from parts as they are now (worn parts give less). */
export function startingPools(
  parts: ReadonlyArray<{
    condition: number;
    catalog: DispatchSnapshot['parts'][number]['catalog'];
  }>,
  rules: GameRules,
): LayeredPools {
  const share = (part: { condition: number }): number =>
    Math.max(0, part.condition) / FULL_CONDITION;
  let hp = 0;
  let esc = 0;
  let armor = 0;
  let regen = 0;
  let energy = 0;
  let battery = 0;
  let recharge = 0;
  for (const part of parts) {
    const s = share(part);
    battery += part.catalog.batCharge * s;
    recharge += part.catalog.batInput * s;
    hp += part.catalog.partHp * s;
    esc += part.catalog.esc * s;
    armor += part.catalog.bli * rules.combat.armor_pool_factor * s;
    regen += (part.catalog.shieldRegen ?? 0) * s;
    if (part.catalog.esc > 0) energy += Math.abs(part.catalog.energyCombat) * s;
  }
  return {
    hp,
    esc,
    armor,
    escRegen: regen,
    escRegenEnergy: regen > 0 ? energy / regen : 0,
    // The batteries leave the port full.
    battery,
    batteryRecharge: recharge,
  };
}

export function buildResolveInput(args: {
  readonly missionId: string;
  readonly missionType: string;
  readonly seed: number | string;
  readonly snapshot: DispatchSnapshot;
  readonly context: ResolutionContext;
  readonly rules: GameRules;
}): Parameters<typeof resolveMission>[0] {
  const { snapshot, context, rules } = args;
  const installed: InstalledPart[] = snapshot.parts.map((part) => ({
    instance: { id: part.id, partType: part.partType, condition: part.condition },
    catalog: part.catalog,
  }));
  const sheet = deriveSheet(installed, rules);
  const { weaponEnergyDraw, shieldEnergyDraw } = combatEnergyDraw(installed);
  const partSnaps: PartSnapshot[] = snapshot.parts.map((part) => ({
    id: part.id,
    partClass: part.catalog.partClass,
    providesEsc: part.catalog.esc > 0,
    condition: part.condition,
    ...(snapshot.engine !== undefined && engineGroupOf(part.catalog) !== null
      ? { engineGroup: engineGroupOf(part.catalog)! }
      : {}),
    ...(snapshot.layered === true
      ? {
          providesArmor: part.catalog.bli > 0,
          power: powerPartOf(part.id, part.catalog, rules.power.idle_demand),
        }
      : {}),
  }));
  // Layered damage model: every pool starts at what the parts can give at their CURRENT condition
  // (a worn ship soaks less), the shield recovers per round at its own pace and each point costs
  // combat energy. Older stored runs (no `layered` flag) replay with the model they were run on.
  const pools = snapshot.layered === true ? layeredPools(snapshot, rules) : null;
  const energyMode = isEnergyMode(snapshot.energyMode) ? snapshot.energyMode : undefined;
  const missionSnapshot: MissionSnapshot = {
    shipId: snapshot.shipId,
    parts: partSnaps,
    sheet,
    fuel: snapshot.fuel,
    hp: pools?.hp ?? sheet.hp,
    esc: pools?.esc ?? sheet.esc,
    energyMode,
    weaponEnergyDraw,
    shieldEnergyDraw,
    ...(pierceShare(installed) > 0 ? { pierceShare: pierceShare(installed) } : {}),
    ...(pools !== null
      ? {
          armor: pools.armor,
          escRegen: pools.escRegen,
          escRegenEnergy: pools.escRegenEnergy,
          battery: pools.battery,
          batteryRecharge: pools.batteryRecharge,
        }
      : {}),
    storage: snapshot.storage ?? [],
  };

  // D29: accept finalizes the board reward from the accepting ship's tier; the resolution rates
  // the payout (and combat win credits) from the same tier. The dispatch snapshot carries each
  // part's basePrice for this; older payloads without it fall back to PROVISIONAL_TIER.
  const tier = snapshot.parts.every((part) => typeof part.catalog.basePrice === 'number')
    ? shipTier(
        snapshot.parts.map((part) => ({ basePrice: part.catalog.basePrice ?? 0 })),
        rules,
      )
    : PROVISIONAL_TIER;

  const legs: readonly LegRoute[] = snapshot.legs;
  const lastLeg = legs[legs.length - 1];
  const missionInput: MissionInput = {
    id: args.missionId,
    type: args.missionType as MissionInput['type'],
    legs,
    tier,
    isolation: context.isolation,
    factionRelation: context.factionRelation,
    relation: RELATIONS[context.factionRelation] ?? 'NEUTRAL',
    stance: snapshot.stance as Stance,
    preset: context.preset as EscapePreset,
    missionOwner: context.missionOwner,
    missionForcesFlee: context.missionForcesFlee,
    objectCarried: OBJECT_CARRIED_TYPES.includes(args.missionType),
    ...(snapshot.engine !== undefined ? { engine: snapshot.engine } : {}),
    client: context.client,
    ...(context.mining
      ? {
          mining: {
            stop: {
              env: lastLeg?.env.id ?? 'open',
              materialId: context.mining.materialId,
              materialRarity: context.mining.materialRarity,
              ...(context.mining.minimumYield !== undefined
                ? { minimumYield: context.mining.minimumYield }
                : {}),
            },
            miner: { min: sheet.min, condition: sheet.condition },
          },
        }
      : {}),
    ...(context.contractedMining ? { contractedMining: context.contractedMining } : {}),
    ...(context.scavenge ? { scavenge: context.scavenge } : {}),
    ...(context.race && context.race.competitors.length > 0 ? { race: context.race } : {}),
  };
  return { seed: args.seed, snapshot: missionSnapshot, mission: missionInput, rules };
}
