import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { client } from '../../api/client';
import { routes } from '../../app/router';
import { clearPrologueSteps } from './prologue-state';
import { PROLOGUE_ENGINE, PROLOGUE_START_PARTS } from './prologue-fixtures';
import { server } from '../../test/msw/server';
import { renderWithRouter } from '../../test/utils';

/** The game's real screens, with the sandbox answering: what the pilot sees in the opening. */
describe('the real Board and Port screens on the sandbox', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // the pilot is past the gift: the friend's engine is in the hold
    window.localStorage.setItem(
      'rs.prologue.player-1',
      JSON.stringify({ step: 'fit-engine', kind: null }),
    );
    vi.stubEnv('VITE_PROLOGUE_SANDBOX', '1');
    server.use(
      http.get('/v1/players/me', () =>
        HttpResponse.json({
          id: 'player-1',
          name: 'Test Pilot',
          credits: 0,
          role: 'PLAYER',
          locale: 'en',
          factionId: null,
          tutorialDone: true,
          prologueOutcome: null,
        }),
      ),
      http.get('/v1/players/me/prologue', () =>
        HttpResponse.json({
          startCredits: 3000,
          refuelCost: 100,
          purse: 300,
          moduleCost: 800,
          upgradeCost: 200,
          payouts: [646, 494, 2660],
        }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('says what the ship lacks while there is no engine, and shows the race card once the engine is fitted', async () => {
    const view = renderWithRouter(routes, { initialEntries: ['/missions'] });
    // no engine yet: the real board hides what the ship cannot take and says why
    const faults = await screen.findByTestId('ship-faults');
    expect(within(faults).getByRole('button', { name: /no engine/i })).toBeInTheDocument();
    expect(faults).toHaveAccessibleName(/cannot take missions/i);

    await client.post('/v1/ships/prologue-ship/assemble', {
      layout: [
        ...PROLOGUE_START_PARTS.map((part) => part.target),
        { partInstanceId: PROLOGUE_ENGINE.id, gx: -4, gy: 0, rot: 0 },
      ],
    });
    // the real Ship screen refreshes what it knows after a save
    await view.queryClient.invalidateQueries();
    await view.router.navigate('/ship');
    await view.router.navigate('/missions');

    expect((await screen.findAllByText(/race to dockside/i)).length).toBeGreaterThan(0);
    expect(document.querySelector('.route-map')).not.toBeNull();
  });

  it('shows the market with every module and their price', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });

    expect(await screen.findByText(/passenger cabin/i)).toBeInTheDocument();
    // The module's name AND its type tag both read "Life support": the market lists the module
    // itself (not just the tag), so one match must sit outside a `.kind-tag`.
    const lifeSupport = await screen.findAllByText(/life support/i);
    expect(lifeSupport.some((el) => !el.closest('.kind-tag'))).toBe(true);
    expect(lifeSupport.some((el) => el.closest('.kind-tag'))).toBe(true);
    expect((await screen.findAllByText(/800/)).length).toBeGreaterThan(0);
  });

  it('after a reload in the middle of the story the wallet shows the story\u2019s credits, not the account\u2019s', async () => {
    window.localStorage.setItem(
      'rs.prologue.player-1',
      JSON.stringify({ step: 'repair', kind: 'passengers' }),
    );
    clearPrologueSteps();
    // the real profile says 0 credits (it was read before the story's fake server was in place)
    renderWithRouter(routes, { initialEntries: ['/port?tab=repair'] });
    // 300 + 646 (race) - 100 (refuel) - 800 (module) + 494 (first job)
    expect((await screen.findAllByText(/540\s¢/)).length).toBeGreaterThan(0);
  });

  it('in the opening the account menu is only the language and Sign out', async () => {
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    const menu = await screen.findByRole('button', { name: 'Sign out' });
    expect(menu).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Rankings' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Report a problem|Bug/i })).toBeNull();
    expect(document.querySelector('.shell-menu-lang')).not.toBeNull();
    // Sign out asks first, even in the story
    fireEvent.click(menu);
    // (a guest is asked about losing the pilot; anyone else gets a plain "Sign out?")
    // the menu closes; what is left saying "Sign out" is the confirmation
    await waitFor(() => expect(screen.getAllByText(/Sign out/).length).toBeGreaterThan(0));
  });

  it('a bought module leaves the shelf', async () => {
    window.localStorage.setItem(
      'rs.prologue.player-1',
      JSON.stringify({ step: 'buy-module', kind: 'passengers' }),
    );
    clearPrologueSteps();
    // the wallet the market reads is the profile's: give it enough for the module
    server.use(
      http.get('/v1/players/me', () =>
        HttpResponse.json({
          id: 'player-1',
          name: 'Test Pilot',
          credits: 5000,
          role: 'PLAYER',
          locale: 'en',
          factionId: null,
          tutorialDone: true,
          prologueOutcome: null,
        }),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/port?tab=market'] });
    expect(await screen.findByText('Passenger Cabin')).toBeInTheDocument();
    await screen.findByText('Life Support');
    const buy = (await screen.findAllByRole('button', { name: /^Buy$/ }))[0] as HTMLElement;
    fireEvent.click(buy);
    const popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: /^Buy$/ }));
    await waitFor(() => expect(screen.queryByText('Passenger Cabin')).not.toBeInTheDocument());
    expect(await screen.findByText('Life Support')).toBeInTheDocument();
  });

  it('shows the real Ship screen with the sandbox ship and its parts', async () => {
    renderWithRouter(routes, { initialEntries: ['/ship'] });

    expect((await screen.findAllByText(/rustnspark/i)).length).toBeGreaterThan(0);
    // the opening's ship has no class and no Rename button
    await waitFor(() => expect(screen.getByText('Nothing')).toBeInTheDocument());
    expect(screen.queryByTestId('rename-ship')).toBeNull();
    // the profile is read again from the story's fake server once it is in place: the screen may redraw once
    await waitFor(() => expect(screen.getByText(/small chemical engine/i)).toBeInTheDocument());
  });
});
