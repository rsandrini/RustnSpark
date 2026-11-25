import type { Placement } from '../../api/generated';

export interface ShipMiniMapProps {
  layout: readonly Placement[];
  /** The rotated footprint (in cells) of a placed part; a part it does not know is not drawn. */
  footprintOf: (partInstanceId: string) => { width: number; height: number } | undefined;
  /** The part drawn in the brass accent; an id that is not on the ship highlights nothing. */
  highlightId?: string;
  size?: number;
  label: string;
}

const PAD = 0.5;
const GAP = 0.08;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A small drawing of the ship: every placed part as a rounded rect in its cell footprint, the
 * bounds fitted into a square view. The highlighted part is brass and pulses (not under reduced
 * motion); parts parked outside the hull are faded.
 */
export function ShipMiniMap({
  layout,
  footprintOf,
  highlightId,
  size = 96,
  label,
}: ShipMiniMapProps) {
  const cells = layout.flatMap((placement) => {
    const fp = footprintOf(placement.partInstanceId);
    return fp === undefined ? [] : [{ placement, fp }];
  });
  const minX = Math.min(...cells.map((c) => c.placement.gx));
  const minY = Math.min(...cells.map((c) => c.placement.gy));
  const maxX = Math.max(...cells.map((c) => c.placement.gx + c.fp.width));
  const maxY = Math.max(...cells.map((c) => c.placement.gy + c.fp.height));
  const side = cells.length === 0 ? 1 : Math.max(maxX - minX, maxY - minY) + PAD * 2;
  const offsetX = cells.length === 0 ? 0 : (side - (maxX - minX)) / 2 - minX;
  const offsetY = cells.length === 0 ? 0 : (side - (maxY - minY)) / 2 - minY;
  const pulse = !prefersReducedMotion();
  return (
    <svg
      className="kit-shipmap"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${side} ${side}`}
    >
      {cells.map(({ placement, fp }) => {
        const highlighted = placement.partInstanceId === highlightId;
        const outside = placement.outside === true;
        const cls = [
          'kit-shipmap-part',
          highlighted ? 'kit-shipmap-hot' : '',
          highlighted && pulse ? 'kit-shipmap-pulse' : '',
          outside ? 'kit-shipmap-out' : '',
        ]
          .filter((c) => c !== '')
          .join(' ');
        return (
          <rect
            key={placement.partInstanceId}
            className={cls}
            data-part-id={placement.partInstanceId}
            x={placement.gx + offsetX + GAP}
            y={placement.gy + offsetY + GAP}
            width={fp.width - GAP * 2}
            height={fp.height - GAP * 2}
            rx={0.18}
          />
        );
      })}
    </svg>
  );
}
