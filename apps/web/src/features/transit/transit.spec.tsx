import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { resetActiveState } from '../../test/msw/handlers';
import { routes } from '../../app/router';
import type { ActiveMission } from '../../api/generated';

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

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

const mission = (over: Partial<ActiveMission> = {}): ActiveMission => ({
  id: 'm-1',
  templateId: 'tpl-b-1',
  type: 'DELIVERY',
  factionId: 'luna',
  originId: 'ceres',
  destinationId: 'hedus',
  legs: [],
  cargo: {},
  reward: 1200,
  expiresAt: iso(2 * 60 * 60 * 1000),
  status: 'ACCEPTED',
  playerId: 'player-1',
  shipId: null,
  acceptedAt: iso(-5 * 60 * 1000),
  arrivalAt: null,
  deadlineAt: iso(60 * 60 * 1000),
  seed: 'seed-1',
  version: 1,
  legWindows: [],
  ...over,
});

describe('transit (S10.7)', () => {
  beforeEach(() => {
    resetActiveState();
    server.use(onboarded());
  });

  it('shows an empty state with a link to the board when nothing is active', async () => {
    server.use(
      http.get('/v1/missions/active', () => HttpResponse.json([], { status: 200 })),
      http.get('/v1/reports', () => HttpResponse.json({ items: [] }, { status: 200 })),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });

    expect(
      await screen.findByText('No active mission. Accept one from the mission board.'),
    ).toBeInTheDocument();
    const boardLink = screen.getByRole('link', { name: 'Mission board' });
    expect(boardLink).toHaveAttribute('href', '/board');
  });

  it('dispatches the accepted mission and flips to the in-transit view', async () => {
    renderWithRouter(routes, { initialEntries: ['/transit'] });

    expect(await screen.findByText('Mission accepted — ready for departure.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }));

    const view = await screen.findByTestId('in-transit');
    expect(view).toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.getByText('Leg 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Leg 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Porto Ceres → Portão Kessler')).toBeInTheDocument();
    expect(screen.getByText('Portão Kessler → Base Hedus')).toBeInTheDocument();
    expect(screen.getAllByText('Awaiting the next window')).toHaveLength(1);
    expect(screen.getAllByText('Arrives in').length).toBeGreaterThanOrEqual(1);
  });

  it('renders a mission that is already in transit with leg progress', async () => {
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json(
          [
            mission({
              status: 'IN_TRANSIT',
              shipId: 'ship-1',
              arrivalAt: iso(30 * 60 * 1000),
              legWindows: [
                {
                  legIndex: 0,
                  routeId: 'ceres-gate',
                  from: iso(-20 * 60 * 1000),
                  to: iso(-1 * 60 * 1000),
                },
                {
                  legIndex: 1,
                  routeId: 'gate-hedus',
                  from: iso(-1 * 60 * 1000),
                  to: iso(30 * 60 * 1000),
                },
              ],
            }),
          ],
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });

    expect(await screen.findByTestId('in-transit')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Porto Ceres → Portão Kessler')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows the delivered panel once the server reports no active mission', async () => {
    let calls = 0;
    server.use(
      http.get('/v1/missions/active', () => {
        calls += 1;
        if (calls <= 1) return HttpResponse.json([mission()], { status: 200 });
        return HttpResponse.json([], { status: 200 });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });

    expect(await screen.findByText('Mission accepted — ready for departure.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }));

    // The last run comes from the server's report list, so it survives a reload and shows
    // the real outcome — not just "no active mission".
    expect(await screen.findByTestId('last-mission')).toHaveTextContent('Last mission');
    const reportLink = screen.getByRole('link', { name: 'Read the report' });
    expect(reportLink).toHaveAttribute('href', '/report/m-1');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Back to the map' })).toHaveAttribute('href', '/map'),
    );
  });

  it('shows the last report after a reload, with its real outcome', async () => {
    server.use(
      http.get('/v1/missions/active', () => HttpResponse.json([], { status: 200 })),
      http.get('/v1/reports', () =>
        HttpResponse.json(
          {
            items: [
              {
                missionId: 'm-7',
                outcome: 'failed',
                credits: -50,
                legs: 1,
                createdAt: new Date().toISOString(),
              },
            ],
          },
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    const panel = await screen.findByTestId('last-mission');
    expect(panel).toHaveTextContent('Mission failed');
    expect(within(panel).getByRole('link', { name: 'Read the report' })).toHaveAttribute(
      'href',
      '/report/m-7',
    );
  });

  it('does not present a merely held mission as in transit', async () => {
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json([{ ...mission(), status: 'HELD' }], { status: 200 }),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    expect(await screen.findByTestId('held')).toHaveTextContent('only held');
    expect(screen.queryByTestId('in-transit')).toBeNull();
  });

  it('says so while the mission is being resolved', async () => {
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json([{ ...mission(), status: 'RESOLVING' }], { status: 200 }),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    expect(await screen.findByTestId('resolving')).toHaveTextContent('Resolving the mission');
    expect(screen.queryByTestId('in-transit')).toBeNull();
  });
});
