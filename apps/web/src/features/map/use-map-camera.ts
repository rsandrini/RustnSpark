import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
  ZOOM_STEP,
  boxOf,
  clampView,
  clientToMap,
  fitView,
  panBy,
  unitsPerPixel,
  zoomAt,
  type Bounds,
  type Box,
  type View,
} from './map-view';

/** A drag shorter than this (in pixels) is still a click on a place. */
const DRAG_THRESHOLD = 4;

/** Wheel and pinch zoom, drag to pan, and the zoom buttons of the sector map. */
export function useMapCamera(bounds: Bounds | null) {
  const [view, setView] = useState<View | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // The stage mounts only once the page has its data, so it is tracked as state: the wheel listener
  // below has to be (re)attached whenever the element appears.
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinch = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const current = useMemo<View | null>(
    () => (bounds === null ? null : clampView(bounds, view ?? fitView(bounds))),
    [bounds, view],
  );
  const box: Box | null = bounds === null || current === null ? null : boxOf(bounds, current);

  const update = useCallback(
    (change: (from: View, area: Bounds) => View) => {
      if (bounds === null) return;
      setView((was) => change(clampView(bounds, was ?? fitView(bounds)), bounds));
    },
    [bounds],
  );

  const zoomAround = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      update((from, area) => {
        const at = boxOf(area, from);
        const rect = svgRef.current?.getBoundingClientRect();
        const anchor =
          rect === undefined || clientX === undefined || clientY === undefined
            ? { x: from.cx, y: from.cy }
            : clientToMap(at, rect, clientX, clientY);
        return zoomAt(area, from, factor, anchor);
      });
    },
    [update],
  );

  // The wheel has to be a non-passive listener to keep the page from scrolling while the map zooms.
  useEffect(() => {
    if (stage === null) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAround(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomAround, stage]);

  const onPointerDown = (event: ReactPointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      drag.current = { x: event.clientX, y: event.clientY, moved: false };
    } else {
      drag.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = a === undefined || b === undefined ? null : Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const known = pointers.current.get(event.pointerId);
    if (known === undefined) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinch.current !== null) {
      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance > 0 && pinch.current > 0) {
        zoomAround(distance / pinch.current, (a.x + b.x) / 2, (a.y + b.y) / 2);
        suppressClick.current = true;
      }
      pinch.current = distance;
      return;
    }
    const start = drag.current;
    const rect = svgRef.current?.getBoundingClientRect();
    if (start === null || rect === undefined || box === null) return;
    if (!start.moved) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return;
      start.moved = true;
      suppressClick.current = true;
      stage?.setPointerCapture?.(event.pointerId);
    }
    const unit = unitsPerPixel(box, rect);
    const dx = (known.x - event.clientX) * unit;
    const dy = (known.y - event.clientY) * unit;
    update((from, area) => panBy(area, from, dx, dy));
  };

  const onPointerEnd = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  // A drag or a pinch that ends over a place must not also select it.
  const onClickCapture = (event: ReactMouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return {
    svgRef,
    stageRef: setStage,
    box,
    scale: current?.scale ?? 1,
    zoomIn: () => zoomAround(ZOOM_STEP),
    zoomOut: () => zoomAround(1 / ZOOM_STEP),
    reset: () => setView(null),
    /** Centres the view on a point at a zoom (kept inside the map). */
    focusOn: (point: { x: number; y: number }, scale: number) => {
      if (bounds !== null) setView(clampView(bounds, { scale, cx: point.x, cy: point.y }));
    },
    stageHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onClickCapture,
    },
  };
}
