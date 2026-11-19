import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { client, serverNow } from '../../../api/client';
import { routes } from '../../../app/router';
import { server } from '../../../test/msw/server';
import { renderWithRouter } from '../../../test/utils';
import { clearPrologueSteps, readSaved } from '../prologue-state';
import { PROLOGUE_ENGINE, PROLOGUE_START_PARTS } from '../prologue-fixtures';
import { OPENING_STEPS, type StepId } from './steps';

const KITE = {
  id: 'free_mentor_kite',
  name: 'Kite',
  title: { en: 'A friend', 'pt-BR': 'Um amigo' },
  role: 'MENTOR',
  factionId: 'free',
  portraitUrl: null,
};

const node = (id: string, text: string, next: string | null = null) => ({
  id,
  text: { en: text, 'pt-BR': text },
  position: 'center',
  anchor: null,
  blocking: true,
  next,
  choices: [],
});

const scene = (id: string, trigger: string, order: number, ...lines: string[]) => ({
  id,
  title: { en: id, 'pt-BR': id },
  trigger,
  order,
  start: `${id}-0`,
  nodes: lines.map((line, index) =>
    node(`${id}-${index}`, line, index + 1 < lines.length ? `${id}-${index + 1}` : null),
  ),
});

function story(scenes: ReturnType<typeof scene>[]) {
  return http.get('/v1/players/me/prologue', () =>
    HttpResponse.json({
      startCredits: 3000,
      purse: 300,
      refuelCost: 100,
      moduleCost: 800,
      upgradeCost: 200,
      payouts: [646, 494, 2660],
      guides: [{ giver: KITE, scenes }],
    }),
  );
}

const pilot = http.get('/v1/players/me', () =>
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
);

const GIFT_SCENES = [
  scene('gift', 'prologue_gift_enter', 1, 'Hey, I am Kite.', 'Here is an engine.'),
  scene('gift-done', 'prologue_gift_done', 1, 'Off we go.'),
];

function saveStep(step: StepId, kind: 'passengers' | 'crates' | null = null) {
  window.localStorage.setItem('rs.prologue.player-1', JSON.stringify({ step, kind }));
  clearPrologueSteps();
}

