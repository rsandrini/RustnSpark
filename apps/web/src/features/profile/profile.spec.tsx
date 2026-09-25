import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
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

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByTestId('wallet')).toHaveTextContent('4,820 ¢');
    expect(screen.getByText('Luna Authority')).toBeInTheDocument();
    expect(await screen.findByText('Mission accomplished')).toBeInTheDocument();
    expect(await screen.findByText(/2 legs/)).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'View report' });
    expect(link).toHaveAttribute('href', '/report/m-1');
  });

  it('shows an empty history placeholder', async () => {
    server.use(http.get('/v1/reports', () => HttpResponse.json({ items: [] }, { status: 200 })));
    renderWithRouter(routes, { initialEntries: ['/profile'] });

    expect(await screen.findByText('No completed missions yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View report' })).not.toBeInTheDocument();
  });
});
