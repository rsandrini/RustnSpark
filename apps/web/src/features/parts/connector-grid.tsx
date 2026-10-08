import { useTranslation } from 'react-i18next';
import type { ConnectorCell } from '../../api/generated';
import type { Kind, PortState, Side } from '../hangar/connectors';

// Shapes carry the connection KIND by how many ports sit on the edge — central: ONE dot at the
// centre; split: TWO small dots either side of the centre; universal: THREE (the centre dot plus
// the two small ones, so it visibly contains both and joins either); none: nothing. Colour carries
// the STATE (green connected, red incorrect, blue available), and the state is also in <title>.
const INSET = 0.13;
const MID = 0.5;
const CENTRAL_RADIUS = 0.075;
const SMALL_RADIUS = 0.05;
const SMALL_OFFSET = 0.17;

/** Offsets along the edge, and the dot radius, for each kind. */
const DOTS: Record<Exclude<Kind, 'none'>, { offset: number; radius: number }[]> = {
  central: [{ offset: 0, radius: CENTRAL_RADIUS }],
  split: [
    { offset: -SMALL_OFFSET, radius: SMALL_RADIUS },
    { offset: SMALL_OFFSET, radius: SMALL_RADIUS },
  ],
  universal: [
    { offset: -SMALL_OFFSET, radius: SMALL_RADIUS },
    { offset: 0, radius: CENTRAL_RADIUS },
    { offset: SMALL_OFFSET, radius: SMALL_RADIUS },
  ],
};

function anchor(x: number, y: number, side: Side): { cx: number; cy: number } {
  switch (side) {
    case 'N':
      return { cx: x + MID, cy: y + INSET };
    case 'S':
      return { cx: x + MID, cy: y + 1 - INSET };
    case 'W':
      return { cx: x + INSET, cy: y + MID };
    default:
      return { cx: x + 1 - INSET, cy: y + MID };
  }
}

/** One port glyph, in grid-cell units, at the inside edge of cell (x, y). */
export function PortGlyph({
  x,
  y,
  side,
  kind,
  state,
  title,
}: {
  x: number;
  y: number;
  side: Side;
  kind: Kind;
  state: PortState;
  title?: string;
}) {
  if (kind === 'none') return null;
  const { cx, cy } = anchor(x, y, side);
  const className = `conn-mark conn-${state} conn-kind-${kind}`;
  const horizontalEdge = side === 'N' || side === 'S';
  return (
    <g className={className} style={{ pointerEvents: 'none' }} data-testid="port-mark">
      {title !== undefined && <title>{title}</title>}
      {DOTS[kind].map((dot) => (
        <circle
          key={dot.offset}
          cx={horizontalEdge ? cx + dot.offset : cx}
          cy={horizontalEdge ? cy : cy + dot.offset}
          r={dot.radius}
        />
      ))}
    </g>
  );
}

/** Read-only footprint of a part with its (available-state) ports: the "before you buy" view.
    Renders nothing for a part with no stored layout (legacy/universal fallback). */
export function ConnectorGrid({
  w,
  h,
  connectors,
  size = 'full',
}: {
  w: number;
  h: number;
  connectors: readonly ConnectorCell[];
  size?: 'mini' | 'full';
}) {
  const { t } = useTranslation();
  if (connectors.length === 0) return null;
  const label = t('connectors.gridLabel');
  return (
    <svg
      className={`connector-grid connector-grid-${size}`}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      data-testid="connector-grid"
    >
      {Array.from({ length: w * h }, (_, index) => (
        <rect
          key={index}
          className="connector-grid-cell"
          x={(index % w) + 0.03}
          y={Math.floor(index / w) + 0.03}
          width={0.94}
          height={0.94}
          rx={0.08}
        />
      ))}
      {connectors.map((cell) => (
        <PortGlyph
          key={`${cell.dx},${cell.dy},${cell.side}`}
          x={cell.dx}
          y={cell.dy}
          side={cell.side}
          kind={cell.kind}
          state="available"
          title={t(`connectors.kinds.${cell.kind}`)}
        />
      ))}
    </svg>
  );
}

/** A kind as the dots it puts on an edge (none = an empty slot) — for chips, legends and tables. */
export function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  return (
    <svg
      className={`kind-icon conn-kind-${kind}${className === undefined ? '' : ` ${className}`}`}
      viewBox="-0.5 -0.2 1 0.4"
      aria-hidden="true"
    >
      {kind === 'none' ? (
        <line x1={-0.3} y1={0} x2={0.3} y2={0} className="kind-icon-none" />
      ) : (
        DOTS[kind].map((dot) => <circle key={dot.offset} cx={dot.offset} cy={0} r={dot.radius} />)
      )}
    </svg>
  );
}
