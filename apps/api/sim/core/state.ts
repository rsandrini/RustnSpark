/**
 * The simulated player: wallet, clock, ledger, ship, cargo hold and materials — everything one bot
 * carries between missions. `starterPlayer` mirrors the game's onboarding
 * (`players/onboarding.service.ts`): the faction's home port, `onboarding.starter_parts` at
 * `parts.starter_condition`, a full tank, and `economy.start_credits` in the wallet.
 */
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import type { InstalledPart } from '../../src/parts/part.types.js';
import { pickCatalogStats } from '../../src/parts/parts.service.js';
import type { CatalogRow, Snapshot } from '../snapshot/types.js';
import { createClock, type Clock } from './clock.js';
import { createLedger, type Ledger } from './ledger.js';

/** One part of the ship or in the hold: enough for the sheet, the resolver and the wear report. */
export interface ShipPartState {
  id: string;
  partType: string;
  condition: number;
  /** How the run got it: scavenge finds sell through the `scavengeSale` ledger line. */
  source?: 'scavenge';
}

export interface ShipState {
  id: string;
  parts: ShipPartState[];
  /** Loose parts in the hold: the resolver freezes them, pirates can take them. */
  fuel: number;
  stance: string;
  energyMode: string;
}

/** Rarity ladder, lowest first — `shipLevel` and the market policy both rank by it. */
export const RARITY_ORDER = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;

/** One-based index on the rarity ladder: COMMON → 1 … LEGENDARY → 5 (unknown → 1). */
export function rarityLevelOf(rarity: string): number {
  const index = RARITY_ORDER.indexOf(rarity as (typeof RARITY_ORDER)[number]);
  return index === -1 ? 1 : index + 1;
}

/** Per-location scavenge attempt counter (`ScavengeCounter` in the game). */
export interface ScavengeAttempt {
  count: number;
  /** Simulated ms of the last attempt — the cooldown counts from it. */
  lastAtMs: number;
}

/** One part in one wear (kind 'wear') or repair (kind 'repair') event. */
export interface PartWearEntry {
  readonly kind: 'wear' | 'repair';
  readonly seq: number;
  readonly partType: string;
  readonly partClass: string;
  readonly rarity: string;
  /** Condition points lost (wear) or restored (repair). */
  readonly loss: number;
  /** Credits this part's share of the repair bill came to (0 for wear). */
  readonly cost: number;
}

export interface PlayerState {
  factionId: string;
  locationId: string;
  wallet: number;
  clock: Clock;
  ledger: Ledger;
  ship: ShipState;
  /** Parts in the hold (`PartInstance.location === 'INVENTORY'` in the game). */
  storage: ShipPartState[];
  /** materialId → quantity. */
  materials: Map<string, number>;
  missionsDone: number;
  scavengesDone: number;
  miningDone: number;
  /** Scavenging jobs done on foot (no ship in the job). */
  footScavenges: number;
  /** Repair actions paid (each one carries the port's maintenance fee). */
  repairActions: number;
  /** Wear and repair events by part, for the store (analysis only; nothing in the game reads it). */
  partWearLog: PartWearEntry[];
  /** Base price of the scavenged parts the pilot fitted: what the finds saved from the market. */
  findsFittedValue: number;
  /** Scavenged part ids already counted in `findsFittedValue` (a part counts once). */
  findsCounted: Set<string>;
  /** Simulated second of the last scavenging job (policy hooks read it later). */
  lastScavengeAt: number | null;
  /** locationId → attempt count and last attempt time (the scavenge cooldown). */
  scavengeAttempts: Map<string, ScavengeAttempt>;
  /** Monotonic id source for parts the run acquires (scavenge finds, market buys). */
  partSeq: number;
  /** Listing ids bought today: one physical item per port per shelf, gone until the day rolls. */
  soldListings: Set<string>;
  /** The shelf day `soldListings` belongs to; a new day clears it (live's buy-event window). */
  soldDay: string;
  log: string[];
}

/** `pickCatalogStats` over a snapshot row: the row carries every column that function reads. */
export function catalogStatsOf(row: CatalogRow) {
  return pickCatalogStats(row as unknown as Parameters<typeof pickCatalogStats>[0]);
}

