import type { PartCatalogStats, Placement } from '../../api/generated';

// Pure client-side geometry for drag/snap feedback: footprints swap on right-angle rotation.
// Which cells exist comes from the ship's own format (`ship.yard.cells`), which also
// re-validates every preview and the save (D20) — the client owns no copy of the shape beyond
// what it was just given to render.

export function footprint(
  catalog: PartCatalogStats,
  rot: 0 | 90,
): { width: number; height: number } {
  return rot === 90
    ? { width: catalog.h, height: catalog.w }
    : { width: catalog.w, height: catalog.h };
}

export function canPlace(
  layout: readonly Placement[],
  catalogById: ReadonlyMap<string, PartCatalogStats>,
  partInstanceId: string,
  gx: number,
  gy: number,
  rot: 0 | 90,
  cells: ReadonlySet<string>,
): boolean {
  const catalog = catalogById.get(partInstanceId);
  if (catalog === undefined) return false;
  const { width, height } = footprint(catalog, rot);
  for (let dx = 0; dx < width; dx += 1) {
    for (let dy = 0; dy < height; dy += 1) {
      if (!cells.has(`${gx + dx},${gy + dy}`)) return false;
    }
  }
  for (const placement of layout) {
    if (placement.partInstanceId === partInstanceId) continue;
    const other = catalogById.get(placement.partInstanceId);
    if (other === undefined) continue;
    const otherFoot = footprint(other, placement.rot);
    const overlaps =
      gx < placement.gx + otherFoot.width &&
      placement.gx < gx + width &&
      gy < placement.gy + otherFoot.height &&
      placement.gy < gy + height;
    if (overlaps) return false;
  }
  return true;
}
