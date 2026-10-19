const RARITY_ORDER: readonly string[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];

interface FormatLevel {
  readonly minRarity: string;
  readonly minBridgeSize: number;
}

interface BridgeLevel {
  readonly rarity: string;
  readonly w: number;
  readonly h: number;
}

/**
 * The formats to offer right after the bridge changed: the ones of the new bridge's own level, not
 * the whole history of what it unlocks. Of the formats the bridge unlocks, those whose rarity floor
 * equals the bridge's rarity and whose size floor equals its size; when none sits exactly there
 * (the catalog has gaps), the highest tier available instead: both the best formats of the highest
 * rarity the bridge unlocks (whatever their size) and the best formats of the biggest size it
 * unlocks, so a 2x2 bridge of a high rarity still sees its rarity's shapes next to the big ones.
 */
export function formatsForBridge<T extends FormatLevel>(
  unlocked: readonly T[],
  bridge: BridgeLevel,
): T[] {
  const size = Math.min(bridge.w, bridge.h);
  const rank = (format: FormatLevel) => RARITY_ORDER.indexOf(format.minRarity);
  const exact = unlocked.filter(
    (format) => format.minRarity === bridge.rarity && format.minBridgeSize === size,
  );
  if (exact.length > 0) return exact;
  if (unlocked.length === 0) return [];
  const bestSize = Math.max(...unlocked.map((format) => format.minBridgeSize));
  const ofSize = unlocked.filter((format) => format.minBridgeSize === bestSize);
  const bestRankOfSize = Math.max(...ofSize.map(rank));
  const biggest = ofSize.filter((format) => rank(format) === bestRankOfSize);
  const bestRank = Math.max(...unlocked.map(rank));
  const highest = unlocked.filter((format) => rank(format) === bestRank);
  return [...new Set([...highest, ...biggest])];
}

/** Whether the installed bridge is not the one the ship's format was last picked for. */
export function formatChangePending(
  recordedBridgeType: string | null,
  installedBridgeType: string | null,
): boolean {
  return (
    recordedBridgeType !== null &&
    installedBridgeType !== null &&
    recordedBridgeType !== installedBridgeType
  );
}

interface ShipBridgeReader {
  ship: { findUnique(args: unknown): Promise<unknown> };
  partInstance: { findFirst(args: unknown): Promise<unknown> };
}

/** Reads the same rule from the database (guards before a ship leaves port). */
export async function shipFormatChangePending(client: unknown, shipId: string): Promise<boolean> {
  const db = client as ShipBridgeReader;
  const ship = (await db.ship.findUnique({
    where: { id: shipId },
    select: { formatBridgeType: true },
  })) as { formatBridgeType: string | null } | null;
  if (ship === null || ship.formatBridgeType === null) return false;
  const bridge = (await db.partInstance.findFirst({
    where: { shipId, location: 'INSTALLED', partCatalog: { partClass: 'BRIDGE' } },
    select: { partType: true },
  })) as { partType: string } | null;
  return formatChangePending(ship.formatBridgeType, bridge?.partType ?? null);
}
