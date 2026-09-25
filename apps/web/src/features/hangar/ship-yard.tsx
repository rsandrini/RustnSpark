import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PartCatalogStats, Placement } from '../../api/generated';
import { footprint } from './hangar.geometry';

// A cell is small: show the first word of the part name, trimmed to what fits the block
// (~4 characters per cell at the label size); the full name is the block's <title> tooltip.
function fitLabel(name: string, blockWidth: number): string {
  const maxChars = Math.max(2, Math.floor((blockWidth - 0.15) * 4.3));
  const first = name.split(' ')[0] ?? name;
  return first.length <= maxChars ? first : `${first.slice(0, maxChars - 1)}…`;
}

export interface ShipYardProps {
  layout: readonly Placement[];
  /** Yard extent from the server: cells run [-halfSize, halfSize). */
  halfSize: number;
  catalogById: ReadonlyMap<string, PartCatalogStats>;
  /** Localized part names by instance id. */
  nameById: ReadonlyMap<string, string>;
  selectedId: string | null;
  draggingId: string | null;
  onSelect: (partInstanceId: string | null) => void;
  onCellClick: (gx: number, gy: number) => void;
  onCellHover: (gx: number, gy: number) => void;
  onDragStart: (partInstanceId: string) => void;
  onDragEnd: () => void;
}

// The 20×20 assembly yard. Cells are transparent rects (data-gx/gy) so placement and
// drag feedback come from real geometry: while a block is dragged it stops capturing
// pointer events and the cell underneath reports where it would snap.
export function ShipYard({
  layout,
  halfSize,
  catalogById,
  nameById,
  selectedId,
  draggingId,
  onSelect,
  onCellClick,
  onCellHover,
  onDragStart,
  onDragEnd,
}: ShipYardProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);

  const cells: Array<{ gx: number; gy: number }> = [];
  const cellCount = halfSize * 2;
  for (let gy = -halfSize; gy < halfSize; gy += 1) {
    for (let gx = -halfSize; gx < halfSize; gx += 1) {
      cells.push({ gx, gy });
    }
  }

  const gridLines: string[] = [];
  for (let i = 0; i <= cellCount; i += 1) {
    const coordinate = -halfSize + i;
    gridLines.push(`M${coordinate},${-halfSize} V${halfSize}`);
    gridLines.push(`M${-halfSize},${coordinate} H${halfSize}`);
  }

  const handlePointerDown = (event: ReactPointerEvent<SVGRectElement>, placement: Placement) => {
    onSelect(placement.partInstanceId);
    onDragStart(placement.partInstanceId);
    event.stopPropagation();
  };

  return (
    <div className="stage hangar-scene">
      <svg
        ref={svgRef}
        viewBox={`${-halfSize} ${-halfSize} ${cellCount} ${cellCount}`}
        role="group"
        aria-label={t('hangar.yardLabel')}
        onPointerUp={onDragEnd}
        onPointerLeave={onDragEnd}
      >
        <path className="yard-grid" d={gridLines.join(' ')} />
        {cells.map((cell) => (
          <rect
            key={`${cell.gx},${cell.gy}`}
            className="yard-cell"
            data-gx={cell.gx}
            data-gy={cell.gy}
            x={cell.gx}
            y={cell.gy}
            width={1}
            height={1}
            onClick={() => onCellClick(cell.gx, cell.gy)}
            onPointerEnter={() => onCellHover(cell.gx, cell.gy)}
          />
        ))}
        {layout.map((placement) => {
          const catalog = catalogById.get(placement.partInstanceId);
          if (catalog === undefined) return null;
          const { width, height } = footprint(catalog, placement.rot);
          return (
            <g key={placement.partInstanceId} className="yard-block">
              <rect
                data-part-id={placement.partInstanceId}
                data-gx={placement.gx}
                data-gy={placement.gy}
                className={[
                  'block',
                  catalog.partClass === 'BRIDGE' ? 'bridge' : '',
                  selectedId === placement.partInstanceId ? 'selected' : '',
                  draggingId === placement.partInstanceId ? 'floating' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                x={placement.gx + 0.04}
                y={placement.gy + 0.04}
                width={width - 0.08}
                height={height - 0.08}
                style={
                  draggingId === placement.partInstanceId ? { pointerEvents: 'none' } : undefined
                }
                onPointerDown={(event) => handlePointerDown(event, placement)}
              />
              <title>{nameById.get(placement.partInstanceId) ?? catalog.partType}</title>
              <text
                className="block-label"
                x={placement.gx + width / 2}
                y={placement.gy + height / 2 + 0.2}
                style={{ pointerEvents: 'none' }}
              >
                {fitLabel(nameById.get(placement.partInstanceId) ?? catalog.partType, width)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
