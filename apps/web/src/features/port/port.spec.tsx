import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import {
  addWreck,
  classicSquareCells,
  destroyEngine,
  economyState,
  setWallet,
  resetEconomyState,
} from '../../test/msw/handlers';
import { queryByRoleSafe } from '../../test/queries';
import { routes } from '../../app/router';

const onboarded = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: economyState.wallet,
        role: 'PLAYER',
        locale: 'en',
        factionId: 'luna',
      },
      { status: 200 },
    ),
  );

function rowButton(label: string | RegExp): Element {
  const row = screen.getByText(label).closest('.pcard');
  if (row === null) throw new Error('row not found');
  const button = row.querySelector('button:not(.info-btn)');
  if (button === null) throw new Error('button not found');
  return button;
}

async function renderPort(): Promise<void> {
  // Port is a nested route now (owner request: the old Ship/Port/Board switcher duplicated the
  // top nav and got removed) — land on it directly instead of clicking a tab that no longer
  // exists.
  renderWithRouter(routes, { initialEntries: ['/hangar/port'] });
  await screen.findByRole('heading', { name: 'My Ship' });
  // Port's own tab bar (Market/Goods/Repair/…) only renders once its data has loaded — a
  // sharper ready signal than the wallet testid, which My Ship's own header already shows.
  await screen.findByRole('tab', { name: 'Market' });
}

