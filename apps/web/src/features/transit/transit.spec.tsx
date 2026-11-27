import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { resetActiveState, resetEconomyState } from '../../test/msw/handlers';
import { routes } from '../../app/router';
import type { ActiveMission } from '../../api/generated';
import i18n from '../../i18n';
import { invalidateShip } from '../ship/invalidate-ship';

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

  it('dispatch waits for a slider change that is not saved yet: the levels go first, then the launch', async () => {
    const order: string[] = [];
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json([mission({ type: 'DELIVERY' })], { status: 200 }),
      ),
      http.post('/v1/ships/:id/engine-levels', async ({ request }) => {
        const body = (await request.json()) as { chem: number; ion: number };
        order.push(`levels ${body.chem}/${body.ion}`);
        return HttpResponse.json({ id: 'ship-1', engineLevels: body }, { status: 200 });
      }),
      http.post('/v1/ships/:id/dispatch', () => {
        order.push('dispatch');
        return HttpResponse.json({ missionId: 'm-1', arrivalAt: iso(60_000), serverTime: iso(0) });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Engine tuning' }));
    const tuning = await screen.findByTestId('engine-tuning');
    fireEvent.focus(within(tuning).getByRole('button', { name: 'Help' }));
    expect(within(tuning).getByRole('tooltip')).toHaveClass('kit-tip-card--end');
    const slider = await within(tuning).findByRole('slider', { name: 'Ion engines' });
    fireEvent.change(slider, { target: { value: '2.5' } });
    // launched at once, well before the slider's own delayed save would fire
    fireEvent.click(await screen.findByRole('button', { name: 'Dispatch' }));
    await waitFor(() => expect(order).toContain('dispatch'));
    expect(order[0]).toBe('levels 1/2.5');
    expect(order.indexOf('dispatch')).toBeGreaterThan(order.indexOf('levels 1/2.5'));
  });

  it('the accepted mission shows the engine levels the trip will fly with', async () => {
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json(
          [
            mission({
              info: {
                title: { en: 'Ceres run', 'pt-BR': 'Rota de Ceres' },
                description: { en: 'Deliver.', 'pt-BR': 'Entregar.' },
                legCount: 1,
                totalDistance: 400,
                peakDanger: 1,
                peakZone: 0,
                estimate: { durationSeconds: 100, fuelNeeded: 4 },
                material: null,
                requirements: [],
                race: null,
                mining: null,
              },
            }),
          ],
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    expect(await screen.findByTestId('mcard-engines')).toHaveTextContent(
      'Engines: chemical 100% · ion 100%',
    );
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
                mining: null,
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
    expect(within(card).getByText('700 units')).toBeInTheDocument();
    // what it demands, with what is met and what is not
    expect(within(card).getByText(/Cargo capacity for this load/)).toBeInTheDocument();
    expect(within(card).getByText(/At least one installed weapon/)).toBeInTheDocument();
    // fuel against what the ship carries
    expect(within(card).getByRole('progressbar', { name: 'Fuel needed' })).toBeInTheDocument();
    // the start deadline, and no "can you take it" verdict (it is already taken)
    expect(within(card).getByText(/Start before/)).toBeInTheDocument();
    expect(within(card).queryByText('Eligible')).not.toBeInTheDocument();
  });

  describe('where the accepted mission is shown', () => {
    const withInfo = () =>
      mission({
        info: {
          title: { en: 'Ceres run', 'pt-BR': 'Rota de Ceres' },
          description: { en: 'Deliver cargo from Ceres to Hedus.', 'pt-BR': 'Entregar.' },
          legCount: 1,
          totalDistance: 400,
          peakDanger: 1,
          peakZone: 0,
          estimate: { durationSeconds: 100, fuelNeeded: 4 },
          material: null,
          requirements: [],
          race: null,
          mining: null,
        },
      });

    it('on the Port tabs there is no mission summary above the lists', async () => {
      server.use(
        http.get('/v1/missions/active', () => HttpResponse.json([withInfo()], { status: 200 })),
      );
      renderWithRouter(routes, { initialEntries: ['/hangar/port'] });
      await screen.findByRole('tab', { name: 'Market' });
      expect(screen.queryByText('Ceres run')).not.toBeInTheDocument();
    });

    it('on the Board it appears once (pinned), not twice', async () => {
      server.use(
        http.get('/v1/missions/active', () => HttpResponse.json([withInfo()], { status: 200 })),
      );
      renderWithRouter(routes, { initialEntries: ['/hangar/board'] });
      await screen.findByTestId('board-active-mission');
      // the pinned row's title and the same mission's card behind its Details: never a second listing
      expect(screen.getAllByText('Ceres run')).toHaveLength(2);
    });

    it('on the Ship tab it is the My Ship summary', async () => {
      server.use(
        http.get('/v1/missions/active', () => HttpResponse.json([withInfo()], { status: 200 })),
      );
      renderWithRouter(routes, { initialEntries: ['/hangar'] });
      expect(await screen.findByText('Ceres run')).toBeInTheDocument();
      expect(screen.getAllByText('Ceres run')).toHaveLength(1);
    });
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

  it('a flight shows a compact hold chip that opens the hold view', async () => {
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json(
          [
            mission({
              status: 'IN_TRANSIT',
              arrivalAt: iso(60_000),
              info: {
                title: { en: 'Ceres run', 'pt-BR': 'Rota de Ceres' },
                description: { en: 'Haul.', 'pt-BR': 'Carga.' },
                legCount: 1,
                totalDistance: 400,
                peakDanger: 1,
                peakZone: 0,
                estimate: null,
                material: null,
                requirements: [],
                mining: null,
                race: null,
                cargo: { mode: 'fixed', need: 8, unitPay: 0 },
              },
            }),
          ],
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    const chip = await screen.findByTestId('hold-chip');
    expect(chip).toHaveTextContent(/Cargo/);
    expect(chip).toHaveTextContent(/8 \/ 10/);
    expect(chip).toHaveAttribute('aria-controls', 'ship-hold');
    expect(screen.getByTestId('ship-tab-ship')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('hold-panel')).toBeNull();
    fireEvent.click(chip);
    const panel = await screen.findByTestId('hold-panel');
    expect(panel).toHaveAttribute('role', 'tabpanel');
    // the panel is a sibling of the yard layout that a phone hides while the ship flies
    expect(panel.closest('.hangar-layout')).toBeNull();
    expect(screen.getByTestId('ship-tab-hold')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(document.activeElement).toBe(panel));
    // the tabs alternate: back to the ship details hides the hold
    fireEvent.click(screen.getByTestId('ship-tab-ship'));
    expect(screen.queryByTestId('hold-panel')).toBeNull();
    fireEvent.click(chip);
    expect(await screen.findByTestId('goods-ore')).toBeInTheDocument();
  });

  it('a mining run shows its ore space on the chip, not cargo units', async () => {
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json(
          [
            mission({
              type: 'MINING',
              status: 'IN_TRANSIT',
              arrivalAt: iso(60_000),
              info: {
                title: { en: 'Ceres run', 'pt-BR': 'Rota de Ceres' },
                description: { en: 'Haul.', 'pt-BR': 'Carga.' },
                legCount: 1,
                totalDistance: 400,
                peakDanger: 1,
                peakZone: 0,
                estimate: null,
                material: null,
                requirements: [],
                mining: {
                  required: 1,
                  materialId: 'iron',
                  expectedSeconds: 60,
                  capSeconds: 120,
                  successChance: 0.9,
                  spaceUnits: 20,
                },
                race: null,
                cargo: { mode: 'fixed', need: 8, unitPay: 0 },
              },
            }),
          ],
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    const chip = await screen.findByTestId('hold-chip');
    expect(chip).toHaveTextContent(/Ore space/);
    expect(chip).toHaveTextContent(/20/);
  });

  it('a race in flight shows the projected order after the last finished leg', async () => {
    const leg = (rows: Array<[string, boolean]>) => ({
      standings: rows.map(([name, you], index) => ({
        name,
        you,
        legSeconds: 100,
        totalSeconds: 100 * (index + 1),
        trouble: false,
      })),
    });
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json(
          [
            mission({
              type: 'RACE',
              status: 'IN_TRANSIT',
              arrivalAt: iso(60_000),
              legWindows: [
                { legIndex: 0, routeId: 'ceres-gate', from: iso(-120_000), to: iso(-60_000) },
                { legIndex: 1, routeId: 'gate-hedus', from: iso(-60_000), to: iso(60_000) },
              ],
              cargo: { race: { competitors: [{ id: 'r1', name: 'Vega Dart', mobility: 4.1 }] } },
              info: {
                title: { en: 'Ceres run', 'pt-BR': 'Rota de Ceres' },
                description: { en: 'Race.', 'pt-BR': 'Corrida.' },
                legCount: 2,
                totalDistance: 800,
                peakDanger: 1,
                peakZone: 0,
                estimate: null,
                material: null,
                requirements: [],
                mining: null,
                race: {
                  rivals: [],
                  you: null,
                  minMobility: 1,
                  prizeShares: [1.6, 0.8, 0.4],
                  projection: [
                    leg([
                      ['', true],
                      ['Vega Dart', false],
                    ]),
                    leg([
                      ['Vega Dart', false],
                      ['', true],
                    ]),
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
    const box = await screen.findByTestId('race-projection');
    // the first leg is finished, the second is not: the order is the one after leg 1
    const order = within(box)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(order[0]).toContain('You');
    expect(order[1]).toContain('Vega Dart');
    expect(box).toHaveTextContent('The race so far (projected)');
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
    fireEvent.click(await screen.findByRole('button', { name: 'Engine tuning' }));
    const tuning = await screen.findByTestId('engine-tuning');
    expect(await within(tuning).findByTestId('engine-trip-time')).toHaveTextContent(
      'This trip takes',
    );
    expect(within(tuning).getByTestId('engine-trip-fuel')).toHaveTextContent(
      'needs 20, you carry 25',
    );
    expect(within(tuning).getByTestId('engine-clean')).toHaveTextContent('100%');
    // where the thrust comes from, so fuel and ion can be balanced against the trip
    const thrust = within(tuning).getByTestId('engine-thrust');
    expect(within(thrust).getByTestId('engine-thrust-chem')).toHaveTextContent('Chemical engines');
    expect(within(thrust).getByTestId('engine-thrust-ion')).toHaveTextContent('Ion engines');
    expect(within(thrust).getByRole('img')).toHaveAccessibleName(
      /Chemical 63% · Ion 38% of the thrust/,
    );
    // pushing the chemical engines changes the figures and the odds, before anything is sent
    fireEvent.change(within(tuning).getByRole('slider', { name: 'Chemical engines' }), {
      target: { value: '1.5' },
    });
    await waitFor(() =>
      expect(within(tuning).getByTestId('engine-clean')).toHaveTextContent('80%'),
    );
    expect(within(tuning).getByTestId('engine-trip-fuel')).toHaveTextContent('needs 30');
    // pushing costs wear even when nothing fails: the panel says how much per leg
    expect(within(tuning).getByTestId('engine-wear')).toHaveTextContent('chemical engines −2');
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

  describe('not-eligible', () => {
    const blocked = {
      eligible: false,
      reasons: [
        { code: 'NO_ENGINE', message: 'The ship has no working engine.' },
        { code: 'NEEDS_CARGO', message: 'Needs more cargo space.' },
      ],
    };

    it('shows the not-eligible notice and disables Dispatch when the active mission says eligible: false', async () => {
      server.use(
        http.get('/v1/missions/active', () =>
          HttpResponse.json([mission({ eligibility: blocked })], { status: 200 }),
        ),
      );
      renderWithRouter(routes, { initialEntries: ['/transit'] });

      const notice = await screen.findByTestId('transit-not-eligible');
      expect(notice).toHaveTextContent(
        "Your ship no longer meets this mission's needs. Fix the ship, or abandon the mission.",
      );
      // a viability code is spoken from the translations (not the server's English message), as a list
      expect(notice).toHaveTextContent('No engine installed.');
      expect(notice).not.toHaveTextContent('The ship has no working engine.');
      expect(notice).not.toHaveTextContent('board.requirements.');
      expect(notice).not.toHaveTextContent('hangar.problems.');
      expect(within(notice).getAllByRole('listitem')).toHaveLength(2);
      expect(screen.getByRole('button', { name: /dispatch/i })).toBeDisabled();
    });

    it('speaks the reasons in pt-BR', async () => {
      try {
        server.use(
          http.get('/v1/missions/active', () =>
            HttpResponse.json([mission({ eligibility: blocked })], { status: 200 }),
          ),
        );
        renderWithRouter(routes, { initialEntries: ['/transit'] });

        const notice = await screen.findByTestId('transit-not-eligible');
        // switched after sign-in: the session's own locale would otherwise win on load
        await act(() => i18n.changeLanguage('pt-BR'));
        expect(notice).toHaveTextContent('Nenhum motor instalado.');
        expect(notice).not.toHaveTextContent('The ship has no working engine.');
      } finally {
        await i18n.changeLanguage('en');
      }
    });

    it('a refused dispatch refetches the active list', async () => {
      let activeCalls = 0;
      server.use(
        http.get('/v1/missions/active', () => {
          activeCalls += 1;
          return HttpResponse.json([mission()], { status: 200 });
        }),
        http.post('/v1/ships/:id/dispatch', () =>
          HttpResponse.json({ error: { code: 'SHIP_NOT_VIABLE', message: 'no' } }, { status: 409 }),
        ),
      );
      renderWithRouter(routes, { initialEntries: ['/transit'] });

      await screen.findByText('Mission accepted — ready for departure.');
      const before = activeCalls;
      fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }));
      await waitFor(() => expect(activeCalls).toBeGreaterThan(before));
    });

    it('enables Dispatch when eligible: true', async () => {
      server.use(
        http.get('/v1/missions/active', () =>
          HttpResponse.json([mission({ eligibility: { eligible: true, reasons: [] } })], {
            status: 200,
          }),
        ),
      );
      renderWithRouter(routes, { initialEntries: ['/transit'] });

      await screen.findByText('Mission accepted — ready for departure.');
      expect(screen.queryByTestId('transit-not-eligible')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /dispatch/i })).toBeEnabled();
    });

    it('after the ship changes the card refetches and the notice goes away', async () => {
      let eligible = false;
      server.use(
        http.get('/v1/missions/active', () =>
          HttpResponse.json(
            [mission({ eligibility: eligible ? { eligible: true, reasons: [] } : blocked })],
            { status: 200 },
          ),
        ),
      );
      const { queryClient } = renderWithRouter(routes, { initialEntries: ['/transit'] });

      await screen.findByTestId('transit-not-eligible');
      eligible = true;
      act(() => invalidateShip(queryClient));
      await waitFor(() =>
        expect(screen.queryByTestId('transit-not-eligible')).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('button', { name: /dispatch/i })).toBeEnabled();
    });

    it('no notice for a mission without eligibility (older server)', async () => {
      server.use(
        http.get('/v1/missions/active', () => HttpResponse.json([mission()], { status: 200 })),
      );
      renderWithRouter(routes, { initialEntries: ['/transit'] });

      await screen.findByText('Mission accepted — ready for departure.');
      expect(screen.queryByTestId('transit-not-eligible')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /dispatch/i })).toBeEnabled();
    });
  });

  it('flags an accepted mission whose start deadline has passed and refuses to dispatch it', async () => {
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json([mission({ deadlineAt: iso(-60 * 1000) })], { status: 200 }),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/transit'] });

    await screen.findByTestId('transit-start-deadline-passed');
    expect(screen.getByTestId('transit-start-deadline-passed')).toHaveTextContent(
      'The start deadline has passed',
    );
    expect(screen.getByRole('button', { name: 'Dispatch' })).toBeDisabled();
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

  it.each([
    [false, 0],
    [true, 1],
  ])(
    'a mining job with contracted=%s: the trip map is shown only for a contracted mission (a free job digs where the ship is docked)',
    async (contracted, maps) => {
      server.use(
        http.get('/v1/missions/active', () =>
          HttpResponse.json(
            [
              mission({
                type: 'MINING',
                status: 'IN_TRANSIT',
                shipId: 'ship-1',
                originId: 'ceres',
                destinationId: contracted ? 'hedus' : 'ceres',
                cargo: { materialId: 'common_ore', contracted },
                arrivalAt: iso(10 * 60 * 1000),
                legWindows: [
                  {
                    legIndex: 0,
                    routeId: 'ceres-gate',
                    from: iso(-1 * 60 * 1000),
                    to: iso(10 * 60 * 1000),
                  },
                ],
              }),
            ],
            { status: 200 },
          ),
        ),
      );
      renderWithRouter(routes, { initialEntries: ['/transit'] });
      await screen.findByTestId('in-transit');
      await waitFor(() => expect(screen.queryAllByTestId('route-map')).toHaveLength(maps));
      // a free job says what it is doing and where, not a flight between two places
      if (!contracted) {
        expect(
          within(screen.getByTestId('in-transit')).getByText(/Mining in Porto Ceres/),
        ).toBeInTheDocument();
        expect(screen.queryByText(/Now flying/)).not.toBeInTheDocument();
      }
    },
  );

  it('the trip progress bar advances on its own, without any interaction', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Freeze the trip window relative to a fixed base: the active-mission poll refetches this
      // endpoint, and re-deriving `iso()` from Date.now() on each hit would recenter the window
      // on "now" and pin the bar at ~50% no matter how far the clock advanced.
      const base = Date.now();
      const at = (offsetMs: number) => new Date(base + offsetMs).toISOString();
      server.use(
        http.get('/v1/missions/active', () =>
          HttpResponse.json(
            [
              mission({
                status: 'IN_TRANSIT',
                shipId: 'ship-1',
                arrivalAt: at(30 * 1000),
                // A one-minute window centred on the base time: the bar sits at ~50% and must
                // walk up as the ticker advances the clock past it.
                legWindows: [
                  {
                    legIndex: 0,
                    routeId: 'ceres-gate',
                    from: at(-30 * 1000),
                    to: at(30 * 1000),
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
      const before = Number(
        within(inTransit).getByRole('progressbar').getAttribute('aria-valuenow'),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      const after = Number(
        within(inTransit).getByRole('progressbar').getAttribute('aria-valuenow'),
      );
      expect(after).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
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

  it('takes the pilot to the report of a flight that was over before the page ever saw it in the air', async () => {
    // a flight of a few seconds (the first one, to the test pad): by the time the lists are read again the mission is
    // gone from the active list and its report is stored
    let dispatched = false;
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json(dispatched ? [] : [mission()], { status: 200 }),
      ),
      http.post('/v1/ships/:id/dispatch', () => {
        dispatched = true;
        return HttpResponse.json({ missionId: 'm-1', arrivalAt: iso(-1000), serverTime: iso(0) });
      }),
      http.get('/v1/reports', () =>
        HttpResponse.json(
          {
            items: dispatched
              ? [
                  {
                    missionId: 'm-1',
                    outcome: 'success',
                    credits: 10,
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
    const { router } = renderWithRouter(routes, { initialEntries: ['/transit'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Dispatch' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/report/m-1'));
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
  it('takes the pilot to the report from another screen (the Map) when the flight ends', async () => {
    const endsAt = Date.now() + 4000;
    server.use(
      http.get('/v1/missions/active', () =>
        Date.now() < endsAt
          ? HttpResponse.json(
              [{ ...mission(), status: 'IN_TRANSIT', arrivalAt: iso(endsAt - Date.now()) }],
              { status: 200 },
            )
          : HttpResponse.json([], { status: 200 }),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/map'] });
    expect(
      await screen.findByRole('heading', { name: 'Mission report' }, { timeout: 12_000 }),
    ).toBeInTheDocument();
  }, 20_000);
});
