import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { client } from '../../../api/client';
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
      payouts: [720, 1080, 1800],
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
      expect(document.querySelector('[data-tour="accept_button"][data-opening-allowed]')).not.toBeNull(),
    );
    // the sort chips and the nav are inert
    expect(document.querySelectorAll('[data-opening-locked]').length).toBeGreaterThan(0);
    for (const el of Array.from(document.querySelectorAll('[data-opening-locked]'))) {
      expect(el).toHaveAttribute('inert');
    }
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
      expect(ships[0]?.name).not.toBe('Wayfarer');
    });
  });

  it('plays the whole story down to the rescue and saves "played"', async () => {
    server.use(story([]));
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
    fireEvent.click(await screen.findByTestId('opening-continue', undefined, { timeout: 8000 }));
    await waitFor(() => expect(saved).toEqual({ outcome: 'played' }));
  }, 15000);

  it('has a step for every moment the Admin can hang a line on', () => {
    expect(OPENING_STEPS).toHaveLength(16);
  });
});
