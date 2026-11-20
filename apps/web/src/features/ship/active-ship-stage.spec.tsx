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
