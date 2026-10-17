import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { ConnectorCell, PartCatalogStats, Placement } from '../../api/generated';
import { conditionTone } from '../../ui/Gauge';
import { PortGlyph } from '../parts/connector-grid';
import { computePortMarks } from './connectors';
import { directionViolations, facingOf, footprint, placementIssue, type Rot } from './hangar.geometry';

const MIN_SPAN = 4;
const FIT_MARGIN = 2;
const ZOOM_STEP = 1.4;
// Pointer travel (px) below which a press is a click, not the start of a pan.
const PAN_THRESHOLD = 5;
// A part carries a single small rotate button pinned to its top-right corner (owner: one little
// icon with a left→right arrow, not four on every border). It is a real HTML button overlaid on
// the yard, so its size is fixed in pixels and can never balloon with the zoom.
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

const ARROW_HALF = 0.14;
const ARROW_DEPTH = 0.16;
const ARROW_EDGE_INSET = 0.04;

/** A small triangle on the facing edge of an engine (exhaust) or weapon (muzzle). */
function FacingArrow({
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

/** The little "turn" glyph drawn inside the top-right rotate button: an arrow pointing left→right
 *  (the direction the part turns when clicked). */
function RotateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 12h15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M13 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
  /** Generated connector cells by instance id; parts without an entry (legacy) draw no ports. */
  connectorsById?: ReadonlyMap<string, readonly ConnectorCell[]>;
  /** Localized part names by instance id. */
  nameById: ReadonlyMap<string, string>;
  selectedId: string | null;
  draggingId: string | null;
  onSelect: (partInstanceId: string | null) => void;
  onCellClick: (gx: number, gy: number) => void;
  onDragStart: (partInstanceId: string) => void;
  onDragEnd: () => void;
  /** Release of a ghost-dragged block: commit it at (gx, gy); an invalid drop is ignored by the
      owner, which leaves the part where the drag started. */
  onDropPart?: (partInstanceId: string, gx: number, gy: number) => void;
  /** Hovering a placed block (owner request): a small stats-only card, not the full popup. */
  onHoverPart?: (partInstanceId: string | null) => void;
  /** Hovering a block's border reveals a small rotate badge; clicking it turns the part in place. */
  onRotate?: (partInstanceId: string) => void;
  /** Press-and-drag on the rotate badge spins the part live to the given orientation (0/90/180/270). */
  onRotateLive?: (partInstanceId: string, rot: Rot) => void;
  /** When false the ship is out on a mission: no rotate button, no drag, no rotation. */
  editable?: boolean;
  /** Read-only figures pinned on the yard's bottom edge (the sheet's key numbers). */
  callouts?: ReactNode;
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
  connectorsById,
  nameById,
  selectedId,
  draggingId,
  onSelect,
  onCellClick,
  onDragStart,
  onDragEnd,
  onDropPart,
  onHoverPart,
  onRotate,
  onRotateLive,
  editable = true,
  callouts,
}: ShipYardProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  // Ports are always on (spec decision 3); the dragged block is already live in `layout` while it
  // hovers, so its marks double as the placement preview.
  // Engines/weapons with parts behind their facing edge: outlined red (direction rules are
  // problems, never placement refusals).
  const directionBlocked = useMemo(
    () => new Map(directionViolations(layout, catalogById).map((v) => [v.partInstanceId, v.kind])),
    [layout, catalogById],
  );
  const portMarks = useMemo(
    () =>
      connectorsById === undefined ? [] : computePortMarks(layout, catalogById, connectorsById),
    [layout, catalogById, connectorsById],
  );

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
  // The part whose four rotate buttons are currently shown (hovered, or the selection).
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null);
  // The part currently mid-spin (drag on a rotate button): it gets a bright, animated clue.
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  // An active press-and-drag on a rotate button. The pivot is the part's centre and rotation
  // is angle-tracking: release snaps to the nearest 90°; a click without movement is one turn.
  type RotateDrag = {
    partInstanceId: string;
    pivotX: number;
    pivotY: number;
    startAngle: number;
    startRot: Rot;
    moved: boolean;
  };
  const rotateDrag = useRef<RotateDrag | null>(null);
  // Set when a press is finalised on pointer-up so the trailing click (same gesture) is eaten
  // instead of rotating twice.
  const suppressRotateClick = useRef<string | null>(null);
  // Pulsing a part right after it turns (owner: "a feedback that was rotated"), then auto-clears.
  const flashTimer = useRef<number | null>(null);
  const flashRotate = useCallback((partInstanceId: string) => {
    setRotatingId(partInstanceId);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      flashTimer.current = null;
      setRotatingId((current) => (current === partInstanceId ? null : current));
    }, 700);
  }, []);
  // A part being dragged across the board as a floating ghost: it hovers on the top layer,
  // free of the grid (green when the cell under it would fit, red when it would not) and only
  // commits (or falls back to where it started) on release.
  type Ghost = {
    partInstanceId: string;
    rot: Rot;
    width: number;
    height: number;
    originX: number;
    originY: number;
    grabX: number;
    grabY: number;
    x: number;
    y: number;
    targetGx: number;
    targetGy: number;
    valid: boolean;
  };
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [view, setView] = useState<View>(() => clampView({ cx: centerX, cy: centerY, span: 20 }));
  const viewRef = useRef(view);
  viewRef.current = view;

  // Where the yard svg sits inside the scene, so the HTML rotate buttons (positioned in screen
  // pixels) can line up with a part's borders. Measured from the live layout, redrawn on resize
  // and on every zoom.
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  useEffect(() => {
    const svg = svgRef.current;
    const scene = sceneRef.current;
    if (svg === null || scene === null) return undefined;
    const measure = () => {
      const s = svg.getBoundingClientRect();
      const c = scene.getBoundingClientRect();
      setBox({ left: s.left - c.left, top: s.top - c.top, width: s.width, height: s.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    observer.observe(scene);
    return () => observer.disconnect();
  }, [view.span]);

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

  const cellSet = useMemo(() => new Set(cells.map(([x, y]) => `${x},${y}`)), [cells]);

  /** A client position in yard cells (the same mapping the wheel-zoom anchor uses). */
  const pointerToCells = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    const current = viewRef.current;
    if (svg === null) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const unit = current.span / Math.max(rect.width, 1);
    return {
      x: current.cx - current.span / 2 + (clientX - rect.left) * unit,
      y: current.cy - current.span / 2 + (clientY - rect.top) * unit,
    };
  };

  const handleBackgroundDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    setHoveredPartId(null);
    rotateDrag.current = null;
    suppressRotateClick.current = null;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) gesture.current.moved = false;
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    // A part being dragged floats as a ghost on the top layer; it does not snap until release.
    if (ghost !== null) {
      const point = pointerToCells(event.clientX, event.clientY);
      const x = point.x - ghost.grabX;
      const y = point.y - ghost.grabY;
      const targetGx = Math.round(x);
      const targetGy = Math.round(y);
      const valid =
        placementIssue(
          layout,
          catalogById,
          ghost.partInstanceId,
          targetGx,
          targetGy,
          ghost.rot,
          cellSet,
        ) === null;
      setGhost({ ...ghost, x, y, targetGx, targetGy, valid });
      return;
    }
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
    if (ghost !== null) {
      // Drop where it fits, and only if it actually moved; a drop on the origin (or an invalid
      // cell) just leaves the part exactly where it started.
      if (
        ghost.valid &&
        (ghost.targetGx !== ghost.originX || ghost.targetGy !== ghost.originY)
      ) {
        onDropPart?.(ghost.partInstanceId, ghost.targetGx, ghost.targetGy);
      }
      setGhost(null);
    }
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current.pinchDistance = null;
    onDragEnd();
  };

  const cellList = cells.map(([gx, gy]) => ({ gx, gy }));

  const handleBlockDown = (event: ReactPointerEvent<SVGRectElement>, placement: Placement) => {
    // Out on a mission the layout is frozen: a press on a part just selects it.
    if (!editable) {
      onSelect(placement.partInstanceId);
      event.stopPropagation();
      return;
    }
    if (rotateDrag.current !== null) return;
    suppressRotateClick.current = null;
    setHoveredPartId(placement.partInstanceId);
    const catalog = catalogById.get(placement.partInstanceId);
    const svg = svgRef.current;
    if (catalog !== undefined && svg !== null) {
      const { width, height } = footprint(catalog, placement.rot);
      const point = pointerToCells(event.clientX, event.clientY);
      try {
        svg.setPointerCapture(event.pointerId);
      } catch {
        // Pointer already released — nothing to capture.
      }
      setGhost({
        partInstanceId: placement.partInstanceId,
        rot: placement.rot,
        width,
        height,
        originX: placement.gx,
        originY: placement.gy,
        grabX: point.x - placement.gx,
        grabY: point.y - placement.gy,
        x: placement.gx,
        y: placement.gy,
        targetGx: placement.gx,
        targetGy: placement.gy,
        valid: true,
      });
    }
    onSelect(placement.partInstanceId);
    onDragStart(placement.partInstanceId);
    event.stopPropagation();
  };

  // Press-and-drag a border rotate button: anchor the pointer's angle around the part's centre
  // (the pivot uses the footprint at press time, so a 2×1→1×2 swing stays centered on the same
  // spot). A press without movement is a single quarter turn.
  const handleRotateDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    placement: Placement,
  ) => {
    if (!editable) return;
    const catalog = catalogById.get(placement.partInstanceId);
    const svg = svgRef.current;
    if (catalog === undefined || svg === null) return;
    event.stopPropagation();
    const { width, height } = footprint(catalog, placement.rot);
    const point = pointerToCells(event.clientX, event.clientY);
    const pivotX = placement.gx + width / 2;
    const pivotY = placement.gy + height / 2;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released — nothing to capture.
    }
    rotateDrag.current = {
      partInstanceId: placement.partInstanceId,
      pivotX,
      pivotY,
      startAngle: Math.atan2(point.y - pivotY, point.x - pivotX),
      startRot: placement.rot,
      moved: false,
    };
    setRotatingId(placement.partInstanceId);
    setHoveredPartId(placement.partInstanceId);
    onSelect(placement.partInstanceId);
  };

  // Live spin: as the pointer orbits the part's centre, snap the rotation to the nearest 90°.
  const handleRotateMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
    placement: Placement,
  ) => {
    const rotate = rotateDrag.current;
    if (rotate === null || rotate.partInstanceId !== placement.partInstanceId) return;
    const point = pointerToCells(event.clientX, event.clientY);
    const angle = Math.atan2(point.y - rotate.pivotY, point.x - rotate.pivotX);
    const delta = Math.atan2(
      Math.sin(angle - rotate.startAngle),
      Math.cos(angle - rotate.startAngle),
    );
    const turns = Math.round(((delta * 180) / Math.PI) / 90);
    if (turns !== 0) rotate.moved = true;
    const target = ((((rotate.startRot + turns * 90) % 360) + 360) % 360) as Rot;
    const current = layout.find((p) => p.partInstanceId === rotate.partInstanceId);
    if (current !== undefined && current.rot !== target) {
      onRotateLive?.(rotate.partInstanceId, target);
    }
  };

  const handleRotateEnd = (
    event: ReactPointerEvent<HTMLButtonElement>,
    placement: Placement,
  ) => {
    const rotate = rotateDrag.current;
    if (rotate === null || rotate.partInstanceId !== placement.partInstanceId) return;
    if (!rotate.moved) onRotate?.(placement.partInstanceId);
    suppressRotateClick.current = placement.partInstanceId;
    rotateDrag.current = null;
    flashRotate(placement.partInstanceId);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer already released — nothing to release.
    }
  };

  // A click that was not a spin (a press-without-move is finalised in handleRotateEnd, which
  // hands the single turn off to onRotate): eat the trailing click so it cannot rotate twice.
  const handleRotateClick = (event: ReactMouseEvent<HTMLButtonElement>, placement: Placement) => {
    event.stopPropagation();
    if (suppressRotateClick.current === placement.partInstanceId) {
      suppressRotateClick.current = null;
      return;
    }
    onRotate?.(placement.partInstanceId);
    flashRotate(placement.partInstanceId);
  };

  const zoom = cellCount / view.span;
  const labelBoost = Math.min(Math.max(zoom, 1), LABEL_ZOOM_CAP);
  // Total format area (the cells prop), not the placed-parts span — labels scale with the
  // yard the player is building on, whatever is installed right now.
  const areaFactor = labelAreaFactor(cells.length);
  const labelFont = (LABEL_FONT * areaFactor) / labelBoost;
  // Which part shows its four border rotate buttons: the hovered one (or the selection / a part
  // mid-spin), never while a drag ghost is in flight. Buttons are hidden outside this.
  const iconSourceId = ghost !== null ? null : rotatingId ?? hoveredPartId ?? selectedId;
  const iconPlacement =
    iconSourceId === null
      ? null
      : layout.find((p) => p.partInstanceId === iconSourceId) ?? null;

  return (
    <div className="stage hangar-scene" ref={sceneRef}>
      {callouts}
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
            onPointerEnter={() => {
              // Empty ground: the rotate buttons follow the part the pointer is over, so clear
              // them here rather than on the block's leave (the buttons sit on top of the block
              // and would otherwise blink out as the pointer crosses the border between them).
              setHoveredPartId(null);
              onHoverPart?.(null);
            }}
            onClick={() => {
              // A drag that panned the view is not a click on the cell it ended over.
              if (gesture.current.moved) return;
              onCellClick(cell.gx, cell.gy);
            }}
          />
        ))}
        {layout.map((placement) => {
          const catalog = catalogById.get(placement.partInstanceId);
          if (catalog === undefined) return null;
          const { width, height } = footprint(catalog, placement.rot);
          const name = nameById.get(placement.partInstanceId) ?? catalog.partType;
          const lines = labelLines(name, width, height, zoom, areaFactor);
          const look = lookById?.get(placement.partInstanceId);
          // The origin block of a live ghost drag: it stays dimmed in place while the ghost floats.
          const isGhosting = ghost?.partInstanceId === placement.partInstanceId;
          const isRotating = rotatingId === placement.partInstanceId;
          const lineHeight = labelFont * 1.15;
          // Nudged up so the condition bar along the bottom edge never sits on the text.
          const firstY = placement.gy + height / 2 - 0.1 - ((lines.length - 1) * lineHeight) / 2;
          const { gx, gy } = placement;
          return (
            <g key={placement.partInstanceId} className="yard-block">
              {selectedId === placement.partInstanceId && !isGhosting && (
                <rect
                  className="block-halo"
                  x={gx - 0.06}
                  y={gy - 0.06}
                  width={width + 0.12}
                  height={height + 0.12}
                  style={{ pointerEvents: 'none' }}
                />
              )}
              <rect
                data-part-id={placement.partInstanceId}
                data-gx={placement.gx}
                data-gy={placement.gy}
                className={[
                  'block',
                  look?.broken === true ? 'broken' : '',
                  disconnectedPartIds?.has(placement.partInstanceId) === true ? 'disconnected' : '',
                  directionBlocked.has(placement.partInstanceId) ? 'dir-blocked' : '',
                  look === undefined
                    ? ''
                    : colorBy === 'rarity'
                      ? `rar-${look.rarity.toLowerCase()}`
                      : `cond-${conditionTone(look.condition)}`,
                  catalog.partClass === 'BRIDGE' ? 'bridge' : '',
                  selectedId === placement.partInstanceId ? 'selected' : '',
                  isGhosting ? 'ghosting' : '',
                  isRotating ? 'rotating' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                x={placement.gx + 0.04}
                y={placement.gy + 0.04}
                width={width - 0.08}
                height={height - 0.08}
                style={
                  isGhosting ? { pointerEvents: 'none' } : undefined
                }
                onPointerDown={(event) => handleBlockDown(event, placement)}
                onPointerEnter={() => {
                  setHoveredPartId(placement.partInstanceId);
                  onHoverPart?.(placement.partInstanceId);
                }}
                onPointerLeave={() => onHoverPart?.(null)}
              />
              <title>
                {[
                  look === undefined
                    ? name
                    : `${name} — ${t('parts.condition')} ${Math.round(look.condition)}%`,
                  directionBlocked.has(placement.partInstanceId)
                    ? t(`hangar.placement.${directionBlocked.get(placement.partInstanceId)}`)
                    : '',
                ]
                  .filter(Boolean)
                  .join('\n')}
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
              {(catalog.partClass === 'ENGINE' || catalog.partClass === 'WEAPON') && (
                <FacingArrow
                  gx={placement.gx}
                  gy={placement.gy}
                  width={width}
                  height={height}
                  facing={facingOf(placement.rot)}
                  label={t(
                    catalog.partClass === 'ENGINE' ? 'hangar.facing.exhaust' : 'hangar.facing.weapon',
                  )}
                />
              )}
              {portMarks
                .filter((mark) => mark.partInstanceId === placement.partInstanceId)
                .map((mark) => (
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
        {/* The dragged part as a free-floating ghost, rendered last so it rides above every block.
            It carries the part's own content (name + ports) so you drag what you see, and reads
            green when the nearest cell would accept it, red when releasing would revert it. */}
        {ghost !== null &&
          (() => {
            const origin = layout.find((p) => p.partInstanceId === ghost.partInstanceId);
            const dx = origin === undefined ? 0 : ghost.x - origin.gx;
            const dy = origin === undefined ? 0 : ghost.y - origin.gy;
            const ghostName = nameById.get(ghost.partInstanceId) ?? '';
            const lines = labelLines(ghostName, ghost.width, ghost.height, zoom, areaFactor);
            const lineHeight = labelFont * 1.15;
            const firstY =
              ghost.y + ghost.height / 2 - 0.1 - ((lines.length - 1) * lineHeight) / 2;
            return (
              <g className="yard-ghost" style={{ pointerEvents: 'none' }}>
                <rect
                  className={`ghost-cell ${ghost.valid ? 'ok' : 'bad'}`}
                  x={ghost.targetGx}
                  y={ghost.targetGy}
                  width={ghost.width}
                  height={ghost.height}
                  rx={0.08}
                />
                <rect
                  className={`ghost-body ${ghost.valid ? 'ok' : 'bad'}`}
                  x={ghost.x + 0.04}
                  y={ghost.y + 0.04}
                  width={ghost.width - 0.08}
                  height={ghost.height - 0.08}
                  rx={0.06}
                />
                {portMarks
                  .filter((mark) => mark.partInstanceId === ghost.partInstanceId)
                  .map((mark) => (
                    <PortGlyph
                      key={`g-${mark.x},${mark.y},${mark.side}`}
                      x={mark.x + dx}
                      y={mark.y + dy}
                      side={mark.side}
                      kind={mark.kind}
                      state={mark.state}
                    />
                  ))}
                <text
                  className="block-label ghost-label"
                  x={ghost.x + ghost.width / 2}
                  style={{ fontSize: `${labelFont}px` }}
                >
                  {lines.map((line, index) => (
                    <tspan
                      key={line + String(index)}
                      x={ghost.x + ghost.width / 2}
                      y={firstY + index * lineHeight + labelFont * 0.35}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })()}
      </svg>
      {/* A single small rotate button pinned to the part's top-right corner, drawn as real HTML
          so it keeps a fixed on-screen size at any zoom (owner: one little arrow icon, not a big
          circle). Click it for one left→right quarter turn; press and drag to spin freely. */}
      {editable &&
        iconPlacement !== null &&
        (() => {
          const iconCatalog = catalogById.get(iconPlacement.partInstanceId);
          if (iconCatalog === undefined) return null;
          const { width } = footprint(iconCatalog, iconPlacement.rot);
          const scale =
            box.width > 0 && box.height > 0 ? Math.min(box.width, box.height) / view.span : 0;
          const offX = (box.width - view.span * scale) / 2;
          const offY = (box.height - view.span * scale) / 2;
          const left0 = view.cx - view.span / 2;
          const top0 = view.cy - view.span / 2;
          const sx = (x: number) => box.left + offX + (x - left0) * scale;
          const sy = (y: number) => box.top + offY + (y - top0) * scale;
          const spinning = rotatingId === iconPlacement.partInstanceId;
          return (
            <div className="yard-rotate-icons">
              <button
                type="button"
                className={`yard-rotate-icon${spinning ? ' rotating' : ''}`}
                data-part-id={iconPlacement.partInstanceId}
                aria-label={t('hangar.actions.rotate')}
                title={t('hangar.actions.rotate')}
                style={{
                  left: `${sx(iconPlacement.gx + width)}px`,
                  top: `${sy(iconPlacement.gy)}px`,
                }}
                onPointerDown={(event) => handleRotateDown(event, iconPlacement)}
                onPointerMove={(event) => handleRotateMove(event, iconPlacement)}
                onPointerUp={(event) => handleRotateEnd(event, iconPlacement)}
                onClick={(event) => handleRotateClick(event, iconPlacement)}
              >
                <RotateIcon />
              </button>
            </div>
          );
        })()}
    </div>
  );
}
