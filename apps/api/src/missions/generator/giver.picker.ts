import type { MissionType } from '@prisma/client';
import type { Rng } from '../../common/rng/rng.js';

/** What a giver offers: weights by mission type, and the zones they will send a pilot to. Admin-owned data. */
export interface GiverPersonality {
  readonly types: Readonly<Record<string, number>>;
  readonly minZone: number;
  readonly maxZone: number;
  readonly tone: string;
}

/** A quest giver as the generator sees it. */
export interface GiverShape {
  readonly id: string;
  readonly role: 'GIVER' | 'MENTOR';
  readonly weight: number;
  /** Where they work; empty = anywhere in their faction. */
  readonly locationIds: readonly string[];
  readonly personality: GiverPersonality;
}

/** The share of a board one giver may fill (never fewer than one offer): a board of one voice is not a board. */
export const MAX_BOARD_SHARE = 0.5;

const weightOf = (giver: GiverShape, type: MissionType): number => {
  const raw = giver.personality.types[type];
  return typeof raw === 'number' && raw > 0 ? raw : 0;
};

/** Whether the giver offers at least one of the types. */
export function offersAnyOf(giver: GiverShape, types: ReadonlySet<MissionType>): boolean {
  for (const type of types) if (weightOf(giver, type) > 0) return true;
  return false;
}

/** The weight a giver puts on one mission type (0 = never offers it). */
export function typeWeight(giver: GiverShape, type: MissionType): number {
  return weightOf(giver, type);
}

/** A weighted pick: the item whose slice of the total weight the roll lands in. Items must have positive weight. */
export function weightedPick<T>(items: readonly T[], weightFor: (item: T) => number, rng: Rng): T {
  const total = items.reduce((sum, item) => sum + weightFor(item), 0);
  let roll = rng.float() * total;
  for (const item of items) {
    roll -= weightFor(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1] as T;
}

export interface PickGiverInput {
  readonly givers: readonly GiverShape[];
  readonly locationId: string;
  /** The giver of each offer already live on the board (null = none). */
  readonly liveGiverIds: readonly (string | null)[];
  readonly boardSize: number;
  /** Types the place can post at all. */
  readonly eligibleTypes: ReadonlySet<MissionType>;
  /** Types the board does not have yet: givers who can offer one are preferred. */
  readonly wantTypes?: ReadonlySet<MissionType>;
  /** Types the board already holds as many of as it allows: a giver who offers only those is passed over. */
  readonly avoidTypes?: ReadonlySet<MissionType>;
  readonly rng: Rng;
}

/**
 * Who offers the next mission of a board. Mentors never appear here (they guide, they do not sell). A candidate works
 * at this place (or anywhere), offers at least one type the place can post, and holds less than half the board;
 * those who can offer a type the board still lacks come first. Weighted by the giver's own weight. Returns undefined
 * when nobody qualifies (the offer is made without a giver).
 */
export function pickGiver(input: PickGiverInput): GiverShape | undefined {
  const { givers, locationId, liveGiverIds, boardSize, wantTypes, avoidTypes, rng } = input;
  const open = new Set([...input.eligibleTypes].filter((type) => avoidTypes?.has(type) !== true));
  const eligibleTypes = open.size > 0 ? open : input.eligibleTypes;
  const here = givers.filter(
    (giver) =>
      giver.role === 'GIVER' &&
      giver.weight > 0 &&
      (giver.locationIds.length === 0 || giver.locationIds.includes(locationId)) &&
      offersAnyOf(giver, eligibleTypes),
  );
  if (here.length === 0) return undefined;

  const cap = Math.max(1, Math.floor(boardSize * MAX_BOARD_SHARE));
  const holds = (giver: GiverShape): number => liveGiverIds.filter((id) => id === giver.id).length;
  const underCap = here.filter((giver) => holds(giver) < cap);
  const pool = underCap.length > 0 ? underCap : here;

  const wanted =
    wantTypes === undefined ? [] : pool.filter((giver) => offersAnyOf(giver, wantTypes));
  const finalPool = wanted.length > 0 ? wanted : pool;
  return weightedPick(finalPool, (giver) => giver.weight, rng);
}

const MISSION_TYPES = new Set(['DELIVERY', 'TRANSPORT', 'ESCORT', 'MINING', 'RESCUE', 'RACE']);

/** A `QuestGiver` row as the generator sees it. Admin edits the JSON, so anything odd is dropped, never thrown. */
export function giverShapeOf(row: {
  readonly id: string;
  readonly role: 'GIVER' | 'MENTOR';
  readonly weight: number;
  readonly locationIds: readonly string[];
  readonly personality: unknown;
}): GiverShape {
  const raw = (
    typeof row.personality === 'object' && row.personality !== null ? row.personality : {}
  ) as Record<string, unknown>;
  const types: Record<string, number> = {};
  if (typeof raw.types === 'object' && raw.types !== null) {
    for (const [type, weight] of Object.entries(raw.types)) {
      if (MISSION_TYPES.has(type) && typeof weight === 'number' && weight > 0) types[type] = weight;
    }
  }
  const zone = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    id: row.id,
    role: row.role,
    weight: row.weight,
    locationIds: row.locationIds,
    personality: {
      types,
      minZone: zone(raw.minZone, 0),
      maxZone: zone(raw.maxZone, Number.POSITIVE_INFINITY),
      tone: typeof raw.tone === 'string' ? raw.tone : 'formal',
    },
  };
}
