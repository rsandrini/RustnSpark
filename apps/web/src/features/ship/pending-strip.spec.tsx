import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';

const onboarded = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: 0,
        role: 'PLAYER',
        locale: 'en',
        factionId: 'luna',
      },
      { status: 200 },
    ),
  );

const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

/** A mission accepted and waiting to start, and (optionally) a search under way beside it. */
async function activeMissions(options: { deadlineInSeconds: number | null; withJob: boolean }) {
  const offers = (await (await fetch('/v1/locations/ceres/missions')).json()) as Array<
    Record<string, unknown> & { id: string; info: { title: unknown; description: unknown } }
  >;
  const base = offers[0]!;
  const waiting = {
    ...base,
    id: 'waiting-1',
    status: 'ACCEPTED',
    playerId: 'player-1',
    shipId: 'ship-1',
    deadlineAt: options.deadlineInSeconds === null ? null : later(options.deadlineInSeconds),
    brief: { title: base.info.title, description: base.info.description },
    legWindows: [],
  };
  const job = {
    ...base,
    id: 'job-1',
    type: 'SCAVENGE',
    status: 'IN_TRANSIT',
    playerId: 'player-1',
    shipId: 'ship-1',
    isJob: true,
    arrivalAt: later(300),
    brief: {
      title: { en: 'Scavenging', 'pt-BR': 'Vasculhando' },
      description: base.info.description,
    },
    legWindows: [],
  };
  return options.withJob ? [waiting, job] : [waiting];
}

describe('a mission waiting beside a search under way', () => {
  it('shows both on the missions screen, and the waiting mission cannot start until the search ends', async () => {
    server.use(onboarded());
    const missions = await activeMissions({ deadlineInSeconds: 3600, withJob: true });
    server.use(http.get('/v1/missions/active', () => HttpResponse.json(missions)));
    renderWithRouter(routes, { initialEntries: ['/hangar/board'] });
    const strip = await screen.findByTestId('pending-strip');
    expect(within(strip).getByTestId('pending-waiting')).toBeInTheDocument();
    expect(within(strip).getByTestId('pending-job')).toHaveTextContent(/Searching/);
    expect(within(strip).getByTestId('pending-job')).toHaveTextContent(/waits/);
  });

  it('the ship screen disables Dispatch while the search runs and says when it ends', async () => {
    server.use(onboarded());
    const missions = await activeMissions({ deadlineInSeconds: 3600, withJob: true });
    server.use(http.get('/v1/missions/active', () => HttpResponse.json(missions)));
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    expect(await screen.findByTestId('transit-job-running')).toHaveTextContent(/under way/i);
    const dispatch = await screen.findByRole('button', { name: 'Dispatch' });
    expect(dispatch).toBeDisabled();
  });

  it('without a search the waiting mission can start as usual', async () => {
    server.use(onboarded());
    const missions = await activeMissions({ deadlineInSeconds: 3600, withJob: false });
    server.use(http.get('/v1/missions/active', () => HttpResponse.json(missions)));
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dispatch' })).toBeEnabled());
    expect(screen.queryByTestId('transit-job-running')).not.toBeInTheDocument();
  });

  it('the port refuses a search that would end after the waiting mission must start', async () => {
    server.use(onboarded());
    // the mission must start within a minute; a search takes minutes
    const missions = await activeMissions({ deadlineInSeconds: 60, withJob: false });
    server.use(http.get('/v1/missions/active', () => HttpResponse.json(missions)));
    renderWithRouter(routes, { initialEntries: ['/port'] });
    fireEvent.click(await screen.findByRole('tab', { name: 'Work' }));
    expect(await screen.findByTestId('scavenge-past-deadline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send the ship scavenging/i })).toBeDisabled();
  });
});
