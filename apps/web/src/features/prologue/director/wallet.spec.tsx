import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { client } from '../../../api/client';
import { routes } from '../../../app/router';
import { server } from '../../../test/msw/server';
import { renderWithRouter } from '../../../test/utils';
import { clearPrologueSteps, readSaved } from '../prologue-state';
import type { StepId } from './steps';

beforeEach(() => {
  window.localStorage.clear();
  clearPrologueSteps();
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
        purse: 300,
        refuelCost: 100,
        moduleCost: 800,
        upgradeCost: 200,
        payouts: [646, 494, 2660],
        guides: [],
      }),
    ),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function saveStep(step: StepId, kind: 'passengers' | 'crates' | null = null) {
  window.localStorage.setItem('rs.prologue.player-1', JSON.stringify({ step, kind }));
  clearPrologueSteps();
}

const wallet = () => screen.getByTestId('topbar-wallet').getAttribute('data-value');

/** The flight's time passes at once: the sandbox reads the same clock. */
function skipAhead() {
  const later = Date.now() + 60 * 60 * 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => later);
}

describe('the opening wallet adds each flight', () => {
  it('pays the race into the wallet', async () => {
    saveStep('race');
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await waitFor(() => expect(wallet()).toBe('300'));
    const [mission] = await client.get<{ id: string }[]>('/v1/missions/active');
    await client.post('/v1/ships/prologue-ship/dispatch', { missionId: mission?.id });
    skipAhead();
    await waitFor(() => expect(readSaved('player-1').step).toBe('race-report'), { timeout: 5000 });
    await waitFor(() => expect(wallet()).toBe('946'), { timeout: 5000 });
  }, 20000);

  it('pays the first job on top of the race', async () => {
    saveStep('dispatch-job', 'passengers');
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    // 300 + 646 (race) - 100 (refuel) - 800 (module)
    await waitFor(() => expect(wallet()).toBe('46'));
    const [ship] = await client.get<{ currentLocationId: string }[]>('/v1/ships');
    const board = await client.get<{ id: string; eligibility?: { eligible: boolean } }[]>(
      `/v1/locations/${ship?.currentLocationId}/missions`,
    );
    let [mission] = await client.get<{ id: string }[]>('/v1/missions/active');
    if (mission === undefined) {
      const job = board.find((offer) => offer.eligibility?.eligible) ?? board[0];
      await client.post(`/v1/missions/${job?.id}/accept`, {});
      [mission] = await client.get<{ id: string }[]>('/v1/missions/active');
    }
    await client.post('/v1/ships/prologue-ship/dispatch', { missionId: mission?.id });
    skipAhead();
    await waitFor(() => expect(readSaved('player-1').step).toBe('job-report'), { timeout: 5000 });
    await waitFor(() => expect(wallet()).toBe('540'), { timeout: 5000 });
  }, 20000);

  it('pays the second job (the third flight) on top of the rest', async () => {
    saveStep('stop-two', 'passengers');
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    // 300 + 646 (race) - 100 (refuel) - 800 (module) + 494 (first job) - repair - upgrade
    await waitFor(() => expect(wallet()).toBe('240'));
    const before = wallet();
    const [ship] = await client.get<{ currentLocationId: string }[]>('/v1/ships');
    const board = await client.get<
      { id: string; reward: number; eligibility?: { eligible: boolean } }[]
    >(`/v1/locations/${ship?.currentLocationId}/missions`);
    const job = board.find((offer) => offer.eligibility?.eligible);
    await client.post(`/v1/missions/${job?.id}/accept`, {});
    await client.post('/v1/ships/prologue-ship/dispatch', { missionId: job?.id });
    skipAhead();
    await waitFor(() => expect(readSaved('player-1').step).not.toBe('stop-two'), { timeout: 5000 });
    await waitFor(() => expect(wallet()).toBe(String(Number(before) + (job?.reward ?? 0))), {
      timeout: 5000,
    });
  }, 20000);
});
