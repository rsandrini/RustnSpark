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
  setShipActivity,
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

// The ship view shows the engine tuning's sliders too: the repair plan's are the others.
const repairSliders = () =>
  screen
    .getAllByRole('slider')
    .filter((slider) => slider.closest('[data-testid="engine-tuning"]') === null);

// The seven Port tabs sit under three group tabs (Buy, Service, Work): open the group, then the tab.
const TAB_GROUP: Record<string, string> = {
  Market: 'Buy',
  'Your goods': 'Buy',
  Repair: 'Service',
  Refuel: 'Service',
  Upgrade: 'Service',
  Scavenging: 'Work',
  Mining: 'Work',
};
function openPortTab(name: string): void {
  const group = TAB_GROUP[name];
  if (group === undefined) throw new Error(`unknown Port tab ${name}`);
  const groupTab = screen.getByRole('tab', { name: new RegExp(`^${group}`) });
  if (groupTab.getAttribute('aria-selected') !== 'true') fireEvent.click(groupTab);
  fireEvent.click(screen.getByRole('tab', { name: name === 'Repair' ? /^Repair/ : name }));
}

describe('port (S10.9)', () => {
  beforeEach(() => {
    resetEconomyState();
    setShipActivity(null);
    server.use(onboarded());
  });

  it('a service stop (no market, no upgrades) offers only repair and refuel', async () => {
    const stop = (await import('../../test/msw/handlers')).world();
    server.use(
      http.get('/v1/locations', () =>
        HttpResponse.json({
          ...stop,
          locations: stop.locations.map((place) =>
            place.id === 'ceres'
              ? {
                  ...place,
                  services: { buy: false, sell: false, repair: true, refuel: true, upgrade: false },
                }
              : place,
          ),
        }),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/hangar/port'] });
    await screen.findByRole('tab', { name: /^Repair/ });
    expect(screen.queryByRole('tab', { name: 'Market' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Your goods' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Buy/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Refuel' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Upgrade' })).not.toBeInTheDocument();
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

    openPortTab('Refuel');
    expect(screen.getByRole('button', { name: /^Buy \d+/ })).toBeDisabled();

    openPortTab('Scavenging');
    expect(screen.getByRole('button', { name: /Send the ship scavenging/i })).toBeEnabled();
  });

  it('sells all mined materials after the quote popup', async () => {
    await renderPort();

    openPortTab('Your goods');
    fireEvent.click(rowButton(/Iron/));
    const popup = await screen.findByRole('dialog', { name: 'Sell Iron for 24 ¢?' });
    expect(popup).toHaveTextContent('Balance after: 4,844 ¢');
    fireEvent.click(within(popup).getByRole('button', { name: 'Sell' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Sold Iron for 24 ¢.');
    await waitFor(() => expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('4,844 ¢'));
  });

  it('sells only the chosen amount of a material', async () => {
    await renderPort();

    openPortTab('Your goods');
    const slider = await screen.findByTestId('sell-amount-iron');
    fireEvent.change(slider, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sell 1' }));
    const popup = await screen.findByRole('dialog', { name: /Sell Iron for \d+ ¢\?/ });
    fireEvent.click(within(popup).getByRole('button', { name: 'Sell' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/Sold Iron for \d+ ¢\./);
    // The rest of the stack is still there to sell.
    await waitFor(() => expect(screen.getByTestId('sell-amount-iron')).toBeInTheDocument());
  });

  it('a destroyed part has no repair slider and is skipped by "set all to 100%"', async () => {
    destroyEngine();
    await renderPort();

    openPortTab('Repair');
    expect(
      await screen.findByText('A destroyed part cannot be repaired: replace it.'),
    ).toBeInTheDocument();
    const sliders = repairSliders();
    expect(sliders).toHaveLength(6);
    expect(sliders.filter((slider) => (slider as HTMLInputElement).disabled)).toHaveLength(1);
  });

  it('repair defaults to a full repair, prices each part and the total, then charges once', async () => {
    await renderPort();

    openPortTab('Repair');
    const sliders = repairSliders();
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

  it('a ship that cannot fly loses "with the ship": the tab says why and falls back to on foot', async () => {
    server.use(
      http.post('/v1/ships/:id/preview', () =>
        HttpResponse.json({
          sheet: {
            pot: 0,
            pdf: 0,
            bli: 0,
            esc: 0,
            sen: 0,
            crg: 0,
            min: 0,
            hp: 10,
            mass: 4,
            energyCont: 0,
            energyCombat: 0,
            batCharge: 0,
            batOutput: 0,
            batInput: 0,
            fuelCap: 0,
            fuelUse: 0,
            structureUsed: 0,
            structureBudget: 10,
            autonomy: 0,
            mob: 1,
            condition: 100,
          },
          shipClass: 'MULTIROLE',
          viability: {
            viable: false,
            problems: [{ code: 'NO_ENGINE', message: 'x' }],
            warnings: [],
          },
          layout: [],
          omittedPartInstanceIds: [],
          disconnectedPartIds: [],
          routeCoverage: null,
        }),
      ),
    );
    await renderPort();
    openPortTab('Scavenging');
    const notice = await screen.findByTestId('scavenge-no-ship');
    expect(notice).toHaveTextContent(/cannot fly/i);
    expect(screen.getByRole('radio', { name: /With the ship/i })).toBeDisabled();
    // The mode fell back to on foot, which needs no usable ship.
    expect(screen.getByTestId('scavenge-foot')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go scavenging on foot/i })).toBeEnabled();
  });

  it('a ship under refit loses "with the ship" (the API would refuse it) and falls back to on foot', async () => {
    setShipActivity({ kind: 'repairing', until: null, missionId: null });
    await renderPort();
    openPortTab('Scavenging');
    const notice = await screen.findByTestId('scavenge-no-ship');
    expect(notice).toHaveTextContent(/repair/i);
    expect(screen.getByRole('radio', { name: /With the ship/i })).toBeDisabled();
    expect(screen.getByTestId('scavenge-foot')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go scavenging on foot/i })).toBeEnabled();
  });

  it('a viable ship with warnings still scavenges with the ship, handicapped', async () => {
    server.use(
      http.post('/v1/ships/:id/preview', () =>
        HttpResponse.json({
          sheet: {
            pot: 0,
            pdf: 0,
            bli: 0,
            esc: 0,
            sen: 0,
            crg: 0,
            min: 0,
            hp: 10,
            mass: 4,
            energyCont: 0,
            energyCombat: 0,
            batCharge: 0,
            batOutput: 0,
            batInput: 0,
            fuelCap: 0,
            fuelUse: 0,
            structureUsed: 0,
            structureBudget: 10,
            autonomy: 0,
            mob: 1,
            condition: 100,
          },
          shipClass: 'MULTIROLE',
          viability: {
            viable: true,
            problems: [],
            warnings: [{ code: 'NO_LIFE_SUPPORT', message: 'x' }],
          },
          layout: [],
          omittedPartInstanceIds: [],
          disconnectedPartIds: [],
          routeCoverage: null,
        }),
      ),
    );
    await renderPort();
    openPortTab('Scavenging');
    const notice = await screen.findByTestId('scavenge-handicap');
    expect(notice).toHaveTextContent('only 50% of the usual chance');
    expect(screen.getByRole('radio', { name: /With the ship/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Send the ship scavenging/i })).toBeEnabled();
  });

  it('shows no handicap notice for a ship that is ready', async () => {
    await renderPort();
    openPortTab('Scavenging');
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
    openPortTab('Repair');
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

    openPortTab('Repair');
    const summary = screen.getByTestId('repair-summary');
    // The default is already a full repair (every part), which this test's mock would gate as
    // the "bigger plan": back out to nothing selected first, then pick a single part, to get the
    // small quote this test actually wants as its starting point.
    fireEvent.click(within(summary).getByRole('button', { name: 'Back to current' }));
    const [slider] = repairSliders();
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

    openPortTab('Refuel');
    // The slider defaults to filling the tank; the price shown is the server's quote of that amount.
    await waitFor(() => expect(screen.getByTestId('refuel-cost')).toHaveTextContent('45 ¢'));
    // The bar shows what the slider adds, and the summary spells it out.
    expect(screen.getByText('Fuel 25 + 15 → 40 / 40')).toBeInTheDocument();
    expect(screen.getByTestId('refuel-summary')).toHaveTextContent('+15');
    fireEvent.click(screen.getByRole('button', { name: 'Buy 15' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Filled 15 units for 45 ¢.');
    await waitFor(() => expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('4,775 ¢'));

    openPortTab('Scavenging');
    // The tab explains itself: time, risk, what you find, and where it works.
    const scav = await screen.findByTestId('scavenging');
    expect(await within(scav).findByText('~10 min')).toBeInTheDocument();
    expect(within(scav).getByText(/Zone 1/)).toBeInTheDocument();
    expect(within(scav).getByText(/Everything you find is USED/)).toBeInTheDocument();
    expect(within(scav).getByText(/Only where your ship is docked/)).toBeInTheDocument();

    // On foot is a choice of its own: its own time, its own warning, its own button.
    fireEvent.click(within(scav).getByRole('radio', { name: /On foot/ }));
    expect(await within(scav).findByText('~5 min')).toBeInTheDocument();
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
    openPortTab('Mining');

    const mining = await screen.findByTestId('mining-job');
    expect(within(mining).getByText(/minable/)).toBeInTheDocument();

    fireEvent.click(within(mining).getByRole('button', { name: 'Send the ship mining' }));
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Assembly yard' })).toBeInTheDocument(),
    );
  });

  it('upgrade tab says why nothing is listed: parts below 100% need a repair first', async () => {
    server.use(
      http.post('/v1/parts/:id/upgrade/quote', ({ params }) =>
        HttpResponse.json({
          partInstanceId: String(params.id),
          eligible: false,
          reason: 'NOT_FULL_CONDITION',
        }),
      ),
    );
    await renderPort();
    openPortTab('Upgrade');
    const why = await screen.findByTestId('upgrade-why');
    expect(why).toHaveTextContent(/not at 100% condition/);
    expect(screen.getByTestId('upgrade-rules')).toHaveTextContent('100% condition');
    fireEvent.click(within(why).getByRole('button', { name: 'Go to Repair' }));
    expect(await screen.findByRole('tab', { name: /^Repair/, selected: true })).toBeInTheDocument();
  });

  it('offers the Mining tab only where the location can be mined', async () => {
    server.use(
      http.get('/v1/locations/:id/mine/info', () => HttpResponse.json({ minable: false })),
    );
    await renderPort();
    fireEvent.click(await screen.findByRole('tab', { name: /^Work/ }));
    // Nothing to mine: Work holds the one job, so there is no second row of tabs and no Mining.
    expect(
      await screen.findByRole('button', { name: 'Send the ship scavenging' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Mining' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Scavenging' })).toBeNull();
  });

  it('surfaces NOT_MINABLE from the server as a plain action error', async () => {
    server.use(
      http.post('/v1/locations/:id/mine', () =>
        HttpResponse.json({ statusCode: 409, message: { error: 'NOT_MINABLE' } }, { status: 409 }),
      ),
    );
    await renderPort();
    openPortTab('Mining');
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
    openPortTab('Refuel');
    expect(await screen.findByText(/no fuel tank installed/i)).toBeInTheDocument();
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
    openPortTab('Refuel');
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

    openPortTab('Your goods');
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
    openPortTab('Refuel');
    // 3 ¢ a unit and 30 ¢ in the wallet: ten units, not the whole tank.
    await waitFor(() => expect(screen.getByTestId('refuel-cost')).toHaveTextContent('30 ¢'));
    expect(screen.getByRole('button', { name: 'Buy 10' })).toBeEnabled();
  });

  it('refuel: the slider picks how much to buy and the price follows the amount', async () => {
    await renderPort();
    openPortTab('Refuel');
    const slider = await screen.findByLabelText('How much fuel to buy');
    fireEvent.change(slider, { target: { value: '5' } });
    await waitFor(() => expect(screen.getByTestId('refuel-cost')).toHaveTextContent('15 ¢'));
    fireEvent.click(screen.getByRole('button', { name: 'Buy 5' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Filled 5 units for 15 ¢.');
  });

  it('a too-damaged loose part cannot be sold; discard asks first, then destroys it and sells the scrap', async () => {
    addWreck();
    await renderPort();
    openPortTab('Your goods');
    const note = await screen.findByTestId('discard-note');
    expect(note).toHaveTextContent('under 1% condition');
    expect(screen.getByText('Too damaged to sell')).toBeInTheDocument();

    fireEvent.click(within(note).getByRole('button', { name: /Discard 1/ }));
    const popup = await screen.findByRole('dialog', { name: 'Destroy 1 damaged part(s)?' });
    // Selling the scrap is on by default, so the notice reports the credits it earned.
    expect(within(popup).getByRole('checkbox', { name: /Sell the scrap/ })).toBeChecked();
    fireEvent.click(within(popup).getByRole('button', { name: 'Destroy them' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Discarded 1 damaged part(s), turning them into 1 scrap and selling it for 4 ¢.',
    );
    await waitFor(() => expect(screen.queryByTestId('discard-note')).toBeNull());
  });

  it('unchecking "sell the scrap" destroys the parts and keeps the scrap in storage', async () => {
    addWreck();
    await renderPort();
    openPortTab('Your goods');
    const note = await screen.findByTestId('discard-note');
    fireEvent.click(within(note).getByRole('button', { name: /Discard 1/ }));
    const popup = await screen.findByRole('dialog', { name: 'Destroy 1 damaged part(s)?' });
    fireEvent.click(within(popup).getByRole('checkbox', { name: /Sell the scrap/ }));
    fireEvent.click(within(popup).getByRole('button', { name: 'Destroy them' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Discarded 1 damaged part(s).');
    await waitFor(() => expect(screen.queryByTestId('discard-note')).toBeNull());
  });

  it('upgrade tab lists only parts the catalog has a next tier for (round 5, item 4)', async () => {
    await renderPort();
    openPortTab('Upgrade');

    // hull and both cargo racks have a next-tier fixture entry; engine/tank/battery don't.
    expect(await screen.findByText('Plated Hull')).toBeInTheDocument();
    expect(screen.getAllByText('Cargo Rack')).toHaveLength(2);
    expect(screen.queryByText('Small Chemical Engine')).toBeNull();
    // The bridge is always here: its card carries the size controls even with no next tier.
    expect(await screen.findByText('Bridge')).toBeInTheDocument();
  });

  // Round-10 owner request: "Upgrade UI should show diff between current part and upgraded
  // part" — the same before/after popup Market already has, built from a virtual part at the
  // next tier (which doesn't exist as an owned instance yet).
  it('the upgrade tab starts on "only what I can afford", which still lists what is within reach', async () => {
    await renderPort();
    openPortTab('Upgrade');
    expect(await screen.findByText('Plated Hull')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Only what I can afford' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('with too few credits the list says so, and turning the filter off shows everything upgradable', async () => {
    setWallet(1);
    await renderPort();
    openPortTab('Upgrade');
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
            pot: 25,
            pdf: 0,
            bli: 12,
            esc: 0,
            sen: 2,
            crg: 10,
            min: 0,
            hp: 60,
            mass: 24,
            energyCont: 8,
            energyCombat: 0,
            batCharge: 4,
            batOutput: 10,
            batInput: 8,
            fuelCap: 40,
            fuelUse: 1,
            structureUsed: 18,
            structureBudget: 40,
            autonomy: 40,
            mob: 2,
            condition: 1,
          },
          shipClass: 'MULTIROLE',
          viability: { viable: true, problems: [] },
          layout: [],
          omittedPartInstanceIds: [],
        });
      }),
    );
    await renderPort();
    openPortTab('Upgrade');
    await screen.findByText('Plated Hull');

    const hullRow = (await screen.findByText('Plated Hull')).closest('article');
    expect(hullRow).not.toBeNull();
    // One info button per card: it opens the part itself AND, under it, the next tier's diff.
    expect(within(hullRow!).getAllByRole('button', { name: /^Details:/ })).toHaveLength(1);
    fireEvent.click(within(hullRow!).getByRole('button', { name: 'Details: Plated Hull' }));

    const popup = await screen.findByRole('dialog', { name: 'Plated Hull' });
    await within(popup).findByRole('heading', {
      name: 'Plated Hull · Common → Reinforced Hull · Uncommon',
    });
    const next = within(popup).getByRole('region', {
      name: 'Plated Hull · Common → Reinforced Hull · Uncommon',
    });
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
    openPortTab('Upgrade');
    const card = (await screen.findByText('Plated Hull')).closest('article') as HTMLElement;
    fireEvent.pointerEnter(card, { clientX: 100, clientY: 200 });
    const hover = await screen.findByTestId('part-card-hover-card');
    expect(hover).toHaveTextContent('Reinforced Hull');
    expect(hover).not.toHaveTextContent('Plated Hull');
    expect(hover).toHaveTextContent('Uncommon');
  });

  it('upgrades a part behind a confirm popup and updates the wallet', async () => {
    await renderPort();
    openPortTab('Upgrade');
    await screen.findByText('Plated Hull');

    fireEvent.click(rowButton('Plated Hull'));
    const popup = await screen.findByRole('dialog', { name: 'Upgrade for 115 ¢?' });
    expect(popup).toHaveTextContent('Upgrade Plated Hull to Reinforced Hull for 115 ¢?');
    // The whole price: credits and what else it asks for, against what the pilot holds.
    const price = within(popup).getByTestId('upgrade-price');
    expect(price).toHaveTextContent('Credits: 115 ¢ (you have');
    expect(price).toHaveTextContent('Scrap (any part): 5 of 2');
    // Both names wear their rarity's colour: what it is now, and what it becomes.
    expect(within(popup).getByText('Plated Hull')).toHaveClass('rarity-name', 'rarity-common');
    expect(within(popup).getByText('Reinforced Hull')).toHaveClass(
      'rarity-name',
      'rarity-uncommon',
    );
    fireEvent.click(within(popup).getByRole('button', { name: 'Upgrade' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Upgraded to Reinforced Hull.');
    await waitFor(() => expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('4,705 ¢'));
    // The upgraded part is now UNCOMMON, so it drops off this tab (no further chain in the fixture).
    await waitFor(() => expect(screen.queryByText('Plated Hull')).toBeNull());
  });

  it('puts one Expand / Shrink button with an (i) inside the bridge card, and nothing else', async () => {
    await renderPort();
    openPortTab('Upgrade');
    const control = await screen.findByTestId(/^bridge-resize-/);
    // It lives in the bridge's own card, not in a block of its own on the page.
    expect(control.closest('.pcard')).not.toBeNull();
    const button = within(control).getByRole('button', { name: 'Shrink to 1×1' });
    await waitFor(() => expect(button).toBeEnabled());
    // No explanatory text next to it: the (i) holds what it becomes and what it pays.
    expect(control).not.toHaveTextContent('you get');
    fireEvent.click(within(control).getByRole('button', { name: /Details.*Shrink to 1×1/i }));
    const popup = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(popup).toHaveTextContent('you get 6,000 ¢, the new bridge costs 0 ¢'),
    );
  });

  it('the upgrade card says what it asks for besides money, and blocks while something is missing', async () => {
    server.use(
      http.post('/v1/parts/:id/upgrade/quote', ({ params }) =>
        HttpResponse.json({
          partInstanceId: String(params.id),
          eligible: true,
          nextPartType: 'hull_uncommon',
          nextDisplayName: { en: 'Reinforced Hull', 'pt-BR': 'Casco Reforçado' },
          cost: 115,
          materials: [
            {
              materialId: 'scrap',
              displayName: { en: 'Scrap (any part)', 'pt-BR': 'Sucata (qualquer peça)' },
              needed: 4,
              have: 1,
            },
          ],
          nextRarity: 'UNCOMMON',
        }),
      ),
    );
    await renderPort();
    openPortTab('Upgrade');
    await screen.findByText('Plated Hull');
    const list = (await screen.findAllByTestId('upgrade-materials'))[0]!;
    expect(list).toHaveTextContent('Scrap (any part): 1 of 4');
    expect(within(list).getByText(/Scrap/).closest('li')).toHaveClass('req-unmet');
    expect(rowButton('Plated Hull')).toBeDisabled();
  });

  it('shows what each material is: its description sits on its card', async () => {
    await renderPort();
    openPortTab('Your goods');
    expect(await screen.findByText('Common iron ore.')).toBeInTheDocument();
  });
});
