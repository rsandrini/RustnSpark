import type { ShipFormat } from '../../api/generated';

const RARITY_ORDER: readonly string[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];

interface BridgeLevel {
  readonly rarity: string;
  readonly w: number;
  readonly h: number;
}

/**
 * The formats to offer right after the bridge changed: the ones of the new bridge's own level, not
 * the whole history of what it unlocks. Of the formats the server lists as unlocked, those whose
 * rarity floor equals the bridge's rarity and whose size floor equals its size; when none sits
 * exactly there (the catalog has gaps), the highest tier available instead.
 */
export function formatsForBridge(
  unlocked: readonly ShipFormat[],
  bridge: BridgeLevel,
): ShipFormat[] {
  const size = Math.min(bridge.w, bridge.h);
  const rank = (format: ShipFormat) => RARITY_ORDER.indexOf(format.minRarity);
  const exact = unlocked.filter(
    (format) => format.minRarity === bridge.rarity && format.minBridgeSize === size,
  );
  if (exact.length > 0) return exact;
  if (unlocked.length === 0) return [];
  const bestSize = Math.max(...unlocked.map((format) => format.minBridgeSize));
  const ofSize = unlocked.filter((format) => format.minBridgeSize === bestSize);
  const bestRank = Math.max(...ofSize.map(rank));
  return ofSize.filter((format) => rank(format) === bestRank);
}
