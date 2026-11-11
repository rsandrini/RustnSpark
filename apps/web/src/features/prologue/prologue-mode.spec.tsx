import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { client } from '../../api/client';
import { routes } from '../../app/router';
import { server } from '../../test/msw/server';
import { renderWithRouter } from '../../test/utils';

type Outcome = 'played' | 'skipped' | null;

function pilot(options: { factionId: string | null; outcome: Outcome }) {
  return http.get('/v1/players/me', () =>
    HttpResponse.json({
      id: 'player-1',
      name: 'Test Pilot',
      credits: 0,
      role: 'PLAYER',
      locale: 'en',
      factionId: options.factionId,
      tutorialDone: true,
      prologueOutcome: options.outcome,
    }),
  );
}

const config = http.get('/v1/players/me/prologue', () =>
  HttpResponse.json({
    startCredits: 3000,
    refuelCost: 100,
    purse: 300,
    moduleCost: 800,
    payouts: [720, 1080, 1800],
  }),
);

describe('the real screens in the opening (the sandbox mode)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    server.use(config);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('opens the real Ship screen for a pilot who is in the opening, answered by the sandbox', async () => {
    vi.stubEnv('VITE_PROLOGUE_SANDBOX', '1');
    server.use(pilot({ factionId: null, outcome: null }));
    const view = renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    await vi.waitFor(() => expect(view.router.state.location.pathname).toBe('/ship'));
    // the sandbox ship, not the test server's
    const ships = await client.get<Array<{ name: string }>>('/v1/ships');
    expect(ships[0]?.name).toBe('Wayfarer');
    expect(await screen.findByRole('navigation')).toBeInTheDocument();
  });

  it('takes the fake server away when the opening is over', async () => {
    vi.stubEnv('VITE_PROLOGUE_SANDBOX', '1');
    server.use(pilot({ factionId: null, outcome: null }));
    const view = renderWithRouter(routes, { initialEntries: ['/ship'] });
    await vi.waitFor(async () => {
      const ships = await client.get<Array<{ name: string }>>('/v1/ships');
      expect(ships[0]?.name).toBe('Wayfarer');
    });

    view.unmount();

    const real = await client.get<Array<{ name: string }>>('/v1/ships');
    expect(real[0]?.name).not.toBe('Wayfarer');
  });

  it('gives the faction picker and the real server to a pilot whose opening has ended', async () => {
    vi.stubEnv('VITE_PROLOGUE_SANDBOX', '1');
    server.use(pilot({ factionId: null, outcome: 'played' }));
    renderWithRouter(routes, { initialEntries: ['/ship'] });

    expect(
      await screen.findByRole('heading', { name: /choose your faction/i }),
    ).toBeInTheDocument();
    const ships = await client.get<Array<{ name: string }>>('/v1/ships');
    expect(ships[0]?.name).not.toBe('Wayfarer');
  });

  it('never gives the sandbox to a pilot who already has a faction', async () => {
    vi.stubEnv('VITE_PROLOGUE_SANDBOX', '1');
    server.use(pilot({ factionId: 'luna', outcome: null }));
    renderWithRouter(routes, { initialEntries: ['/ship'] });

    await screen.findByRole('navigation');
    const ships = await client.get<Array<{ name: string }>>('/v1/ships');
    expect(ships[0]?.name).not.toBe('Wayfarer');
  });

  it('is off unless the build asks for it', async () => {
    server.use(pilot({ factionId: null, outcome: null }));
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });
    expect(await screen.findByTestId('prologue')).toBeInTheDocument();
    const ships = await client.get<Array<{ name: string }>>('/v1/ships');
    expect(ships[0]?.name).not.toBe('Wayfarer');
  });
});
