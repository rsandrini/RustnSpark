import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { WorldResponse } from '../api/generated';
import { renderWithProviders } from '../test/utils';
import { RouteMap, pathOfLegs } from './RouteMap';

const place = (id: string, x: number, y: number) => ({
  id,
  displayName: { en: id.toUpperCase(), 'pt-BR': id.toUpperCase() },
  description: { en: '', 'pt-BR': '' },
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
});
