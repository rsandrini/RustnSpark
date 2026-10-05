import { describe, it, expect } from 'vitest';
import type { WorldRoute } from '../../api/generated';
import { journeyNodeIds, positionAt } from './journey';

const routes = [
  { id: 'a-b', nodeAId: 'a', nodeBId: 'b' },
  { id: 'c-b', nodeAId: 'c', nodeBId: 'b' },
] as unknown as WorldRoute[];

describe('journey', () => {
  it('walks routes in either direction from the origin', () => {
    expect(journeyNodeIds('a', [{ routeId: 'a-b' }, { routeId: 'c-b' }], routes)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  const stops = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 100, y: 0 },
    { id: 'c', x: 100, y: 100 },
  ];
  const windows = [
    { from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:10:00Z' },
    { from: '2026-01-01T00:10:00Z', to: '2026-01-01T00:20:00Z' },
  ];
  const at = (iso: string) => positionAt(stops, windows, Date.parse(iso))!;

  it('sits at the origin before departure and at the end after arrival', () => {
    expect(at('2025-12-31T23:59:00Z')).toMatchObject({ x: 0, y: 0, docked: true });
    expect(at('2026-01-01T01:00:00Z')).toMatchObject({ x: 100, y: 100, docked: true });
  });

  it('interpolates along the current leg and points along it', () => {
    const half = at('2026-01-01T00:05:00Z');
    expect(half).toMatchObject({ x: 50, y: 0, docked: false, legIndex: 0, heading: 0 });
    const second = at('2026-01-01T00:15:00Z');
    expect(second).toMatchObject({ x: 100, y: 50, docked: false, legIndex: 1, heading: 90 });
  });
});
