// Round-5 backlog item 4: upgrade a part in place to its next rarity tier. The mechanism is
// deliberately data-free — it derives the next tier from the catalog's own naming convention
// (`hull` -> `hull_uncommon` -> `hull_rare` -> `hull_epic` -> `hull_legendary`, same suffixes for
// every family) rather than a curated "upgradesTo" field, so it picks up whatever tier chains the
// catalog happens to define today or grows tomorrow without this file changing.

type RarityName = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

const RARITY_SUFFIX: Readonly<Record<RarityName, string>> = {
  COMMON: '',
  UNCOMMON: '_uncommon',
  RARE: '_rare',
  EPIC: '_epic',
  LEGENDARY: '_legendary',
};

// LEGENDARY has no entry: it is already the top tier.
const NEXT_RARITY: Readonly<Partial<Record<RarityName, RarityName>>> = {
  COMMON: 'UNCOMMON',
  UNCOMMON: 'RARE',
  RARE: 'EPIC',
  EPIC: 'LEGENDARY',
};

function isRarityName(value: string): value is RarityName {
  return value in RARITY_SUFFIX;
}

/** Strips the current rarity's suffix, e.g. ('hull_rare', 'RARE') -> 'hull'. */
export function basePartTypeOf(partType: string, rarity: string): string {
  if (!isRarityName(rarity)) return partType;
  const suffix = RARITY_SUFFIX[rarity];
  return suffix !== '' && partType.endsWith(suffix) ? partType.slice(0, -suffix.length) : partType;
}

/**
 * The `partType` the catalog would need to define for the next tier up, or null when `rarity`
 * is already LEGENDARY (or unrecognized). This is a naming candidate only — the caller still
 * has to look it up in PartCatalog, since most families don't yet define every tier.
 */
export function nextTierPartTypeOf(partType: string, rarity: string): string | null {
  if (!isRarityName(rarity)) return null;
  const nextRarity = NEXT_RARITY[rarity];
  if (nextRarity === undefined) return null;
  const base = basePartTypeOf(partType, rarity);
  return `${base}${RARITY_SUFFIX[nextRarity]}`;
}

/**
 * Price of upgrading in place: the base-price gap to the next tier, marked up over just selling
 * the old part and buying the new one (the premium for staying installed, no re-slotting). Never
 * free even if the catalog ever defines a next tier that isn't pricier.
 */
export function partUpgradeCost(
  currentBasePrice: number,
  nextBasePrice: number,
  multiplier: number,
): number {
  return Math.max(1, Math.round((nextBasePrice - currentBasePrice) * multiplier));
}
