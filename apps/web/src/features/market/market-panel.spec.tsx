import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { economyState, resetEconomyState, setWallet } from '../../test/msw/handlers';
import { routes } from '../../app/router';
import type { ShipSheet } from '../../api/generated';

// Mirrors the default fixture's own ship sheet (handlers.ts's private `sheet()`) exactly, same
// convention hangar.spec.tsx already uses for its own compare tests — the "before" side of the
// comparison in these tests always comes from that real default, never a value we invent here.
const defaultSheet: ShipSheet = {
  pot: 25,
  pdf: 0,
  bli: 12,
  esc: 0,
  sen: 2,
  crg: 10,
  min: 0,
  hp: 40,
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
};

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

const panel = () => document.querySelector('.market-panel') as HTMLElement;

async function renderPortMarket(): Promise<void> {
  // Port is a nested route now (owner request: the old Ship/Port/Board switcher duplicated the
  // top nav and got removed) — land on it directly instead of clicking a tab that no longer
  // exists.
  renderWithRouter(routes, { initialEntries: ['/hangar/port'] });
  await screen.findByRole('heading', { name: 'My Ship' });
  await screen.findByRole('tab', { name: 'Market' });
}

describe('market panel: descriptions and filters', () => {
  beforeEach(() => {
    resetEconomyState();
    server.use(onboarded());
  });

  it('shows name, price, what it is and a key stat on every card; the long description is behind the info button', async () => {
    await renderPortMarket();
    await screen.findByText('Plated Hull');
    const cards = document.querySelectorAll('.market-panel .pcard');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of Array.from(cards)) {
      expect(card.querySelector('.pcard-name')?.textContent ?? '').not.toBe('');
      expect(card.querySelector('.pcard-price')).not.toBeNull();
      expect(card.querySelector('.pcard-summary')?.textContent ?? '').not.toBe('');
      // the prose moved behind (i): it no longer takes three lines on every card
      expect(card.querySelector('.part-desc-short')).toBeNull();
    }
  });

  it('opens the full explanation from the info button, with the stats table and a hover tag for why you need it', async () => {
    await renderPortMarket();
    await screen.findByText('Plated Hull');
    fireEvent.click(screen.getAllByRole('button', { name: /^Details: Plated Hull/ })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Plated Hull' });
    // The description/"why you need it" prose is a hover tag next to the name now, not
    // always-on text (owner request); it's still there, just behind a title attribute.
    const whyTag = within(dialog).getByRole('button', { name: /Why you need it: Plated Hull/ });
    expect(whyTag).toHaveAttribute(
      'title',
      expect.stringContaining('what it does, why you need it'),
    );
    // The stats are a real table.
    expect(within(dialog).getByRole('table')).toBeInTheDocument();
  });

  it('filters by part type, by new/used and by search text', async () => {
    await renderPortMarket();
    await screen.findByText('Plated Hull');
    const list = () => document.querySelectorAll('.market-panel .pcard-grid .pcard');
    const total = list().length;

    // Defense is split by kind: the Plated Hull sits under Hull, not under a Defense chip.
    expect(screen.queryByRole('button', { name: 'Defense' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hull' }));
    expect(list()).toHaveLength(1);
    expect(within(panel()).queryByText('Cargo Rack')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(list()).toHaveLength(total);

    // New / used lives under "More filters".
    fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'used' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show parts' }));
    expect(list()).toHaveLength(1);
    expect(within(panel()).getByText('Cargo Rack (used)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show parts' }));
    fireEvent.change(screen.getByLabelText('Search parts'), { target: { value: 'zzz' } });
    expect(list()).toHaveLength(0);
    expect(screen.getByText('No parts match these filters.')).toBeInTheDocument();
  });

  it('narrows the list by rarity and by size', async () => {
    await renderPortMarket();
    await screen.findByText('Plated Hull');
    const list = () => document.querySelectorAll('.market-panel .pcard-grid .pcard');
    const total = list().length;

    fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
    const rarity = screen.getByLabelText('Rarity');
    const options = within(rarity)
      .getAllByRole('option')
      .map((option) => option.getAttribute('value'));
    const picked = options.find((value) => value !== 'all');
    fireEvent.change(rarity, { target: { value: picked } });
    expect(list().length).toBeGreaterThan(0);
    expect(list().length).toBeLessThanOrEqual(total);

    fireEvent.change(rarity, { target: { value: 'all' } });
    const size = screen.getByLabelText('Size');
    fireEvent.change(size, { target: { value: '9x9' } });
    expect(list()).toHaveLength(0);
    fireEvent.change(size, { target: { value: 'all' } });
    expect(list()).toHaveLength(total);
  });

  it('lists the cheapest offers first by default', async () => {
    await renderPortMarket();
    await screen.findByText('Plated Hull');
    const prices = Array.from(document.querySelectorAll('.market-panel .pcard-price b')).map(
      (node) => Number((node.textContent ?? '').replace(/[^\d]/g, '')),
    );
    expect(prices.length).toBeGreaterThan(1);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('"Affordable now" hides what the pilot cannot pay, and a button says how much is missing', async () => {
    setWallet(130);
    await renderPortMarket();
    await screen.findByText('Plated Hull');
    const list = () => document.querySelectorAll('.market-panel .pcard-grid .pcard');
    const total = list().length;

    // Off by default: the Plated Hull (300) is listed, its button says what is missing.
    const hull = screen.getByText('Plated Hull').closest('.pcard') as HTMLElement;
    await waitFor(() =>
      expect(within(hull).getByRole('button', { name: 'Need 170 ¢ more' })).toBeDisabled(),
    );

    const chip = screen.getByRole('button', { name: 'Affordable now' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(list().length).toBeLessThan(total);
    expect(screen.queryByText('Plated Hull')).toBeNull();

    fireEvent.click(chip);
    expect(list()).toHaveLength(total);
  });

  it('says what the ship lacks, offers the matching parts, and can be dismissed', async () => {
    const shelf = (await (await fetch('/v1/locations/ceres/market')).json()) as {
      listings: Array<Record<string, unknown> & { catalog: Record<string, unknown> }>;
    };
    const hull = shelf.listings[0]!;
    server.use(
      http.get('/v1/locations/:id/market', ({ params }) =>
        HttpResponse.json({
          locationId: String(params.id),
          listings: [
            ...shelf.listings,
            {
              ...hull,
              listingId: 'catalog:ceres:cannon',
              partType: 'cannon',
              partClass: 'WEAPON',
              displayName: { en: 'Cannon', 'pt-BR': 'Canhão' },
              catalog: { ...hull.catalog, partType: 'cannon', partClass: 'WEAPON' },
              price: 110,
            },
          ],
          sellMinCondition: 1,
          sellOffers: [],
        }),
      ),
    );
    await renderPortMarket();
    await screen.findByText('Plated Hull');

    // The default ship has armor and cargo but no firepower.
    const needs = await screen.findByTestId('ship-needs');
    expect(within(needs).getByText(/A weapon/)).toBeInTheDocument();
    expect(within(needs).queryByText(/cargo hold/)).toBeNull();

    fireEvent.click(within(needs).getByRole('button', { name: 'Show parts' }));
    const list = () => document.querySelectorAll('.market-panel .pcard-grid .pcard');
    expect(list()).toHaveLength(1);
    expect(within(panel()).getByText('Cannon')).toBeInTheDocument();

    fireEvent.click(within(needs).getByRole('button', { name: /^Dismiss: A weapon/ }));
    expect(screen.queryByTestId('ship-needs')).toBeNull();
  });

  it('shows the pilot balance in the Hangar store', async () => {
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await waitFor(() => {
      if (document.querySelector('rect.block') === null) throw new Error('no block yet');
    });
    const sheet = screen.getByRole('region', { name: 'Ship sheet' });
    expect(sheet.querySelector('.panel')!.textContent).toMatch(/Ship sheet/);

    fireEvent.click(screen.getByRole('tab', { name: 'Store' }));
    expect(await screen.findByTestId('store-balance')).toHaveTextContent('4,820 ¢');
    // The wallet moved off My Ship's own header into the top bar's account menu (owner
    // request — fewer lines on the page), visible on every in-game screen now.
    expect(screen.getByTestId('topbar-wallet')).toHaveTextContent('4,820 ¢');
  });

  it('compares a listing as an ADDITION by default (what buying it as an extra part does), colored by whether it helps', async () => {
    server.use(
      onboarded(),
      http.post('/v1/ships/:id/preview', async ({ request }) => {
        const body = (await request.json()) as {
          virtualPart?: { partType: string; condition: number };
          replacePartInstanceId?: string;
        };
        expect(body.virtualPart?.partType).toBe('hull');
        // an addition: nothing is replaced unless the pilot picks it
        expect(body.replacePartInstanceId).toBeUndefined();
        return HttpResponse.json({
          sheet: { ...defaultSheet, hp: defaultSheet.hp + 10 },
          shipClass: 'MULTIROLE',
          viability: { viable: true, problems: [] },
          layout: [],
          omittedPartInstanceIds: [],
        });
      }),
    );
    await renderPortMarket();
    await screen.findByText('Plated Hull');

    fireEvent.click(screen.getAllByRole('button', { name: /^Details: Plated Hull/ })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Plated Hull' });
    await waitFor(() =>
      expect(within(dialog).getByText('If you install this now')).toBeInTheDocument(),
    );
    const hpRow = within(dialog).getByRole('row', { name: /^Hit points/ });
    await waitFor(() => expect(within(hpRow).getByText('50 (+10)')).toBeInTheDocument());
    expect(within(hpRow).getByText('50 (+10)')).toHaveClass('delta-good');
  });

  it('lets the pilot switch between "replace X" and "add it" for the same listing (owner request)', async () => {
    server.use(
      onboarded(),
      http.post('/v1/ships/:id/preview', async ({ request }) => {
        const body = (await request.json()) as { replacePartInstanceId?: string };
        return HttpResponse.json({
          sheet:
            body.replacePartInstanceId === undefined
              ? { ...defaultSheet, hp: defaultSheet.hp + 10 }
              : { ...defaultSheet, hp: defaultSheet.hp + 6 },
          shipClass: 'MULTIROLE',
          viability: { viable: true, problems: [] },
          layout: [],
          omittedPartInstanceIds: [],
        });
      }),
    );
    await renderPortMarket();
    await screen.findByText('Plated Hull');

    fireEvent.click(screen.getAllByRole('button', { name: /^Details: Plated Hull/ })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Plated Hull' });
    // Opens on "add it".
    await waitFor(() =>
      expect(within(dialog).getByText('If you install this now')).toBeInTheDocument(),
    );
    const hpRow = within(dialog).getByRole('row', { name: /^Hit points/ });
    await waitFor(() => expect(within(hpRow).getByText('50 (+10)')).toBeInTheDocument());

    // The picker switches to replacing the installed part of the same class.
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Compare as' }), {
      target: { value: 'part-hull' },
    });
    await waitFor(() => expect(within(dialog).getByText(/swap this in for/i)).toBeInTheDocument());
    await waitFor(() => expect(within(hpRow).getByText('46 (+6)')).toBeInTheDocument());
  });

  it('compares a listing with nothing installed of its class as a plain addition, not a swap', async () => {
    server.use(
      onboarded(),
      http.get('/v1/inventory', () => HttpResponse.json([], { status: 200 })),
      http.post('/v1/ships/:id/preview', () =>
        HttpResponse.json({
          sheet: { ...defaultSheet, hp: defaultSheet.hp + 4 },
          shipClass: 'MULTIROLE',
          viability: { viable: true, problems: [] },
          layout: [],
          omittedPartInstanceIds: [],
        }),
      ),
    );
    await renderPortMarket();
    await screen.findByText('Plated Hull');

    fireEvent.click(screen.getAllByRole('button', { name: /^Details: Plated Hull/ })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Plated Hull' });
    await waitFor(() =>
      expect(within(dialog).getByText('If you install this now')).toBeInTheDocument(),
    );
  });

  it('hovering a Market/Store card shows the same compare stats card the Hangar tray has, without opening the full popup (owner request)', async () => {
    server.use(
      onboarded(),
      http.post('/v1/ships/:id/preview', () =>
        HttpResponse.json({
          sheet: { ...defaultSheet, hp: defaultSheet.hp + 6 },
          shipClass: 'MULTIROLE',
          viability: { viable: true, problems: [] },
          layout: [],
          omittedPartInstanceIds: [],
        }),
      ),
    );
    await renderPortMarket();
    await screen.findByText('Plated Hull');
    const card = screen.getAllByText('Plated Hull')[0]!.closest('.pcard');
    if (card === null) throw new Error('card not found');

    expect(screen.queryByTestId('part-card-hover-card')).toBeNull();
    fireEvent.pointerEnter(card, { clientX: 100, clientY: 200 });

    const hoverCard = await screen.findByTestId('part-card-hover-card');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(within(hoverCard).getByText('46 (+6)')).toBeInTheDocument());

    fireEvent.pointerLeave(card);
    await waitFor(() => expect(screen.queryByTestId('part-card-hover-card')).toBeNull());
  });

  it('hovering a placed part shows a small stats card — clicking it never opens the full popup', async () => {
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    const block = await waitFor(() => {
      const found = document.querySelector('rect.block');
      if (found === null) throw new Error('no block yet');
      return found;
    });

    fireEvent.pointerDown(block);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('part-hover-card')).toBeNull();

    fireEvent.pointerEnter(block);
    expect(await screen.findByTestId('part-hover-card')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.pointerLeave(block);
    await waitFor(() => expect(screen.queryByTestId('part-hover-card')).not.toBeInTheDocument());
  });
});
