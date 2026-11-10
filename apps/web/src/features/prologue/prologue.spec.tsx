import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { routes } from '../../app/router';
import { server } from '../../test/msw/server';
import { renderWithRouter } from '../../test/utils';
import { clearPrologueSteps } from './prologue-state';
import { dismissGuide } from './prologue-test-utils';

type Outcome = 'played' | 'skipped' | null | undefined;

/** A pilot with no faction, and whatever the server says about the opening. */
function pilot(getOutcome: () => Outcome, factionId: string | null = null) {
  return http.get('/v1/players/me', () =>
    HttpResponse.json({
      id: 'player-1',
      name: 'Test Pilot',
      credits: 0,
      role: 'PLAYER',
      locale: 'en',
      factionId,
      tutorialDone: true,
      ...(getOutcome() === undefined ? {} : { prologueOutcome: getOutcome() }),
    }),
  );
}

/** The server's payouts for the opening (they add up to the credits a pilot starts with). */
const payouts = http.get('/v1/players/me/prologue', () =>
  HttpResponse.json({ startCredits: 3000, refuelCost: 100, payouts: [620, 930, 1550] }),
);

describe('the new-pilot opening: gating, resume and skip', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearPrologueSteps();
    server.use(payouts);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the opening to a pilot with no faction and no saved outcome', async () => {
    server.use(pilot(() => null));
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    expect(await screen.findByTestId('prologue')).toHaveAttribute('data-step', 'gift');
    expect(screen.queryByRole('heading', { name: /choose your faction/i })).toBeNull();
  });

  it.each(['played', 'skipped'] as const)(
    'shows the faction picker once the server says the opening was %s, even in a fresh browser',
    async (outcome) => {
      server.use(pilot(() => outcome));
      renderWithRouter(routes, { initialEntries: ['/onboarding'] });

      expect(
        await screen.findByRole('heading', { name: /choose your faction/i }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('prologue')).toBeNull();
    },
  );

  it('keeps showing the picker for an older server that does not send the outcome', async () => {
    server.use(pilot(() => undefined));
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });
    expect(
      await screen.findByRole('heading', { name: /choose your faction/i }),
    ).toBeInTheDocument();
  });

  it('resumes at the step the pilot was on', async () => {
    window.localStorage.setItem('rs.prologue.player-1', 'race');
    server.use(pilot(() => null));
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    expect(await screen.findByTestId('prologue')).toHaveAttribute('data-step', 'race');
  });

  it('starts from the top when the browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    server.use(pilot(() => null));
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    expect(await screen.findByTestId('prologue')).toHaveAttribute('data-step', 'gift');
  });

  it('moves to the next step and remembers it', async () => {
    server.use(pilot(() => null));
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    await screen.findByTestId('gift-scene');
    await dismissGuide();

    await waitFor(() =>
      expect(screen.getByTestId('prologue')).toHaveAttribute('data-step', 'fit-engine'),
    );
    expect(window.localStorage.getItem('rs.prologue.player-1')).toBe('fit-engine');
  });

  it('shows a big warning when skipping, and skips only after a second confirm', async () => {
    let outcome: Outcome = null;
    const posted: unknown[] = [];
    server.use(
      pilot(() => outcome),
      http.post('/v1/players/me/prologue', async ({ request }) => {
        const body = (await request.json()) as { outcome: 'played' | 'skipped' };
        posted.push(body);
        outcome = body.outcome;
        return HttpResponse.json({ outcome: body.outcome });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    await userEvent.click(await screen.findByRole('button', { name: /skip the opening/i }));
    const dialog = await screen.findByRole('dialog', { name: /skip the opening\?/i });
    expect(dialog).toHaveTextContent(/first time/i);
    expect(dialog).toHaveTextContent(/cannot come back/i);
    expect(posted).toEqual([]);

    // backing out keeps the opening
    await userEvent.click(screen.getByRole('button', { name: /play the opening/i }));
    expect(screen.queryByRole('dialog', { name: /skip the opening\?/i })).toBeNull();
    expect(posted).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: /skip the opening/i }));
    await userEvent.click(await screen.findByRole('button', { name: /skip anyway/i }));

    await waitFor(() => expect(posted).toEqual([{ outcome: 'skipped' }]));
    expect(
      await screen.findByRole('heading', { name: /choose your faction/i }),
    ).toBeInTheDocument();
  });

  it('saves the outcome played when the story ends', async () => {
    window.localStorage.setItem('rs.prologue.player-1', 'rescue');
    let outcome: Outcome = null;
    const posted: unknown[] = [];
    server.use(
      pilot(() => outcome),
      http.post('/v1/players/me/prologue', async ({ request }) => {
        const body = (await request.json()) as { outcome: 'played' | 'skipped' };
        posted.push(body);
        outcome = body.outcome;
        return HttpResponse.json({ outcome: body.outcome });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    await screen.findByTestId('rescue-scene');
    await dismissGuide();

    await waitFor(() => expect(posted).toEqual([{ outcome: 'played' }]));
    expect(
      await screen.findByRole('heading', { name: /choose your faction/i }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem('rs.prologue.player-1')).toBeNull();
  });

  it('puts the harbour office above the picker after a played opening, and not after a skipped one', async () => {
    server.use(pilot(() => 'played'));
    const played = renderWithRouter(routes, { initialEntries: ['/onboarding'] });
    expect(await screen.findByTestId('prologue-port')).toHaveTextContent(/kite's gone/i);
    played.unmount();

    server.use(pilot(() => 'skipped'));
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });
    await screen.findByRole('heading', { name: /choose your faction/i });
    expect(screen.queryByTestId('prologue-port')).toBeNull();
  });
});
