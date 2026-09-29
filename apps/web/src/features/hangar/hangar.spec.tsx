import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';
import type { Placement, ShipSheet } from '../../api/generated';

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

const testSheet: ShipSheet = {
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

function cell(container: Element, gx: number, gy: number): SVGRectElement {
  const element = container.querySelector(`rect.yard-cell[data-gx="${gx}"][data-gy="${gy}"]`);
  if (element === null) throw new Error(`cell ${gx},${gy} not found`);
  return element as SVGRectElement;
}

function block(container: Element, partId: string): SVGRectElement | null {
  return container.querySelector(`rect[data-part-id="${partId}"]`);
}

// Echo the ship with the submitted layout so onSuccess state stays consistent.
function shipEcho(layout: Placement[]) {
  return {
    id: 'ship-1',
    ownerPlayerId: 'player-1',
    name: 'luna starter',
    fuel: 40,
    status: 'IN_PORT',
    currentLocationId: 'ceres',
    stance: 'NEUTRAL',
    layout,
    sheet: testSheet,
    shipClass: 'MULTIROLE',
  };
}

describe('hangar (S10.4)', () => {
  it('renders the ship sheet, class and the loose-parts tray', async () => {
    server.use(onboarded());
    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar'] });

    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
    expect(screen.getAllByText('Multirole').length).toBeGreaterThan(0);
    // crg 10 from the server sheet
    expect(screen.getByText('10')).toBeInTheDocument();
    // Only part-cargo-b is in storage; everything else is placed on the yard.
    expect(await screen.findByRole('button', { name: /^cargo/i })).toBeInTheDocument();
    expect(block(container, 'part-bridge')).not.toBeNull();
    expect(block(container, 'part-cargo-b')).toBeNull();
    // HP/condition percent is printed small, right on the bar itself (owner request).
    expect(
      block(container, 'part-bridge')?.closest('g')?.querySelector('text.cond-label')
        ?.textContent,
    ).toBe('1%');
  });

  it('never rounds mobility up past 1 — the display must agree with "Mobility is below 1"', async () => {
    server.use(
      onboarded(),
      http.get('/v1/ships', () =>
        HttpResponse.json([
          {
            id: 'ship-1',
            ownerPlayerId: 'player-1',
            name: 'luna starter',
            fuel: 40,
            status: 'IN_PORT',
            currentLocationId: 'ceres',
            stance: 'NEUTRAL',
            layout: [],
            sheet: { ...testSheet, mob: 0.958 },
            shipClass: 'MULTIROLE',
            yard: { halfSize: 10 },
            activity: { kind: 'idle', until: null, missionId: null },
          },
        ]),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    // One decimal would round 0.958 up to a displayed "1", which then contradicts a
    // MOB_TOO_LOW ("Mobility is below 1.") problem shown right next to it.
    expect(await screen.findByText('0.96')).toBeInTheDocument();
  });

  it('opens a part popup only from its (i) button — clicking the row itself never opens one', async () => {
    server.use(onboarded());
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    const trayButton = await screen.findByRole('button', { name: /^cargo/i });
    fireEvent.click(trayButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Details: Cargo Rack/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { level: 2 })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it("shows what installing a loose part would do to the ship, next to its own stats", async () => {
    server.use(
      onboarded(),
      http.post('/v1/ships/:id/preview', async ({ request }) => {
        const body = (await request.json()) as { partInstanceIds?: string[] };
        // The comparison call adds the candidate part (part-cargo-b, crg 5) to whatever's
        // already installed; answer with the ship's cargo bumped by exactly that, so the
        // popup's delta column has a real, checkable number instead of a coincidental zero.
        const withCandidate = (body.partInstanceIds ?? []).includes('part-cargo-b');
        return HttpResponse.json({
          sheet: { ...testSheet, crg: withCandidate ? testSheet.crg + 5 : testSheet.crg },
          shipClass: 'MULTIROLE',
          viability: { viable: true, problems: [] },
          layout: [],
          omittedPartInstanceIds: [],
        });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    fireEvent.click(await screen.findByRole('button', { name: /Details: Cargo Rack/i }));
    const dialog = await screen.findByRole('dialog');

    // "If installed" is Hangar-only: Cargo goes up by the part's own crg (5), everything else
    // that wasn't touched reads as unchanged.
    const cargoRow = within(dialog).getByRole('row', { name: /^Cargo/ });
    await waitFor(() => expect(within(cargoRow).getByText('+5')).toBeInTheDocument());
    const mobRow = within(dialog).getByRole('row', { name: /^Mobility/ });
    expect(within(mobRow).getByText('No change')).toBeInTheDocument();
  });

  it('labels parts with their localized names, never the raw part code', async () => {
    server.use(onboarded());
    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar'] });

    await screen.findByRole('heading', { name: 'My Ship' });
    // Tray button and the placed block's label both use the server-provided name.
    expect(await screen.findByRole('button', { name: /^Cargo Rack/ })).toBeInTheDocument();
    expect(container.textContent).toContain('Small Chemical Engine');
    expect(container.textContent).not.toContain('engine_chem_small');
    expect(container.textContent).not.toMatch(/\bcargo\b(?! Rack)/);
  });

  it('places a tray part on the yard and previews the layout after the debounce', async () => {
    server.use(onboarded());
    const previewLayouts: Placement[][] = [];
    server.use(
      http.post('/v1/ships/:id/preview', async ({ request }) => {
        const body = (await request.json()) as { layout: Placement[] };
        previewLayouts.push(body.layout);
        return HttpResponse.json(
          {
            sheet: testSheet,
            shipClass: 'MULTIROLE',
            viability: { viable: true, problems: [] },
            layout: body.layout,
            omittedPartInstanceIds: [],
          },
          { status: 200 },
        );
      }),
    );

    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar'] });
    const trayButton = await screen.findByRole('button', { name: /^cargo/i });

    fireEvent.click(trayButton);
    fireEvent.click(cell(container, 4, 0));

    const placed = block(container, 'part-cargo-b');
    expect(placed).not.toBeNull();
    expect(placed).toHaveAttribute('data-gx', '4');
    expect(placed).toHaveAttribute('data-gy', '0');

    await waitFor(
      () =>
        expect(
          previewLayouts.some((layout) =>
            layout.some(
              (placement) =>
                placement.partInstanceId === 'part-cargo-b' &&
                placement.gx === 4 &&
                placement.gy === 0,
            ),
          ),
        ).toBe(true),
      { timeout: 3000 },
    );
  });

  it('rotates and removes a selected block', async () => {
    server.use(onboarded());
    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar'] });

    const cargo = await waitFor(() => {
      const element = block(container, 'part-cargo-a');
      expect(element).not.toBeNull();
      return element as SVGRectElement;
    });

    const beforeWidth = Number(cargo.getAttribute('width'));
    const beforeHeight = Number(cargo.getAttribute('height'));

    fireEvent.pointerDown(cargo);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));

    const rotated = block(container, 'part-cargo-a');
    expect(rotated).not.toBeNull();
    // 2×1 cargo turns to a 1×2 footprint.
    expect(Number(rotated?.getAttribute('width'))).toBeCloseTo(beforeHeight, 3);
    expect(Number(rotated?.getAttribute('height'))).toBeCloseTo(beforeWidth, 3);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(block(container, 'part-cargo-a')).toBeNull();
    // Both cargo units are loose now.
    expect(screen.getAllByRole('button', { name: /^cargo/i })).toHaveLength(2);
  });

  it('saves the edited layout through assemble', async () => {
    server.use(onboarded());
    const assembled: Array<{ layout: Placement[] }> = [];
    server.use(
      http.post('/v1/ships/:id/assemble', async ({ request }) => {
        const body = (await request.json()) as { layout: Placement[] };
        assembled.push(body);
        return HttpResponse.json(shipEcho(body.layout), { status: 200 });
      }),
    );

    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar'] });
    const trayButton = await screen.findByRole('button', { name: /^cargo/i });
    fireEvent.click(trayButton);
    fireEvent.click(cell(container, 4, 0));

    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));

    await waitFor(() => expect(assembled).toHaveLength(1));
    expect(assembled[0]?.layout).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ partInstanceId: 'part-cargo-b', gx: 4, gy: 0 }),
      ]),
    );
    expect(await screen.findByText('Layout saved.')).toBeInTheDocument();
  });

  it('shows translated problems when the server rejects the layout', async () => {
    server.use(onboarded());
    server.use(
      http.post('/v1/ships/:id/assemble', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: {
              error: 'SHIP_NOT_VIABLE',
              problems: [{ code: 'NO_ENGINE', message: 'Ship has no engine installed.' }],
            },
          },
          { status: 400 },
        ),
      ),
    );

    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar'] });
    const trayButton = await screen.findByRole('button', { name: /^cargo/i });
    fireEvent.click(trayButton);
    fireEvent.click(cell(container, 4, 0));

    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));

    expect(await screen.findByText('No engine installed.')).toBeInTheDocument();
  });

  it('runs the auto layout through the server', async () => {
    server.use(onboarded());
    let autoCalls = 0;
    let sentIds: string[] = [];
    server.use(
      http.post('/v1/ships/:id/auto-assemble', async ({ request }) => {
        autoCalls += 1;
        sentIds = ((await request.json()) as { partInstanceIds?: string[] }).partInstanceIds ?? [];
        return HttpResponse.json(shipEcho([]), { status: 200 });
      }),
    );

    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    fireEvent.click(screen.getByRole('button', { name: 'Auto layout' }));
    await waitFor(() => expect(autoCalls).toBe(1));
    // Only the parts that are IN the ship are re-arranged: the loose spare stays in storage.
    expect(sentIds).toContain('part-bridge');
    expect(sentIds).not.toContain('part-cargo-b');
    expect(sentIds).toHaveLength(6);
  });

  it('rotate: a 1×1 part explains itself, a blocked rotation says why', async () => {
    server.use(onboarded());
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });
    const block = await waitFor(() => {
      const found = document.querySelector('rect.block');
      if (found === null) throw new Error('no block yet');
      return found;
    });
    fireEvent.pointerDown(block);
    fireEvent.click(await screen.findByRole('button', { name: 'Rotate' }));
    // Whatever part that is, the pilot gets an answer instead of a silent click.
    expect(await screen.findByTestId('rotate-hint')).toBeInTheDocument();
  });
});
