import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { economyState, resetEconomyState } from '../../test/msw/handlers';
import { routes } from '../../app/router';

const onboarded = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: economyState.wallet,
        role: 'PLAYER',
        locale: 'en',
        factionId: 'luna',
      },
      { status: 200 },
    ),
  );

describe('profile (S10.9)', () => {
  beforeEach(() => {
    resetEconomyState();
    server.use(onboarded());
  });

  it('shows the wallet, faction and mission history', async () => {
    renderWithRouter(routes, { initialEntries: ['/profile'] });

    const heading = await screen.findByRole('heading', { name: 'Profile' });
    const main = heading.closest('main')!;
    expect(screen.getByTestId('wallet')).toHaveTextContent('4,820 ¢');
    // The top bar's own faction badge (ShipIdentity) also says "Luna Authority" now; this one
    // is the profile page's own.
    expect(within(main).getByText('Luna Authority')).toBeInTheDocument();
    expect(await screen.findByText('Mission accomplished')).toBeInTheDocument();
    expect(await screen.findByText(/2 legs/)).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'View report' });
    expect(link).toHaveAttribute('href', '/report/m-1');

    // Owner: "almost impossible to know in the mission history log where I had a combat" — a
    // token on the row the history item is for, and a direct way into that fight's own detail.
    const combatTag = screen.getByRole('link', { name: 'Combat' });
    expect(combatTag).toHaveAttribute('href', '/report/m-1#combat');
  });

  it('shows no Combat tag for a run with no fight', async () => {
    server.use(
      http.get('/v1/reports', () =>
        HttpResponse.json(
          {
            items: [
              {
                missionId: 'm-2',
                outcome: 'success',
                credits: 200,
                legs: 1,
                createdAt: new Date().toISOString(),
                hadCombat: false,
              },
            ],
          },
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/profile'] });

    await screen.findByRole('link', { name: 'View report' });
    expect(screen.queryByRole('link', { name: 'Combat' })).not.toBeInTheDocument();
  });

  it('shows an empty history placeholder', async () => {
    server.use(http.get('/v1/reports', () => HttpResponse.json({ items: [] }, { status: 200 })));
    renderWithRouter(routes, { initialEntries: ['/profile'] });

    expect(await screen.findByText('No completed missions yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View report' })).not.toBeInTheDocument();
  });
});
