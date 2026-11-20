import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import {
  economyState,
  resetEconomyState,
  setRescueWaitMs,
  setShipStatus,
} from '../../test/msw/handlers';
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
    window.sessionStorage.clear();
    resetEconomyState();
    server.use(onboarded());
  });
  afterEach(() => setShipStatus('IN_PORT'));

  it('offers two ways out for a floating ship and confirms before charging', async () => {
    setShipStatus('ADRIFT');
    renderWithRouter(routes, { initialEntries: ['/hangar'] });

    // a floating ship opens its own big popup: why it ran dry, and the two ways out
    const popup = await screen.findByRole('dialog', { name: 'Floating in space' });
    expect(popup).toHaveTextContent('Nearest base: Porto Ceres, 300 away');
    expect(within(popup).getByTestId('floating-why')).toHaveTextContent(
      'A leaking tank lost 182 fuel',
    );
    expect(within(popup).getByTestId('floating-why')).toHaveTextContent('ran dry on leg 3');
    // the top bar says where the ship is, not "docked"
    expect(screen.getAllByText('Floating in space').length).toBeGreaterThan(1);
    expect(within(popup).getByRole('button', { name: /Wait for the rescue/ })).toHaveTextContent(
      '400 ¢',
    );
    fireEvent.click(within(popup).getByRole('button', { name: /Rescue now/ }));

    // Nothing is charged until the confirmation is accepted.
    expect(popup).toHaveTextContent('you pay 700 ¢');
    expect(economyState.wallet).toBe(4820);
    fireEvent.click(within(popup).getByRole('button', { name: 'Rescue now' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Towed to port for 700 ¢. Fuel on board: 25.',
    );
    await waitFor(() => expect(screen.queryByTestId('rescue-banner')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('4,120 ¢'));
  });

  it('waiting charges nothing yet and shows when the rescue arrives; the ship is towed then', async () => {
    setShipStatus('ADRIFT');
    setRescueWaitMs(1500);
    renderWithRouter(routes, { initialEntries: ['/hangar'] });

    const popup = await screen.findByRole('dialog', { name: 'Floating in space' });
    fireEvent.click(within(popup).getByRole('button', { name: /Wait for the rescue/ }));
    expect(popup).toHaveTextContent('You pay 400 ¢ when it arrives');
    fireEvent.click(within(popup).getByRole('button', { name: 'Wait for the rescue' }));

    expect((await screen.findAllByTestId('rescue-waiting'))[0]).toHaveTextContent(
      'Rescue on its way',
    );
    expect(economyState.wallet).toBe(4820);

    // the time is up: the top bar asks the server to let the rescue arrive
    await waitFor(() => expect(screen.queryByTestId('rescue-banner')).toBeNull(), {
      timeout: 4000,
    });
    await waitFor(() => expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('4,420 ¢'));
  });

  it('shows no rescue banner for a ship in port', async () => {
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });
    expect(screen.queryByTestId('rescue-banner')).toBeNull();
  });

  it('is also reachable from the transit screen after a mission leaves the ship adrift', async () => {
    setShipStatus('ADRIFT');
    server.use(http.get('/v1/missions/active', () => HttpResponse.json([], { status: 200 })));
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    expect(await screen.findByTestId('rescue-banner')).toBeInTheDocument();
  });

  it('closing the popup leaves a compact bar that opens it again', async () => {
    window.sessionStorage.clear();
    setShipStatus('ADRIFT');
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    const popup = await screen.findByRole('dialog', { name: 'Floating in space' });
    fireEvent.click(within(popup).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(
      within(await screen.findByTestId('rescue-banner')).getByRole('button', {
        name: 'Rescue options',
      }),
    );
    expect(await screen.findByRole('dialog', { name: 'Floating in space' })).toBeInTheDocument();
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
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    const popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: /Rescue now/ }));
    fireEvent.click(within(popup).getByRole('button', { name: 'Rescue now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The ship is on a mission.');
  });
});
