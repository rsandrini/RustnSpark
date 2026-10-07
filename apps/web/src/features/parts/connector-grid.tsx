import { useTranslation } from 'react-i18next';
import type { ConnectorCell } from '../../api/generated';
import type { Kind, PortState, Side } from '../hangar/connectors';

// Shapes carry the connection KIND (dot = central, bar = split, ring = universal, nothing = none);
// colour carries the STATE (green connected, red incorrect, blue available) — so a colour-blind
// player can still read the kind, and the state is also in the <title>.
const INSET = 0.13;
const MID = 0.5;
const DOT_RADIUS = 0.07;
const RING_RADIUS = 0.085;
const BAR_HALF = 0.17;
const BAR_THICK = 0.06;
const GLYPH_STROKE = 0.04;

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
      {kind === 'central' && <circle cx={cx} cy={cy} r={DOT_RADIUS} />}
      {kind === 'universal' && (
        <circle cx={cx} cy={cy} r={RING_RADIUS} fill="none" strokeWidth={GLYPH_STROKE} />
      )}
      {kind === 'split' && (
        <rect
          x={horizontalEdge ? cx - BAR_HALF : cx - BAR_THICK / 2}
          y={horizontalEdge ? cy - BAR_THICK / 2 : cy - BAR_HALF}
          width={horizontalEdge ? BAR_HALF * 2 : BAR_THICK}
          height={horizontalEdge ? BAR_THICK : BAR_HALF * 2}
          rx={BAR_THICK / 2}
        />
      )}
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
