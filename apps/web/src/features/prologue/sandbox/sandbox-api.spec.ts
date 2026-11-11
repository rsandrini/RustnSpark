import {
  CatalogDetailSchema,
  DialogueStateSchema,
  DisplayResponseSchema,
  EnginePreviewSchema,
  FactionsResponseSchema,
  InventoryItemSchema,
  MaterialsResponseSchema,
  MyStatsResponseSchema,
  PartCatalogListItemSchema,
  PlayerProfileResponseSchema,
  PreviewResponseSchema,
  ShipFormatSchema,
  ShipResponseSchema,
  SystemNoticesResponseSchema,
  TutorialProgressSchema,
  WorldResponseSchema,
} from '@rustandspark/contract';
import { describe, expect, it } from 'vitest';
import { PROLOGUE_ENGINE, PROLOGUE_START_PARTS } from '../prologue-fixtures';
import { sandboxInterceptor } from './sandbox-api';
import { createSandbox, STARTING_FUEL, type SandboxEvent } from './sandbox-state';

const CONFIG = {
  payouts: [646, 494, 2660],
  purse: 300,
  refuelCost: 100,
  moduleCost: 800,
  upgradeCost: 200,
  profile: { id: 'player-1', name: 'Test Pilot', locale: 'en', role: 'PLAYER' as const },
};

function fresh() {
  const sandbox = createSandbox(CONFIG);
  const events: SandboxEvent[] = [];
  sandbox.subscribe((event) => events.push(event));
  const intercept = sandboxInterceptor(sandbox);
  const call = async (method: string, path: string, body?: unknown) => {
    const answer = await intercept({ method, path, body });
    if (!answer.handled) throw new Error(`not handled: ${method} ${path}`);
    return answer.value;
  };
  return { sandbox, events, call };
}

const startLayout = () => PROLOGUE_START_PARTS.map((part) => part.target);
const withEngine = (rot: 0 | 90 | 180 | 270 = 0, gx = -4, gy = 0) => [
  ...startLayout(),
  { partInstanceId: PROLOGUE_ENGINE.id, gx, gy, rot },
];

