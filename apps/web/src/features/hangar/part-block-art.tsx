import type { SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { PartCatalogStats } from '../../api/generated';
import { conditionTone } from '../../ui/Gauge';
import { PortGlyph } from '../parts/connector-grid';
import { kindLabelKey, partKindOf } from '../parts/part-kind';
import { PartKindIcon } from '../parts/part-kind-icon';
import type { PortMark } from './connectors';
import { facingOf, footprint, type Rot } from './hangar.geometry';
import type { PartLook } from './ship-yard';

export function formatCondition(condition: number): string {
  return `${Math.round(condition)}%`;
}

const ARROW_HALF = 0.14;
const ARROW_DEPTH = 0.16;
const ARROW_EDGE_INSET = 0.04;

/** A small triangle on the facing edge of an engine (exhaust) or weapon (muzzle). */
export function FacingArrow({
  gx,
  gy,
  width,
  height,
  facing,
  label,
}: {
  gx: number;
  gy: number;
  width: number;
  height: number;
  facing: 'N' | 'E' | 'S' | 'W';
  label: string;
}) {
  const midX = gx + width / 2;
  const midY = gy + height / 2;
  const points: Record<typeof facing, string> = {
    N: `${midX - ARROW_HALF},${gy + ARROW_EDGE_INSET + ARROW_DEPTH} ${midX + ARROW_HALF},${gy + ARROW_EDGE_INSET + ARROW_DEPTH} ${midX},${gy + ARROW_EDGE_INSET}`,
    S: `${midX - ARROW_HALF},${gy + height - ARROW_EDGE_INSET - ARROW_DEPTH} ${midX + ARROW_HALF},${gy + height - ARROW_EDGE_INSET - ARROW_DEPTH} ${midX},${gy + height - ARROW_EDGE_INSET}`,
    W: `${gx + ARROW_EDGE_INSET + ARROW_DEPTH},${midY - ARROW_HALF} ${gx + ARROW_EDGE_INSET + ARROW_DEPTH},${midY + ARROW_HALF} ${gx + ARROW_EDGE_INSET},${midY}`,
    E: `${gx + width - ARROW_EDGE_INSET - ARROW_DEPTH},${midY - ARROW_HALF} ${gx + width - ARROW_EDGE_INSET - ARROW_DEPTH},${midY + ARROW_HALF} ${gx + width - ARROW_EDGE_INSET},${midY}`,
  };
  return (
    <polygon
      className="facing-arrow"
      data-facing={facing}
      points={points[facing]}
      style={{ pointerEvents: 'none' }}
    >
      <title>{label}</title>
    </polygon>
  );
}

const KIND_ROW_TOP = 0.2;
const KIND_ROW_GAP = 0.03;
const KIND_ROW_MAX_FONT = 0.17;
/** Room kept above the condition bar (it starts 0.24 above the bottom edge). */
const BAR_CLEARANCE = 0.26;

export interface BlockTextLayout {
  /** The type row, or null when the block has none (the bridge, a ghost, or no room for it). */
  row: { top: number; height: number; font: number; icon: number; showLabel: boolean } | null;
  /** How many name lines are drawn. */
  lineCount: number;
  /** Centre of the first name line, in yard cells. */
  firstY: number;
}

/**
 * Where the type row and the name go inside one block (cell units, `gy` = top of the footprint).
 * The row sits at the top, below the connector dots (inset 0.13): icon + label when the footprint is at least 2
 * cells tall, the icon alone when it is 1 cell tall (the name then keeps at most 1 line). The name block is
 * pushed down just enough to clear the row; when even that would hit the condition bar the row is dropped and the
 * name keeps its classic place.
 */
export function blockTextLayout(
  gy: number,
  height: number,
  labelFont: number,
  nameLines: number,
  withRow: boolean,
): BlockTextLayout {
  const lineHeight = labelFont * 1.15;
  const classic = (n: number) => gy + height / 2 - 0.1 - ((n - 1) * lineHeight) / 2;
  if (!withRow) return { row: null, lineCount: nameLines, firstY: classic(nameLines) };
  const font = Math.min(labelFont * 0.85, KIND_ROW_MAX_FONT);
  const rowHeight = font * 1.3;
  const top = gy + KIND_ROW_TOP;
  const lineCount = height < 2 ? Math.min(nameLines, 1) : nameLines;
  const firstY = Math.max(classic(lineCount), top + rowHeight + KIND_ROW_GAP + lineHeight / 2);
  const lastBottom = firstY + (lineCount - 1) * lineHeight + lineHeight / 2;
  if (lastBottom > gy + height - BAR_CLEARANCE) {
    return { row: null, lineCount: nameLines, firstY: classic(nameLines) };
  }
  return {
    row: { top, height: rowHeight, font, icon: font * 1.25, showLabel: height >= 2 },
    lineCount,
    firstY,
  };
}

/** Shortens a label with an ellipsis so it fits `maxWidth` cells at `font` (average glyph ~0.56 em). */
export function fitKindLabel(label: string, maxWidth: number, font: number): string {
  const maxChars = Math.max(1, Math.floor(maxWidth / (font * 0.56)));
  return label.length <= maxChars ? label : `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

export interface PartBlockArtProps {
  /** The part's top-left cell. */
  gx: number;
  gy: number;
  rot: Rot;
  catalog: PartCatalogStats;
  name: string;
  look: PartLook | undefined;
  colorBy: 'rarity' | 'condition';
  /** The port marks of this part, in the same cell coordinates as `gx`/`gy`. */
  portMarks: readonly PortMark[];
  /** The name, already wrapped to the lines that fit the block. */
  lines: readonly string[];
  /** The label's font size, in cells. */
  labelFont: number;
  flags?: {
    disconnected?: boolean;
    outside?: boolean;
    directionBlocked?: boolean;
    selected?: boolean;
    ghosting?: boolean;
    rotating?: boolean;
  };
  /** More lines for the block's tooltip (a placement problem, "outside the hull"). */
  extraTitle?: readonly string[];
  /** Props for the block's rectangle: the yard hangs its data attributes and its pointer handlers there. */
  rectProps?: SVGProps<SVGRectElement> & Record<`data-${string}`, string | number | undefined>;
}

/**
 * One part drawn the way it looks on the ship: the block in its rarity (or condition) colour, its name, the
 * condition bar, the facing arrow of an engine or weapon and the connector ports. The yard draws every placed part
 * with it, and the part carried across the screen is drawn with the very same thing, so they never differ.
 * Render it inside an `<svg>` whose units are yard cells.
 */
export function PartBlockArt({
  gx,
  gy,
  rot,
  catalog,
  name,
  look,
  colorBy,
  portMarks,
  lines,
  labelFont,
  flags = {},
  extraTitle = [],
  rectProps,
}: PartBlockArtProps) {
  const { t } = useTranslation();
  const { width, height } = footprint(catalog, rot);
  const lineHeight = labelFont * 1.15;
  const kind = partKindOf(catalog);
  const kindLabel = t(kindLabelKey(kind));
  const shownLines = look?.broken === true ? [...lines.slice(0, 1), t('parts.broken')] : lines;
  // The bridge's name is its type; a ghost is dimmed and carries no row.
  const withRow = kind !== 'bridge' && flags.ghosting !== true;
  // The name is nudged up so the condition bar never sits on the text, and down to clear the type row.
  const layout = blockTextLayout(gy, height, labelFont, shownLines.length, withRow);
  const firstY = layout.firstY;
  const drawnLines = shownLines.slice(0, layout.lineCount);
  return (
    <>
      <rect
        {...rectProps}
        className={[
          'block',
          look?.broken === true ? 'broken' : '',
          flags.disconnected === true ? 'disconnected' : '',
          flags.outside === true ? 'outside' : '',
          flags.directionBlocked === true ? 'dir-blocked' : '',
          look === undefined
            ? ''
            : colorBy === 'rarity'
              ? `rar-${look.rarity.toLowerCase()}`
              : `cond-${conditionTone(look.condition)}`,
          catalog.partClass === 'BRIDGE' ? 'bridge' : '',
          flags.selected === true ? 'selected' : '',
          flags.ghosting === true ? 'ghosting' : '',
          flags.rotating === true ? 'rotating' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        x={gx + 0.04}
        y={gy + 0.04}
        width={width - 0.08}
        height={height - 0.08}
      />
      <title>
        {[
          look === undefined
            ? name
            : `${name} — ${t('parts.condition')} ${Math.round(look.condition)}%`,
          kind === 'bridge' ? '' : kindLabel,
          ...extraTitle,
        ]
          .filter(Boolean)
          .join('\n')}
      </title>
      {look !== undefined && (
        <g style={{ pointerEvents: 'none' }}>
          <rect
            className="cond-track"
            x={gx + 0.14}
            y={gy + height - 0.24}
            width={width - 0.28}
            height={0.1}
            rx={0.05}
          />
          <rect
            className={`cond-bar cond-${conditionTone(look.condition)}`}
            x={gx + 0.14}
            y={gy + height - 0.24}
            width={((width - 0.28) * Math.min(100, Math.max(0, look.condition))) / 100}
            height={0.1}
            rx={0.05}
          />
          {/* HP/condition percent, small, centered on the bar itself. */}
          <text className="cond-label" x={gx + width / 2} y={gy + height - 0.155}>
            {formatCondition(look.condition)}
          </text>
        </g>
      )}
      {(catalog.partClass === 'ENGINE' || catalog.partClass === 'WEAPON') && (
        <FacingArrow
          gx={gx}
          gy={gy}
          width={width}
          height={height}
          facing={facingOf(rot)}
          label={t(
            catalog.partClass === 'ENGINE' ? 'hangar.facing.exhaust' : 'hangar.facing.weapon',
          )}
        />
      )}
      {portMarks.map((mark) => (
        <PortGlyph
          key={`${mark.x},${mark.y},${mark.side}`}
          x={mark.x}
          y={mark.y}
          side={mark.side}
          kind={mark.kind}
          state={mark.state}
          title={`${t(`connectors.kinds.${mark.kind}`)} — ${t(`connectors.states.${mark.state}`)}`}
        />
      ))}
      {layout.row !== null && (
        <g className="block-kind" data-testid="block-kind" style={{ pointerEvents: 'none' }}>
          <svg
            data-testid="block-kind-icon"
            x={gx + 0.16}
            y={layout.row.top + (layout.row.height - layout.row.icon) / 2}
            width={layout.row.icon}
            height={layout.row.icon}
            overflow="visible"
          >
            <PartKindIcon kind={kind} size={layout.row.icon} />
          </svg>
          {layout.row.showLabel && (
            <text
              className="block-kind-label"
              data-testid="block-kind-label"
              x={gx + 0.16 + layout.row.icon + 0.05}
              y={layout.row.top + layout.row.height / 2 + layout.row.font * 0.35}
              style={{ fontSize: `${layout.row.font}px` }}
            >
              {fitKindLabel(kindLabel, width - 0.32 - layout.row.icon - 0.05, layout.row.font)}
            </text>
          )}
        </g>
      )}
      <text
        className="block-label"
        x={gx + width / 2}
        style={{ pointerEvents: 'none', fontSize: `${labelFont}px` }}
      >
        {drawnLines.map((line, index) => (
          <tspan
            key={line + String(index)}
            x={gx + width / 2}
            y={firstY + index * lineHeight + labelFont * 0.35}
          >
            {line}
          </tspan>
        ))}
      </text>
    </>
  );
}
