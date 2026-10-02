import type { InstalledPart } from '../parts/part.types.js';

/** Stats that still count for a disconnected part — it's still physically bolted on, still
    has bulk and hull integrity, it just isn't doing its job. Every other catalog stat is
    "functional" and only counts when connected. */
const STRUCTURAL_KEYS = new Set(['mass', 'structureCost', 'partHp']);

/** Zeroes a disconnected part's functional stats before deriveSheet sums them — deriveSheet
    itself is unchanged; this is a pure pre-processing step every real caller applies first.
    mass/structureCost/partHp are untouched regardless of connection status (Connectors v0.1:
    a disconnected part is dead weight, not an absent one). */
export function applyConnectivity(
  parts: readonly InstalledPart[],
  connectedIds: ReadonlySet<string>,
): InstalledPart[] {
  return parts.map((part) => {
    if (connectedIds.has(part.instance.id)) return part;
    const catalog = { ...part.catalog };
    for (const key of Object.keys(catalog) as Array<keyof typeof catalog>) {
      if (STRUCTURAL_KEYS.has(key) || typeof catalog[key] !== 'number') continue;
      (catalog as Record<string, unknown>)[key] = 0;
    }
    return { ...part, catalog };
  });
}
