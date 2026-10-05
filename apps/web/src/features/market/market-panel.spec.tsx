import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { economyState, resetEconomyState } from '../../test/msw/handlers';
import { routes } from '../../app/router';
import type { ShipSheet } from '../../api/generated';

// Mirrors the default fixture's own ship sheet (handlers.ts's private `sheet()`) exactly, same
// convention hangar.spec.tsx already uses for its own compare tests — the "before" side of the
// comparison in these tests always comes from that real default, never a value we invent here.
const defaultSheet: ShipSheet = {
  pot: 25, pdf: 0, bli: 12, esc: 0, sen: 2, crg: 10, min: 0, hp: 40, mass: 24,
  energyCont: 8, energyCombat: 0, batCharge: 4, batOutput: 10, batInput: 8,
  fuelCap: 40, fuelUse: 1, structureUsed: 18, structureBudget: 40,
  autonomy: 40, mob: 2, condition: 1,
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

  it('shows every offer with its description, never just a name and a price', async () => {
    await renderPortMarket();
    await screen.findByText('Plated Hull');
    const cards = document.querySelectorAll('.market-panel .pcard');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of Array.from(cards)) {
      expect(card.querySelector('.part-desc-short')?.textContent ?? '').not.toBe('');
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
    expect(whyTag).toHaveAttribute('title', expect.stringContaining('what it does, why you need it'));
    // The stats are a real table.
    expect(within(dialog).getByRole('table')).toBeInTheDocument();
  });

  it('filters by part type, by new/used and by search text', async () => {
    await renderPortMarket();
    await screen.findByText('Plated Hull');
    const list = () => document.querySelectorAll('.market-panel .pcard-grid .pcard');
    const total = list().length;

    fireEvent.click(screen.getByRole('button', { name: 'Defense' }));
    expect(list()).toHaveLength(1);
    expect(within(panel()).queryByText('Cargo Rack')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(list()).toHaveLength(total);

    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'used' } });
    expect(list()).toHaveLength(1);
    expect(within(panel()).getByText('Cargo Rack (used)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search parts'), { target: { value: 'zzz' } });
    expect(list()).toHaveLength(0);
    expect(screen.getByText('No parts match these filters.')).toBeInTheDocument();
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

  it('compares a listing against the installed part of the same class, colored by whether it helps', async () => {
    server.use(
      onboarded(),
      http.post('/v1/ships/:id/preview', async ({ request }) => {
        const body = (await request.json()) as {
          virtualPart?: { partType: string; condition: number };
          replacePartInstanceId?: string;
        };
        // The default fixture's only installed DEFENSE-class part is part-hull (Plated Hull).
        expect(body.virtualPart?.partType).toBe('hull');
        expect(body.replacePartInstanceId).toBe('part-hull');
        return HttpResponse.json({
          sheet: { ...defaultSheet, hp: defaultSheet.hp + 6 },
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
    await waitFor(() => expect(within(dialog).getByText(/swap this in for/i)).toBeInTheDocument());
    const hpRow = within(dialog).getByRole('row', { name: /^Hit points/ });
    await waitFor(() => expect(within(hpRow).getByText('46 (+6)')).toBeInTheDocument());
    expect(within(hpRow).getByText('46 (+6)')).toHaveClass('delta-good');
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
    // Defaults to the same auto-picked swap as before.
    await waitFor(() => expect(within(dialog).getByText(/swap this in for/i)).toBeInTheDocument());
    const hpRow = within(dialog).getByRole('row', { name: /^Hit points/ });
    await waitFor(() => expect(within(hpRow).getByText('46 (+6)')).toBeInTheDocument());

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Compare as' }), {
      target: { value: '' },
    });
    await waitFor(() =>
      expect(within(dialog).getByText('If you install this now')).toBeInTheDocument(),
    );
    await waitFor(() => expect(within(hpRow).getByText('50 (+10)')).toBeInTheDocument());
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
