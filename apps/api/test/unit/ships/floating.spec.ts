import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  floatSpotOf,
  pathNodes,
  rescuePrices,
  towPlanFor,
  type RouteEdge,
} from '../../../src/ships/floating.js';

// hedus --400-- marsa --800-- drift --400-- veil      (marsa is a base; hedus too; drift/veil are not)
const edges: RouteEdge[] = [
  { id: 'hedus-marsa', nodeAId: 'hedus', nodeBId: 'marsa', distance: 400 },
  { id: 'drift-marsa', nodeAId: 'drift', nodeBId: 'marsa', distance: 800 },
  { id: 'drift-veil', nodeAId: 'drift', nodeBId: 'veil', distance: 400 },
];
const routes = new Map(edges.map((edge) => [edge.id, edge]));
const bases = new Set(['hedus', 'marsa']);
const rules = GAME_CONFIG_DEFAULTS;

describe('floating ship', () => {
  it('walks a journey node by node, whichever way each route is stored', () => {
    expect(pathNodes('hedus', ['hedus-marsa', 'drift-marsa', 'drift-veil'], routes)).toEqual([
      'hedus',
      'marsa',
      'drift',
      'veil',
    ]);
    expect(pathNodes('hedus', ['drift-veil'], routes)).toBeNull();
  });

  it('floats on the leg it ran dry on, as far as the fuel that was left would carry it', () => {
    const spot = floatSpotOf({
      legIndex: 1,
      fuelLeft: 342,
      legBurn: 379,
      originId: 'hedus',
      routeIds: ['hedus-marsa', 'drift-marsa', 'drift-veil'],
      routes,
    });
    expect(spot).toMatchObject({ routeId: 'drift-marsa', fromId: 'marsa' });
    expect(spot!.progress).toBeCloseTo(342 / 379);
  });

  it('never floats exactly on a node or at the far end', () => {
    const none = floatSpotOf({ legIndex: 0, fuelLeft: 0, legBurn: 100, originId: 'hedus', routeIds: ['hedus-marsa'], routes });
    const almost = floatSpotOf({ legIndex: 0, fuelLeft: 99.99, legBurn: 100, originId: 'hedus', routeIds: ['hedus-marsa'], routes });
    expect(none!.progress).toBeGreaterThan(0);
    expect(almost!.progress).toBeLessThan(1);
  });

  it('is towed to the nearest base, along the route or on past the far end', () => {
    // near marsa on the long route: the base is just ahead
    const near = towPlanFor({ routeId: 'drift-marsa', fromId: 'marsa', progress: 0.1 }, edges, bases);
    expect(near).toEqual({ baseId: 'marsa', distance: 80 });
    // near drift on the same route: back to marsa is far, but there is no closer base
    const far = towPlanFor({ routeId: 'drift-marsa', fromId: 'marsa', progress: 0.9 }, edges, bases);
    expect(far!.baseId).toBe('marsa');
    expect(far!.distance).toBeCloseTo(720);
    // on the route out to the dead end: the base is back where it came from
    const out = towPlanFor({ routeId: 'drift-veil', fromId: 'drift', progress: 0.5 }, edges, bases);
    expect(out).toEqual({ baseId: 'marsa', distance: 200 + 800 });
  });

  it('prices waiting at half the reference tow and calling it now at that plus the distance', () => {
    expect(rescuePrices(0, rules)).toEqual({ wait: 400, now: 400 });
    expect(rescuePrices(300, rules)).toEqual({ wait: 400, now: 700 });
    const dearer = { ...rules, economy: { ...rules.economy, rescue_distance_price: 2 } };
    expect(rescuePrices(300, dearer).now).toBe(1000);
  });
});
