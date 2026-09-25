import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PartCatalogStats, Placement } from '../../api/generated';
import { footprint } from './hangar.geometry';

const GRID_HALF_SIZE = 10;
const CELL_COUNT = GRID_HALF_SIZE * 2;

export interface ShipYardProps {
  layout: readonly Placement[];
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
  const svgRef = useRef<SVGSVGElement>(null);

  const cells: Array<{ gx: number; gy: number }> = [];
  for (let gy = -GRID_HALF_SIZE; gy < GRID_HALF_SIZE; gy += 1) {
    for (let gx = -GRID_HALF_SIZE; gx < GRID_HALF_SIZE; gx += 1) {
      cells.push({ gx, gy });
    }
  }

  const gridLines: string[] = [];
  for (let i = 0; i <= CELL_COUNT; i += 1) {
    const coordinate = -GRID_HALF_SIZE + i;
    gridLines.push(`M${coordinate},${-GRID_HALF_SIZE} V${GRID_HALF_SIZE}`);
    gridLines.push(`M${-GRID_HALF_SIZE},${coordinate} H${GRID_HALF_SIZE}`);
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
        viewBox={`${-GRID_HALF_SIZE} ${-GRID_HALF_SIZE} ${CELL_COUNT} ${CELL_COUNT}`}
        role="grid"
        aria-label="assembly grid"
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
              <text
                className="block-label"
                x={placement.gx + width / 2}
                y={placement.gy + height / 2 + 0.2}
                style={{ pointerEvents: 'none' }}
              >
                {nameById.get(placement.partInstanceId) ?? catalog.partType}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
