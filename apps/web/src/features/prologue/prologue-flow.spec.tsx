import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { routes } from '../../app/router';
import { server } from '../../test/msw/server';
import { renderWithRouter } from '../../test/utils';
import { creditsAt } from './prologue-script';
import { clearPrologueSteps, PROLOGUE_STEPS, type StepId } from './prologue-state';
import { dismissGuide } from './prologue-test-utils';

const PAYOUTS = [600, 900, 1500];

function openAt(step: StepId) {
  window.localStorage.clear();
  clearPrologueSteps();
  window.localStorage.setItem('rs.prologue.player-1', step);
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
      HttpResponse.json({ startCredits: 3000, payouts: PAYOUTS }),
    ),
  );
  return renderWithRouter(routes, { initialEntries: ['/onboarding'] });
}

const stepOf = () => screen.getByTestId('prologue').getAttribute('data-step');
const dispatchButtons = () => screen.getAllByRole('button', { name: /^dispatch$/i });

describe('the opening, step by step', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearPrologueSteps();
  });

  it('adds the payouts up to exactly what a pilot starts with', () => {
    expect(creditsAt('gift', PAYOUTS)).toBe(0);
    expect(creditsAt('race', PAYOUTS)).toBe(0);
    expect(creditsAt('stop-one', PAYOUTS)).toBe(600);
    expect(creditsAt('fit-cargo', PAYOUTS)).toBe(1500);
    expect(creditsAt('final-board', PAYOUTS)).toBe(3000);
    expect(creditsAt('rescue', PAYOUTS)).toBe(3000);
    expect(PROLOGUE_STEPS.at(-1)).toBe('rescue');
  });

  it('shows the pilot their ship and the friend on the first step', async () => {
    openAt('gift');
    expect(await screen.findByTestId('gift-scene')).toBeInTheDocument();
    expect(await screen.findByTestId('dialogue')).toHaveTextContent(/Kite/);
    expect(screen.getByTestId('prologue-credits')).toHaveTextContent('0');
  });

  it('puts the race on the real mission card with its map and dispatches into the race', async () => {
    openAt('race-board');
    expect((await screen.findAllByText(/dockside sprint/i)).length).toBeGreaterThan(0);
    expect(document.querySelector('.route-map')).not.toBeNull();
    expect(dispatchButtons()).toHaveLength(1);

    await userEvent.click(dispatchButtons()[0] as HTMLElement);
    await waitFor(() => expect(stepOf()).toBe('race'));
  });

  it('makes the pilot refuel before the first stop lets them dispatch, and offers two jobs that pay the same', async () => {
    openAt('stop-one');
    await screen.findAllByText(/passengers to dockside/i);
    expect(screen.getByTestId('prologue-credits')).toHaveTextContent('600');
    const buttons = dispatchButtons();
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toBeDisabled();
    const rewards = [...document.querySelectorAll('.mcard-reward b')].map((b) => b.textContent);
    expect(rewards[0]).toBe(rewards[1]);

    await userEvent.click(screen.getByRole('button', { name: /refuel/i }));
    for (const button of dispatchButtons()) expect(button).toBeEnabled();
    await userEvent.click(dispatchButtons()[1] as HTMLElement);
    await waitFor(() => expect(stepOf()).toBe('offer-run-1'));
  });

  it('lets the guide be read and then gets out of the way of the card', async () => {
    openAt('race-board');
    expect(await screen.findByTestId('dialogue')).toBeInTheDocument();
    await dismissGuide();
    expect(screen.queryByTestId('dialogue')).toBeNull();
    expect(dispatchButtons()).toHaveLength(1);
  });

  it('shows a short trip and then the second fitting', async () => {
    openAt('offer-run-1');
    await userEvent.click(await screen.findByRole('button', { name: /continue/i }));
    await waitFor(() => expect(stepOf()).toBe('fit-cargo'));
    expect(screen.getByTestId('prologue-credits')).toHaveTextContent('1,500');
  });

  it('puts the dangerous final run on the card and goes on to the fight when dispatched', async () => {
    openAt('final-board');
    expect((await screen.findAllByText(/cinder reach/i)).length).toBeGreaterThan(0);
    expect(screen.getByTestId('prologue-credits')).toHaveTextContent('3,000');
    await userEvent.click(dispatchButtons()[0] as HTMLElement);
    await waitFor(() => expect(stepOf()).toBe('final-run'));
  });

  it('goes from the loss popup to the rescue', async () => {
    openAt('loss');
    const popup = await screen.findByRole('alertdialog');
    await userEvent.click(within(popup).getByRole('button'));
    await waitFor(() => expect(stepOf()).toBe('rescue'));
    expect(await screen.findByTestId('rescue-scene')).toBeInTheDocument();
  });

  it('lets the rescuer speak before the opening ends', async () => {
    openAt('rescue');
    expect(await screen.findByTestId('dialogue')).toHaveTextContent(/Dara Voss/);
    await dismissGuide();
  });
});
