import { stableUnit } from './deterministic.js';

/**
 * The daily used-parts shelf (D25) as pure functions: which part, at what condition, sits in
 * slot `index` of a port's shelf on a UTC day, plus the listing-id format that names it.
 * `MarketService` lists offers with these and re-derives them on `buy`, so listing and
 * purchase can never disagree — and because nothing here reads the clock, a test can replay
 * any day of the year.
 */
export const USED_OFFER_COUNT = 6;
const USED_CONDITION_MIN = 40;
const USED_CONDITION_MAX = 90;
const DAY_KEY_LENGTH = 10;

export function dayKey(at: Date): string {
  return at.toISOString().slice(0, DAY_KEY_LENGTH);
}

export function catalogListingId(locationId: string, partType: string): string {
  return `catalog:${locationId}:${partType}`;
}

export function usedListingId(
  locationId: string,
  day: string,
  index: number,
  partType: string,
): string {
  return `used:${locationId}:${day}:${index}:${partType}`;
}

// Seeds for the connector layout a listing carries (connector ports spec, decision 7): derived
// only from the listing's own identity, so market() shows — and buy() stores — the same
// layout. Used offers are one physical item per (port, day, slot); catalog (new) stock is the
// same per (port, day, part type).
export function usedConnectorSeed(locationId: string, day: string, index: number): string {
  return `conn:${locationId}:${day}:${index}`;
}

export function catalogConnectorSeed(locationId: string, day: string, partType: string): string {
  return `conn:${locationId}:${day}:${partType}`;
}

// The day's shelf: condition (already within the 40–90 band) and part for slot `index`.
// market() lists it and buy() re-derives it, so both must read this one function or the
// listed price and the charged price can drift apart.
export function usedOffer<T>(
  locationId: string,
  day: string,
  index: number,
  catalogs: readonly T[],
): { condition: number; part: T | undefined } {
  const roll = stableUnit(`${locationId}:${day}:${index}`);
  const condition = Math.min(
    USED_CONDITION_MAX,
    Math.floor(USED_CONDITION_MIN + roll * (USED_CONDITION_MAX - USED_CONDITION_MIN + 1)),
  );
  const part =
    catalogs[Math.floor(stableUnit(`part:${locationId}:${day}:${index}`) * catalogs.length)];
  return { condition, part };
}

export function parseListingId(listingId: string): {
  kind: 'catalog' | 'used';
  locationId: string;
  partType: string;
  day?: string;
  index?: number;
} | null {
  const catalog = /^catalog:(?<locationId>[^:]+):(?<partType>.+)$/.exec(listingId);
  if (catalog?.groups) {
    return {
      kind: 'catalog',
      locationId: catalog.groups['locationId']!,
      partType: catalog.groups['partType']!,
    };
  }
  const used =
    /^used:(?<locationId>[^:]+):(?<day>\d{4}-\d{2}-\d{2}):(?<index>\d+):(?<partType>.+)$/.exec(
      listingId,
    );
  if (used?.groups) {
    const index = Number(used.groups['index']);
    // Only the six offers the board actually shows exist. Without this bound a client
    // could enumerate any date-shaped day and any index to mint arbitrary
    // (condition, partType) combinations that were never listed.
    if (!Number.isSafeInteger(index) || index < 0 || index >= USED_OFFER_COUNT) {
      return null;
    }
    return {
      kind: 'used',
      locationId: used.groups['locationId']!,
      day: used.groups['day']!,
      index,
      partType: used.groups['partType']!,
    };
  }
  return null;
}
