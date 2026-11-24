import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { ship } from '../../test/msw/handlers';
import { Hud } from './Hud';

vi.mock('../../features/auth/auth.hooks', () => ({
  useAuth: () => ({ user: { factionId: 'luna' } }),
}));

const phone = { on: false };
vi.mock('../useIsPhone', () => ({ useIsPhone: () => phone.on }));

const withShip = (over: { fuelUse?: number; fuel?: number; hold?: boolean }) => {
  const base = ship();
  return http.get('/v1/ships', () =>
    HttpResponse.json([
      {
        ...base,
        fuel: over.fuel ?? 30,
        sheet: { ...base.sheet, fuelUse: over.fuelUse ?? 1, fuelCap: 40, condition: 80 },
        hold: { used: 2, capacity: 10 },
      },
    ]),
  );
};

beforeEach(() => {
  phone.on = false;
});
afterEach(() => {
  phone.on = false;
});

describe('Hud', () => {
  it('renders three gauges for a normal ship and no wallet', async () => {
    server.use(withShip({}));
    renderWithProviders(<Hud />);
    expect(await screen.findByRole('progressbar', { name: /Fuel/ })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /Hull/ })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /Cargo/ })).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(3);
    expect(screen.queryByTestId('topbar-wallet')).toBeNull();
    expect(document.querySelector('.wallet-chip')).toBeNull();
  });

  it('renders nothing while there is no ship', async () => {
    server.use(http.get('/v1/ships', () => HttpResponse.json([])));
    const { container } = renderWithProviders(<Hud />);
    await waitFor(() => expect(container.querySelector('.hud')).toBeNull());
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('the fuel gauge is missing for an ion-only ship', async () => {
    server.use(withShip({ fuelUse: 0 }));
    renderWithProviders(<Hud />);
    expect(await screen.findByRole('progressbar', { name: /Hull/ })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: /Fuel/ })).toBeNull();
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('each gauge has an accessible name and its tooltip text', async () => {
    server.use(withShip({}));
    renderWithProviders(<Hud />);
    const fuel = await screen.findByRole('progressbar', { name: 'Fuel 30 of 40' });
    await userEvent.click(fuel);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Fuel: 30 of 40');
    expect(fuel).toHaveAccessibleDescription(/Fuel: 30 of 40/);
    const cargo = screen.getByRole('progressbar', { name: 'Cargo 2 of 10' });
    await userEvent.click(cargo);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Cargo: 2 of 10');
  });

  it('phone layout renders the compact row', async () => {
    phone.on = true;
    server.use(withShip({}));
    const { container } = renderWithProviders(<Hud />);
    await screen.findByRole('progressbar', { name: /Fuel/ });
    expect(container.querySelector('.hud.hud--compact')).not.toBeNull();
    // icon + number only: the word is in the accessible name, not on the pill
    expect(screen.getByRole('progressbar', { name: /Fuel/ })).toHaveTextContent('30/40');
    expect(screen.getByRole('progressbar', { name: /Fuel/ })).not.toHaveTextContent('Fuel');
  });

  it('marks the reserve while a mission is accepted', async () => {
    server.use(
      withShip({}),
      http.get('/v1/missions/active', () =>
        HttpResponse.json([
          { id: 'm1', status: 'ACCEPTED', info: { estimate: { fuelNeeded: 12 } } },
        ]),
      ),
    );
    const { container } = renderWithProviders(<Hud />);
    await waitFor(() => expect(container.querySelector('.gauge-tick')).not.toBeNull());
  });
});
