import type { SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { PartCatalogStats } from '../../api/generated';
import { conditionTone } from '../../ui/Gauge';
import { PortGlyph } from '../parts/connector-grid';
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
  // Nudged up so the condition bar along the bottom edge never sits on the text.
  const firstY = gy + height / 2 - 0.1 - ((lines.length - 1) * lineHeight) / 2;
  const shownLines = look?.broken === true ? [...lines.slice(0, 1), t('parts.broken')] : lines;
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
      <text
        className="block-label"
        x={gx + width / 2}
        style={{ pointerEvents: 'none', fontSize: `${labelFont}px` }}
      >
        {shownLines.map((line, index) => (
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