export function catalogIndex(snapshot: Snapshot): Map<string, CatalogRow> {
  return new Map(snapshot.catalog.map((row) => [row.partType, row]));
}

/** The installed parts as the game's pure functions see them (connectors assumed fine, D-grid abstracted). */
export function installedParts(
  ship: ShipState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): InstalledPart[] {
  return ship.parts.map((part) => {
    const row = catalogByType.get(part.partType);
    if (row === undefined) {
      throw new Error(`part type ${part.partType} is not in the snapshot catalog`);
    }
    return {
      instance: { id: part.id, partType: part.partType, condition: part.condition },
      catalog: catalogStatsOf(row),
    };
  });
}

export interface StarterPlayerOptions {
  readonly clock?: Clock;
}

/** Home port of a faction, the same lookup onboarding does (unknown faction → error). */
export function homeLocationOf(snapshot: Snapshot, factionId: string): string {
  const homes = snapshot.rules.onboarding.home_locations as unknown as Record<string, string>;
  const locationId = homes[factionId];
  if (locationId === undefined) {
    throw new Error(`faction ${factionId} is not playable (no home location)`);
  }
  return locationId;
}

export function starterPlayer(
  snapshot: Snapshot,
  factionId: string,
  options: StarterPlayerOptions = {},
): PlayerState {
  const rules = snapshot.rules;
  const catalogByType = catalogIndex(snapshot);
  const condition = rules.parts.starter_condition;
  const parts: ShipPartState[] = (rules.onboarding.starter_parts as unknown as string[]).map(
    (partType, index) => ({
      id: `starter-${index}-${partType}`,
      partType,
      condition,
    }),
  );
  const ship: ShipState = {
    id: 'sim-ship',
    parts,
    // A new ship starts with a share of its tank, exactly like the onboarding kit
    // (`onboarding.start_fuel_fraction`).
    fuel: 0,
    stance: 'NEUTRAL',
    energyMode: 'FULL',
  };
  const fuelCap = deriveSheet(installedParts(ship, catalogByType), rules).fuelCap;
  ship.fuel = Math.min(
    fuelCap,
    Math.max(1, Math.floor(fuelCap * rules.onboarding.start_fuel_fraction)),
  );
  return {
    factionId,
    locationId: homeLocationOf(snapshot, factionId),
    wallet: rules.economy.start_credits,
    clock: options.clock ?? createClock(),
    ledger: createLedger(),
    ship,
    storage: [],
    materials: new Map(),
    missionsDone: 0,
    scavengesDone: 0,
    miningDone: 0,
    footScavenges: 0,
    repairActions: 0,
    partWearLog: [],
    findsFittedValue: 0,
    findsCounted: new Set(),
    lastScavengeAt: null,
    scavengeAttempts: new Map(),
    partSeq: 0,
    soldListings: new Set(),
    soldDay: '',
    log: [],
  };
}

/**
 * The ship's level: the lowest rarity among its installed parts (the plan's `shipLevel` —
 * a level is only reached when every installed part is at that rarity or better).
 */
export function shipLevel(
  ship: ShipState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): number {
  let level: number = RARITY_ORDER.length;
  for (const part of ship.parts) {
    const row = catalogByType.get(part.partType);
    if (row === undefined) continue;
    level = Math.min(level, rarityLevelOf(row.rarity));
  }
  return ship.parts.length === 0 ? 1 : level;
}

/** Total condition points the installed parts lost (the mission's wear). */
export function wearPoints(before: readonly ShipPartState[], after: readonly ShipPartState[]): number {
  const beforeById = new Map(before.map((part) => [part.id, part.condition]));
  let lost = 0;
  for (const part of after) {
    const was = beforeById.get(part.id) ?? part.condition;
    lost += Math.max(0, was - part.condition);
  }
  return lost;
}

/** Ship value at catalog prices: what the report's `ship_value` column means. */
export function shipValue(
  ship: ShipState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): number {
  return ship.parts.reduce((sum, part) => sum + (catalogByType.get(part.partType)?.basePrice ?? 0), 0);
}
