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

/** Territory labels never go below this many screen pixels. */
export const MIN_LABEL_PX = 9;

/** A label's y: near the top of its circle, but never above the visible window (so a zoomed-in label stays on screen). */
export function territoryLabelY(
  territory: Pick<Territory, 'cy' | 'radius'>,
  box: { y: number } | null,
  scale: number,
): number {
  const top = territory.cy - territory.radius + 14 * scale;
  return box === null ? top : Math.max(top, box.y + 14 * scale);
}

/** The label font size in map units: the base size, but at least `minPx` on screen (unitsPerPx = map units per pixel). */
export function labelFontSize(base: number, unitsPerPx: number, minPx = MIN_LABEL_PX): number {
  return Number.isFinite(unitsPerPx) && unitsPerPx > 0 ? Math.max(base, minPx * unitsPerPx) : base;
}

/**
 * Which territories get a label. Everywhere but a phone at fit zoom all of them; there they would collide,
 * so only the territory holding the ship or the selected place is named until the map is zoomed to regional detail.
 */
export function labelledFactions(
  territories: readonly Pick<Territory, 'factionId' | 'placeIds'>[],
  opts: {
    phone: boolean;
    zoom: number;
    regionalZoom: number;
    placeIds: readonly (string | null | undefined)[];
  },
): Set<string> {
  if (!opts.phone || opts.zoom >= opts.regionalZoom) {
    return new Set(territories.map((territory) => territory.factionId));
  }
  const wanted = new Set(opts.placeIds.filter((id): id is string => typeof id === 'string'));
  return new Set(
    territories
      .filter((territory) => territory.placeIds.some((id) => wanted.has(id)))
      .map((territory) => territory.factionId),
  );
}
