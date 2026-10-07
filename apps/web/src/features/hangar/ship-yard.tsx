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
// Zoom-out overshoot: the yard can shrink to 80% of the window so there is always empty
// slack around it to pan into (owner: movement was locked the moment the view was fully fit).
const VIEW_OVERSHOOT = 1.25;

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
// Owner: installed-part names too big — halved twice (0.42 → 0.32 → 0.16). Wrap capacity
// below is derived from this font so names keep filling their block instead of truncating
// against stale character metrics.
const LABEL_FONT = 0.16;
// Character/line capacity per cell at a reference font of 0.42 (4.3 chars, 2 lines per cell);
// scaled as `reference / LABEL_FONT` whenever the font changes.
const LABEL_REF_FONT = 0.42;
const LABEL_REF_CHARS = 4.3;
const LABEL_REF_LINES = 2;

// Owner request (hangar): scale part labels DOWN with the format's total area — bigger yards
// get smaller letters so text stops overflowing parts; never scaled UP (a small yard keeps
// the baseline size, growth made names unreadable). Baseline is classic_square (20×20 = 400
// cells); the shrink is clamped so extreme formats stay sane.
const LABEL_BASELINE_AREA = 400;
const LABEL_AREA_FACTOR_MIN = 0.5;

/** Label size factor for a yard of the given total cell count (1 = classic_square baseline;
    always ≤ 1 — the label only shrinks as the yard grows). */
export function labelAreaFactor(yardArea: number): number {
  const factor = Math.sqrt(LABEL_BASELINE_AREA / Math.max(1, yardArea));
  return Math.min(1, Math.max(LABEL_AREA_FACTOR_MIN, factor));
}

function formatCondition(condition: number): string {
  return `${Math.round(condition)}%`;
}

/** Word-wrap a part name into the lines that fit a block of the given size at this zoom.
    areaFactor (1 = classic_square) shrinks/grows the font with the yard's total area —
    capacity is ∝ 1/font, so a smaller font fits more characters and lines. */
export function labelLines(
  name: string,
  width: number,
  height: number,
  zoom: number,
  areaFactor = 1,
): string[] {
  const boost = Math.min(Math.max(zoom, 1), LABEL_ZOOM_CAP) / Math.max(areaFactor, 0.01);
  const maxChars = Math.max(
    2,
    Math.floor((width - 0.15) * (LABEL_REF_CHARS * LABEL_REF_FONT) / LABEL_FONT * boost),
  );
  const maxLines = Math.max(
    1,
    Math.floor((height - 0.1) * (LABEL_REF_LINES * LABEL_REF_FONT) / LABEL_FONT * boost),
  );
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
  /** Which cells exist, from the ship's own format — relative to the bridge at [0,0]. */
  cells: readonly [number, number][];
  /** Instance ids with no compatible connector chain back to the bridge right now. */
  disconnectedPartIds?: ReadonlySet<string>;
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
  cells,
  disconnectedPartIds,
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

  const bounds = (() => {
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (const [x, y] of cells) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + 1);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + 1);
    }
    return { minX, maxX, minY, maxY };
  })();
  const cellCount = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  const clampView = useCallback(
    (view: View): View => {
      const span = Math.min(cellCount * VIEW_OVERSHOOT, Math.max(MIN_SPAN, view.span));
      // Pan range: the plain `yard/2 - span/2` hit zero at full span and the view froze
      // (owner: "blocked"). Floor the range at a half-window / quarter-yard so the ship can
      // always slide around, including fully fitted or zoomed-out overshoot views.
      const rangeFor = (yard: number) =>
        Math.max(yard / 2 - span / 2, Math.min(span / 2, yard / 4));
      const rangeX = rangeFor(bounds.maxX - bounds.minX);
      const rangeY = rangeFor(bounds.maxY - bounds.minY);
      return {
        span,
        cx: Math.min(centerX + rangeX, Math.max(centerX - rangeX, view.cx)),
        cy: Math.min(centerY + rangeY, Math.max(centerY - rangeY, view.cy)),
      };
    },
    [cellCount, bounds, centerX, centerY],
  );

  const fitView = useCallback((): View => {
    if (layout.length === 0) {
      return clampView({ cx: centerX, cy: centerY, span: Math.min(cellCount, 20) });
    }
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
    if (!Number.isFinite(minX)) {
      return clampView({ cx: centerX, cy: centerY, span: Math.min(cellCount, 20) });
    }
    return clampView({
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      span: Math.max(maxX - minX, maxY - minY) + FIT_MARGIN * 2,
    });
  }, [layout, catalogById, cellCount, clampView, centerX, centerY]);

  const [colorBy, setColorBy] = useState<'rarity' | 'condition'>('rarity');
  const [view, setView] = useState<View>(() => clampView({ cx: centerX, cy: centerY, span: 20 }));
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
        const span = Math.min(
          cellCount * VIEW_OVERSHOOT,
          Math.max(MIN_SPAN, current.span / factor),
        );
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
    if (!gesture.current.moved) {
      gesture.current.moved = true;
      // Once this is a pan (not a pending click) capture the pointer so dragging past the
      // svg edge or over another element can't strand the gesture mid-move.
      try {
        svg.setPointerCapture(event.pointerId);
      } catch {
        // Pointer already released — nothing to capture.
      }
    }
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

  const cellList = cells.map(([gx, gy]) => ({ gx, gy }));

  const handleBlockDown = (event: ReactPointerEvent<SVGRectElement>, placement: Placement) => {
    onSelect(placement.partInstanceId);
    onDragStart(placement.partInstanceId);
    event.stopPropagation();
  };

  const zoom = cellCount / view.span;
  const labelBoost = Math.min(Math.max(zoom, 1), LABEL_ZOOM_CAP);
  // Total format area (the cells prop), not the placed-parts span — labels scale with the
  // yard the player is building on, whatever is installed right now.
  const areaFactor = labelAreaFactor(cells.length);
  const labelFont = (LABEL_FONT * areaFactor) / labelBoost;

  return (
    <div className="stage hangar-scene">
      <div className="yard-tools" role="group" aria-label={t('hangar.zoom.label')}>
        <button
          type="button"
          className="btn"
          aria-label={t('hangar.zoom.out')}
          disabled={view.span >= cellCount * VIEW_OVERSHOOT}
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
        {cellList.map((cell) => (
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
          const lines = labelLines(name, width, height, zoom, areaFactor);
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
                  disconnectedPartIds?.has(placement.partInstanceId) === true ? 'disconnected' : '',
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
                  {/* HP/condition percent, small, centered on the bar itself (owner request). */}
                  <text
                    className="cond-label"
                    x={placement.gx + width / 2}
                    y={placement.gy + height - 0.155}
                  >
                    {formatCondition(look.condition)}
                  </text>
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
