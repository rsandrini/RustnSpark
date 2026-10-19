import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE,
  boxOf,
  clampView,
  clientToMap,
  fitView,
  panBy,
  zoomAt,
  type Bounds,
} from './map-view';

const bounds: Bounds = { minX: 0, minY: 0, width: 1000, height: 500 };

describe('map camera', () => {
  it('starts on the whole map', () => {
    expect(boxOf(bounds, fitView(bounds))).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
  });

  it('zooms in on the point under the cursor and keeps it there', () => {
    const anchor = { x: 800, y: 100 };
    const view = zoomAt(bounds, fitView(bounds), 2, anchor);
    const box = boxOf(bounds, view);
    expect(box.w).toBe(500);
    // the anchor is at the same fraction of the window as before (0.8, 0.2)
    expect((anchor.x - box.x) / box.w).toBeCloseTo(0.8);
    expect((anchor.y - box.y) / box.h).toBeCloseTo(0.2);
  });

  it('never zooms past its limits, nor leaves the map', () => {
    let view = fitView(bounds);
    for (let i = 0; i < 20; i += 1) view = zoomAt(bounds, view, 2, { x: 1000, y: 500 });
    expect(view.scale).toBe(MAX_SCALE);
    const box = boxOf(bounds, view);
    expect(box.x + box.w).toBeLessThanOrEqual(1000.0001);
    expect(box.y + box.h).toBeLessThanOrEqual(500.0001);
    expect(zoomAt(bounds, fitView(bounds), 0.1, { x: 5, y: 5 }).scale).toBe(1);
  });

  it('pans until the centre reaches the edge; a view showing everything stays centred', () => {
    const zoomed = zoomAt(bounds, fitView(bounds), 4, { x: 500, y: 250 });
    const moved = panBy(bounds, zoomed, -10_000, 0);
    // zoomed in, the CENTRE of the view may reach the edge of the map (so a place there can be centred)
    const box = boxOf(bounds, moved);
    expect(box.x + box.w / 2).toBe(0);
    // the whole-map view stays centred
    expect(clampView(bounds, { scale: 1, cx: 10, cy: 10 })).toEqual(fitView(bounds));
  });

  it('reads a screen point in map units, with the letterboxing of the svg', () => {
    const box = { x: 0, y: 0, w: 1000, h: 500 };
    // a 500 x 500 px area: the map is drawn 500 x 250 px, centred vertically (125 px bars)
    const rect = { left: 0, top: 0, width: 500, height: 500 };
    expect(clientToMap(box, rect, 250, 250)).toEqual({ x: 500, y: 250 });
    expect(clientToMap(box, rect, 0, 125)).toEqual({ x: 0, y: 0 });
  });
});
