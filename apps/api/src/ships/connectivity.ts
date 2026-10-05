import type { InstalledPart, PartCatalog } from '../parts/part.types.js';

/** The spec's own exhaustive functional-stat list (2026-10-02-connectors-v1-design.md) — a
    disconnected part stops contributing exactly these, and nothing else. An earlier version of
    this function zeroed "every numeric field that isn't mass/structureCost/partHp" instead of
    this explicit list, which also zeroed w, h, and basePrice (geometry and pricing, not
    gameplay stats) — basePrice feeding shipTier() meant a disconnected part could silently
    drop a ship's whole tier. Listed explicitly so adding a new PartCatalog field never
    silently becomes "functional" by default. */
const FUNCTIONAL_KEYS = [
  'pot',
  'pdf',
  'bli',
  'esc',
  'sen',
  'crg',
  'min',
  'energyCont',
  'energyCombat',
  'batCharge',
  'batOutput',
  'batInput',
  'fuelCap',
  'fuelUse',
] as const satisfies ReadonlyArray<keyof PartCatalog>;

/** Zeroes a disconnected part's functional stats before deriveSheet sums them — deriveSheet
    itself is unchanged; this is a pure pre-processing step every real caller applies first.
    mass/structureCost/partHp (and everything else on PartCatalog: w, h, basePrice, partType,
    partClass, pressurized, lifeSupport) are untouched regardless of connection status
    (Connectors v0.1: a disconnected part is dead weight, not an absent one). */
export function applyConnectivity(
  parts: readonly InstalledPart[],
  connectedIds: ReadonlySet<string>,
): InstalledPart[] {
  return parts.map((part) => {
    if (connectedIds.has(part.instance.id)) return part;
    const catalog = { ...part.catalog };
    for (const key of FUNCTIONAL_KEYS) {
      catalog[key] = 0;
    }
    return { ...part, catalog };
  });
}
