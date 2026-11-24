import type { WorldLocation } from '../../api/generated';

/** A faction's area on the star chart: a circle around its places, in map units. */
export interface Territory {
  factionId: string;
  cx: number;
  cy: number;
  radius: number;
  placeIds: string[];
}

export interface TerritoryOptions {
  /** Margin added beyond the farthest place (default 40). */
  pad?: number;
  /** Smallest radius, so a lone place still gets an area (default 60). */
  minRadius?: number;
}

/** Place faction ids that mean "no faction": the server's neutral id is 'free'. */
const INDEPENDENT = new Set(['', 'free', 'independent']);

export function territoriesOf(
  locations: readonly Pick<WorldLocation, 'id' | 'x' | 'y' | 'factionId'>[],
  opts: TerritoryOptions = {},
): Territory[] {
  const pad = opts.pad ?? 40;
  const minRadius = opts.minRadius ?? 60;
  const byFaction = new Map<string, typeof locations>();
  for (const l of locations) {
    if (INDEPENDENT.has(l.factionId)) continue;
    byFaction.set(l.factionId, [...(byFaction.get(l.factionId) ?? []), l]);
  }
  return [...byFaction.keys()].sort().map((factionId) => {
    const places = byFaction.get(factionId)!;
    const cx = places.reduce((s, p) => s + p.x, 0) / places.length;
    const cy = places.reduce((s, p) => s + p.y, 0) / places.length;
    const far = Math.max(...places.map((p) => Math.hypot(p.x - cx, p.y - cy)));
    return {
      factionId,
      cx,
      cy,
      radius: Math.max(far + pad, minRadius),
      placeIds: places.map((p) => p.id),
    };
  });
}
