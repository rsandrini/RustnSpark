import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { WorldResponse } from '../api/generated';
import { renderWithProviders } from '../test/utils';
import { RouteMap, pathOfLegs } from './RouteMap';

const place = (id: string, x: number, y: number) => ({
  id,
  displayName: { en: id.toUpperCase(), 'pt-BR': id.toUpperCase() },
  description: { en: '', 'pt-BR': '' },
  detail: 'main' as const,
  type: 'port',
  x,
  y,
  zone: 0,
  factionId: 'luna',
  isolation: 1,
  services: {},
  risk: 'lo' as const,
  missionCount: 0,
});
const world: WorldResponse = {
  locations: [place('a', 0, 0), place('b', 10, 0), place('c', 10, 10)],
  routes: [
    { id: 'r1', nodeAId: 'a', nodeBId: 'b', distance: 10, danger: 0, hot: false },
    { id: 'r2', nodeAId: 'c', nodeBId: 'b', distance: 10, danger: 0, hot: false },
  ],
};

describe('pathOfLegs', () => {
  it('follows the legs away from the origin, whichever end of a route is listed first', () => {
    expect(pathOfLegs([{ routeId: 'r1' }, { routeId: 'r2' }], world, 'a')).toEqual(['a', 'b', 'c']);
  });
  it('is out and back for a return trip', () => {
    expect(pathOfLegs([{ routeId: 'r1' }, { routeId: 'r1' }], world, 'a')).toEqual(['a', 'b', 'a']);
  });
  it('is empty when a route or the world is unknown', () => {
    expect(pathOfLegs([{ routeId: 'zz' }], world, 'a')).toEqual([]);
    expect(pathOfLegs([{ routeId: 'r1' }], undefined, 'a')).toEqual([]);
  });
});

describe('RouteMap', () => {
  it('names where the trip starts and ends and marks the ship underway', () => {
    renderWithProviders(<RouteMap world={world} path={['a', 'b', 'c']} progress={0.5} />);
    expect(screen.getByRole('img', { name: 'Route from A to C' })).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByTestId('route-map').querySelector('.rm-ship')).not.toBeNull();
  });
  it('draws nothing for a trip with no path', () => {
    renderWithProviders(<RouteMap world={world} path={[]} />);
    expect(screen.queryByTestId('route-map')).not.toBeInTheDocument();
  });

  it('is centred on the trip, not on the whole sector, and a short hop is not blown up', () => {
    // a far-apart sector with one short hop at the bottom right
    const wide: WorldResponse = {
      locations: [
        place('a', 0, 0),
        place('b', 1000, 0),
        place('c', 950, 980),
        place('d', 1000, 1000),
      ],
      routes: [{ id: 'r1', nodeAId: 'c', nodeBId: 'd', distance: 70, danger: 0, hot: false }],
    };
    renderWithProviders(<RouteMap path={['c', 'd']} world={wide} />);
    const svg = screen.getByTestId('route-map').querySelector('svg')!;
    const [x, y, w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    // a window smaller than the whole map (320 x 170), around the hop at the bottom right
    expect(w).toBeLessThan(320);
    expect(h).toBeLessThan(170);
    const nodes = Array.from(svg.querySelectorAll('circle.rm-node.end')).map((node) => ({
      cx: Number(node.getAttribute('cx')),
      cy: Number(node.getAttribute('cy')),
    }));
    expect(nodes).toHaveLength(2);
    const midX = (nodes[0]!.cx + nodes[1]!.cx) / 2;
    const midY = (nodes[0]!.cy + nodes[1]!.cy) / 2;
    expect(Math.abs(midX - (x + w / 2))).toBeLessThan(0.5);
    expect(Math.abs(midY - (y + h / 2))).toBeLessThan(0.5);
  });
});
