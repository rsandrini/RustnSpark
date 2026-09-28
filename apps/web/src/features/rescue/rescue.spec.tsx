import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { economyState, resetEconomyState, setShipStatus } from '../../test/msw/handlers';
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

describe('rescue (S8.6 / S10.9)', () => {
  beforeEach(() => {
    resetEconomyState();
    server.use(onboarded());
  });
  afterEach(() => setShipStatus('IN_PORT'));

  it('offers a tow to an adrift ship and confirms before charging', async () => {
    setShipStatus('ADRIFT');
    renderWithRouter(routes, { initialEntries: ['/port'] });

    const banner = await screen.findByTestId('rescue-banner');
    expect(banner).toHaveTextContent('Ship adrift');
    fireEvent.click(within(banner).getByRole('button', { name: 'Call a tow' }));

    // Nothing is charged until the confirmation is accepted.
    const popup = await screen.findByRole('dialog', { name: 'Ship adrift' });
    expect(economyState.wallet).toBe(4820);
    fireEvent.click(within(popup).getByRole('button', { name: 'Call a tow' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Towed back to port for 800 ¢. Fuel on board: 25.',
    );
    await waitFor(() => expect(screen.queryByTestId('rescue-banner')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('wallet')).toHaveTextContent('4,020 ¢'));
  });

  it('shows no rescue banner for a ship in port', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });
    await screen.findByRole('heading', { name: 'My Ship' });
    expect(screen.queryByTestId('rescue-banner')).toBeNull();
  });

  it('is also reachable from the transit screen after a mission leaves the ship adrift', async () => {
    setShipStatus('ADRIFT');
    server.use(http.get('/v1/missions/active', () => HttpResponse.json([], { status: 200 })));
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    expect(await screen.findByTestId('rescue-banner')).toBeInTheDocument();
  });

  it('translates a rescue failure instead of showing the generic message', async () => {
    setShipStatus('ADRIFT');
    server.use(
      http.post('/v1/ships/:id/rescue', () =>
        HttpResponse.json(
          { statusCode: 409, message: { error: 'SHIP_ON_MISSION' } },
          { status: 409 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/port'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Call a tow' }));
    const popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Call a tow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The ship is on a mission.');
  });
});
