import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import {
  classicSquareCells,
  resetBoardState,
  resetActiveState,
  ship,
} from '../../test/msw/handlers';
import { routes } from '../../app/router';
import { BALANCED_PROFILE } from '../../test/ship-profile-fixture';

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

async function renderBoard(extra = ''): Promise<void> {
  // Board is a nested route now (owner request: the old Ship/Port/Board switcher duplicated the
  // top nav and got removed) — land on it directly instead of clicking a tab that no longer
  // exists.
  renderWithRouter(routes, { initialEntries: [`/hangar/board${extra}`] });
  await screen.findByRole('heading', { name: 'My Ship' });
  // Board's own type-filter chips only render once its offers have loaded.
  await screen.findByRole('tab', { name: /^All missions/ });
}

const bareOffer = (id: string) => ({
  id,
  templateId: `tpl-${id}`,
  type: 'DELIVERY',
  factionId: 'luna',
  originId: 'ceres',
  destinationId: 'gate',
  legs: [],
  cargo: {},
  reward: 900,
  expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  status: 'AVAILABLE',
  playerId: null,
  privatePlayerId: null,
  shipId: null,
  acceptedAt: null,
  arrivalAt: null,
  deadlineAt: null,
  seed: `seed-${id}`,
  version: 1,
  rewardEstimate: 900,
  info: {
    title: { en: id, 'pt-BR': id },
    description: { en: 'A run.', 'pt-BR': '' },
    legCount: 1,
    totalDistance: 300,
    peakDanger: 2,
    peakZone: 0,
    estimate: { durationSeconds: 100, fuelNeeded: 8 },
    material: null,
    requirements: [],
    race: null,
  },
});

