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
  brief: {
    title: { en: 'Ceres run', 'pt-BR': 'Rota de Ceres' },
    description: {
      en: 'Deliver cargo from Ceres to Hedus.',
      'pt-BR': 'Entregar carga de Ceres para Hedus.',
    },
  },
  ...over,
});

describe('transit (S10.7)', () => {
  beforeEach(() => {
    resetActiveState();
    resetEconomyState();
    server.use(onboarded());
  });

  it('an accepted mission keeps all its details: what it is, how long, the fuel, what it demands', async () => {
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json(
          [
            mission({
              info: {
                title: { en: 'Ceres run', 'pt-BR': 'Rota de Ceres' },
                description: {
                  en: 'Deliver cargo from Ceres to Hedus.',
                  'pt-BR': 'Entregar carga de Ceres para Hedus.',
                },
                legCount: 2,
                totalDistance: 700,
                peakDanger: 3,
                peakZone: 1,
                estimate: { durationSeconds: 150, fuelNeeded: 12 },
                material: null,
                requirements: [
                  { code: 'CARGO_TYPE', message: 'cargo', met: true },
                  { code: 'WEAPONS', message: 'weapons', met: false },
                ],
                race: null,
              },
            }),
          ],
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });

    const details = await screen.findByText('Ceres run');
    const card = details.closest('article') as HTMLElement;
    // the mission type, its description in plain sight (not only on hover), and the figures
    expect(within(card).getByText('Delivery')).toBeInTheDocument();
    expect(within(card).getByText('Deliver cargo from Ceres to Hedus.')).toBeInTheDocument();
    expect(within(card).getByText('2m 30s')).toBeInTheDocument();
    expect(within(card).getByText('700')).toBeInTheDocument();
    // what it demands, with what is met and what is not
    expect(within(card).getByText(/Cargo capacity for this load/)).toBeInTheDocument();
    expect(within(card).getByText(/At least one installed weapon/)).toBeInTheDocument();
    // fuel against what the ship carries
    expect(within(card).getByRole('progressbar', { name: 'Fuel needed' })).toBeInTheDocument();
    // the start deadline, and no "can you take it" verdict (it is already taken)
    expect(within(card).getByText(/Start before/)).toBeInTheDocument();
    expect(within(card).queryByText('Eligible')).not.toBeInTheDocument();
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

  // Round-10 owner request: "in My Ship, before dispatch the mission, we need a better UI
  // ... I cannot see the origin -> destination, I cannot see the details". Embedded (My
  // Ship) skipped the standalone header that carried routeLabel, so the pre-dispatch
  // briefing had no route at all — add it as a fact, plus the per-leg breakdown.
  it('embedded on My Ship, the pre-dispatch briefing shows the route and the leg plan', async () => {
    renderWithRouter(routes, { initialEntries: ['/hangar'] });

    expect(await screen.findByText('Mission accepted — ready for departure.')).toBeInTheDocument();
    const briefing = screen.getByTestId('briefing');
    expect(within(briefing).getByText('Porto Ceres → Base Hedus')).toBeInTheDocument();

    expect(screen.getByTestId('leg-plan')).toBeInTheDocument();
    expect(screen.getByText('Porto Ceres → Portão Kessler')).toBeInTheDocument();
    expect(screen.getByText('Portão Kessler → Base Hedus')).toBeInTheDocument();
  });

  it('a race mission lists its rivals (fastest first) before dispatch', async () => {
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json(
          [
            mission({
              type: 'RACE',
              cargo: {
                race: {
                  competitors: [
                    { id: 'r1', name: 'Comet Runner', mobility: 2.4 },
                    { id: 'r2', name: 'Vega Dart', mobility: 4.1 },
                  ],
                },
              },
            }),
          ],
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    const rivals = await screen.findByTestId('race-rivals');
    const items = within(rivals)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items).toEqual(['Vega Dart — speed 41', 'Comet Runner — speed 24']);
  });

  it("an accepted mission shows the engine tuning with this trip's time and fuel; dispatch sends only the mission", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json(
          [
            mission({
              type: 'RACE',
              cargo: { race: { competitors: [{ id: 'r1', name: 'Comet Runner', mobility: 2.4 }] } },
            }),
          ],
          { status: 200 },
        ),
      ),
      http.post('/v1/ships/:id/dispatch', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ missionId: 'm-1', arrivalAt: iso(60_000), serverTime: iso(0) });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    const tuning = await screen.findByTestId('engine-tuning');
    expect(await within(tuning).findByTestId('engine-trip-time')).toHaveTextContent(
      'This trip takes',
    );
    expect(within(tuning).getByTestId('engine-trip-fuel')).toHaveTextContent(
      'needs 20, you carry 25',
    );
    expect(within(tuning).getByTestId('engine-clean')).toHaveTextContent('100%');
    // pushing the chemical engines changes the figures and the odds, before anything is sent
    fireEvent.change(within(tuning).getByRole('slider', { name: 'Chemical engines' }), {
      target: { value: '1.5' },
    });
    await waitFor(() =>
      expect(within(tuning).getByTestId('engine-clean')).toHaveTextContent('80%'),
    );
    expect(within(tuning).getByTestId('engine-trip-fuel')).toHaveTextContent('needs 30');
    expect(await within(tuning).findByRole('alert')).toHaveTextContent(
      'more fuel than the ship carries',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Dispatch' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ missionId: 'm-1' });
  });

  it('dispatches the accepted mission and flips to the in-transit view', async () => {
    renderWithRouter(routes, { initialEntries: ['/transit'] });

    expect(await screen.findByText('Mission accepted — ready for departure.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }));

    const view = await screen.findByTestId('in-transit');
    expect(view).toBeInTheDocument();
    // the trip column carries the scene: it moves while the ship is under way
    expect(within(screen.getByTestId('transit-aside')).getByTestId('transit-scene')).toHaveClass(
      'moving',
    );
    expect(screen.getByTestId('briefing')).toBeInTheDocument();
    expect(screen.getAllByRole('timer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Leg 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Leg 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Porto Ceres → Portão Kessler')).toBeInTheDocument();
    expect(screen.getByText('Portão Kessler → Base Hedus')).toBeInTheDocument();
    expect(screen.getAllByText('Awaiting the next window')).toHaveLength(1);
    // Round-10 owner follow-up ("too big, show the quest details"): the current leg's own
    // status now carries a real countdown to when THAT leg ends, not just a bare "Arrives
    // in" label with no value — one of the two timers on screen belongs to it.
    const currentLeg = screen.getByText('Leg 1 of 2').closest('li')!;
    expect(within(currentLeg).getByText(/Arrives in/)).toBeInTheDocument();
    expect(within(currentLeg).getByRole('timer')).toBeInTheDocument();
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

  // Round-10 owner follow-up: "the quest panels... is too big, they too much space and
  // don't show enough information" — a single-leg trip has nothing an itinerary box would
  // add over one compact status line, so the per-leg list (and its redundant single entry)
  // is dropped entirely for that case.
  it('a single-leg trip shows one compact status line instead of a redundant one-item itinerary', async () => {
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
    expect(
      within(inTransit).getByText(/Now flying Porto Ceres → Portão Kessler/),
    ).toBeInTheDocument();
    expect(within(inTransit).getByText(/Arrives in/)).toBeInTheDocument();
    expect(within(inTransit).getByRole('timer')).toBeInTheDocument();
    // No itinerary list at all: one leg has nothing left to itemize.
    expect(within(inTransit).queryByText('Leg 1 of 1')).toBeNull();
    expect(within(inTransit).queryByRole('list')).toBeNull();
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
    // mission" link next to the Ship/Board/Port tabs, going straight to its report.
    // (Embedded, the old "Back to the map" shortcut is gone — Map is always one click away
    // in the persistent GameNav now.)
    const reportLink = await screen.findByRole('link', { name: 'Last mission' });
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
    expect(await screen.findByRole('link', { name: 'Last mission' })).toHaveAttribute(
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
    expect(await screen.findByRole('link', { name: 'Last mission' })).toHaveAttribute(
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