describe('the sandbox fake server answers what the real screens ask', () => {
  it('answers every read call in the shape the contract says', async () => {
    const { call } = fresh();
    expect(PlayerProfileResponseSchema.parse(await call('GET', '/v1/players/me'))).toMatchObject({
      id: 'player-1',
      credits: 300,
      factionId: null,
      tutorialDone: true,
    });
    const ships = (await call('GET', '/v1/ships')) as unknown[];
    expect(ships).toHaveLength(1);
    ShipResponseSchema.parse(ships[0]);
    ShipResponseSchema.parse(await call('GET', '/v1/ships/prologue-ship'));
    for (const format of (await call('GET', '/v1/ship-formats')) as unknown[])
      ShipFormatSchema.parse(format);
    for (const item of (await call('GET', '/v1/inventory')) as unknown[])
      InventoryItemSchema.parse(item);
    for (const item of (await call('GET', '/v1/parts/catalog')) as unknown[])
      PartCatalogListItemSchema.parse(item);
    WorldResponseSchema.parse(await call('GET', '/v1/locations'));
    DisplayResponseSchema.parse(await call('GET', '/v1/display'));
    FactionsResponseSchema.parse(await call('GET', '/v1/factions'));
    SystemNoticesResponseSchema.parse(await call('GET', '/v1/system/notices'));
    MaterialsResponseSchema.parse(await call('GET', '/v1/materials'));
    MyStatsResponseSchema.parse(await call('GET', '/v1/players/me/stats'));
    TutorialProgressSchema.parse(await call('GET', '/v1/players/me/tutorial-progress'));
    DialogueStateSchema.parse(await call('GET', '/v1/players/me/dialogue'));
    CatalogDetailSchema.parse(await call('GET', '/v1/catalog/parts/engine_chem_small'));
    EnginePreviewSchema.parse(await call('POST', '/v1/ships/prologue-ship/engine-preview', {}));
    PreviewResponseSchema.parse(
      await call('POST', '/v1/ships/prologue-ship/preview', { layout: startLayout() }),
    );
  });

  it('starts with the purse, almost no fuel, three parts fitted and the friend’s engine in the hold', async () => {
    const { call } = fresh();
    const ship = ShipResponseSchema.parse(await call('GET', '/v1/ships/prologue-ship'));
    expect(ship.fuel).toBe(STARTING_FUEL);
    expect(ship.layout).toHaveLength(3);
    const inventory = (await call('GET', '/v1/inventory')) as Array<{
      partType: string;
      location: string;
    }>;
    expect(inventory.find((item) => item.partType === 'engine_chem_small')?.location).toBe(
      'INVENTORY',
    );
  });

  it('says the ship cannot fly without an engine, and can with the engine fitted right', async () => {
    const { call } = fresh();
    const without = PreviewResponseSchema.parse(
      await call('POST', '/v1/ships/prologue-ship/preview', { layout: startLayout() }),
    );
    expect(without.viability.viable).toBe(false);
    expect(without.viability.problems.map((problem) => problem.code)).toContain('NO_ENGINE');

    const fitted = PreviewResponseSchema.parse(
      await call('POST', '/v1/ships/prologue-ship/preview', { layout: withEngine() }),
    );
    expect(fitted.viability.viable).toBe(true);
    expect(fitted.disconnectedPartIds).toEqual([]);
    expect(fitted.sheet.mob).toBeGreaterThan(0);
  });

  it('keeps a wrongly placed engine on the ship and reports it, instead of refusing it', async () => {
    const { call } = fresh();
    const wrong = PreviewResponseSchema.parse(
      await call('POST', '/v1/ships/prologue-ship/preview', { layout: withEngine(0, -4, -1) }),
    );
    expect(wrong.disconnectedPartIds).toContain(PROLOGUE_ENGINE.id);
    expect(wrong.viability.viable).toBe(false);

    const turned = PreviewResponseSchema.parse(
      await call('POST', '/v1/ships/prologue-ship/preview', { layout: withEngine(180) }),
    );
    expect(turned.viability.warnings.length + turned.disconnectedPartIds.length).toBeGreaterThan(0);
  });

  it('installs the parts a save lists and tells the director which one was fitted', async () => {
    const { call, events, sandbox } = fresh();
    const ship = ShipResponseSchema.parse(
      await call('POST', '/v1/ships/prologue-ship/assemble', { layout: withEngine() }),
    );
    expect(ship.layout).toHaveLength(4);
    expect(events).toContainEqual({ type: 'part_fitted', partId: PROLOGUE_ENGINE.id });
    expect(sandbox.state.parts.find((entry) => entry.id === PROLOGUE_ENGINE.id)?.location).toBe(
      'INSTALLED',
    );
  });

  it('takes a part back to the hold when a save leaves it out', async () => {
    const { call, events } = fresh();
    await call('POST', '/v1/ships/prologue-ship/assemble', { layout: withEngine() });
    await call('POST', '/v1/ships/prologue-ship/assemble', { layout: startLayout() });
    expect(events).toContainEqual({ type: 'part_removed', partId: PROLOGUE_ENGINE.id });
  });

  it('refuses a save with parts on top of each other, like the server does', async () => {
    const { call } = fresh();
    const overlapping = [
      ...startLayout(),
      { partInstanceId: PROLOGUE_ENGINE.id, gx: -3, gy: 0, rot: 0 as const },
    ];
    await expect(
      call('POST', '/v1/ships/prologue-ship/assemble', { layout: overlapping }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_LAYOUT',
    });
  });

  it('keeps a part parked outside the yard, flags it and keeps the ship on the ground (it is not refused)', async () => {
    const { call, sandbox } = fresh();
    const ship = ShipResponseSchema.parse(
      await call('POST', '/v1/ships/prologue-ship/assemble', { layout: withEngine(0, -8, 0) }),
    );
    expect(
      ship.layout.find((placement) => placement.partInstanceId === PROLOGUE_ENGINE.id)?.outside,
    ).toBe(true);
    const preview = PreviewResponseSchema.parse(
      await call('POST', '/v1/ships/prologue-ship/preview', { layout: ship.layout }),
    );
    expect(preview.viability.problems.map((problem) => problem.code)).toContain('PART_OUTSIDE');
    expect(sandbox.state.parts.find((entry) => entry.id === PROLOGUE_ENGINE.id)?.location).toBe(
      'INSTALLED',
    );
  });

  it('reports a part that touches the hull but not through a port that fits, without refusing the save', async () => {
    const { call } = fresh();
    const preview = PreviewResponseSchema.parse(
      await call('POST', '/v1/ships/prologue-ship/preview', { layout: withEngine(90) }),
    );
    expect(preview.viability.viable).toBe(false);
    expect(preview.viability.problems.length + preview.viability.warnings.length).toBeGreaterThan(
      0,
    );
  });

  it('leaves a call it does not know to the network', async () => {
    const { sandbox } = fresh();
    const intercept = sandboxInterceptor(sandbox);
    expect(await intercept({ method: 'POST', path: '/v1/players/me/prologue', body: {} })).toEqual({
      handled: false,
    });
    expect(await intercept({ method: 'POST', path: '/v1/auth/refresh', body: undefined })).toEqual({
      handled: false,
    });
  });
});
