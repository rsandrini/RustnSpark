import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PartCatalogStats, Placement } from '../../api/generated';
import { conditionTone } from '../../ui/Gauge';
import { footprint } from './hangar.geometry';

const MIN_SPAN = 4;
const FIT_MARGIN = 2;
const ZOOM_STEP = 1.4;
// Pointer travel (px) below which a press is a click, not the start of a pan.
const PAN_THRESHOLD = 5;

interface View {
  cx: number;
  cy: number;
  /** Visible width in cells (the yard is square). */
  span: number;
}

// Text is in yard units, so it grows with the zoom. To make names readable the label font
// shrinks (in units) as the player zooms in, which lets more characters and lines fit a block;
// past LABEL_ZOOM_CAP the labels just keep growing on screen.
const LABEL_ZOOM_CAP = 2.4;
const LABEL_FONT = 0.42;

/** Word-wrap a part name into the lines that fit a block of the given size at this zoom. */
export function labelLines(name: string, width: number, height: number, zoom: number): string[] {
  const boost = Math.min(Math.max(zoom, 1), LABEL_ZOOM_CAP);
  const maxChars = Math.max(2, Math.floor((width - 0.15) * 4.3 * boost));
  const maxLines = Math.max(1, Math.floor((height - 0.1) * 2 * boost));
  const lines: string[] = [];
  let current = '';
  for (const word of name.split(' ')) {
    const next = current === '' ? word : `${current} ${word}`;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current !== '') lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  const shown = lines.slice(0, maxLines).map((line) => {
    return line.length <= maxChars ? line : `${line.slice(0, maxChars - 1)}…`;
  });
  if (lines.length > maxLines) {
    const last = shown[shown.length - 1] ?? '';
    shown[shown.length - 1] = last.endsWith('…') ? last : `${last.slice(0, maxChars - 1)}…`;
  }
  return shown;
}

export interface PartLook {
  readonly rarity: string;
  /** Condition in percent (0..100). */
  readonly condition: number;
  /** Dead: at or below the wear threshold. */
  readonly broken: boolean;
}

export interface ShipYardProps {
  layout: readonly Placement[];
  /** Rarity and condition by instance id: blocks are coloured by one of them. */
  lookById?: ReadonlyMap<string, PartLook>;
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
  /** Hovering a placed block (owner request): a small stats-only card, not the full popup. */
  onHoverPart?: (partInstanceId: string | null) => void;
}

