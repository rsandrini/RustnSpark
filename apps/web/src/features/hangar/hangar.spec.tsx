import { describe, it, expect, beforeEach } from 'vitest';
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
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the ship sheet, class and the loose-parts tray', async () => {
    server.use(onboarded());
    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar'] });

    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
    expect(screen.getAllByText('Multirole').length).toBeGreaterThan(0);
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

  it('opens straight to the Port or Board tab from a nested URL (owner request: reachable from the top nav, not just the local tab row)', async () => {
    server.use(onboarded());
    renderWithRouter(routes, { initialEntries: ['/hangar/port'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    // Embedded Port has no page <h1> of its own (round-3 nav consolidation kept that
    // suppressed); its own Market/Repair/Refuel/Scavenging tabs are always there.
    expect(await screen.findByRole('tab', { name: 'Refuel' })).toBeInTheDocument();
  });

  it('portals Port\'s own tab row above the ship animation, not below it (owner request)', async () => {
    server.use(onboarded());
    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar/port'] });
    await screen.findByRole('tab', { name: 'Refuel' });

    const slot = container.querySelector('.hangar-subnav-slot');
    expect(slot).not.toBeNull();
    expect(within(slot as HTMLElement).getByRole('tab', { name: 'Market' })).toBeInTheDocument();

    // DOM order: the slot (with Port's tabs now inside it) comes before the animated scene.
    const scene = container.querySelector('[data-testid="transit-scene"]');
    expect(scene).not.toBeNull();
    expect(
      slot!.compareDocumentPosition(scene as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('the legacy /board and /port links still work, now landing on the nested route', async () => {
    server.use(onboarded());
    renderWithRouter(routes, { initialEntries: ['/board'] });
    await screen.findByRole('heading', { name: 'My Ship' });
    // Embedded Board has no page <h1> of its own (round-3 nav consolidation kept that
    // suppressed); its filter chip group is always there and carries the same label.
    expect(await screen.findByRole('group', { name: 'Mission board' })).toBeInTheDocument();
  });


  it('hides the ship animation behind a toggle, persisted across a reload (owner request: extra screen space)', async () => {
    server.use(onboarded());
    const { container, unmount } = renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    const scene = container.querySelector('[data-testid="transit-scene"]');
    expect(scene).not.toBeNull();
    // Owner request, round 10 follow-up: the toggle sits ON the animation box itself (an
    // overlay), not in a row before or after it — both live inside the same positioned host.
    const host = container.querySelector('.ship-stage-overlay-host');
    expect(host).not.toBeNull();
    const toggle = screen.getByRole('button', { name: 'Hide animation' });
    expect(host!.contains(scene)).toBe(true);
    expect(host!.contains(toggle)).toBe(true);
    expect(toggle).toHaveClass('stage-toggle-overlay');

    fireEvent.click(toggle);
    expect(container.querySelector('[data-testid="transit-scene"]')).toBeNull();
    // Docked and ready has nothing left to say that the top bar's own ship status doesn't
    // already say on every screen (owner request, round 10) — no placeholder caption at all.
    expect(screen.queryByTestId('stage-caption')).toBeNull();
    expect(window.localStorage.getItem('rs.hangar.stageCollapsed')).toBe('1');

    unmount();
    const second = renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });
    expect(second.container.querySelector('[data-testid="transit-scene"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show animation' })).toBeInTheDocument();
  });

  it('shows a headline summary (8 key numbers) above the full stat breakdown, collapsed by default (owner request, round 8: ship sheet too long)', async () => {
    server.use(onboarded());
    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    const headline = await screen.findByTestId('sheet-headline');
    // crg 10 from the server sheet, shown as a headline tile (not a flat 20-row list).
    expect(within(headline).getByText('Cargo').closest('.sheet-headline-tile')).toHaveTextContent(
      '10',
    );
    for (const label of [
      'Firepower',
      'Defense',
      'Mobility',
      'Autonomy',
      'Condition',
      'Energy',
      'Structure',
    ]) {
      expect(within(headline).getByText(label)).toBeInTheDocument();
    }

    // The full 20-row breakdown is behind a closed-by-default disclosure, grouped into sections.
    const details = container.querySelector('details.sheet-details');
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Show all stats'));
    expect(details).toHaveAttribute('open');

    for (const group of ['Combat', 'Power', 'Propulsion & Range', 'Cargo', 'Hull']) {
      expect(within(details as HTMLElement).getByText(group)).toBeInTheDocument();
    }

    // Owner request: better, fuller descriptions ("Fuel tank" -> "Fuel tank capacity"), and the
    // existing per-row hover tooltip is preserved, not dropped by the restructure.
    const fuelRow = within(details as HTMLElement)
      .getByText('Fuel tank capacity')
      .closest('.statrow');
    expect(fuelRow).toHaveAttribute('title', expect.stringContaining('every installed tank'));

    // Cruising power (owner example: "generate"/"consume" instead of a bare signed number).
    // The only part with a nonzero energyCont in the fixture is the battery (+8).
    const cruiseRow = within(details as HTMLElement)
      .getByText('Cruising power')
      .closest('.statrow');
    expect(cruiseRow).toHaveTextContent('Surplus +8');
    expect(cruiseRow).toHaveTextContent('Generates 8');
    expect(cruiseRow).toHaveTextContent('Consumes 0');
    expect(cruiseRow?.querySelector('.pill')).toHaveClass('pill-ok');

    // Combat power: a draw checked against the battery's own output, not a surplus/deficit.
    const combatPowerRow = within(details as HTMLElement)
      .getByText('Combat power')
      .closest('.statrow');
    expect(combatPowerRow).toHaveTextContent('Draws 0/round');
    expect(combatPowerRow).toHaveTextContent('Battery covers it (10/round)');
  });

  it('shows the rarity in the hover popup for a placed block, not printed on the block itself (owner request, round 8 follow-up)', async () => {
    server.use(onboarded());
    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    const bridgeBlock = block(container, 'part-bridge');
    expect(bridgeBlock).not.toBeNull();
    // Not printed on the block itself — only in the popup that appears on hover.
    expect(bridgeBlock?.closest('g')?.querySelector('text.rarity-label')).toBeNull();

    fireEvent.pointerEnter(bridgeBlock as Element, { clientX: 100, clientY: 200 });
    const hoverCard = await screen.findByTestId('part-hover-card');
    const badge = within(hoverCard).getByText('Common');
    expect(badge).toHaveClass('rarity-badge');
    expect(badge).toHaveClass('rarity-common');
  });

  it('shows the rarity right after the part name in the tray list (owner request, round 7)', async () => {
    server.use(onboarded());
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    const trayButton = await screen.findByRole('button', { name: /^Cargo Rack/ });
    const badge = within(trayButton).getByText('Common');
    expect(badge).toHaveClass('rarity-badge');
    expect(badge).toHaveClass('rarity-common');
  });

  // Round-10 owner request: "add the rarity of the ship, top right of the ship sheet — the
  // lowest rarity part that is installed."
  it('shows the ship\'s own rarity (lowest among installed parts) next to the Ship Sheet heading', async () => {
    server.use(onboarded());
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    const sheetHeading = await screen.findByRole('heading', { name: 'Ship sheet' });
    const badge = within(sheetHeading.closest('.row-between')!).getByText('Common');
    expect(badge).toHaveClass('rarity-badge', 'rarity-common');
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
    // MOB_TOO_LOW ("Mobility is below 1.") problem shown right next to it. Mobility is a
    // headline tile (always visible), so scope to it — the same number also appears in the
    // collapsed "Show all stats" detail below.
    const headline = await screen.findByTestId('sheet-headline');
    expect(within(headline).getByText('0.96')).toBeInTheDocument();
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

    // "If installed" is Hangar-only, and (owner request, round 5 follow-up) shows the ship's
    // actual resulting stat, not a bare delta that collides with "This part"'s own column —
    // Cargo becomes 15 (10 + the part's own 5), the change shown alongside it in parens.
    // Everything untouched reads as just its own unchanged final value, no redundant label.
    const cargoRow = within(dialog).getByRole('row', { name: /^Cargo/ });
    await waitFor(() => expect(within(cargoRow).getByText('15 (+5)')).toBeInTheDocument());
    // More cargo is a good thing (owner request, round 5): the delta reads green, not a flat color.
    expect(within(cargoRow).getByText('15 (+5)')).toHaveClass('delta-good');
    // Mobility is unchanged (2 -> 2): both columns coincidentally show "2", so this checks the
    // delta cell specifically by its own class, not by (ambiguous) text.
    const mobRow = within(dialog).getByRole('row', { name: /^Mobility/ });
    const mobDelta = mobRow.querySelector('.delta');
    expect(mobDelta).toHaveTextContent('2');
    expect(mobDelta).toHaveClass('delta-same');
  });

  it('colors a worse change (more mass) red, not the same green as a better one', async () => {
    server.use(
      onboarded(),
      http.post('/v1/ships/:id/preview', async ({ request }) => {
        const body = (await request.json()) as { partInstanceIds?: string[] };
        const withCandidate = (body.partInstanceIds ?? []).includes('part-cargo-b');
        // part-cargo-b's own mass isn't in the test fixture catalog, so fake a real bump here —
        // more mass drags mobility down, so it must read as a bad (red) change, not good.
        return HttpResponse.json({
          sheet: { ...testSheet, mass: withCandidate ? testSheet.mass + 4 : testSheet.mass },
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

    const massRow = within(dialog).getByRole('row', { name: /^Mass/ });
    await waitFor(() => expect(within(massRow).getByText('28 (+4)')).toBeInTheDocument());
    expect(within(massRow).getByText('28 (+4)')).toHaveClass('delta-bad');
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

  it('shows a short "N problems" status above the headline once a layout edit comes back unviable (owner request, round 8: status on top, not buried after 20 rows)', async () => {
    server.use(
      onboarded(),
      http.post('/v1/ships/:id/preview', async ({ request }) => {
        const body = (await request.json()) as { layout: Placement[] };
        return HttpResponse.json(
          {
            sheet: testSheet,
            shipClass: 'MULTIROLE',
            viability: {
              viable: false,
              problems: [{ code: 'MOB_TOO_LOW', message: 'Mobility is below 1.' }],
            },
            layout: body.layout,
            omittedPartInstanceIds: [],
          },
          { status: 200 },
        );
      }),
    );

    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByText('Ready to fly');

    const trayButton = await screen.findByRole('button', { name: /^cargo/i });
    fireEvent.click(trayButton);
    fireEvent.click(cell(container, 4, 0));

    expect(await screen.findByText('1 problem(s)')).toBeInTheDocument();
    // The full, actionable detail (with its "find in store" fix) still renders separately,
    // below the sheet — the strip is a short pointer to it, not a replacement for it.
    expect(screen.getByText('Mobility is below 1.')).toBeInTheDocument();
  });

  it('Store compare uses the saved ship sheet, not an unsaved layout-edit preview (review finding)', async () => {
    server.use(onboarded());
    server.use(
      http.post('/v1/ships/:id/preview', async ({ request }) => {
        const body = (await request.json()) as {
          layout?: Placement[];
          virtualPart?: { partType: string };
        };
        if (body.layout !== undefined) {
          // The debounced unsaved-layout preview: a wildly different sheet, so the bug (using
          // this instead of the saved ship.sheet for the Store compare) would be unmissable.
          return HttpResponse.json({
            sheet: { ...testSheet, hp: 999 },
            shipClass: 'MULTIROLE',
            viability: { viable: true, problems: [] },
            layout: body.layout,
            omittedPartInstanceIds: [],
          });
        }
        // The market-compare virtual-part call: +6 on top of the real, saved ship sheet
        // (testSheet.hp is 40) — never the 999 from the unsaved layout edit above.
        return HttpResponse.json({
          sheet: { ...testSheet, hp: testSheet.hp + 6 },
          shipClass: 'MULTIROLE',
          viability: { viable: true, problems: [] },
          layout: [],
          omittedPartInstanceIds: [],
        });
      }),
    );

    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar'] });
    const trayButton = await screen.findByRole('button', { name: /^cargo/i });
    fireEvent.click(trayButton);
    fireEvent.click(cell(container, 4, 0));
    // Wait for the debounced layout preview to actually land, so preview.sheet really differs
    // from ship.sheet by the time the Store tab is opened.
    await waitFor(() => expect(screen.getByText('999')).toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByRole('tab', { name: 'Store' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Details: Plated Hull' }));
    const dialog = await screen.findByRole('dialog');

    const hpRow = within(dialog).getByRole('row', { name: /^Hit points/ });
    await waitFor(() => expect(within(hpRow).getByText('46 (+6)')).toBeInTheDocument());
  });

  it('hovering a tray part shows the comparison inline, without clicking (owner request)', async () => {
    server.use(
      onboarded(),
      http.post('/v1/ships/:id/preview', async ({ request }) => {
        const body = (await request.json()) as { partInstanceIds?: string[] };
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

    const trayButton = await screen.findByRole('button', { name: /^Cargo Rack/ });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.pointerEnter(trayButton, { clientX: 100, clientY: 200 });
    // Cargo goes to 15 (10 + this part's own 5) — the comparison shows up on hover alone,
    // never opening the full popup.
    await waitFor(() => expect(screen.getByText('15 (+5)')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.pointerLeave(trayButton);
    await waitFor(() => expect(screen.queryByText('15 (+5)')).not.toBeInTheDocument());
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
