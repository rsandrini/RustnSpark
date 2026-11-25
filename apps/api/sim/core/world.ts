/**
 * The world the bot plays in, built once from the snapshot: the filler's `FillerWorld`, the port
 * facts a mission needs (isolation, faction relation), a scavenge context, and the mission board.
 *
 * `boardAt` mirrors `missions/board.service.ts → topUp` — expire what is past its `expiresAt`,
 * generate with `fillMission` on the location's epoch seed, and reseed until the board is varied
 * (`isVariedEnough`, same strictness ladder: STRICT → SAME_JOB_ONLY → ANYTHING_GOES) or full.
 * The private start-safe offer (D43) is modeled too: while the player has not finished more than
 * `starter_guarantee_max_completed` missions, a takeable starter DELIVERY is kept live for them.
 */
import type { GameRules } from '../../src/config/game-config.types.js';
import {
  ANYTHING_GOES,
  isVariedEnough,
  SAME_JOB_ONLY,
  STRICT,
} from '../../src/missions/board-variety.js';
import type { Strictness } from '../../src/missions/board-variety.js';
import type { DispatchLeg } from '../../src/missions/dispatch.service.js';
import {
  eligibleTypesAt,
  fillMission,
  MissionGenerationError,
  reachByType,
  referenceSeconds,
} from '../../src/missions/generator/template.filler.js';
import type {
  FillerEnvironment,
  FillerLocation,
  FillerMaterial,
  FillerRoute,
  FillerRouteEnvironment,
  FillerTemplate,
  FillerWorld,
  MissionDraft,
} from '../../src/missions/generator/template.filler.js';
import { missionSeed } from '../../src/missions/generator/mission.generator.js';
import { boardSize, maxOffersOfOneType } from '../../src/missions/board-size.js';
import {
  boardTarget,
  lengthBounds,
  nextSlot,
  type BoardSlot,
} from '../../src/missions/board-composition.js';
import {
  giverShapeOf,
  offersAnyOf,
  pickGiver,
  type GiverShape,
} from '../../src/missions/generator/giver.picker.js';
import { createRng } from '../../src/common/rng/rng.js';
import {
  checkMissionRequirements,
  offerRequirements,
} from '../../src/missions/requirements.checker.js';
import type { ScavengeContext } from '../../src/resolution/scavenge/scavenge.resolver.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import type {
  Json,
  JsonObject,
  LocationRow,
  MissionTypeName,
  Snapshot,
} from '../snapshot/types.js';
import type { CatalogRow } from '../snapshot/types.js';
import { catalogIndex, installedParts, type PlayerState } from './state.js';

/** Same rungs as `board.service.ts`: 12 strict tries, then 24 varied, then anything goes. */
const STRICT_ATTEMPTS = 12;
const VARIETY_ATTEMPTS = 24;
/** How many drafts the starter guarantee tries before giving up (same cap as the game). */
const STARTER_ATTEMPTS = 12;
/** The snapshot carries no config version; the epoch seed only needs to be stable. */
const SIM_CONFIG_VERSION = 0;
/** Places where wreckage is scrap: mirrored from `missions/scavenge-context.ts`. */
const SCRAP_PLACE_TYPES: ReadonlySet<string> = new Set(['scrap_field', 'dead_zone', 'relay']);
/** Default leg environment when a stored leg somehow lacks one (`parseDispatchLegs`). */
const DEFAULT_ENV = { id: 'none', level: 1, fuelMult: 1 };

/** Prisma's `DateTime` is `string | Date` in unchecked create inputs; the sim only needs ms. */
function toMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** One board offer: the generated draft plus the template facts accept/resolve need. */
export interface Offer {
  readonly id: string;
  readonly seed: string;
  readonly templateId: string;
  readonly type: MissionTypeName;
  readonly factionId: string;
  readonly originId: string;
  readonly destinationId: string;
  readonly legs: DispatchLeg[];
  readonly cargo: JsonObject;
  /** The board's provisional figure (tier 1); accept re-prices it from the ship's tier. */
  readonly reward: number;
  readonly expiresAtMs: number;
  readonly deadlineAtMs: number | null;
  /** The player's own start-safe offer (`privatePlayerId` in the game). */
  readonly starter: boolean;
  readonly requirements: Json;
  readonly encounterPolicy: Json;
  /** Who posted it (the live board spreads offers over the faction's givers). */
  readonly giverId?: string;
}

