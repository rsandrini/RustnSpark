import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../test/utils';
import { server } from '../test/msw/server';
import { resetActiveState, resetBoardState } from '../test/msw/handlers';
import { routes } from './router';

const onboarded = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: 4820,
        role: 'PLAYER',
        locale: 'en',
        factionId: 'luna',
      },
      { status: 200 },
    ),
  );

function gameNav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Game navigation' });
}

describe('navigation flow (S10.10)', () => {
  beforeEach(() => {
    resetBoardState();
    resetActiveState();
    server.use(onboarded());
  });

  it('shows the persistent game nav with the whole loop on in-game screens', async () => {
    renderWithRouter(routes, { initialEntries: ['/hangar'] });

    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
    const nav = gameNav();
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['/hangar', '/map']);
  });

  it('the top-right account menu has Profile and Logout, and Admin only for an admin account', async () => {
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows Admin in the account menu for an admin account', async () => {
    server.use(
      http.get('/v1/players/me', () =>
        HttpResponse.json(
          {
            id: 'player-1',
            name: 'Test Pilot',
            credits: 4820,
            role: 'ADMIN',
            locale: 'en',
            factionId: 'luna',
          },
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('/ redirects an onboarded pilot straight to My Ship (Home was retired)', async () => {
    renderWithRouter(routes, { initialEntries: ['/'] });
    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
  });

  it('jumps from the hangar to the map through the nav', async () => {
    const { router } = renderWithRouter(routes, { initialEntries: ['/hangar'] });

    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
    fireEvent.click(within(gameNav()).getByRole('link', { name: 'Map' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
    expect(await screen.findByRole('heading', { name: 'Sector map' })).toBeInTheDocument();
  });

  it('walks report → My Ship (Port folded in) → map through the footer and nav', async () => {
    const { router } = renderWithRouter(routes, { initialEntries: ['/report/m-1'] });

    expect(await screen.findByRole('heading', { name: 'Mission report' })).toBeInTheDocument();
    // Port is folded into My Ship now (round-3): the report's own "Port" link still exists
    // and lands there (it just no longer opens a route of its own).
    fireEvent.click(screen.getByRole('link', { name: 'Port' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/hangar'));
    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();

    fireEvent.click(within(gameNav()).getByRole('link', { name: 'Map' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
  });

  it('hides the game nav before the faction is chosen', async () => {
    server.use(
      http.get('/v1/players/me', () =>
        HttpResponse.json(
          {
            id: 'player-1',
            name: 'Test Pilot',
            credits: 0,
            role: 'PLAYER',
            locale: 'en',
            factionId: null,
          },
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    expect(await screen.findByRole('heading', { name: 'Choose your faction' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Game navigation' })).not.toBeInTheDocument();
  });
});