beforeEach(() => {
  window.localStorage.clear();
  clearPrologueSteps();
  server.use(pilot);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the director: the story on the real screens', () => {
  it('speaks the first lines in the middle of the screen, then waits for Continue', async () => {
    server.use(story(GIFT_SCENES));
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    const box = await screen.findByTestId('dialogue');
    expect(box.querySelector('.dialogue-box')).toHaveAttribute('data-position', 'center');
    expect((await screen.findAllByText(/Kite/)).length).toBeGreaterThan(0);
    // two lines: the first, then the second
    // the first press finishes the typing, the second goes on
    const next = await screen.findByRole('button', { name: 'Continue' });
    fireEvent.click(next);
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByText(/Here is an engine/)).toBeInTheDocument());
  });

  it('moves on from the gift when the pilot presses Continue, saving the step', async () => {
    server.use(story([]));
    renderWithRouter(routes, { initialEntries: ['/ship'] });

    fireEvent.click(await screen.findByTestId('opening-continue'));
    await waitFor(() => expect(readSaved('player-1').step).toBe('fit-engine'));
  });

  it('a step with no lines still advances when the pilot does the thing', async () => {
    server.use(story([]));
    saveStep('fit-engine');
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await screen.findByTestId('opening-bar');

    await client.post('/v1/ships/prologue-ship/assemble', {
      layout: [
        ...PROLOGUE_START_PARTS.map((part) => part.target),
        { partInstanceId: PROLOGUE_ENGINE.id, gx: -4, gy: 0, rot: 0 },
      ],
    });
    await waitFor(() => expect(readSaved('player-1').step).toBe('race-board'));
  });

  it('does not move on when the engine is saved in a place that does not connect', async () => {
    server.use(story([]));
    saveStep('fit-engine');
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await screen.findByTestId('opening-bar');

    await client.post('/v1/ships/prologue-ship/assemble', {
      layout: [
        ...PROLOGUE_START_PARTS.map((part) => part.target),
        { partInstanceId: PROLOGUE_ENGINE.id, gx: -4, gy: -1, rot: 0 },
      ],
    });
    // give the director a moment to (wrongly) move on
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(readSaved('player-1').step).toBe('fit-engine');
  });

  it('puts a pilot who closed the tab back on the screen of the step they were on', async () => {
    server.use(story([]));
    saveStep('stop-port');
    const view = renderWithRouter(routes, { initialEntries: ['/ship'] });
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/port'));
  });

  it('locks everything but what the step allows, and lights up what it wants pressed', async () => {
    server.use(story([]));
    saveStep('race-board');
    const view = renderWithRouter(routes, { initialEntries: ['/missions'] });
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/missions'));

    await waitFor(() =>
      expect(
        document.querySelector('[data-tour="accept_button"][data-opening-allowed]'),
      ).not.toBeNull(),
    );
    // the sort chips and the nav are inert
    expect(document.querySelectorAll('[data-opening-locked]').length).toBeGreaterThan(0);
    for (const el of Array.from(document.querySelectorAll('[data-opening-locked]'))) {
      expect(el).toHaveAttribute('inert');
    }
  });

  it('says what to do now, and the button says what it does', async () => {
    server.use(story([]));
    saveStep('gift');
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    expect(await screen.findByTestId('opening-continue')).toHaveTextContent('Take the engine');
  });

  it('the pilot chooses the job themselves: nothing moves on until they press Choose', async () => {
    server.use(story([]));
    saveStep('choose-job');
    renderWithRouter(routes, { initialEntries: ['/missions'] });
    await screen.findByTestId('opening-bar');
    expect(screen.queryByTestId('opening-hint')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(readSaved('player-1').step).toBe('choose-job');

    const choose = (await screen.findAllByRole('button', { name: 'Choose this job' }))[1];
    fireEvent.click(choose as HTMLElement);
    await waitFor(() => expect(readSaved('player-1').step).toBe('buy-module'));
    expect(readSaved('player-1').kind).toBe('crates');
  });

  it('hands over the scrap on the upgrade step and moves on when the hull is upgraded', async () => {
    server.use(story([]));
    saveStep('upgrade');
    const view = renderWithRouter(routes, { initialEntries: ['/port'] });
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/port'));
    await screen.findByTestId('opening-bar');
    expect(screen.queryByTestId('opening-hint')).not.toBeInTheDocument();

    await client.post('/v1/parts/prologue-hull/upgrade', {});
    await waitFor(() => expect(readSaved('player-1').step).toBe('stop-two'));
  });

  it('after the module is bought the pilot is taken to the ship, not kept in the shop', async () => {
    server.use(
      story([
        scene('bought', 'prologue_buy-module_done', 1, 'Paid for. Now fit it.'),
        scene('fit', 'prologue_fit-module_enter', 1, 'Drag, connect, save.'),
      ]),
    );
    saveStep('buy-module', 'crates');
    const view = renderWithRouter(routes, { initialEntries: ['/port?tab=market'] });
    await screen.findByTestId('opening-bar');
    const listings = await client.get<{
      listings: Array<{ listingId: string; price: number; partType: string }>;
    }>('/v1/locations/loc/market');
    const listing = listings.listings.find((entry) => entry.partType === 'cargo') as {
      listingId: string;
      price: number;
    };
    await client.post('/v1/market/buy', {
      listingId: listing.listingId,
      expectedPrice: listing.price,
    });

    // the shop lets go of the pilot as soon as the module is paid for
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/ship'));
    expect(readSaved('player-1').step).toBe('buy-module');
    // the friend speaks, the pilot reads it, and the story walks them to the ship
    const button = await screen.findByRole('button', { name: 'Continue' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(readSaved('player-1').step).toBe('fit-module'));
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/ship'));
  });

  it('a passenger job needs both its parts: the step is done only when the cabin and the life support are bought', async () => {
    server.use(story([scene('bought', 'prologue_buy-module_done', 1, 'Paid for.')]));
    saveStep('buy-module', 'passengers');
    const view = renderWithRouter(routes, { initialEntries: ['/port?tab=market'] });
    await screen.findByTestId('opening-bar');
    const { listings } = await client.get<{
      listings: Array<{ listingId: string; price: number; partType: string }>;
    }>('/v1/locations/loc/market');
    const buy = (type: string) => {
      const listing = listings.find((entry) => entry.partType === type) as {
        listingId: string;
        price: number;
      };
      return client.post('/v1/market/buy', {
        listingId: listing.listingId,
        expectedPrice: listing.price,
      });
    };
    await buy('passenger_cabin');
    await new Promise((resolve) => setTimeout(resolve, 400));
    // one part is not the job's module yet: the shop keeps the pilot
    expect(view.router.state.location.pathname).toBe('/port');
    await buy('life_support');
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/ship'));
  });

  it('the repair step: pay the workshop at the port and the story moves on to the upgrade', async () => {
    server.use(story([]));
    saveStep('repair', 'passengers');
    renderWithRouter(routes, { initialEntries: ['/port?tab=repair'] });
    await screen.findByTestId('opening-bar');
    const ship = await client.get<Array<{ id: string }>>('/v1/ships');
    const parts =
      await client.get<Array<{ id: string; condition: number; location: string }>>('/v1/inventory');
    const targets = parts
      .filter((part) => part.location === 'INSTALLED' && part.condition < 100)
      .map((part) => ({ partInstanceId: part.id, toCondition: 100 }));
    expect(targets.length).toBeGreaterThan(0);
    await client.post(`/v1/ships/${ship[0]?.id ?? ''}/repair`, { targets });
    await waitFor(() => expect(readSaved('player-1').step).toBe('upgrade'));
  });

  it('the taken job\u2019s Open on My Ship button is not locked on the steps that fly a job', async () => {
    server.use(story([]));
    saveStep('final-run', 'passengers');
    renderWithRouter(routes, { initialEntries: ['/missions'] });
    await screen.findByTestId('opening-bar');
    const open = await screen.findByRole('button', { name: 'Open on My Ship' });
    // the story has locked the rest of the screen (the filter chips), and left this button alone
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Only eligible' })).toHaveAttribute('inert'),
    );
    expect(open).not.toHaveAttribute('inert');
  });

  it('the account menu (language, Sign out) is never locked, on any screen of the story', async () => {
    server.use(story([]));
    saveStep('choose-job');
    renderWithRouter(routes, { initialEntries: ['/missions'] });
    await screen.findByTestId('opening-bar');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Only eligible' })).toHaveAttribute('inert'),
    );
    expect(screen.getByRole('button', { name: 'Account menu' })).not.toHaveAttribute('inert');
  });

  it('the race ends on its report with the short result card open, before the guide speaks', async () => {
    server.use(story([scene('rr', 'prologue_race-report_enter', 1, 'I crossed first.')]));
    saveStep('race-report');
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    // the card first: place and time of the race
    const card = await screen.findByTestId('mission-result');
    expect(within(card).getByTestId('mission-result-race')).toBeInTheDocument();
    // the guide waits for it
    expect(screen.queryByText('I crossed first.')).not.toBeInTheDocument();
    fireEvent.click(within(card).getByTestId('mission-result-close'));
    expect(await screen.findByText('I crossed first.')).toBeInTheDocument();
  });

  it('stops the race at the end of a leg while the friend speaks, and goes on when the line is read', async () => {
    server.use(story([scene('leg-one', 'prologue_race_leg_1', 1, 'First leg down.')]));
    saveStep('race');
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await screen.findByTestId('opening-bar');
    await client.post('/v1/ships/prologue-ship/dispatch', { missionId: 'sandbox-race' });

    // twenty seconds go by at once: the first leg (about 18 s) is over
    const real = Date.now;
    const jump = 20_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => real() + jump);
    expect(
      await screen.findByText('First leg down.', undefined, { timeout: 4000 }),
    ).toBeInTheDocument();

    // the clock stands still while the line is on the screen
    const stopped = serverNow();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(serverNow()).toBe(stopped);

    // the last line says Continue (not Close), and reading it lets the race go on
    const button = await screen.findByRole('button', { name: 'Continue' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByTestId('dialogue')).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(serverNow()).toBeGreaterThan(stopped);
    spy.mockRestore();
  }, 20000);

  it("the friend's engine is in the hold only after the pilot takes it", async () => {
    server.use(story([]));
    saveStep('gift');
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const hold = async () =>
      (await client.get<Array<{ id: string }>>('/v1/inventory')).map((part) => part.id);
    const take = await screen.findByTestId('opening-continue');
    expect(await hold()).not.toContain(PROLOGUE_ENGINE.id);

    fireEvent.click(take);
    await waitFor(async () => expect(await hold()).toContain(PROLOGUE_ENGINE.id));
    // and it drops into the parts list with its animation
    await waitFor(() => expect(document.querySelector('.part-btn-wrap.arrived')).not.toBeNull());
  });

  it('asks twice before skipping, at any step', async () => {
    server.use(story([]));
    for (const step of ['gift', 'race', 'stop-two', 'rescue'] as const) {
      saveStep(step);
      const view = renderWithRouter(routes, { initialEntries: ['/ship'] });
      fireEvent.click(await screen.findByTestId('opening-skip'));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      view.unmount();
    }
  });

  it('skips for good: the outcome is saved and the fake server goes away', async () => {
    server.use(story([]));
    let saved: unknown = null;
    server.use(
      http.post('/v1/players/me/prologue', async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ outcome: 'skipped' });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    fireEvent.click(await screen.findByTestId('opening-skip'));
    const dialog = await screen.findByRole('dialog');
    const buttons = dialog.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);

    await waitFor(() => expect(saved).toEqual({ outcome: 'skipped' }));
    await waitFor(async () => {
      const ships = await client.get<Array<{ name: string }>>('/v1/ships');
      expect(ships[0]?.name).not.toBe('RustNSpark');
    });
  });

  it('goes black after the loss (no failed report), speaks over the black, and never opens the report', async () => {
    server.use(
      story([
        scene('bob-dark', 'prologue_loss_enter', 30, 'Missiles no'),
        scene('dara-first', 'prologue_loss_enter', 31, 'Guys, a survivor'),
      ]),
    );
    saveStep('loss');
    const view = renderWithRouter(routes, { initialEntries: ['/ship'] });
    expect(await screen.findByTestId('dark-moment')).toBeInTheDocument();
    // nobody speaks until the screen is dark
    expect(screen.queryByText('Missiles no')).not.toBeInTheDocument();
    // while Bob speaks there is no ping; it goes out once the next voice is due
    expect(screen.queryByTestId('moment-ping')).not.toBeInTheDocument();
    const next = await screen.findByRole('button', { name: 'Continue' }, { timeout: 4000 });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(await screen.findByText('Guys, a survivor')).toBeInTheDocument();
    expect(screen.getByTestId('moment-ping')).toBeInTheDocument();
    expect(view.router.state.location.pathname).not.toMatch(/^\/report\//);
    expect(screen.queryByTestId('mission-result')).not.toBeInTheDocument();
  }, 15000);

  it('keeps the black under the rescue picture, so the game screen never shows between them', async () => {
    server.use(story([]));
    saveStep('rescue');
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    expect(await screen.findByTestId('rescue-moment')).toBeInTheDocument();
    expect(screen.getByTestId('dark-moment')).toBeInTheDocument();
  });

  it('plays the ending: the rescuer, a black card with "Some months later", the Marshal, then saves "played"', async () => {
    server.use(
      story([
        scene('dara-last', 'prologue_rescue_done', 34, 'Come aboard'),
        scene('marshal', 'prologue_later_enter', 35, 'Choose who you fight with'),
      ]),
    );
    let saved: unknown = null;
    server.use(
      http.post('/v1/players/me/prologue', async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ outcome: 'played' });
      }),
    );
    saveStep('rescue');
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    expect(await screen.findByTestId('rescue-moment')).toBeInTheDocument();
    // the rescuer's last line is read; the Marshal does not speak with it
    expect(
      await screen.findByText('Come aboard', undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Choose who you fight with')).not.toBeInTheDocument();
    const read = screen.getByRole('button', { name: 'Continue' });
    fireEvent.click(read);
    fireEvent.click(read);
    // time passes first, THEN the Marshal speaks
    // the cutter flies off first, then the game's name, then the time skip, and only then the Marshal
    expect(
      await screen.findByTestId('title-moment', undefined, { timeout: 6000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Choose who you fight with')).not.toBeInTheDocument();
    expect(
      await screen.findByText(/Some months later/, undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Choose who you fight with')).not.toBeInTheDocument();
    expect(
      await screen.findByText('Choose who you fight with', undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(saved).toBeNull();
    const last = screen.getByRole('button', { name: 'Continue' });
    fireEvent.click(last);
    fireEvent.click(last);
    await waitFor(() => expect(saved).toEqual({ outcome: 'played' }));
  }, 40000);

  it('has a step for every moment the Admin can hang a line on', () => {
    expect(OPENING_STEPS).toHaveLength(18);
  });
});
