/** The sector map's camera: a zoom factor (1 = the whole map) and where the view is centred, in map units. */
export interface Bounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface View {
  scale: number;
  cx: number;
  cy: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far the map has to be zoomed in before a place of each detail level is drawn. */
export const DETAIL_MIN_SCALE: Record<'main' | 'regional' | 'local', number> = {
  main: 1,
  regional: 1.6,
  local: 2.5,
};

export const MIN_SCALE = 1;
export const MAX_SCALE = 6;
export const ZOOM_STEP = 1.5;

export const fitView = (bounds: Bounds): View => ({
  scale: MIN_SCALE,
  cx: bounds.minX + bounds.width / 2,
  cy: bounds.minY + bounds.height / 2,
});

/** The viewBox for a view: a window `1/scale` the size of the map. */
export function boxOf(bounds: Bounds, view: View): Box {
  const w = bounds.width / view.scale;
  const h = bounds.height / view.scale;
  return { x: view.cx - w / 2, y: view.cy - h / 2, w, h };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Keeps the window inside the map (a zoomed-out view is always centred). */
export function clampView(bounds: Bounds, view: View): View {
  const scale = clamp(view.scale, MIN_SCALE, MAX_SCALE);
  const w = bounds.width / scale;
  const h = bounds.height / scale;
  const cx = clamp(view.cx, bounds.minX + w / 2, bounds.minX + bounds.width - w / 2);
  const cy = clamp(view.cy, bounds.minY + h / 2, bounds.minY + bounds.height - h / 2);
  return { scale, cx, cy };
}

/** Zooms by `factor` keeping the map point under `anchor` where it is on screen. */
export function zoomAt(
  bounds: Bounds,
  view: View,
  factor: number,
  anchor: { x: number; y: number },
): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const from = boxOf(bounds, view);
  const u = (anchor.x - from.x) / from.w;
  const v = (anchor.y - from.y) / from.h;
  const w = bounds.width / scale;
  const h = bounds.height / scale;
  return clampView(bounds, {
    scale,
    cx: anchor.x - u * w + w / 2,
    cy: anchor.y - v * h + h / 2,
  });
}

/** Slides the view by a distance in map units. */
export function panBy(bounds: Bounds, view: View, dx: number, dy: number): View {
  return clampView(bounds, { ...view, cx: view.cx + dx, cy: view.cy + dy });
}

/** A screen point in map units, for an svg drawn with `preserveAspectRatio: xMidYMid meet` in `rect`. */
export function clientToMap(
  box: Box,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const pxPerUnit = Math.min(rect.width / box.w, rect.height / box.h);
  const offsetX = (rect.width - box.w * pxPerUnit) / 2;
  const offsetY = (rect.height - box.h * pxPerUnit) / 2;
  return {
    x: box.x + (clientX - rect.left - offsetX) / pxPerUnit,
    y: box.y + (clientY - rect.top - offsetY) / pxPerUnit,
  };
}

/** How many map units one screen pixel covers. */
export const unitsPerPixel = (box: Box, rect: { width: number; height: number }): number =>
  1 / Math.min(rect.width / box.w, rect.height / box.h);
