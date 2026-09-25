import type { PartCatalogStats, Placement } from '../../api/generated';

// Pure client-side geometry for drag/snap feedback: cells [-halfSize, halfSize), footprints
// swap on right-angle rotation. The yard size comes from the server (`ship.yard.halfSize`), which
// also re-validates every preview and the save (D20) — the client owns no copy of the number.

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
  halfSize: number,
): boolean {
  const catalog = catalogById.get(partInstanceId);
  if (catalog === undefined) return false;
  const { width, height } = footprint(catalog, rot);
  if (gx < -halfSize || gy < -halfSize || gx + width > halfSize || gy + height > halfSize) {
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
