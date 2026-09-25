import type { PartCatalogStats, Placement } from '../../api/generated';

// The same yard the server validates (geometry.ts): cells [-10, 10), footprints swap on
// right-angle rotation. This is pure client-side geometry for drag/snap feedback —
// the server re-validates every preview and the save (D20).
const GRID_HALF_SIZE = 10;

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
): boolean {
  const catalog = catalogById.get(partInstanceId);
  if (catalog === undefined) return false;
  const { width, height } = footprint(catalog, rot);
  if (
    gx < -GRID_HALF_SIZE ||
    gy < -GRID_HALF_SIZE ||
    gx + width > GRID_HALF_SIZE ||
    gy + height > GRID_HALF_SIZE
  ) {
    return false;
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