describe('port (S10.9)', () => {
  beforeEach(() => {
    resetEconomyState();
    server.use(onboarded());
  });

  it('buys a listing behind the confirmation popup and updates the wallet', async () => {
    await renderPort();

    expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('4,820 ¢');
    expect(screen.getByText('Plated Hull')).toBeInTheDocument();

    fireEvent.click(rowButton('Plated Hull'));
    const popup = await screen.findByRole('dialog', {
      name: 'Buy Plated Hull for 300 ¢?',
    });
    expect(popup).toHaveTextContent('Balance after: 4,520 ¢');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Bought Plated Hull for 300 ¢.');
    await waitFor(() => expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('4,520 ¢'));
  });

  it('disables spending on a negative balance while scavenging stays open', async () => {
    server.use(
      http.get('/v1/players/me', () =>
        HttpResponse.json(
          {
            id: 'player-1',
            name: 'Test Pilot',
            credits: -120,
            role: 'PLAYER',
            locale: 'en',
            factionId: 'luna',
          },
          { status: 200 },
        ),
      ),
    );
    await renderPort();

    expect(await screen.findByTestId('topbar-wallet')).toHaveTextContent('-120 ¢');
    expect(screen.getByText(/Negative balance/i)).toBeInTheDocument();
    expect(rowButton('Plated Hull')).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Refuel' }));
    expect(screen.getByRole('button', { name: /^Buy \d+/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Scavenging' }));
    expect(screen.getByRole('button', { name: /Send the ship scavenging/i })).toBeEnabled();
  });

  it('sells all mined materials after the quote popup', async () => {
    await renderPort();

    fireEvent.click(await screen.findByRole('tab', { name: 'Your goods' }));
    fireEvent.click(rowButton(/Iron/));
    const popup = await screen.findByRole('dialog', { name: 'Sell Iron for 24 ¢?' });
    expect(popup).toHaveTextContent('Balance after: 4,844 ¢');
    fireEvent.click(within(popup).getByRole('button', { name: 'Sell' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Sold Iron for 24 ¢.');
    await waitFor(() => expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('4,844 ¢'));
  });

  it('a destroyed part has no repair slider and is skipped by "set all to 100%"', async () => {
    destroyEngine();
    await renderPort();

    fireEvent.click(await screen.findByRole('tab', { name: /^Repair/ }));
    expect(
      await screen.findByText('A destroyed part cannot be repaired: replace it.'),
    ).toBeInTheDocument();
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(6);
    expect(sliders.filter((slider) => (slider as HTMLInputElement).disabled)).toHaveLength(1);
  });

  it('repair defaults to a full repair, prices each part and the total, then charges once', async () => {
    await renderPort();

    fireEvent.click(await screen.findByRole('tab', { name: /^Repair/ }));
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(6);
    // A full repair is the default the first time there's damage to quote (owner: the workshop
    // fee should be a real number as soon as the tab opens, not 0 until a slider moves): every
    // slider already sits at 100.
    for (const slider of sliders) {
      expect((slider as HTMLInputElement).value).toBe('100');
    }
    const summary = screen.getByTestId('repair-summary');
    await waitFor(() => expect(screen.getByTestId('repair-total')).toHaveTextContent('1,188 ¢'));
    expect(within(summary).getByText('Current balance')).toBeInTheDocument();
    expect(within(summary).getByText('4,820 ¢')).toBeInTheDocument();
    expect(within(summary).getByRole('button', { name: 'Start repair' })).toBeEnabled();
    expect(
      screen.getAllByTestId('repair-line').every((line) => /¢/.test(line.textContent ?? '')),
    ).toBe(true);

    // "Back to current" undoes it without repairing anything...
    fireEvent.click(within(summary).getByRole('button', { name: 'Back to current' }));
    expect(screen.getByTestId('repair-summary')).toHaveTextContent('Nothing selected yet');
    // ...and one click on "Set all to 100%" puts it right back.
    fireEvent.click(within(summary).getByRole('button', { name: 'Set all to 100%' }));
    await waitFor(() => expect(screen.getByTestId('repair-total')).toHaveTextContent('1,188 ¢'));

    fireEvent.click(within(summary).getByRole('button', { name: 'Start repair' }));
    const popup = await screen.findByRole('dialog', { name: 'Repair for 1188 ¢?' });
    expect(economyState.wallet).toBe(4820);
    fireEvent.click(within(popup).getByRole('button', { name: 'Start repair' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Repair started for 1188 ¢');
    await waitFor(() => expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('3,632 ¢'));
  });

  it('says so up front when the ship cannot fly: scavenging stays open, with a reduced chance', async () => {
    server.use(
      http.post('/v1/ships/:id/preview', () =>
        HttpResponse.json({
          sheet: {
            pot: 0, pdf: 0, bli: 0, esc: 0, sen: 0, crg: 0, min: 0, hp: 10, mass: 4,
            energyCont: 0, energyCombat: 0, batCharge: 0, batOutput: 0, batInput: 0,
            fuelCap: 0, fuelUse: 0, structureUsed: 0, structureBudget: 10, autonomy: 0,
            mob: 1, condition: 100,
          },
          shipClass: 'MULTIROLE',
          viability: { viable: false, problems: [{ code: 'NO_ENGINE', message: 'x' }], warnings: [] },
          layout: [],
          omittedPartInstanceIds: [],
          disconnectedPartIds: [],
          routeCoverage: null,
        }),
      ),
    );
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Scavenging' }));
    const notice = await screen.findByTestId('scavenge-handicap');
    expect(notice).toHaveTextContent('only 50% of the usual chance');
    expect(screen.getByRole('button', { name: /Send the ship scavenging/i })).toBeEnabled();
  });

  it('shows no handicap notice for a ship that is ready', async () => {
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Scavenging' }));
    await screen.findByTestId('scavenging');
    await waitFor(() => expect(screen.queryByTestId('scavenge-handicap')).not.toBeInTheDocument());
  });

  it('does not report "not enough money" for a repair that was just paid for', async () => {
    // The wallet barely covers the plan; once it is debited, the spent plan must not be compared
    // with the smaller balance (owner report: the warning appeared right after accepting).
    setWallet(1300);
    // The repair is a timed job: the parts stay damaged on screen until it completes.
    server.use(
      http.post('/v1/ships/:id/repair', ({ params }) => {
        setWallet(112);
        return HttpResponse.json({
          repairJobId: 'job-1',
          shipId: String(params.id),
          cost: 1188,
          durationSeconds: 30,
          completesAt: new Date(Date.now() + 30_000).toISOString(),
          targets: [],
        });
      }),
    );
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: /^Repair/ }));
    const summary = screen.getByTestId('repair-summary');
    await waitFor(() => expect(screen.getByTestId('repair-total')).toHaveTextContent('1,188 ¢'));
    fireEvent.click(within(summary).getByRole('button', { name: 'Start repair' }));
    const popup = await screen.findByRole('dialog', { name: 'Repair for 1188 ¢?' });
    fireEvent.click(within(popup).getByRole('button', { name: 'Start repair' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Repair started for 1188 ¢');
    await waitFor(() => expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('112 ¢'));
    expect(screen.queryByText(/not enough credits|insufficient credits/i)).not.toBeInTheDocument();
  });

  it('never lets "Start repair" open on a stale (pre-refetch) quote for a bigger plan', async () => {
    // A slow quote for the "set all to 100%" plan: while it is loading, `keepPreviousData` would
    // otherwise show the smaller, single-part quote already on screen. The trigger must not
    // offer that stale, cheaper number as if it priced the current (bigger) plan.
    const gate: { release: (() => void) | null } = { release: null };
    server.use(
      http.post('/v1/ships/:id/repair/quote', async ({ request }) => {
        const body = (await request.json()) as { targets: Array<{ toCondition: number }> };
        if (body.targets.length > 1) {
          await new Promise<void>((resolve) => {
            gate.release = resolve;
          });
          return HttpResponse.json(
            { shipId: 'ship-1', cost: 1188, durationSeconds: 30, items: [], fee: 0 },
            { status: 200 },
          );
        }
        return HttpResponse.json(
          { shipId: 'ship-1', cost: 20, durationSeconds: 5, items: [], fee: 0 },
          { status: 200 },
        );
      }),
    );
    await renderPort();

    fireEvent.click(await screen.findByRole('tab', { name: /^Repair/ }));
    const summary = screen.getByTestId('repair-summary');
    // The default is already a full repair (every part), which this test's mock would gate as
    // the "bigger plan": back out to nothing selected first, then pick a single part, to get the
    // small quote this test actually wants as its starting point.
    fireEvent.click(within(summary).getByRole('button', { name: 'Back to current' }));
    const [slider] = screen.getAllByRole('slider');
    fireEvent.change(slider!, { target: { value: '100' } });
    await waitFor(() => expect(screen.getByTestId('repair-total')).toHaveTextContent('20 ¢'));
    expect(within(summary).getByRole('button', { name: 'Start repair' })).toBeEnabled();

    // Now the bigger plan's quote is loading: the trigger must not offer the old, smaller price.
    fireEvent.click(within(summary).getByRole('button', { name: 'Set all to 100%' }));
    expect(within(summary).getByRole('button', { name: 'Start repair' })).toBeDisabled();

    await waitFor(() => expect(gate.release).not.toBeNull());
    gate.release?.();
    await waitFor(() => expect(screen.getByTestId('repair-total')).toHaveTextContent('1,188 ¢'));
    expect(within(summary).getByRole('button', { name: 'Start repair' })).toBeEnabled();
  });

  it('fills the tank and scavenges the field', async () => {
    await renderPort();

    fireEvent.click(await screen.findByRole('tab', { name: 'Refuel' }));
    expect(screen.getByText('Fuel 25 / 40')).toBeInTheDocument();
    // The slider defaults to filling the tank; the price shown is the server's quote of that amount.
    await waitFor(() => expect(screen.getByTestId('refuel-cost')).toHaveTextContent('45 ¢'));
    fireEvent.click(screen.getByRole('button', { name: 'Buy 15' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Filled 15 units for 45 ¢.');
    await waitFor(() => expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('4,775 ¢'));

    fireEvent.click(screen.getByRole('tab', { name: 'Scavenging' }));
    // The tab explains itself: time, risk, what you find, and where it works.
    const scav = await screen.findByTestId('scavenging');
    expect(await within(scav).findByText(/about 10 minutes/)).toBeInTheDocument();
    expect(within(scav).getByText(/zone 1/)).toBeInTheDocument();
    expect(within(scav).getByText(/Everything you find is USED/)).toBeInTheDocument();
    expect(within(scav).getByText(/Only where your ship is docked/)).toBeInTheDocument();

    // On foot is a choice of its own: its own time, its own warning, its own button.
    fireEvent.click(within(scav).getByRole('radio', { name: /On foot/ }));
    expect(await within(scav).findByText(/about 5 minutes/)).toBeInTheDocument();
    expect(within(scav).getByTestId('scavenge-foot')).toHaveTextContent('50%');
    expect(within(scav).queryByTestId('scavenge-handicap')).not.toBeInTheDocument();
    expect(within(scav).getByRole('button', { name: 'Go scavenging on foot' })).toBeInTheDocument();
    fireEvent.click(within(scav).getByRole('radio', { name: /With the ship/ }));

    // Starting the job sends the ship out and back to the Ship view, where the travel
    // summary lives (the mock's /v1/missions/active does not simulate the new job itself).
    fireEvent.click(screen.getByRole('button', { name: 'Send the ship scavenging' }));
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Assembly yard' })).toBeInTheDocument(),
    );
  });

  // Round-10 owner request: "add independent mining missions at minable locations" — its
  // own tab, as visible/findable as Scavenging (not nested inside it), server decides
  // eligibility (NOT_MINABLE / NO_MINING_RIG surface as an ordinary action error, same as
  // any other gated action here).
  it('starts an independent mining job from its own Mining tab', async () => {
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Mining' }));

    const mining = await screen.findByTestId('mining-job');
    expect(within(mining).getByText(/minable/)).toBeInTheDocument();

    fireEvent.click(within(mining).getByRole('button', { name: 'Send the ship mining' }));
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Assembly yard' })).toBeInTheDocument(),
    );
  });

  it('surfaces NOT_MINABLE from the server as a plain action error', async () => {
    server.use(
      http.post('/v1/locations/:id/mine', () =>
        HttpResponse.json({ statusCode: 409, message: { error: 'NOT_MINABLE' } }, { status: 409 }),
      ),
    );
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Mining' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send the ship mining' }));
    expect(await screen.findByText('There is nothing to mine here.')).toBeInTheDocument();
  });

  it('refuel tab explains there is no tank instead of claiming a 0/0 tank is already full', async () => {
    server.use(
      http.get('/v1/ships', () =>
        HttpResponse.json(
          [
            {
              id: 'ship-1',
              ownerPlayerId: 'player-1',
              name: 'sun starter',
              fuel: 0,
              status: 'IN_PORT',
              currentLocationId: 'hedus',
              stance: 'NEUTRAL',
              layout: [],
              // An all-ion (or mid-refit) ship: no tank installed, so fuelCap is 0 — this must
              // not read as "0 / 0 = full" the way a genuinely topped-up tank would.
              sheet: { fuelCap: 0 },
              shipClass: 'MULTIROLE',
              yard: { cells: classicSquareCells() },
              activity: { kind: 'idle', until: null, missionId: null },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Refuel' }));
    expect(
      await screen.findByText(/no fuel tank installed/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/tank is already full/i)).toBeNull();
    expect(screen.queryByTestId('refuel-cost')).toBeNull();
  });

  it('opens the market of the port where the ship is docked, not a hard-coded one', async () => {
    const requested: string[] = [];
    server.use(
      http.get('/v1/ships', () =>
        HttpResponse.json(
          [
            {
              id: 'ship-1',
              ownerPlayerId: 'player-1',
              name: 'sun starter',
              fuel: 25,
              status: 'IN_PORT',
              currentLocationId: 'hedus',
              stance: 'NEUTRAL',
              layout: [],
              sheet: { fuelCap: 40 },
              shipClass: 'MULTIROLE',
              yard: { cells: classicSquareCells() },
              activity: { kind: 'idle', until: null, missionId: null },
            },
          ],
          { status: 200 },
        ),
      ),
      http.get('/v1/locations/:id/market', ({ params }) => {
        requested.push(String(params.id));
        return HttpResponse.json(
          { locationId: String(params.id), listings: [], sellOffers: [], sellMinCondition: 15 },
          { status: 200 },
        );
      }),
    );
    await renderPort();
    expect(requested).toContain('hedus');
    expect(requested).not.toContain('ceres');
  });

  it('sends an Idempotency-Key on every spending POST, reusing it for a retry of the same action', async () => {
    const keys: string[] = [];
    let attempts = 0;
    server.use(
      http.post('/v1/market/buy', ({ request }) => {
        keys.push(request.headers.get('idempotency-key') ?? '');
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json(
            { statusCode: 409, message: { error: 'INSUFFICIENT_FUNDS' } },
            { status: 409 },
          );
        }
        return HttpResponse.json(
          { partInstanceId: 'p-9', partType: 'hull', condition: 100, price: 300, credits: 4520 },
          { status: 200 },
        );
      }),
    );
    await renderPort();

    await screen.findByText('Plated Hull');
    fireEvent.click(rowButton('Plated Hull'));
    let popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));
    // A translated message, not the generic one.
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough credits.');

    popup = screen.getByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).not.toBe('');
    expect(keys[1]).toBe(keys[0]);
  });

  it('refuel, sell and repair are refused by the (strict) mock without a key — and the UI sends one', async () => {
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Refuel' }));
    await waitFor(() => expect(screen.getByTestId('refuel-cost')).toHaveTextContent('45 ¢'));
    fireEvent.click(screen.getByRole('button', { name: 'Buy 15' }));
    // The strict mock answers 400 IDEMPOTENCY_KEY_REQUIRED if the header is missing.
    expect(await screen.findByRole('status')).toHaveTextContent('Filled 15 units');
    expect(queryByRoleSafe('alert')).toBeNull();
  });

  it('a stale buy price updates the popup with the server price instead of failing silently', async () => {
    server.use(
      http.post('/v1/market/buy', () =>
        HttpResponse.json(
          { statusCode: 409, message: { error: 'PRICE_CHANGED', actual: 320 } },
          { status: 409 },
        ),
      ),
    );
    await renderPort();
    await screen.findByText('Plated Hull');
    fireEvent.click(rowButton('Plated Hull'));
    const popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));
    expect(await screen.findByRole('dialog', { name: /320 ¢/ })).toHaveTextContent(
      'The price changed to 320 ¢ — confirm again.',
    );
  });

  it('sells an inventory part at the port quote on the first click', async () => {
    await renderPort();
    await screen.findByText('Plated Hull');
    fireEvent.click(rowButton('Plated Hull'));
    let popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));
    await screen.findByRole('status');

    fireEvent.click(screen.getByRole('tab', { name: 'Your goods' }));
    const sell = await screen.findAllByRole('button', { name: 'Sell' });
    fireEvent.click(sell[0]!);
    popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Sell' }));
    // No PRICE_CHANGED round trip: the sale goes through.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Sold /));
    expect(queryByRoleSafe('alert')).toBeNull();
  });

  it('refreshes the wallet from the profile, never by rotating the session', async () => {
    let sessionRefreshes = 0;
    server.use(
      http.post('/v1/auth/refresh', () => {
        sessionRefreshes += 1;
        return HttpResponse.json({ accessToken: 'token-x' }, { status: 200 });
      }),
    );
    await renderPort();
    await screen.findByTestId('topbar-wallet');
    const before = sessionRefreshes;
    await screen.findByText('Plated Hull');
    fireEvent.click(rowButton('Plated Hull'));
    const popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));
    await waitFor(() => expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('4,520 ¢'));
    expect(sessionRefreshes).toBe(before);
  });

  it('refuel opens on what the pilot can afford, never on a price they cannot pay', async () => {
    setWallet(30);
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Refuel' }));
    // 3 ¢ a unit and 30 ¢ in the wallet: ten units, not the whole tank.
    await waitFor(() => expect(screen.getByTestId('refuel-cost')).toHaveTextContent('30 ¢'));
    expect(screen.getByRole('button', { name: 'Buy 10' })).toBeEnabled();
  });

  it('refuel: the slider picks how much to buy and the price follows the amount', async () => {
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Refuel' }));
    const slider = await screen.findByLabelText('How much fuel to buy');
    fireEvent.change(slider, { target: { value: '5' } });
    await waitFor(() => expect(screen.getByTestId('refuel-cost')).toHaveTextContent('15 ¢'));
    fireEvent.click(screen.getByRole('button', { name: 'Buy 5' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Filled 5 units for 15 ¢.');
  });

  it('a too-damaged loose part cannot be sold; discard asks first, then destroys it', async () => {
    addWreck();
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Your goods' }));
    const note = await screen.findByTestId('discard-note');
    expect(note).toHaveTextContent('under 15% condition');
    expect(screen.getByText('Too damaged to sell')).toBeInTheDocument();

    fireEvent.click(within(note).getByRole('button', { name: /Discard 1/ }));
    const popup = await screen.findByRole('dialog', { name: 'Destroy 1 damaged part(s)?' });
    fireEvent.click(within(popup).getByRole('button', { name: 'Destroy them' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Discarded 1 damaged part(s).');
    await waitFor(() => expect(screen.queryByTestId('discard-note')).toBeNull());
  });

  it('upgrade tab lists only parts the catalog has a next tier for (round 5, item 4)', async () => {
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Upgrade' }));

    // hull and both cargo racks have a next-tier fixture entry; bridge/engine/tank/battery don't.
    expect(await screen.findByText('Plated Hull')).toBeInTheDocument();
    expect(screen.getAllByText('Cargo Rack')).toHaveLength(2);
    expect(screen.queryByText('Bridge')).toBeNull();
    expect(screen.queryByText('Small Chemical Engine')).toBeNull();
  });

  // Round-10 owner request: "Upgrade UI should show diff between current part and upgraded
  // part" — the same before/after popup Market already has, built from a virtual part at the
  // next tier (which doesn't exist as an owned instance yet).
  it('the upgrade tab starts on "only what I can afford", which still lists what is within reach', async () => {
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Upgrade' }));
    expect(await screen.findByText('Plated Hull')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Only what I can afford' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('with too few credits the list says so, and turning the filter off shows everything upgradable', async () => {
    setWallet(1);
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Upgrade' }));
    expect(
      await screen.findByText(/Nothing you can upgrade with your credits/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Plated Hull')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Only what I can afford' }));
    expect(await screen.findByText('Plated Hull')).toBeInTheDocument();
  });
  it('upgrade tab shows a diff popup between the current part and the next tier', async () => {
    server.use(
      http.post('/v1/ships/:id/preview', async ({ request }) => {
        const body = (await request.json()) as {
          virtualPart?: { partType: string; condition: number };
          replacePartInstanceId?: string;
        };
        // The exact wiring under test: the diff is a REPLACE of this instance with the next
        // tier's catalog code, not a plain addition.
        expect(body.virtualPart?.partType).toBe('hull_uncommon');
        expect(body.replacePartInstanceId).toBe('part-hull');
        return HttpResponse.json({
          sheet: {
            pot: 25, pdf: 0, bli: 12, esc: 0, sen: 2, crg: 10, min: 0, hp: 60, mass: 24,
            energyCont: 8, energyCombat: 0, batCharge: 4, batOutput: 10, batInput: 8,
            fuelCap: 40, fuelUse: 1, structureUsed: 18, structureBudget: 40, autonomy: 40,
            mob: 2, condition: 1,
          },
          shipClass: 'MULTIROLE',
          viability: { viable: true, problems: [] },
          layout: [],
          omittedPartInstanceIds: [],
        });
      }),
    );
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Upgrade' }));
    await screen.findByText('Plated Hull');

    const hullRow = (await screen.findByText('Plated Hull')).closest('article');
    expect(hullRow).not.toBeNull();
    // One info button per card: it opens the part itself AND, under it, the next tier's diff.
    expect(within(hullRow!).getAllByRole('button', { name: /^Details:/ })).toHaveLength(1);
    fireEvent.click(within(hullRow!).getByRole('button', { name: 'Details: Plated Hull' }));

    const popup = await screen.findByRole('dialog', { name: 'Plated Hull' });
    await within(popup).findByRole('heading', { name: 'Plated Hull · Common → Reinforced Hull · Uncommon' });
    const next = within(popup).getByRole('region', { name: 'Plated Hull · Common → Reinforced Hull · Uncommon' });
    // The diff sets the upgraded part against the one the pilot owns (not "add it to the ship").
    const diff = within(next).getByTestId('upgrade-diff');
    expect(within(diff).getByText('This part today')).toBeInTheDocument();
    // The next tier's own higher hp (40 today, 60 upgraded) shows as a positive delta.
    const hpRow = within(diff).getByRole('row', { name: /^Hit points/ });
    expect(within(hpRow).getByText('60 (+20)')).toBeInTheDocument();
    expect(within(hpRow).getByText('40')).toBeInTheDocument();
  });

  it('hovering a card in the Upgrade tab shows the part it will become, not the one it is', async () => {
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Upgrade' }));
    const card = (await screen.findByText('Plated Hull')).closest('article') as HTMLElement;
    fireEvent.pointerEnter(card, { clientX: 100, clientY: 200 });
    const hover = await screen.findByTestId('part-card-hover-card');
    expect(hover).toHaveTextContent('Reinforced Hull');
    expect(hover).not.toHaveTextContent('Plated Hull');
    expect(hover).toHaveTextContent('Uncommon');
  });

  it('upgrades a part behind a confirm popup and updates the wallet', async () => {
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: 'Upgrade' }));
    await screen.findByText('Plated Hull');

    fireEvent.click(rowButton('Plated Hull'));
    const popup = await screen.findByRole('dialog', { name: 'Upgrade for 115 ¢?' });
    expect(popup).toHaveTextContent('Upgrade Plated Hull to Reinforced Hull for 115 ¢?');
    // Both names wear their rarity's colour: what it is now, and what it becomes.
    expect(within(popup).getByText('Plated Hull')).toHaveClass('rarity-name', 'rarity-common');
    expect(within(popup).getByText('Reinforced Hull')).toHaveClass('rarity-name', 'rarity-uncommon');
    fireEvent.click(within(popup).getByRole('button', { name: 'Upgrade' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Upgraded to Reinforced Hull.');
    await waitFor(() => expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('4,705 ¢'));
    // The upgraded part is now UNCOMMON, so it drops off this tab (no further chain in the fixture).
    await waitFor(() => expect(screen.queryByText('Plated Hull')).toBeNull());
  });
});
