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
    // Owner request: Port and Board are reachable straight from the top nav again (reversing
    // the round-3 fold), between My Ship and Map.
    expect(hrefs).toEqual(['/hangar', '/hangar/port', '/hangar/board', '/map']);
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

  it('walks report → My Ship Port tab → map through the footer and nav', async () => {
    const { router } = renderWithRouter(routes, { initialEntries: ['/report/m-1'] });

    expect(await screen.findByRole('heading', { name: 'Mission report' })).toBeInTheDocument();
    // Port now has two "Port" links on this screen at once: the report's own (to="/port") and
    // the top nav's (to="/hangar/port", now always present). Find the report's own by its href.
    const reportPortLink = screen
      .getAllByRole('link', { name: 'Port' })
      .find((link) => link.getAttribute('href') === '/port');
    expect(reportPortLink).toBeDefined();
    fireEvent.click(reportPortLink!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/hangar/port'));
    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();

    fireEvent.click(within(gameNav()).getByRole('link', { name: 'Map' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
  });

  it('a /board link lands on My Ship with the Board tab open, not the Ship tab', async () => {
    // Owner: "open mission board from the map is going to ship (not to the mission board
    // menu)" — /board (and /port, /transit) land on the matching nested hangar route; whichever
    // tab the link meant to open must actually be the one selected.
    const { router } = renderWithRouter(routes, { initialEntries: ['/report/m-1'] });
    expect(await screen.findByRole('heading', { name: 'Mission report' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Back to the board' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/hangar/board'));
    // No local tab row left to read "selected" off (owner request: it duplicated the top nav
    // and was removed) — Board's own content actually rendering is the real signal.
    expect(await screen.findByRole('group', { name: 'Mission board' })).toBeInTheDocument();
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
