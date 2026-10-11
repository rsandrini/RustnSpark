/**
 * The shape of the JSON snapshot: everything the simulation needs about the world, read once
 * from the live database by `export-snapshot.ts` and then frozen by `load-snapshot.ts`.
 *
 * The rows mirror the Prisma models of the same name but as plain JSON, so nothing outside
 * `export-snapshot.ts` ever imports `@prisma/client`.
 */
import type { GameRules } from '../../src/config/game-config.types.js';

export type RarityName = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

export type PartClassName =
  | 'ENGINE'
  | 'TANK'
  | 'BATTERY'
  | 'REACTOR'
  | 'WEAPON'
  | 'DEFENSE'
  | 'CARGO'
  | 'SENSOR'
  | 'UTILITY'
  | 'BRIDGE';

export type MissionTypeName =
  | 'DELIVERY'
  | 'TRANSPORT'
  | 'ESCORT'
  | 'MINING'
  | 'RESCUE'
  | 'TRAVEL'
  | 'SCAVENGE'
  | 'RACE';

/** Any JSON value the database stores in a `Json` column (same shape Prisma reports). */
export type Json = string | number | boolean | null | JsonObject | JsonArray;

export interface JsonObject {
  [key: string]: Json | undefined;
}

export type JsonArray = Json[];

/**
 * `PartCatalog` — the same row the game passes to `pickCatalogStats`. The connector columns are
 * left out on purpose: they describe the yard grid, which the simulation abstracts away.
 */
export interface CatalogRow {
  readonly partType: string;
  readonly partClass: PartClassName;
  readonly rarity: RarityName;
  readonly w: number;
  readonly h: number;
  readonly mass: number;
  readonly structureCost: number;
  readonly basePrice: number;
  readonly scrapValue: number;
  readonly partHp: number;
  readonly pot: number;
  readonly pdf: number;
  readonly bli: number;
  readonly esc: number;
  readonly sen: number;
  readonly crg: number;
  readonly min: number;
  readonly energyCont: number;
  readonly energyCombat: number;
  readonly fuelCap: number | null;
  readonly fuelUse: number | null;
  readonly batCharge: number | null;
  readonly batOutput: number | null;
  readonly batInput: number | null;
  readonly specialProp: Json;
  readonly active: boolean;
}

/** `Location`. */
export interface LocationRow {
  readonly id: string;
  readonly displayName: Json;
  readonly description: Json;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly zone: number;
  readonly factionId: string;
  readonly isolation: number;
  readonly mood: number;
  readonly services: Json;
}

/** `Route`. */
export interface RouteRow {
  readonly id: string;
  readonly nodeAId: string;
  readonly nodeBId: string;
  readonly distance: number;
  readonly danger: number;
}

/** `RouteEnvironment` (a route's ordered list of environments). */
export interface RouteEnvironmentRow {
  readonly routeId: string;
  readonly environmentId: string;
  readonly order: number;
}

/** `Environment`. */
export interface EnvironmentRow {
  readonly id: string;
  readonly displayName: Json;
  readonly description: Json;
  readonly level: number;
  readonly fuelMult: number;
  readonly subsystemTarget: string | null;
  readonly mitigatingPart: string | null;
}

/** `MissionTemplate`. */
export interface TemplateRow {
  readonly id: string;
  readonly displayName: Json;
  readonly description: Json;
  readonly type: MissionTypeName;
  readonly factionId: string;
  readonly requirements: Json;
  readonly rewardCalc: Json;
  readonly deadlineCalc: Json;
  readonly encounterPolicy: Json;
  readonly active: boolean;
}

/** `Material`. */
export interface MaterialRow {
  readonly id: string;
  readonly displayName: Json;
  readonly description: Json;
  readonly rarity: RarityName;
  readonly basePrice: number;
  /** Sells for exactly `basePrice` everywhere (scrap); no isolation or faction factor. */
  readonly fixedPrice: boolean;
  readonly active: boolean;
}

/** `DropTable` — what a scavenge job can find at a given source. */
export interface DropTableRow {
  readonly id: string;
  readonly source: string;
  readonly tiers: Json;
}

/** `Faction`: only the bits the economy uses (the relation to the player's faction). */
export interface FactionRow {
  readonly id: string;
  readonly playable: boolean;
  readonly relations: Json;
}

/** Everything the simulation reads, once. `takenAt` is an ISO-8601 instant. */
export interface Snapshot {
  readonly takenAt: string;
  readonly rules: GameRules;
  readonly catalog: readonly CatalogRow[];
  readonly locations: readonly LocationRow[];
  readonly routes: readonly RouteRow[];
  readonly routeEnvironments: readonly RouteEnvironmentRow[];
  readonly environments: readonly EnvironmentRow[];
  readonly templates: readonly TemplateRow[];
  readonly materials: readonly MaterialRow[];
  readonly dropTable: readonly DropTableRow[];
  readonly factions: readonly FactionRow[];
}

/** The top-level keys every snapshot must carry (checked by the loader). */
export const SNAPSHOT_KEYS = [
  'takenAt',
  'rules',
  'catalog',
  'locations',
  'routes',
  'routeEnvironments',
  'environments',
  'templates',
  'materials',
  'dropTable',
  'factions',
] as const satisfies readonly (keyof Snapshot)[];

/**
 * The same snapshot with mutable properties and mutable row arrays: what `withEdits` hands to
 * an edit function, so a what-if can patch a rule, a price or a whole table.
 */
export interface SnapshotDraft {
  takenAt: string;
  rules: GameRules;
  catalog: CatalogRow[];
  locations: LocationRow[];
  routes: RouteRow[];
  routeEnvironments: RouteEnvironmentRow[];
  environments: EnvironmentRow[];
  templates: TemplateRow[];
  materials: MaterialRow[];
  dropTable: DropTableRow[];
  factions: FactionRow[];
}