// The assembly yard. Cells are transparent rects (data-gx/gy) so placement and drag feedback
// come from real geometry: while a block is dragged it stops capturing pointer events and the
// cell underneath reports where it would snap. The view (zoom + pan) is a viewBox window onto
// the fixed grid, so the geometry the server validates never changes.
export function ShipYard({
  layout,
  lookById,
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
  onHoverPart,
}: ShipYardProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const cellCount = halfSize * 2;

  const clampView = useCallback(
    (view: View): View => {
      const span = Math.min(cellCount, Math.max(MIN_SPAN, view.span));
      const limit = halfSize - span / 2;
      return {
        span,
        cx: Math.min(limit, Math.max(-limit, view.cx)),
        cy: Math.min(limit, Math.max(-limit, view.cy)),
      };
    },
    [cellCount, halfSize],
  );

  const fitView = useCallback((): View => {
    if (layout.length === 0) return clampView({ cx: 0, cy: 0, span: Math.min(cellCount, 20) });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const placement of layout) {
      const catalog = catalogById.get(placement.partInstanceId);
      if (catalog === undefined) continue;
      const { width, height } = footprint(catalog, placement.rot);
      minX = Math.min(minX, placement.gx);
      minY = Math.min(minY, placement.gy);
      maxX = Math.max(maxX, placement.gx + width);
      maxY = Math.max(maxY, placement.gy + height);
    }
    if (!Number.isFinite(minX)) return clampView({ cx: 0, cy: 0, span: Math.min(cellCount, 20) });
    return clampView({
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      span: Math.max(maxX - minX, maxY - minY) + FIT_MARGIN * 2,
    });
  }, [layout, catalogById, cellCount, clampView]);

  const [colorBy, setColorBy] = useState<'rarity' | 'condition'>('rarity');
  const [view, setView] = useState<View>(() => clampView({ cx: 0, cy: 0, span: 20 }));
  const viewRef = useRef(view);
  viewRef.current = view;

  // Frame the ship the first time it has parts (the page seeds the layout after loading).
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && layout.length > 0) {
      fitted.current = true;
      setView(fitView());
    }
  }, [layout, fitView]);

  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      setView((current) => {
        const span = Math.min(cellCount, Math.max(MIN_SPAN, current.span / factor));
        // Keep the point under the cursor fixed while the window resizes around it.
        const ax = anchor?.x ?? current.cx;
        const ay = anchor?.y ?? current.cy;
        const ratio = span / current.span;
        return clampView({
          span,
          cx: ax + (current.cx - ax) * ratio,
          cy: ay + (current.cy - ay) * ratio,
        });
      });
    },
    [cellCount, clampView],
  );

  // Wheel zoom needs a non-passive listener to stop the page from scrolling under the yard.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const current = viewRef.current;
      const anchor = {
        x:
          current.cx - current.span / 2 + ((event.clientX - rect.left) / rect.width) * current.span,
        y:
          current.cy - current.span / 2 + ((event.clientY - rect.top) / rect.height) * current.span,
      };
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, anchor);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // Pan (one pointer on the background) and pinch (two pointers), tracked by pointer id.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; pinchDistance: number | null }>({
    moved: false,
    pinchDistance: null,
  });

  const handleBackgroundDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) gesture.current.moved = false;
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (previous === undefined || draggingId !== null) return;
    const svg = svgRef.current;
    if (svg === null) return;
    const rect = svg.getBoundingClientRect();
    const current = viewRef.current;
    const unitsPerPx = current.span / rect.width;
    const next = { x: event.clientX, y: event.clientY };

    if (pointers.current.size >= 2) {
      pointers.current.set(event.pointerId, next);
      const [a, b] = Array.from(pointers.current.values());
      if (a === undefined || b === undefined) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const last = gesture.current.pinchDistance;
      gesture.current.pinchDistance = distance;
      gesture.current.moved = true;
      if (last !== null && last > 0) zoomBy(distance / last);
      return;
    }

    const travelled = Math.hypot(next.x - previous.x, next.y - previous.y);
    if (!gesture.current.moved && travelled < PAN_THRESHOLD) return;
    gesture.current.moved = true;
    pointers.current.set(event.pointerId, next);
    setView(
      clampView({
        span: current.span,
        cx: current.cx - (next.x - previous.x) * unitsPerPx,
        cy: current.cy - (next.y - previous.y) * unitsPerPx,
      }),
    );
  };

  const handlePointerEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current.pinchDistance = null;
    onDragEnd();
  };

  const cells: Array<{ gx: number; gy: number }> = [];
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

  const handleBlockDown = (event: ReactPointerEvent<SVGRectElement>, placement: Placement) => {
    onSelect(placement.partInstanceId);
    onDragStart(placement.partInstanceId);
    event.stopPropagation();
  };

  const zoom = cellCount / view.span;
  const labelBoost = Math.min(Math.max(zoom, 1), LABEL_ZOOM_CAP);
  const labelFont = LABEL_FONT / labelBoost;

  return (
    <div className="stage hangar-scene">
      <div className="yard-tools" role="group" aria-label={t('hangar.zoom.label')}>
        <button
          type="button"
          className="btn"
          aria-label={t('hangar.zoom.out')}
          disabled={view.span >= cellCount}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          {t('hangar.zoom.minus')}
        </button>
        <span className="yard-zoom" aria-live="polite">
          {t('hangar.zoom.percent', { value: Math.round(zoom * 100) })}
        </span>
        <button
          type="button"
          className="btn"
          aria-label={t('hangar.zoom.in')}
          disabled={view.span <= MIN_SPAN}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          {t('hangar.zoom.plus')}
        </button>
        <button type="button" className="btn" onClick={() => setView(fitView())}>
          {t('hangar.zoom.fit')}
        </button>
        <span className="yard-color-toggle" role="group" aria-label={t('hangar.colorBy.label')}>
          {(['rarity', 'condition'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn${colorBy === mode ? ' on' : ''}`}
              aria-pressed={colorBy === mode}
              onClick={() => setColorBy(mode)}
            >
              {t(`hangar.colorBy.${mode}`)}
            </button>
          ))}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${view.cx - view.span / 2} ${view.cy - view.span / 2} ${view.span} ${view.span}`}
        role="group"
        aria-label={t('hangar.yardLabel')}
        onPointerDown={handleBackgroundDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
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
            onClick={() => {
              // A drag that panned the view is not a click on the cell it ended over.
              if (gesture.current.moved) return;
              onCellClick(cell.gx, cell.gy);
            }}
            onPointerEnter={() => onCellHover(cell.gx, cell.gy)}
          />
        ))}
        {layout.map((placement) => {
          const catalog = catalogById.get(placement.partInstanceId);
          if (catalog === undefined) return null;
          const { width, height } = footprint(catalog, placement.rot);
          const name = nameById.get(placement.partInstanceId) ?? catalog.partType;
          const lines = labelLines(name, width, height, zoom);
          const look = lookById?.get(placement.partInstanceId);
          const lineHeight = labelFont * 1.15;
          // Nudged up so the condition bar along the bottom edge never sits on the text.
          const firstY = placement.gy + height / 2 - 0.1 - ((lines.length - 1) * lineHeight) / 2;
          return (
            <g key={placement.partInstanceId} className="yard-block">
              <rect
                data-part-id={placement.partInstanceId}
                data-gx={placement.gx}
                data-gy={placement.gy}
                className={[
                  'block',
                  look?.broken === true ? 'broken' : '',
                  look === undefined
                    ? ''
                    : colorBy === 'rarity'
                      ? `rar-${look.rarity.toLowerCase()}`
                      : `cond-${conditionTone(look.condition)}`,
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
                onPointerDown={(event) => handleBlockDown(event, placement)}
                onPointerEnter={() => onHoverPart?.(placement.partInstanceId)}
                onPointerLeave={() => onHoverPart?.(null)}
              />
              <title>
                {look === undefined
                  ? name
                  : `${name} — ${t('parts.condition')} ${Math.round(look.condition)}%`}
              </title>
              {look !== undefined && (
                <g style={{ pointerEvents: 'none' }}>
                  <rect
                    className="cond-track"
                    x={placement.gx + 0.14}
                    y={placement.gy + height - 0.24}
                    width={width - 0.28}
                    height={0.1}
                    rx={0.05}
                  />
                  <rect
                    className={`cond-bar cond-${conditionTone(look.condition)}`}
                    x={placement.gx + 0.14}
                    y={placement.gy + height - 0.24}
                    width={((width - 0.28) * Math.min(100, Math.max(0, look.condition))) / 100}
                    height={0.1}
                    rx={0.05}
                  />
                </g>
              )}
              <text
                className="block-label"
                x={placement.gx + width / 2}
                style={{ pointerEvents: 'none', fontSize: `${labelFont}px` }}
              >
                {(look?.broken === true ? [...lines.slice(0, 1), t('parts.broken')] : lines).map(
                  (line, index) => (
                    <tspan
                      key={line + String(index)}
                      x={placement.gx + width / 2}
                      y={firstY + index * lineHeight + labelFont * 0.35}
                    >
                      {line}
                    </tspan>
                  ),
                )}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