export interface PortFacts {
  readonly locationId: string;
  readonly zone: number;
  readonly isolation: number;
  readonly factionId: string;
  /** The employer's view of the player's faction, as `contextFromLive` wants it. */
  readonly factionRelation: string;
  /** Local market mood — the buy/sell multiplier `PricingService.priceInput` reads off the row. */
  readonly mood: number;
}

interface BoardLocationState {
  offers: Offer[];
  epoch: number;
  /** How many private starter offers this location has drafted (seed rotation). */
  starterDrafts: number;
  starterOffer: Offer | null;
}

export interface Board {
  readonly locations: Map<string, BoardLocationState>;
  /**
   * Where every location's offer sequence starts. The board is a pure function of (place, epoch),
   * so two runs with the same start would be the very same game: the run seed moves the start so
   * that "100 runs" are 100 different boards (0 = the original, seed-independent sequence).
   */
  readonly startEpoch: number;
}

/** Epochs between two runs' offer sequences: far apart enough that boards never overlap. */
const EPOCHS_PER_RUN = 1000;

export function createBoard(runSeed = 0): Board {
  return { locations: new Map(), startEpoch: Math.max(0, runSeed) * EPOCHS_PER_RUN };
}

export function buildFillerWorld(snapshot: Snapshot): FillerWorld {
  const locations: FillerLocation[] = snapshot.locations.map((row) => ({
    id: row.id,
    type: row.type,
    zone: row.zone,
    factionId: row.factionId,
  }));
  const routes: FillerRoute[] = snapshot.routes.map((row) => ({
    id: row.id,
    nodeAId: row.nodeAId,
    nodeBId: row.nodeBId,
    distance: row.distance,
    danger: row.danger,
  }));
  const routeEnvironments: FillerRouteEnvironment[] = snapshot.routeEnvironments.map((row) => ({
    routeId: row.routeId,
    environmentId: row.environmentId,
    order: row.order,
  }));
  const environments: FillerEnvironment[] = snapshot.environments.map((row) => ({
    id: row.id,
    level: row.level,
    fuelMult: row.fuelMult,
  }));
  const templates: FillerTemplate[] = snapshot.templates
    .filter((row) => row.active)
    .map((row) => ({
      id: row.id,
      type: row.type,
      factionId: row.factionId,
      active: row.active,
      requirements: row.requirements,
    }));
  // Scrap (fixed-price materials) is a find, never something a mining offer digs up — the same
  // filter `loadWorld` applies.
  const materials: FillerMaterial[] = snapshot.materials
    .filter((row) => row.active && !row.fixedPrice)
    .map((row) => ({ id: row.id, rarity: row.rarity }));
  return { locations, routes, routeEnvironments, environments, templates, materials };
}

// Row lookups run thousands of times per simulated run; index each snapshot once.
const locationIndex = new WeakMap<Snapshot, Map<string, LocationRow>>();
const factionIndex = new WeakMap<Snapshot, Map<string, Snapshot['factions'][number]>>();

function locationRowOf(snapshot: Snapshot, locationId: string): LocationRow {
  let index = locationIndex.get(snapshot);
  if (index === undefined) {
    index = new Map(snapshot.locations.map((location) => [location.id, location]));
    locationIndex.set(snapshot, index);
  }
  const row = index.get(locationId);
  if (row === undefined) throw new Error(`location ${locationId} is not in the snapshot`);
  return row;
}

function factionRelationsOf(snapshot: Snapshot, factionId: string): unknown {
  let index = factionIndex.get(snapshot);
  if (index === undefined) {
    index = new Map(snapshot.factions.map((faction) => [faction.id, faction]));
    factionIndex.set(snapshot, index);
  }
  return index.get(factionId)?.relations ?? {};
}

/** What a port charges and fears: isolation and the employer faction's view of the player. */
export function portFactsOf(
  snapshot: Snapshot,
  locationId: string,
  playerFactionId: string,
): PortFacts {
  const row = locationRowOf(snapshot, locationId);
  const relations = factionRelationsOf(snapshot, row.factionId) as Record<string, unknown>;
  const raw = relations[playerFactionId];
  const normalized = typeof raw === 'string' ? raw.toLowerCase() : 'neutral';
  const factionRelation =
    normalized === 'ally' || normalized === 'hostile' ? normalized : 'neutral';
  return {
    locationId,
    zone: row.zone,
    isolation: row.isolation,
    factionId: row.factionId,
    factionRelation,
    mood: row.mood,
  };
}

