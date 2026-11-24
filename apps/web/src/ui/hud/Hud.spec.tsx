import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { ship } from '../../test/msw/handlers';
import { Hud } from './Hud';

const auth = { factionId: 'luna' as string | null };
vi.mock('../../features/auth/auth.hooks', () => ({
  useAuth: () => ({ user: { factionId: auth.factionId } }),
}));
const opening = { active: false };
vi.mock('../../features/prologue/prologue-mode', () => ({
  usePrologueMode: () => ({ active: opening.active }),
}));

const phone = { on: false };
vi.mock('../useIsPhone', () => ({ useIsPhone: () => phone.on }));

const withShip = (over: { fuelUse?: number; fuel?: number; fuelCap?: number; crg?: number }) => {
  const base = ship();
  return http.get('/v1/ships', () =>
    HttpResponse.json([
      {
        ...base,
        fuel: over.fuel ?? 30,
        sheet: {
          ...base.sheet,
          fuelUse: over.fuelUse ?? 1,
          fuelCap: over.fuelCap ?? 40,
          condition: 80,
        },
        hold: { used: 2, capacity: over.crg ?? 10 },
      },
    ]),
  );
};

beforeEach(() => {
  phone.on = false;
  auth.factionId = 'luna';
  opening.active = false;
});
afterEach(() => {
  phone.on = false;
  auth.factionId = 'luna';
  opening.active = false;
});

const accepted = (status: string, fuelNeeded: number) =>
  http.get('/v1/missions/active', () =>
    HttpResponse.json([{ id: 'm1', status, info: { estimate: { fuelNeeded } } }]),
  );

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

  it('is a labelled region landmark', async () => {
    server.use(withShip({}));
    renderWithProviders(<Hud />);
    const region = await screen.findByRole('region', { name: 'Fuel, hull and cargo' });
    expect(region.tagName).toBe('SECTION');
    expect(region).not.toHaveAttribute('role');
  });

  it('reserves the row while the ships load, with no gauges, then fills it', async () => {
    server.use(
      http.get('/v1/ships', async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return HttpResponse.json([ship()]);
      }),
    );
    const { container } = renderWithProviders(<Hud />);
    const row = container.querySelector('.hud.hud--pending');
    expect(row).not.toBeNull();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    await screen.findByRole('progressbar', { name: /Hull/ });
    expect(container.querySelector('.hud--pending')).toBeNull();
  });

  it('shows the compact numbers on the phone pill and the full ones in the name', async () => {
    phone.on = true;
    server.use(withShip({ fuel: 1_234_567, fuelCap: 9_999_999 }));
    renderWithProviders(<Hud />);
    const fuel = await screen.findByRole('progressbar', { name: /Fuel/ });
    expect(fuel).toHaveTextContent('1.2M/10M');
    expect(fuel).toHaveAccessibleName('Fuel 1,234,567 of 9,999,999');
  });

  it('renders nothing while there is no ship', async () => {
    server.use(http.get('/v1/ships', () => HttpResponse.json([])));
    const { container } = renderWithProviders(<Hud />);
    await waitFor(() => expect(container.querySelector('.hud')).toBeNull());
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('collapses after the pending state when the settled ships are empty: no permanent empty strip', async () => {
    server.use(
      http.get('/v1/ships', async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return HttpResponse.json([]);
      }),
    );
    const { container } = renderWithProviders(<Hud />);
    expect(container.querySelector('.hud.hud--pending')).not.toBeNull();
    await waitFor(() => expect(container.querySelector('.hud')).toBeNull());
    expect(container.querySelector('.hud--pending')).toBeNull();
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
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Flying burns it');
    expect(fuel).toHaveAccessibleDescription(/Flying burns it/);
    expect(fuel).not.toHaveAccessibleDescription(/30 of 40/);
    const cargo = screen.getByRole('progressbar', { name: 'Cargo 2 of 10' });
    await userEvent.click(cargo);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Space in use by mission cargo');
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
    server.use(withShip({}), accepted('ACCEPTED', 12));
    const { container } = renderWithProviders(<Hud />);
    await waitFor(() => expect(container.querySelector('.gauge-tick')).not.toBeNull());
  });

  it.each([
    ['a mission that is not accepted', 'ACTIVE', 12],
    ['no fuel needed', 'ACCEPTED', 0],
    ['more fuel needed than the tank holds', 'ACCEPTED', 60],
  ])('draws no reserve mark for %s', async (_name, status, needed) => {
    server.use(withShip({}), accepted(status, needed));
    const { container } = renderWithProviders(<Hud />);
    const fuel = await screen.findByRole('progressbar', { name: /Fuel/ });
    await waitFor(() => expect(container.querySelector('.hud')).not.toBeNull());
    expect(container.querySelector('.gauge-tick')).toBeNull();
    await userEvent.click(fuel);
    const tip = await screen.findByRole('tooltip');
    if (needed > 40) expect(tip).toHaveTextContent(/more than the tank holds/i);
    expect(tip).not.toHaveTextContent(/amber mark/i);
  });

  it('the tooltip names the amber mark when the reserve is inside the tank', async () => {
    server.use(withShip({}), accepted('ACCEPTED', 12));
    renderWithProviders(<Hud />);
    await userEvent.click(await screen.findByRole('progressbar', { name: /Fuel/ }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/amber mark/i);
  });

  it('draws no gauge with nothing to fill (no cargo space, no tank)', async () => {
    server.use(withShip({ fuelCap: 0, crg: 0 }));
    renderWithProviders(<Hud />);
    expect(await screen.findByRole('progressbar', { name: /Hull/ })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: /Fuel/ })).toBeNull();
    expect(screen.queryByRole('progressbar', { name: /Cargo/ })).toBeNull();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });

  it('shows in the opening, when the pilot has no faction yet', async () => {
    auth.factionId = null;
    opening.active = true;
    server.use(withShip({}));
    renderWithProviders(<Hud />);
    expect(await screen.findByRole('progressbar', { name: /Fuel/ })).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(3);
  });

  it('stays away with no faction and no opening', async () => {
    auth.factionId = null;
    server.use(withShip({}));
    const { container } = renderWithProviders(<Hud />);
    await waitFor(() => expect(container.querySelector('.hud')).toBeNull());
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });
});
