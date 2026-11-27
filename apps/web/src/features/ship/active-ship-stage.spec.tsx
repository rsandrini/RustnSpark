import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { setShipActivity } from '../../test/msw/handlers';
import { routes } from '../../app/router';

const onboarded = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: 0,
        role: 'PLAYER',
        locale: 'en',
        factionId: 'luna',
      },
      { status: 200 },
    ),
  );

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

describe('the ship stage on a mining contract', () => {
  afterEach(() => setShipActivity(null));

  it('flies first and says how long the mining after it takes', async () => {
    server.use(onboarded());
    setShipActivity({
      kind: 'flying',
      until: inMinutes(50),
      missionId: 'm-1',
      repairUntil: null,
      flightUntil: inMinutes(10),
    });
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const scene = (await screen.findAllByTestId('transit-scene'))[0]!;
    expect(scene).toHaveClass('mode-flying');
    expect((await screen.findAllByText(/then mining 40m/))[0]).toBeInTheDocument();
  });

  it('a flight followed by mining (`flightThen`) says mining and then digs', async () => {
    server.use(onboarded());
    setShipActivity({
      kind: 'flying',
      until: inMinutes(30),
      missionId: 'm-1',
      repairUntil: null,
      flightUntil: inMinutes(-1),
      flightThen: 'mining',
    });
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const scene = (await screen.findAllByTestId('transit-scene'))[0]!;
    expect(scene).toHaveClass('mode-mining');
    expect(scene.querySelector('.scan-radar')).toBeNull();
    expect(screen.queryByText('Scanning the area')).toBeNull();
  });

  it('switches to the mining scene once the flight is over', async () => {
    server.use(onboarded());
    setShipActivity({
      kind: 'flying',
      until: inMinutes(30),
      missionId: 'm-1',
      repairUntil: null,
      flightUntil: inMinutes(-1),
    });
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const scene = (await screen.findAllByTestId('transit-scene'))[0]!;
    expect(scene).toHaveClass('mode-mining');
  });
});

describe('the ship stage on an explore mission', () => {
  afterEach(() => setShipActivity(null));

  const exploring = (flightEndsInMinutes: number, arrivalInMinutes: number) =>
    setShipActivity({
      kind: 'flying',
      until: inMinutes(arrivalInMinutes),
      missionId: 'm-1',
      repairUntil: null,
      flightUntil: inMinutes(flightEndsInMinutes),
      flightThen: 'scanning',
    });

  it('flies first and says how long the scan after it takes', async () => {
    server.use(onboarded());
    exploring(10, 50);
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const scene = (await screen.findAllByTestId('transit-scene'))[0]!;
    expect(scene).toHaveClass('mode-flying');
    expect((await screen.findAllByText(/then scanning 40m/))[0]).toBeInTheDocument();
    expect(screen.queryByText(/then mining/)).toBeNull();
  });

  it('switches to the scanning scene once the flight is over', async () => {
    server.use(onboarded());
    exploring(-1, 30);
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const scene = (await screen.findAllByTestId('transit-scene'))[0]!;
    expect(scene).toHaveClass('mode-scanning');
    expect(scene.querySelector('.scan-radar')).not.toBeNull();
    expect(scene.querySelector('.mine-rock')).toBeNull();
    expect((await screen.findAllByText('Scanning the area'))[0]).toBeInTheDocument();
  });
});