/** Mirrors `missions/scavenge-context.ts → loadScavengeContext` over snapshot rows. */
export function scavengeContextOf(snapshot: Snapshot, locationId: string): ScavengeContext {
  const row = locationRowOf(snapshot, locationId);
  const table = [...snapshot.dropTable]
    .filter((entry) => entry.source === 'scavenging')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  const tiers = Array.isArray(table?.tiers)
    ? (table.tiers as unknown[]).flatMap((entry) => {
        const candidate = entry as { tier?: unknown; chance?: unknown };
        return typeof candidate.tier === 'string' && typeof candidate.chance === 'number'
          ? [{ tier: candidate.tier, chance: candidate.chance }]
          : [];
      })
    : [];
  return {
    zone: row.zone,
    fieldType: row.type === 'scrap_field' && row.factionId === 'pirates' ? 'pirate' : 'common',
    scrapPlace: SCRAP_PLACE_TYPES.has(row.type),
    tiers,
    catalog: snapshot.catalog
      .filter((part) => part.active && part.partClass !== 'BRIDGE')
      .map((part) => ({ partType: part.partType, rarity: part.rarity, basePrice: part.basePrice })),
  };
}

/** `parseDispatchLegs`'s view of a draft's legs (the filler generates them in that shape). */
function legsOf(draft: MissionDraft): DispatchLeg[] {
  const legs = Array.isArray(draft.legs) ? (draft.legs as unknown as DispatchLeg[]) : [];
  return legs.map((leg) => ({
    routeId: leg.routeId,
    distance: leg.distance,
    danger: leg.danger ?? 0,
    zone: leg.zone ?? 0,
    env: leg.env ?? DEFAULT_ENV,
  }));
}

function offerOf(draft: MissionDraft, snapshot: Snapshot, starter: boolean): Offer {
  const template = snapshot.templates.find((row) => row.id === draft.templateId);
  return {
    id: draft.seed,
    seed: draft.seed,
    templateId: draft.templateId,
    type: draft.type,
    factionId: draft.factionId,
    originId: draft.originId,
    destinationId: draft.destinationId,
    legs: legsOf(draft),
    cargo: (draft.cargo ?? {}) as JsonObject,
    reward: draft.reward,
    expiresAtMs: toMs(draft.expiresAt),
    deadlineAtMs: draft.deadlineAt == null ? null : toMs(draft.deadlineAt),
    starter,
    requirements: offerRequirements(template?.requirements ?? {}, draft.cargo) as Json,
    encounterPolicy: template?.encounterPolicy ?? {},
    ...(draft.giverId == null ? {} : { giverId: draft.giverId }),
  };
}

/** The active quest givers of each faction as the generator sees them (read once per snapshot). */
const giversBySnapshot = new WeakMap<Snapshot, ReadonlyMap<string, readonly GiverShape[]>>();

function giversOf(snapshot: Snapshot, factionId: string): readonly GiverShape[] {
  let byFaction = giversBySnapshot.get(snapshot);
  if (byFaction === undefined) {
    const grouped = new Map<string, GiverShape[]>();
    for (const row of snapshot.questGivers ?? []) {
      if (!row.active) continue;
      const list = grouped.get(row.factionId) ?? [];
      list.push(giverShapeOf(row));
      grouped.set(row.factionId, list);
    }
    byFaction = grouped;
    giversBySnapshot.set(snapshot, byFaction);
  }
  return byFaction.get(factionId) ?? [];
}

function strictnessAt(attempt: number): Strictness {
  if (attempt < STRICT_ATTEMPTS) return STRICT;
  if (attempt < VARIETY_ATTEMPTS) return SAME_JOB_ONLY;
  return ANYTHING_GOES;
}

