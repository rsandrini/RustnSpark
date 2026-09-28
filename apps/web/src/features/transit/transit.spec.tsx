import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { resetActiveState, resetEconomyState } from '../../test/msw/handlers';
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
  privatePlayerId: null,
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
    resetEconomyState();
    server.use(onboarded());
  });

  it('embedded on My Ship, shows nothing at all when there is no active mission or last report', async () => {
    // Home is gone and Transit is embedded now (round-3): with nothing active and no report
    // yet, the host's own idle ActiveShipStage scene already says "docked" — the old
    // standalone empty-state text/link would just be a second, redundant one.
    server.use(
      http.get('/v1/missions/active', () => HttpResponse.json([], { status: 200 })),
      http.get('/v1/reports', () => HttpResponse.json({ items: [] }, { status: 200 })),
    );
    renderWithRouter(routes, { initialEntries: ['/hangar'] });

    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
    expect(await screen.findByText('Docked and ready')).toBeInTheDocument();
    expect(screen.queryByTestId('last-mission')).toBeNull();
    expect(screen.queryByTestId('held')).toBeNull();
    expect(screen.queryByTestId('in-transit')).toBeNull();
  });

  it('dispatches the accepted mission and flips to the in-transit view', async () => {
    renderWithRouter(routes, { initialEntries: ['/transit'] });

    expect(await screen.findByText('Mission accepted — ready for departure.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }));

    const view = await screen.findByTestId('in-transit');
    expect(view).toBeInTheDocument();
    expect(screen.getByTestId('transit-scene')).toHaveClass('moving');
    expect(screen.getByTestId('briefing')).toBeInTheDocument();
    expect(screen.getAllByRole('timer').length).toBeGreaterThanOrEqual(1);
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

    const inTransit = await screen.findByTestId('in-transit');
    expect(inTransit).toBeInTheDocument();
    expect(screen.getAllByRole('timer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Porto Ceres → Portão Kessler')).toBeInTheDocument();
    expect(within(inTransit).getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows the delivered panel once the server reports no active mission', async () => {
    // Deterministic on the Dispatch click itself, not a fragile call-count race: the mission
    // stays active until dispatched, then the server never reports one again.
    let dispatched = false;
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json(dispatched ? [] : [mission()], { status: 200 }),
      ),
      http.post('/v1/ships/:id/dispatch', () => {
        dispatched = true;
        return HttpResponse.json(
          {
            missionId: 'm-1',
            arrivalAt: iso(3600 * 1000),
            serverTime: iso(0),
            durationSeconds: 3600,
          },
          { status: 200 },
        );
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });

    expect(await screen.findByText('Mission accepted — ready for departure.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }));

    // The last run comes from the server's report list, so it survives a reload and shows
    // the real outcome — not just "no active mission". It reaches the pilot as a "Last
    // mission" link next to the Ship/Board/Port tabs, opening a popup with the report link
    // (Embedded, the old "Back to the map" shortcut is gone — Map is always one click away
    // in the persistent GameNav now.)
    fireEvent.click(await screen.findByRole('button', { name: 'Last mission' }));
    const popup = await screen.findByRole('dialog', { name: 'Last mission' });
    const reportLink = within(popup).getByRole('link', { name: 'Read the report' });
    expect(reportLink).toHaveAttribute('href', '/report/m-1');
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
    fireEvent.click(await screen.findByRole('button', { name: 'Last mission' }));
    const popup = await screen.findByRole('dialog', { name: 'Last mission' });
    expect(popup).toHaveTextContent('Mission failed');
    expect(within(popup).getByRole('link', { name: 'Read the report' })).toHaveAttribute(
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

  it('shows the report of a mission that finished while the page was open', async () => {
    // The report list is empty until the worker finishes, exactly as in the real stack: a copy
    // fetched at page load must not be the one shown after the mission resolves.
    let resolved = false;
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json(resolved ? [] : [{ ...mission(), status: 'IN_TRANSIT' }], {
          status: 200,
        }),
      ),
      http.get('/v1/reports', () =>
        HttpResponse.json(
          {
            items: resolved
              ? [
                  {
                    missionId: 'm-9',
                    outcome: 'success',
                    credits: 700,
                    legs: 1,
                    createdAt: new Date().toISOString(),
                  },
                ]
              : [],
          },
          { status: 200 },
        ),
      ),
    );
    const { queryClient } = renderWithRouter(routes, { initialEntries: ['/transit'] });
    expect(await screen.findByTestId('in-transit')).toBeInTheDocument();

    resolved = true;
    await queryClient.invalidateQueries({ queryKey: ['active'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Last mission' }));
    const popup = await screen.findByRole('dialog', { name: 'Last mission' });
    expect(within(popup).getByRole('link', { name: 'Read the report' })).toHaveAttribute(
      'href',
      '/report/m-9',
    );
  });

  it('lets the pilot back out: cancel an accepted mission, release a held one', async () => {
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    expect(await screen.findByText('Mission accepted — ready for departure.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel mission' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Cancel mission' })).toBeNull(),
    );
    expect(screen.queryByText('Mission accepted — ready for departure.')).toBeNull();
  });

  it('offers Release on a held mission', async () => {
    let released = 0;
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json([{ ...mission(), status: 'HELD' }], { status: 200 }),
      ),
      http.delete('/v1/missions/:id/hold', () => {
        released += 1;
        return HttpResponse.json({ status: 'AVAILABLE' }, { status: 200 });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    const held = await screen.findByTestId('held');
    fireEvent.click(within(held).getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(released).toBe(1));
  });

  it('takes a pilot who is watching to the report when the mission ends, and refreshes the wallet', async () => {
    let profileReads = 0;
    server.use(
      http.get('/v1/players/me', () => {
        profileReads += 1;
        return HttpResponse.json(
          {
            id: 'player-1',
            name: 'Test Pilot',
            credits: 100,
            role: 'PLAYER',
            locale: 'en',
            factionId: 'luna',
          },
          { status: 200 },
        );
      }),
      // In flight for ~4 s (the poll is fast that close to arrival), then gone.
      http.get('/v1/missions/active', () =>
        Date.now() < endsAt
          ? HttpResponse.json(
              [{ ...mission(), status: 'IN_TRANSIT', arrivalAt: iso(endsAt - Date.now()) }],
              { status: 200 },
            )
          : HttpResponse.json([], { status: 200 }),
      ),
    );
    const endsAt = Date.now() + 4000;
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    expect(await screen.findByTestId('in-transit')).toBeInTheDocument();
    const readsWhileFlying = profileReads;

    // The mission ends while the pilot is on this screen: the report opens on its own.
    expect(
      await screen.findByRole('heading', { name: 'Mission report' }, { timeout: 12_000 }),
    ).toBeInTheDocument();
    expect(profileReads).toBeGreaterThan(readsWhileFlying);
  }, 20_000);
});