describe('board (S10.6)', () => {
  beforeEach(() => {
    resetBoardState();
    // An earlier test (accept/dispatch) can leave an accepted mission behind; that active
    // mission — not the board list — is what was actually leaking into later tests here.
    resetActiveState();
    server.use(onboarded());
  });

  it('renders offers with eligibility, blocked reasons and type filters', async () => {
    await renderBoard();
    // "Only eligible" defaults on and would hide the blocked offer this test checks; turn it
    // off first.
    fireEvent.click(screen.getByRole('button', { name: 'Only eligible' }));

    // Each offer says what the job is (title), where it goes, and what it needs.
    expect((await screen.findAllByText('Corporate Delivery')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Deliver sealed cargo to the destination.').length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText('Flight time').length).toBeGreaterThan(0);
    expect(screen.getAllByText('You need:').length).toBeGreaterThan(0);
    // the verdict is in the card behind Details; the row says what stops the pilot, once
    expect(screen.getAllByText('Eligible')).toHaveLength(3);
    expect(screen.getAllByText('Blocked')).toHaveLength(1);
    // MINER is now shown via the requirement checklist ("A mining rig installed", unmet),
    // not the old failure-only sentence; MOB_TOO_LOW is a general viability reason and still
    // uses the old reasons list.
    expect(screen.getAllByText('A mining rig installed').length).toBeGreaterThan(0);
    // (said once above the list, and again in the card)
    expect(screen.getAllByText('Mobility too low').length).toBeGreaterThan(0);
    expect(screen.getAllByText('On hold').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1,200 ¢').length).toBeGreaterThan(0);

    expect(document.querySelectorAll('.mcard')).toHaveLength(4);
    fireEvent.click(screen.getByRole('tab', { name: /^Mining/ }));
    expect(document.querySelectorAll('.mcard')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: /^All missions/ }));
    expect(document.querySelectorAll('.mcard')).toHaveLength(4);
  });

  // Round-10 owner request ("show destination area controller in quests, hover on place
  // name"): the destination's controlling faction, as a native title tooltip on its name.
  it('hovers the destination place name to show its controlling faction', async () => {
    await renderBoard();
    // b-1 (Corporate Delivery) goes to 'gate', which the fixture world controls under 'sun'.
    // the row's route and the card behind Details both name it; the card carries the faction title
    const names = await screen.findAllByText('Portão Kessler');
    expect(names.some((name) => name.getAttribute('title') === 'Controlled by Sun Traders')).toBe(
      true,
    );
  });

  // Round-10 owner request: "show the requirements for the mission, in a clear way, not
  // only the text" — a full met/unmet checklist (fixture b-3, MINING) instead of the old
  // one-line "needs" sentence, and no duplicate text with the blocked-reasons list below.
  it('shows the full requirement checklist, met and unmet, without duplicating blocked reasons', async () => {
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Only eligible' }));

    // MOB_TOO_LOW is a general viability reason (not a mission requirement), unique to the
    // mining card's fixture — use it to find the card itself.
    const miningCard = (await screen.findAllByText('Mobility too low'))
      .map((node) => node.closest('article'))
      .find((article) => article !== null);
    expect(miningCard).not.toBeNull();
    const card = within(miningCard!);

    // Checklist entry, unmet: a cross/warn marker, with wording that still reads sensibly
    // next to either a check or a cross (not the failure-phrased "Needs a mining system",
    // which would read self-contradictory next to a ✓ on the met case below).
    expect(card.getByText('A mining rig installed').closest('li')).toHaveClass('req-unmet');
    // Checklist entry, met: the same requirement set also lists what the ship DOES satisfy,
    // not only what blocks it.
    expect(card.getByText('Cargo capacity for this load').closest('li')).toHaveClass('req-met');
    // The real numbers, the ship against the mission: cargo as it is, mobility on the display
    // scale (x10) like the ship sheet.
    expect(card.getByTestId('req-MINER')).toHaveTextContent('Your ship: 0 · needs 1');
    expect(card.getByTestId('req-CARGO_TYPE')).toHaveTextContent('Your ship: 10 · needs 5');
    expect(card.getByTestId('req-MIN_MOBILITY')).toHaveTextContent('Your ship: 11 · needs 15');
    // The old failure-only message for MINER must not also appear — it is now fully replaced
    // by the checklist entry for that same code, not duplicated alongside it.
    expect(screen.queryByText('Needs a mining system')).toBeNull();
    // once as the row's chip, once in the card behind Details
    expect(screen.getAllByText(/A mining rig installed/)).toHaveLength(2);
  });

  it('shows mining contract time, odds and a cargo warning when the contract exceeds ore space', async () => {
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Only eligible' }));

    const miningCard = (await screen.findAllByText('Mobility too low'))
      .map((node) => node.closest('article'))
      .find((article) => article !== null);
    expect(miningCard).not.toBeNull();
    const card = within(miningCard!);

    expect(card.getByTestId('mcard-mining-odds')).toHaveTextContent('about 40m 0s, 42% chance');
    expect(card.getByTestId('mcard-mining-cargo-warning')).toHaveTextContent(
      'needs more cargo (25 > 20 space)',
    );
  });

  it('a mining order says what is asked (the amount and the ore) and splits the time into flight and mining', async () => {
    const offers = (await (await fetch('/v1/locations/ceres/missions')).json()) as Array<{
      id: string;
      info: Record<string, unknown>;
    }>;
    server.use(
      http.get('/v1/locations/:id/missions', () =>
        HttpResponse.json(
          offers.map((offer) =>
            offer.id === 'b-3'
              ? {
                  ...offer,
                  info: {
                    ...offer.info,
                    material: {
                      name: { en: 'Iron', 'pt-BR': 'Ferro' },
                      contracted: true,
                      quantity: 25,
                    },
                    estimate: {
                      durationSeconds: 3000,
                      fuelNeeded: 10,
                      flightSeconds: 600,
                      digSeconds: 2400,
                    },
                  },
                }
              : offer,
          ),
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Only eligible' }));
    const miningCard = (await screen.findAllByText('Mobility too low'))
      .map((node) => node.closest('article'))
      .find((article) => article !== null);
    const card = within(miningCard!);
    expect(card.getByTestId('mcard-order')).toHaveTextContent('The order25 × Iron');
    expect(card.getByTestId('mcard-mining-odds')).toHaveTextContent(
      'Flight 10m 0s, then mining about 40m 0s · 42% to reach the amount',
    );
  });

  it('a paid mining offer that is not a contract also counts its dig after the flight', async () => {
    const offers = (await (await fetch('/v1/locations/ceres/missions')).json()) as Array<{
      id: string;
      info: Record<string, unknown>;
    }>;
    server.use(
      http.get('/v1/locations/:id/missions', () =>
        HttpResponse.json(
          offers.map((offer) =>
            offer.id === 'b-3'
              ? {
                  ...offer,
                  info: {
                    ...offer.info,
                    mining: null,
                    estimate: {
                      durationSeconds: 900,
                      fuelNeeded: 10,
                      flightSeconds: 600,
                      digSeconds: 300,
                    },
                  },
                }
              : offer,
          ),
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Only eligible' }));
    const miningCard = (await screen.findAllByText('Mobility too low'))
      .map((node) => node.closest('article'))
      .find((article) => article !== null);
    expect(within(miningCard!).getByTestId('mcard-mining-phases')).toHaveTextContent(
      'Flight 10m 0s, then digging 5m 0s on arrival',
    );
  });

  const exploreOffers = async (share: number, { refused = false, perTick = 6 } = {}) => {
    const offers = (await (await fetch('/v1/locations/ceres/missions')).json()) as Array<{
      id: string;
      info: Record<string, unknown>;
    }>;
    server.use(
      http.get('/v1/locations/:id/missions', () =>
        HttpResponse.json(
          offers.map((offer) =>
            offer.id === 'b-3'
              ? {
                  ...offer,
                  type: 'EXPLORE',
                  cargo: { area: 80 },
                  eligibility: { eligible: !refused, reasons: [] },
                  info: {
                    ...offer.info,
                    mining: null,
                    estimate: {
                      durationSeconds: 4200,
                      fuelNeeded: 10,
                      flightSeconds: 600,
                      scanSeconds: 3600,
                    },
                    explore: {
                      area: 80,
                      perTick,
                      ticks: 12,
                      capTicks: 12,
                      share,
                      scanSeconds: 3600,
                    },
                    specialty: {
                      stat: 'sensor',
                      need: 80,
                      have: 3.98,
                      minimum: 4,
                      factor: 1,
                      trips: null,
                      met: !refused,
                    },
                    requirements: [
                      {
                        code: 'SENSOR_STRENGTH',
                        message: 'Radar too weak',
                        met: !refused,
                        needed: 4,
                        actual: 3.98,
                        unit: 'sensor',
                      },
                    ],
                  },
                }
              : offer,
          ),
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Only eligible' }));
    const chip = (await screen.findAllByText(/Radar strength for this area/))[0]!;
    return within(chip.closest<HTMLElement>('li.mrow')!);
  };

  it('an explore offer says what the radar covers and in how long', async () => {
    const card = await exploreOffers(0.9);
    expect(card.getByTestId('mcard-explore')).toHaveTextContent(
      'Scan 80 units · your radar covers 90% in 1h 0m',
    );
    expect(card.getByTestId('mrow-explore')).toHaveTextContent('covers 90%');
    // the scan has no time multiplier: no specialty line
    expect(card.queryByTestId('mcard-specialty')).toBeNull();
    expect(card.queryByTestId('mrow-specialty')).toBeNull();
    expect(card.queryByTestId('mcard-mining')).toBeNull();
  });

  it('an explore offer short of the full area never reads 100%', async () => {
    const card = await exploreOffers(0.996);
    expect(card.getByTestId('mcard-explore')).toHaveTextContent('covers 99%');
  });

  it('a refused explore offer shows no scan line, and the radar chip leads to the store', async () => {
    const card = await exploreOffers(0.9, { refused: true });
    const link = card.getByRole('link', { name: /Radar strength for this area/ });
    expect(link).toHaveAttribute('href', '/ship?store=SENSOR');
    // the refused figure never reads equal to the needed one
    expect(link).toHaveTextContent('Your ship: 3.9 · needs 4');
    expect(card.queryByTestId('mcard-explore')).toBeNull();
    expect(card.queryByTestId('mrow-explore')).toBeNull();
  });

  it('a radar that covers nothing shows no scan line', async () => {
    const card = await exploreOffers(0, { perTick: 0 });
    expect(card.queryByTestId('mcard-explore')).toBeNull();
    expect(card.queryByTestId('mrow-explore')).toBeNull();
  });

  it('an open-cargo delivery says what the extra units pay', async () => {
    await renderBoard();
    const line = await screen.findByTestId('mcard-cargo');
    expect(line).toHaveTextContent('at least 3 units');
    expect(line).toHaveTextContent('beyond 3 pays 20');
  });

  it('only shows eligible offers by default, and the toggle brings the rest back', async () => {
    await renderBoard();
    // Default fixture: 3 eligible offers (b-1, b-2, b-4-held-but-mine-eligible) + 1 blocked
    // (b-3, mining). "Only eligible" starts on, so the board opens on the eligible-only view.
    await screen.findAllByText('Corporate Delivery');
    expect(screen.queryByText('Blocked')).toBeNull();
    expect(document.querySelectorAll('.mcard')).toHaveLength(3);

    const toggle = screen.getByRole('button', { name: 'Only eligible' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelectorAll('.mcard')).toHaveLength(4);
    expect(screen.getAllByText('Blocked')).toHaveLength(1);
  });

  it('says how many offers are open, sorts by reward first and can re-sort', async () => {
    await renderBoard();
    await screen.findAllByText('Corporate Delivery');
    expect(screen.getByText('Missions board · 4 open, 3 you can take')).toBeInTheDocument();
    const sort = screen.getByRole('combobox', { name: 'Sort' });
    expect(sort).toHaveValue('reward');
    const rewards = () =>
      Array.from(document.querySelectorAll('.mcard-reward')).map((node) =>
        Number((node.textContent ?? '').replace(/\D/g, '')),
      );
    const sorted = [...rewards()].sort((a, b) => b - a);
    expect(rewards()).toEqual(sorted);
    fireEvent.change(sort, { target: { value: 'expires' } });
    expect(document.querySelectorAll('.mcard')).toHaveLength(3);
  });

  it('accepts an eligible offer and moves on to the transit screen', async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    await renderBoard();
    // "Only eligible" defaults on and would hide the blocked offer this test's count expects.
    fireEvent.click(screen.getByRole('button', { name: 'Only eligible' }));

    const acceptButtons = await screen.findAllByRole('button', { name: /Accept|Locked/ });
    expect(acceptButtons).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: 'Locked' })).toHaveLength(1);
    // The board is sorted by reward now, so the first row may be the blocked one: take an enabled one.
    fireEvent.click(acceptButtons.find((button) => !button.hasAttribute('disabled')) as Element);

    // Embedded: accepting switches the host back to its own Ship view —
    // the just-accepted mission's travel summary appears there.
    await waitFor(
      () => expect(screen.getByRole('group', { name: 'Assembly yard' })).toBeInTheDocument(),
      { timeout: 4000 },
    );
    // the toast's one buzz, not a second one from the call site
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith([20, 40, 30]);
    delete (navigator as { vibrate?: unknown }).vibrate;
  });

  it('holds an offer and releases it again', async () => {
    await renderBoard();
    // "Only eligible" defaults on and would hide the blocked offer this test's count expects.
    fireEvent.click(screen.getByRole('button', { name: 'Only eligible' }));

    const holdButtons = await screen.findAllByRole('button', { name: 'Hold' });
    expect(holdButtons).toHaveLength(3);
    fireEvent.click(holdButtons[1] as Element);

    await waitFor(() => expect(screen.getAllByText('On hold')).toHaveLength(2));
    const releaseButtons = await screen.findAllByRole('button', { name: 'Release' });
    fireEvent.click(releaseButtons[0] as Element);

    await waitFor(() => expect(screen.getAllByText('On hold')).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: 'Hold' })).toHaveLength(3);
  });

  it('reads the board location from the query string', async () => {
    // The place banner is gone from the embedded board now (the ship stage at the top of My
    // Ship already shows it); what's left to check is that the query string actually drove
    // which location's offers were requested.
    const requested: string[] = [];
    server.use(
      http.get('/v1/locations/:id/missions', ({ params }) => {
        requested.push(String(params.id));
        return HttpResponse.json([], { status: 200 });
      }),
    );
    await renderBoard('?location=gate');
    await waitFor(() => expect(requested).toContain('gate'));
    expect(requested).not.toContain('ceres');
  });

  it('blocks Accept on every card while a scavenging run is going', async () => {
    server.use(
      http.get('/v1/ships', () =>
        HttpResponse.json(
          [
            {
              id: 'ship-1',
              ownerPlayerId: 'player-1',
              name: 'luna starter',
              fuel: 25,
              status: 'IN_PORT',
              currentLocationId: 'ceres',
              stance: 'NEUTRAL',
              layout: [],
              sheet: { fuelCap: 40 },
              shipClass: 'BALANCED',
              profile: BALANCED_PROFILE,
              profileModifier: null,
              yard: { cells: classicSquareCells() },
              activity: { kind: 'scavenging', until: null, missionId: 'm-1', repairUntil: null },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    await screen.findAllByText('Corporate Delivery');
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Scavenging…' })) {
      expect(button).toBeDisabled();
    }
  });

  it('says what you have, what the trip needs and what the tank holds, with a bar of the three', async () => {
    await renderBoard();
    await screen.findAllByText('Corporate Delivery');
    // Default fixture: ship has 25/40 fuel, every offer needs 8 — comfortably enough.
    const block = screen.getAllByTestId('mcard-fuel')[0]!;
    expect(block).toHaveAttribute('data-state', 'ok');
    expect(block).toHaveTextContent('Fuel: you have 25 · the trip needs 8 · tank 40');
    expect(block.querySelector('.fuel-need')).toHaveTextContent('8');
    expect(within(block).getByTestId('fuel-verdict')).toHaveTextContent('Enough');
    const bar = within(block).getByRole('progressbar', { name: 'Fuel needed' });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(bar).toHaveAttribute('aria-valuemax', '40');
    // an enough tank has nothing to fix: no action link
    expect(within(block).queryByRole('link')).toBeNull();
  });

  it('is amber and offers to refuel the missing amount when the tank could hold the trip but is short', async () => {
    server.use(
      http.get('/v1/ships', () =>
        HttpResponse.json(
          [
            {
              id: 'ship-1',
              ownerPlayerId: 'player-1',
              name: 'luna starter',
              fuel: 5,
              status: 'IN_PORT',
              currentLocationId: 'ceres',
              stance: 'NEUTRAL',
              layout: [],
              sheet: { fuelCap: 40 },
              shipClass: 'BALANCED',
              profile: BALANCED_PROFILE,
              profileModifier: null,
              yard: { cells: classicSquareCells() },
              activity: { kind: 'idle', until: null, missionId: null, repairUntil: null },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    await screen.findAllByText('Corporate Delivery');
    // the row flags the shortfall with a chip
    expect(screen.getAllByTestId('fuel-chip')[0]).toHaveAttribute('data-state', 'short');
    const block = screen.getAllByTestId('mcard-fuel')[0]!;
    expect(block).toHaveAttribute('data-state', 'short');
    // 5 aboard, the trip needs 8: short by 3, and refuelling fixes it
    expect(within(block).getByTestId('fuel-verdict')).toHaveTextContent('Short by 3');
    expect(within(block).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
    const refuel = within(block).getByRole('link', { name: 'Refuel 3' });
    expect(refuel).toHaveAttribute('href', '/port?tab=refuel&units=3');
  });

  it('is red and points to the tanks when the trip needs more than the tank can ever hold', async () => {
    server.use(
      http.get('/v1/ships', () =>
        HttpResponse.json(
          [
            {
              id: 'ship-1',
              ownerPlayerId: 'player-1',
              name: 'luna starter',
              fuel: 3,
              status: 'IN_PORT',
              currentLocationId: 'ceres',
              stance: 'NEUTRAL',
              layout: [],
              sheet: { fuelCap: 3 },
              shipClass: 'BALANCED',
              profile: BALANCED_PROFILE,
              profileModifier: null,
              yard: { cells: classicSquareCells() },
              activity: { kind: 'idle', until: null, missionId: null, repairUntil: null },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    await screen.findAllByText('Corporate Delivery');
    const block = screen.getAllByTestId('mcard-fuel')[0]!;
    expect(block).toHaveAttribute('data-state', 'tank');
    expect(within(block).getByTestId('fuel-verdict')).toHaveTextContent('Needs a bigger tank');
    // refuelling cannot fix it: the action is the market's tanks, not the Refuel tab
    expect(within(block).getByRole('link', { name: 'Find a bigger tank' })).toHaveAttribute(
      'href',
      '/port?tab=market',
    );
    expect(within(block).queryByRole('link', { name: /^Refuel/ })).toBeNull();
  });

  it('a pure-ion ship (no fuel burn) gets no fuel row at all on the cards', async () => {
    server.use(
      http.get('/v1/ships', () =>
        HttpResponse.json(
          [
            {
              id: 'ship-1',
              ownerPlayerId: 'player-1',
              name: 'luna starter',
              fuel: 0,
              status: 'IN_PORT',
              currentLocationId: 'ceres',
              stance: 'NEUTRAL',
              layout: [],
              sheet: { fuelCap: 0, fuelUse: 0 },
              shipClass: 'BALANCED',
              profile: BALANCED_PROFILE,
              profileModifier: null,
              yard: { cells: classicSquareCells() },
              activity: { kind: 'idle', until: null, missionId: null, repairUntil: null },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    await screen.findAllByText('Corporate Delivery');
    expect(document.querySelectorAll('.mcard-fuel')).toHaveLength(0);
    expect(screen.queryAllByRole('progressbar', { name: 'Fuel needed' })).toHaveLength(0);
    expect(screen.queryAllByText(/uses \d/)).toHaveLength(0);
  });

  it('shows the mission already taken at the top of the board, with all its details', async () => {
    const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json(
          [
            {
              id: 'taken-1',
              templateId: 'tpl-1',
              type: 'TRANSPORT',
              factionId: 'luna',
              originId: 'ceres',
              destinationId: 'hedus',
              legs: [],
              cargo: {},
              reward: 2100,
              expiresAt: iso(3_600_000),
              status: 'ACCEPTED',
              playerId: 'player-1',
              privatePlayerId: null,
              shipId: null,
              acceptedAt: iso(-60_000),
              arrivalAt: null,
              deadlineAt: null,
              seed: 's',
              version: 1,
              legWindows: [],
              brief: {
                title: { en: 'Ore to Hedus', 'pt-BR': 'Minério para Hedus' },
                description: { en: 'Haul ore.', 'pt-BR': 'Transportar minério.' },
              },
              info: {
                title: { en: 'Ore to Hedus', 'pt-BR': 'Minério para Hedus' },
                description: {
                  en: 'Haul ore to the Hedus garrison.',
                  'pt-BR': 'Transportar minério.',
                },
                legCount: 1,
                totalDistance: 500,
                peakDanger: 2,
                peakZone: 0,
                estimate: { durationSeconds: 90, fuelNeeded: 6 },
                material: null,
                requirements: [{ code: 'CARGO_TYPE', message: 'cargo', met: true }],
                race: null,
              },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();

    const pinned = await screen.findByTestId('board-active-mission');
    expect(within(pinned).getByText('Your mission')).toBeInTheDocument();
    expect(within(pinned).getAllByText('Ore to Hedus')[0]).toBeInTheDocument();
    expect(within(pinned).getByText('Haul ore to the Hedus garrison.')).toBeInTheDocument();
    expect(within(pinned).getAllByText('1m 30s').length).toBeGreaterThan(0);
    expect(within(pinned).getByRole('button', { name: 'Open on My Ship' })).toBeInTheDocument();
    // it is not offered again as something to accept
    expect(within(pinned).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('a row says nothing about fuel while the tank covers the trip', async () => {
    await renderBoard();
    await screen.findAllByText('Corporate Delivery');
    // 25 aboard, 8 needed, tank 40: no chip; the row's figure is just the amount
    expect(screen.queryAllByTestId('fuel-chip')).toHaveLength(0);
    expect(screen.getAllByText('uses 8 fuel').length).toBeGreaterThan(0);
  });

  it('the board shows a blocker chip per ship fault instead of the paragraph', async () => {
    server.use(
      http.get('/v1/locations/:id/missions', () =>
        HttpResponse.json(
          [
            {
              id: 'b-bad',
              templateId: 'tpl-b-bad',
              type: 'DELIVERY',
              factionId: 'luna',
              originId: 'ceres',
              destinationId: 'gate',
              legs: [],
              cargo: {},
              reward: 900,
              expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
              status: 'AVAILABLE',
              playerId: null,
              privatePlayerId: null,
              shipId: null,
              acceptedAt: null,
              arrivalAt: null,
              deadlineAt: null,
              seed: 'seed-bad',
              version: 1,
              rewardEstimate: 900,
              eligibility: {
                eligible: false,
                reasons: [{ code: 'STRUCTURE_EXCEEDED', message: 'Structure budget exceeded' }],
              },
              info: {
                title: { en: 'Blocked Run', 'pt-BR': 'Corrida Bloqueada' },
                description: { en: 'A run.', 'pt-BR': '' },
                legCount: 1,
                totalDistance: 300,
                peakDanger: 2,
                peakZone: 0,
                estimate: { durationSeconds: 100, fuelNeeded: 8 },
                material: null,
                requirements: [],
                race: null,
              },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    const faults = await screen.findByTestId('ship-faults');
    expect(within(faults).getByRole('button', { name: /Structure budget exceeded/ })).toBeVisible();
    expect(within(faults).getAllByRole('button')).toHaveLength(1);
    // the chips keep their context: a labelled group (not an alert)
    expect(faults).toHaveAttribute('role', 'group');
    expect(faults).toHaveAccessibleName(
      'Your ship cannot take missions. Each problem below leads to its fix.',
    );
    expect(screen.queryByText(/Your ship cannot take missions right now/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Fix it on the Ship screen/ })).toBeNull();
  });

  it('a chip jumps to the screen that fixes it', async () => {
    server.use(
      http.get('/v1/locations/:id/missions', () =>
        HttpResponse.json(
          [
            {
              id: 'b-bad',
              templateId: 'tpl-b-bad',
              type: 'DELIVERY',
              factionId: 'luna',
              originId: 'ceres',
              destinationId: 'gate',
              legs: [],
              cargo: {},
              reward: 900,
              expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
              status: 'AVAILABLE',
              playerId: null,
              privatePlayerId: null,
              shipId: null,
              acceptedAt: null,
              arrivalAt: null,
              deadlineAt: null,
              seed: 'seed-bad',
              version: 1,
              rewardEstimate: 900,
              eligibility: {
                eligible: false,
                reasons: [{ code: 'STRUCTURE_EXCEEDED', message: 'Structure budget exceeded' }],
              },
              info: {
                title: { en: 'Blocked Run', 'pt-BR': 'Corrida Bloqueada' },
                description: { en: 'A run.', 'pt-BR': '' },
                legCount: 1,
                totalDistance: 300,
                peakDanger: 2,
                peakZone: 0,
                estimate: { durationSeconds: 100, fuelNeeded: 8 },
                material: null,
                requirements: [],
                race: null,
              },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    const faults = await screen.findByTestId('ship-faults');
    fireEvent.click(within(faults).getByRole('button', { name: /Structure budget exceeded/ }));
    await waitFor(() => {
      expect(screen.queryByTestId('ship-faults')).toBeNull();
    });
  });

  it('each ship-wide chip leads to its own fix: a ship fault switches to the ship tab, a missing module goes to the store', async () => {
    const offer = (id: string, type: string, code: string) => ({
      id,
      templateId: `tpl-${id}`,
      type,
      factionId: 'luna',
      originId: 'ceres',
      destinationId: 'gate',
      legs: [],
      cargo: {},
      reward: 900,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      status: 'AVAILABLE',
      playerId: null,
      privatePlayerId: null,
      shipId: null,
      acceptedAt: null,
      arrivalAt: null,
      deadlineAt: null,
      seed: `seed-${id}`,
      version: 1,
      rewardEstimate: 900,
      eligibility: { eligible: false, reasons: [{ code, message: code }] },
      info: {
        title: { en: id, 'pt-BR': id },
        description: { en: 'A run.', 'pt-BR': '' },
        legCount: 1,
        totalDistance: 300,
        peakDanger: 2,
        peakZone: 0,
        estimate: { durationSeconds: 100, fuelNeeded: 8 },
        material: null,
        requirements: [],
        race: null,
      },
    });
    server.use(
      http.get('/v1/locations/:id/missions', () =>
        HttpResponse.json(
          [
            offer('x-1', 'DELIVERY', 'NO_BRIDGE'),
            offer('x-2', 'TRANSPORT', 'NO_LIFE_SUPPORT'),
            offer('x-3', 'TRAVEL', 'NO_BRIDGE'),
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    const faults = await screen.findByTestId('ship-faults');
    // the ship screen is the host's own tab here: a button that switches to it
    expect(within(faults).getByRole('button', { name: /No bridge/ })).toBeVisible();
    expect(within(faults).getByRole('link', { name: /No life support/ })).toHaveAttribute(
      'href',
      '/ship?store=UTILITY',
    );
    // the group says it once: no second paragraph repeating it
    expect(screen.queryByText(/cannot take missions right now/i)).toBeNull();
    expect(screen.queryAllByText(/Your ship cannot take missions/)).toHaveLength(0);
    // tabs: a count per kind, and the travel offer (no tab) still counted under All
    expect(screen.getByRole('tab', { name: 'All missions (3)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Delivery (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Travel/ })).toBeNull();
  });

  describe('an unassembled ship', () => {
    const unassembled = () =>
      http.get('/v1/ships', () => HttpResponse.json([{ ...ship(), layout: [] }]));
    const emptyShelf = () =>
      http.get('/v1/locations/:id/missions', () => HttpResponse.json([], { status: 200 }));
    const NOTICE = 'Your ship is not assembled';

    it('says so once when the shelf is empty (no offer carries a chip)', async () => {
      server.use(unassembled(), emptyShelf());
      await renderBoard();
      expect(await screen.findAllByText(NOTICE)).toHaveLength(1);
      expect(screen.queryByTestId('ship-faults')).toBeNull();
    });

    it('with offers, tells it in the chips (one per reason) and not in the notice', async () => {
      const blocked = (id: string, code: string) => ({
        ...bareOffer(id),
        eligibility: { eligible: false, reasons: [{ code, message: code }] },
      });
      server.use(
        unassembled(),
        http.get('/v1/locations/:id/missions', () =>
          HttpResponse.json([blocked('u-1', 'NO_BRIDGE'), blocked('u-2', 'NO_ENGINE')], {
            status: 200,
          }),
        ),
      );
      await renderBoard();
      const faults = await screen.findByTestId('ship-faults');
      expect(within(faults).getByRole('button', { name: /No bridge/ })).toBeVisible();
      expect(within(faults).getByRole('button', { name: /No engine/ })).toBeVisible();
      expect(screen.queryByText(NOTICE)).toBeNull();
    });

    it('an assembled ship with an empty shelf gets neither', async () => {
      server.use(emptyShelf());
      await renderBoard();
      expect(await screen.findByText('No offers at this location.')).toBeInTheDocument();
      expect(screen.queryByText(NOTICE)).toBeNull();
      expect(screen.queryByTestId('ship-faults')).toBeNull();
    });
  });

  it('no fault, no chips', async () => {
    server.use(
      http.get('/v1/locations/:id/missions', () => HttpResponse.json([], { status: 200 })),
    );
    await renderBoard();
    expect(screen.queryByTestId('ship-faults')).toBeNull();
  });

  it('keeps the fuel block out of the cramped facts grid, and hides a redundant equal estimate', async () => {
    server.use(
      http.get('/v1/locations/:id/missions', () =>
        HttpResponse.json(
          [
            {
              id: 'b-eq',
              templateId: 'tpl-b-eq',
              type: 'DELIVERY',
              factionId: 'luna',
              originId: 'ceres',
              destinationId: 'gate',
              legs: [],
              cargo: {},
              reward: 900,
              expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
              status: 'AVAILABLE',
              playerId: null,
              privatePlayerId: null,
              shipId: null,
              acceptedAt: null,
              arrivalAt: null,
              deadlineAt: null,
              seed: 'seed-eq',
              version: 1,
              // Same as reward — the "Est." line must not repeat it.
              rewardEstimate: 900,
              eligibility: { eligible: true, reasons: [] },
              info: {
                title: { en: 'Equal Estimate Run', 'pt-BR': 'Corrida com Estimativa Igual' },
                description: { en: 'Same numbers, no point saying it twice.', 'pt-BR': '' },
                legCount: 1,
                totalDistance: 300,
                peakDanger: 2,
                peakZone: 0,
                estimate: { durationSeconds: 100, fuelNeeded: 8 },
                material: null,
                requirements: [],
                race: null,
              },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    await screen.findAllByText('Equal Estimate Run');

    // the row's pay and the card's: the equal estimate adds no third one
    expect(screen.getAllByText('900 ¢')).toHaveLength(2);
    expect(screen.queryByText(/Est\. 900 ¢/)).toBeNull();

    // The facts grid (Distance/Legs/Flight time) no longer includes Fuel as a fourth column —
    // its gauge lives in its own full-width row, outside the grid.
    const factsGrid = document.querySelector<HTMLElement>('.mcard-facts')!;
    expect(within(factsGrid).queryByTestId('mcard-fuel')).toBeNull();
    const fuelRow = document.querySelector<HTMLElement>('.mcard-fuel')!;
    expect(fuelRow).not.toBeNull();
    // the fuel block sits right under the facts, above what the mission needs
    expect(factsGrid.nextElementSibling).toBe(fuelRow);
    expect(within(fuelRow).getByRole('progressbar', { name: 'Fuel needed' })).toBeInTheDocument();
  });

  it('warns on a mission whose trip needs more fuel than the tank holds (FUEL_CAPACITY row, unmet, with the numbers)', async () => {
    server.use(
      http.get('/v1/locations/:id/missions', () =>
        HttpResponse.json(
          [
            {
              id: 'b-eq',
              templateId: 'tpl-b-eq',
              type: 'DELIVERY',
              factionId: 'luna',
              originId: 'ceres',
              destinationId: 'gate',
              legs: [],
              cargo: {},
              reward: 900,
              expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
              status: 'AVAILABLE',
              playerId: null,
              privatePlayerId: null,
              shipId: null,
              acceptedAt: null,
              arrivalAt: null,
              deadlineAt: null,
              seed: 'seed-eq',
              version: 1,
              // Same as reward — the "Est." line must not repeat it.
              rewardEstimate: 900,
              eligibility: { eligible: true, reasons: [] },
              info: {
                title: { en: 'Far Haul', 'pt-BR': 'Carga Distante' },
                description: { en: 'Same numbers, no point saying it twice.', 'pt-BR': '' },
                legCount: 1,
                totalDistance: 300,
                peakDanger: 2,
                peakZone: 0,
                estimate: { durationSeconds: 100, fuelNeeded: 800 },
                material: null,
                requirements: [
                  {
                    code: 'FUEL_CAPACITY',
                    message: 'tank',
                    met: false,
                    needed: 800,
                    actual: 300,
                    unit: 'fuel',
                  },
                ],
                race: null,
              },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    await screen.findAllByText('Far Haul');

    // the checklist warns, with the numbers, instead of reading as if the requirements were met
    const row = (await screen.findAllByTestId('req-FUEL_CAPACITY'))[0]!;
    expect(row).toHaveTextContent('Your ship: 300 · needs 800');
    expect(row.closest('li')).toHaveClass('req-unmet');
    expect(row.closest('li')).toHaveTextContent('WARNING');
  });

  it("shows a race offer's field: every rival's speed and time, you ranked among them, and the prizes", async () => {
    server.use(
      http.get('/v1/locations/:id/missions', () =>
        HttpResponse.json(
          [
            {
              id: 'race-1',
              templateId: 'race_luna',
              type: 'RACE',
              factionId: 'luna',
              originId: 'ceres',
              destinationId: 'gate',
              legs: [],
              cargo: {},
              reward: 1600,
              expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
              status: 'AVAILABLE',
              playerId: null,
              privatePlayerId: null,
              shipId: null,
              acceptedAt: null,
              arrivalAt: null,
              deadlineAt: null,
              seed: 'seed-race',
              version: 1,
              rewardEstimate: 1600,
              eligibility: { eligible: true, reasons: [] },
              info: {
                title: { en: 'Luna Grand Prix', 'pt-BR': 'Grande Prêmio da Luna' },
                description: { en: 'Race the field.', 'pt-BR': '' },
                legCount: 1,
                totalDistance: 600,
                peakDanger: 2,
                peakZone: 0,
                estimate: { durationSeconds: 300, fuelNeeded: 8 },
                material: null,
                requirements: [{ code: 'RACE_SPEED', message: 'too slow', met: true }],
                race: {
                  rivals: [
                    {
                      name: 'Comet Runner',
                      mobility: 2.4,
                      durationSeconds: 700,
                      bestSeconds: 600,
                      worstSeconds: 900,
                    },
                    {
                      name: 'Vega Dart',
                      mobility: 4.1,
                      durationSeconds: 410,
                      bestSeconds: 350,
                      worstSeconds: 520,
                    },
                    {
                      name: 'Halo Sprint',
                      mobility: 3.1,
                      durationSeconds: 540,
                      bestSeconds: 470,
                      worstSeconds: 700,
                    },
                  ],
                  you: {
                    durationSeconds: 300,
                    bestSeconds: 280,
                    worstSeconds: 330,
                  },
                  minMobility: 2.5,
                  prizeShares: [1.6, 0.8, 0.4],
                },
              },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    const field = await screen.findByTestId('race-field');
    const rows = within(field).getAllByRole('row').slice(1);
    // fastest first; "You" (mobility 2, 300s via the estimate) slots in by its own time
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('You'),
      expect.stringContaining('Vega Dart'),
      expect.stringContaining('Halo Sprint'),
      expect.stringContaining('Comet Runner'),
    ]);
    // speeds on the display scale (x10), and the expected time next to the best day
    expect(within(field).getByText('41')).toBeInTheDocument();
    expect(within(field).getByText(/Entry: speed 25 or more/)).toBeInTheDocument();
    expect(within(field).getByRole('columnheader', { name: 'Expected' })).toBeInTheDocument();
    expect(within(field).getByRole('columnheader', { name: 'Best day' })).toBeInTheDocument();
    const vega = within(field)
      .getByText(/Vega Dart/)
      .closest('tr')!;
    expect(vega).toHaveTextContent('6m 50s'); // expected 410 s
    expect(vega).toHaveTextContent('5m 50s'); // best day 350 s
    expect(within(field).getByText(/1º 1,600 ¢/)).toBeInTheDocument();
    expect(within(field).getByText(/2º 800 ¢/)).toBeInTheDocument();
    expect(document.querySelector('.mcard-type')).toHaveTextContent('Race');
    expect(screen.getByRole('tab', { name: /^Race/ })).toBeInTheDocument(); // the type filter tab
  });

  it("labels the player's private start-safe mission (D43) and no shared offer", async () => {
    server.use(
      http.get('/v1/locations/:id/missions', () =>
        HttpResponse.json(
          [
            {
              id: 'starter-1',
              templateId: 'delivery_luna',
              type: 'DELIVERY',
              factionId: 'luna',
              originId: 'ceres',
              destinationId: 'tycho',
              legs: [],
              cargo: {},
              reward: 300,
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              status: 'AVAILABLE',
              playerId: null,
              privatePlayerId: 'player-1',
              shipId: null,
              acceptedAt: null,
              arrivalAt: null,
              deadlineAt: null,
              seed: 'starter|player-1|ceres|0',
              version: 0,
              rewardEstimate: 300,
              eligibility: { eligible: true, reasons: [] },
              info: {
                title: { en: 'First Steps', 'pt-BR': 'Primeiros Passos' },
                description: { en: 'An easy first run.', 'pt-BR': 'Uma primeira viagem fácil.' },
                legCount: 1,
                totalDistance: 400,
                peakDanger: 1,
                peakZone: 0,
                estimate: { durationSeconds: 120, fuelNeeded: 4 },
                material: null,
                requirements: [],
                race: null,
              },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    expect(await screen.findByTestId('starter-badge')).toHaveTextContent('Starter mission');
    expect(screen.getAllByTestId('starter-badge')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
  });

  describe('the escort home', () => {
    const escort = (state: string) =>
      http.get('/v1/ships/:id/escort', () =>
        HttpResponse.json({
          state,
          reasons: state === 'available' ? [] : ['NOT_STUCK'],
          destinationId: 'ceres',
          durationSeconds: 600,
          arrivesAt: null,
          nextAvailableAt: null,
        }),
      );

    it('is one small chip among the blockers, said once on the missions screen', async () => {
      server.use(escort('available'));
      await renderBoard();
      const chip = await screen.findByTestId('escort-chip');
      expect(within(screen.getByTestId('ship-faults')).getByTestId('escort-chip')).toBe(chip);
      expect(screen.getAllByText('Stuck? Call the escort home')).toHaveLength(1);
      // no card, and the title is not printed outside the popup
      expect(screen.queryByTestId('escort-offer')).toBeNull();
      expect(screen.queryByText('Stuck? An escort can take you home')).toBeNull();
    });

    it('opens the confirmation popup from the chip', async () => {
      server.use(escort('available'));
      await renderBoard();
      fireEvent.click(await screen.findByTestId('escort-chip'));
      expect(await screen.findByRole('button', { name: 'Yes, send the escort' })).toBeVisible();
    });

    it('shows no chip when the escort is not on offer', async () => {
      server.use(escort('unavailable'));
      await renderBoard();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(screen.queryByTestId('escort-chip')).toBeNull();
    });
  });
});