function fillOne(args: {
  readonly world: FillerWorld;
  readonly rules: GameRules;
  readonly origin: FillerLocation;
  readonly seed: string;
  readonly nowMs: number;
  readonly giver?: GiverShape;
  readonly avoidTypes?: ReadonlySet<MissionTypeName>;
  readonly preferTypes?: ReadonlySet<MissionTypeName>;
  readonly lengthTarget?: { readonly minSeconds?: number; readonly maxSeconds?: number };
  readonly starter?: {
    readonly types: readonly MissionTypeName[];
    readonly maxZone: number;
    readonly maxDistance: number;
  };
}): MissionDraft {
  return fillMission({
    seed: args.seed,
    origin: args.origin,
    world: args.world,
    rules: args.rules,
    now: new Date(args.nowMs),
    ...(args.giver === undefined ? {} : { giver: args.giver }),
    ...(args.avoidTypes === undefined ? {} : { avoidTypes: args.avoidTypes }),
    ...(args.preferTypes === undefined ? {} : { preferTypes: args.preferTypes }),
    ...(args.lengthTarget === undefined ? {} : { lengthTarget: args.lengthTarget }),
    ...(args.starter === undefined
      ? {}
      : {
          starter: {
            types: args.starter.types,
            maxZone: args.starter.maxZone,
            maxDistance: args.starter.maxDistance,
          },
        }),
  });
}

/** The requirements check the starter guarantee runs (`isTakeable` in `missions.service.ts`). */
function requirementsMet(
  draft: MissionDraft,
  snapshot: Snapshot,
  rules: GameRules,
  state: PlayerState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): boolean {
  const template = snapshot.templates.find((row) => row.id === draft.templateId);
  const parts = installedParts(state.ship, catalogByType);
  const sheet = deriveSheet(parts, rules);
  const report = checkMissionRequirements(
    {
      missionType: draft.type,
      requirements: offerRequirements(template?.requirements, draft.cargo),
      sheet,
      parts,
    },
    rules,
  );
  return report.eligible;
}

export interface BoardAtInput {
  readonly board: Board;
  readonly snapshot: Snapshot;
  readonly world: FillerWorld;
  readonly rules: GameRules;
  readonly state: PlayerState;
  readonly locationId: string;
  readonly nowMs: number;
}

function locationState(board: Board, locationId: string): BoardLocationState {
  let state = board.locations.get(locationId);
  if (state === undefined) {
    state = { offers: [], epoch: board.startEpoch, starterDrafts: 0, starterOffer: null };
    board.locations.set(locationId, state);
  }
  return state;
}

/**
 * The offers the player sees at their port right now: the shared board (topped up like the
 * game's) plus, while the guarantee lasts, their own private starter DELIVERY.
 */
