import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

  it('says so when a pilot is not found', async () => {
    server.use(
      http.get('/v1/players/by-name/:name/profile', () =>
        HttpResponse.json({ statusCode: 404, error: 'PLAYER_NOT_FOUND' }, { status: 404 }),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/pilots/Nobody'] });
    expect(await screen.findByRole('alert')).toHaveTextContent('That pilot was not found.');
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

  it('loads the history ten at a time and fetches more on request', async () => {
    const item = (n: number) => ({
      missionId: `m-${n}`,
      outcome: 'success',
      credits: n,
      legs: 1,
      createdAt: new Date(2026, 9, 28, 12, 0, 60 - n).toISOString(),
      hadCombat: false,
    });
    const asked: string[] = [];
    server.use(
      http.get('/v1/reports', ({ request }) => {
        const url = new URL(request.url);
        asked.push(url.search);
        const second = url.searchParams.get('cursor') === 'next';
        return HttpResponse.json({
          items: second ? [item(11), item(12)] : Array.from({ length: 10 }, (_, k) => item(k + 1)),
          ...(second ? {} : { nextCursor: 'next' }),
        });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/profile'] });

    await screen.findAllByRole('link', { name: 'View report' });
    expect(screen.getAllByRole('link', { name: 'View report' })).toHaveLength(10);
    expect(asked[0]).toContain('limit=10');
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'View report' })).toHaveLength(12),
    );
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });
});
