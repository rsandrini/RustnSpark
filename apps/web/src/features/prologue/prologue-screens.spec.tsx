import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { client } from '../../api/client';
import { routes } from '../../app/router';
import { PROLOGUE_ENGINE, PROLOGUE_START_PARTS } from './prologue-fixtures';
import { server } from '../../test/msw/server';
import { renderWithRouter } from '../../test/utils';

/** The game's real screens, with the sandbox answering: what the pilot sees in the opening. */
describe('the real Board and Port screens on the sandbox', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // the pilot is past the gift: the friend's engine is in the hold
    window.localStorage.setItem(
      'rs.prologue.player-1',
      JSON.stringify({ step: 'fit-engine', kind: null }),
    );
    vi.stubEnv('VITE_PROLOGUE_SANDBOX', '1');
    server.use(
      http.get('/v1/players/me', () =>
        HttpResponse.json({
          id: 'player-1',
          name: 'Test Pilot',
          credits: 0,
          role: 'PLAYER',
          locale: 'en',
          factionId: null,
          tutorialDone: true,
          prologueOutcome: null,
        }),
      ),
      http.get('/v1/players/me/prologue', () =>
        HttpResponse.json({
          startCredits: 3000,
          refuelCost: 100,
          purse: 300,
          moduleCost: 800,
          upgradeCost: 200,
          payouts: [646, 494, 2660],
        }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('says what the ship lacks while there is no engine, and shows the race card once the engine is fitted', async () => {
    const view = renderWithRouter(routes, { initialEntries: ['/missions'] });
    // no engine yet: the real board hides what the ship cannot take and says why
    expect(
      await screen.findByText(/your ship cannot take missions right now/i),
    ).toBeInTheDocument();
    expect((await screen.findAllByText(/no engine/i)).length).toBeGreaterThan(0);

    await client.post('/v1/ships/prologue-ship/assemble', {
      layout: [
        ...PROLOGUE_START_PARTS.map((part) => part.target),
        { partInstanceId: PROLOGUE_ENGINE.id, gx: -4, gy: 0, rot: 0 },
      ],
    });
    // the real Ship screen refreshes what it knows after a save
    await view.queryClient.invalidateQueries();
    await view.router.navigate('/ship');
    await view.router.navigate('/missions');

    expect((await screen.findAllByText(/race to dockside/i)).length).toBeGreaterThan(0);
    expect(document.querySelector('.route-map')).not.toBeNull();
  });

  it('shows the market with the two modules and their price', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });

    expect(await screen.findByText(/passenger module/i)).toBeInTheDocument();
    expect((await screen.findAllByText(/800/)).length).toBeGreaterThan(0);
  });

  it('shows the real Ship screen with the sandbox ship and its parts', async () => {
    renderWithRouter(routes, { initialEntries: ['/ship'] });

    expect((await screen.findAllByText(/wayfarer/i)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/small chemical engine/i)).toBeInTheDocument();
  });
});