export function boardAt(input: BoardAtInput): Offer[] {
  const { board, snapshot, world, rules, state, locationId, nowMs } = input;
  const boardState = locationState(board, locationId);
  const live = livePublic(boardState, nowMs);

  const origin = world.locations.find((location) => location.id === locationId);
  if (origin === undefined) return live;

  // D43: the start-safe offer is private to this player and refreshed while they qualify.
  const qualifiesForStarter = state.missionsDone <= rules.missions.starter_guarantee_max_completed;
  if (!qualifiesForStarter) {
    boardState.starterOffer = null;
  } else if (boardState.starterOffer === null || boardState.starterOffer.expiresAtMs <= nowMs) {
    boardState.starterOffer = draftStarterOffer({
      snapshot,
      world,
      rules,
      origin,
      state,
      boardState,
      nowMs,
    });
  }

  // Same sizes and rules as `board.service.ts → topUp`: the board is as big as the place (main /
  // regional / local), a type holds at most half of it, the types the board lacks come first and
  // the next offer is posted by one of the faction's quest givers.
  const place = snapshot.locations.find((row) => row.id === locationId);
  const baseSize =
    place === undefined
      ? rules.missions.board_min_per_location
      : boardSize({ type: place.type, detail: place.detail ?? null }, rules);
  if (live.length >= baseSize) return withStarter(boardState, live);
  // What this place can post, measured once per top-up (a test pad keeps today's path).
  const planned = origin.type !== 'test_pad';
  const reach = planned ? reachByType(origin, world, rules) : new Map();
  const boardMin = planned ? boardTarget(baseSize, reach, rules) : baseSize;
  const bounds = planned ? lengthBounds(reach, rules) : null;
  const maxSameType = maxOffersOfOneType(boardMin, rules);
  const eligibleTypes = eligibleTypesAt(origin, world);
  const givers = giversOf(snapshot, origin.factionId);
  const secondsOf = (offer: Offer): number =>
    referenceSeconds(
      offer.legs.reduce((sum, leg) => sum + leg.distance, 0),
      rules,
    );
  const liveShape = (): (Offer & { seconds: number })[] =>
    live.map((offer) => ({ ...offer, seconds: secondsOf(offer) }));
  while (live.length < boardMin) {
    let draft: MissionDraft;
    try {
      let attempt = 0;
      for (;;) {
        const avoidTypes = new Set(
          [...eligibleTypes].filter(
            (type) => live.filter((offer) => offer.type === type).length >= maxSameType,
          ),
        );
        const wanted = planned
          ? nextSlot({ reach, live: liveShape(), capped: avoidTypes, rules })
          : {};
        const slot: BoardSlot =
          wanted.types !== undefined && [...wanted.types].every((t) => avoidTypes.has(t))
            ? {}
            : wanted;
        const seed = missionSeed({
          locationId,
          epoch: boardState.epoch,
          configVersion: SIM_CONFIG_VERSION,
        });
        let giver = pickGiver({
          givers,
          locationId,
          liveGiverIds: live.map((offer) => offer.giverId ?? null),
          boardSize: boardMin,
          eligibleTypes,
          ...(slot.types === undefined ? {} : { wantTypes: slot.types }),
          avoidTypes,
          rng: createRng(seed).child('giver'),
        });
        if (giver !== undefined && slot.types !== undefined && !offersAnyOf(giver, slot.types)) {
          giver = undefined;
        }
        const lengthTarget =
          bounds === null || slot.length === undefined
            ? undefined
            : slot.length === 'short'
              ? { maxSeconds: bounds.shortMax }
              : { minSeconds: bounds.longMin };
        draft = fillOne({
          world,
          rules,
          origin,
          seed,
          nowMs,
          ...(giver === undefined ? {} : { giver }),
          avoidTypes,
          ...(slot.types === undefined ? {} : { preferTypes: slot.types }),
          ...(lengthTarget === undefined ? {} : { lengthTarget }),
        });
        const strictness = strictnessAt(attempt);
        const draftSeconds = referenceSeconds(
          legsOf(draft).reduce((sum, leg) => sum + leg.distance, 0),
          rules,
        );
        const lengthOk =
          lengthTarget === undefined ||
          attempt >= STRICT_ATTEMPTS ||
          (draftSeconds <= (lengthTarget.maxSeconds ?? Number.POSITIVE_INFINITY) &&
            draftSeconds >= (lengthTarget.minSeconds ?? 0));
        if (lengthOk && isVariedEnough(draft, live, maxSameType, strictness)) break;
        attempt += 1;
        boardState.epoch += 1;
      }
    } catch (error) {
      // A world edited into a corner serves a thin board rather than failing (topUp's rule).
      if (error instanceof MissionGenerationError) break;
      throw error;
    }
    live.push(offerOf(draft, snapshot, false));
    boardState.epoch += 1;
  }

  return withStarter(boardState, live);
}

function withStarter(boardState: BoardLocationState, live: Offer[]): Offer[] {
  const starter = boardState.starterOffer;
  return starter === null ? live : [starter, ...live];
}

function livePublic(boardState: BoardLocationState, nowMs: number): Offer[] {
  boardState.offers = boardState.offers.filter((offer) => offer.expiresAtMs > nowMs);
  return boardState.offers;
}

function draftStarterOffer(args: {
  readonly snapshot: Snapshot;
  readonly world: FillerWorld;
  readonly rules: GameRules;
  readonly origin: FillerLocation;
  readonly state: PlayerState;
  readonly boardState: BoardLocationState;
  readonly nowMs: number;
}): Offer | null {
  const { snapshot, world, rules, origin, state, boardState, nowMs } = args;
  const catalogByType = catalogIndex(snapshot);
  for (let attempt = 0; attempt < STARTER_ATTEMPTS; attempt += 1) {
    let draft: MissionDraft;
    try {
      draft = fillOne({
        world,
        rules,
        origin,
        seed: `starter|sim|${origin.id}|${boardState.starterDrafts + attempt}`,
        nowMs,
        starter: {
          types: ['DELIVERY'],
          maxZone: rules.missions.starter_max_zone,
          maxDistance: rules.missions.starter_max_distance,
        },
      });
    } catch (error) {
      if (error instanceof MissionGenerationError) return null;
      throw error;
    }
    if (requirementsMet(draft, snapshot, rules, state, catalogByType)) {
      boardState.starterDrafts += attempt + 1;
      return offerOf(draft, snapshot, true);
    }
  }
  return null;
}
