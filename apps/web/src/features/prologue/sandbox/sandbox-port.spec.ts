import {
  BuyResponseSchema,
  InventoryItemSchema,
  MarketResponseSchema,
  PartUpgradeQuoteResponseSchema,
  PartUpgradeResponseSchema,
  RefuelQuoteResponseSchema,
  RefuelResponseSchema,
} from '@rustandspark/contract';
import { describe, expect, it } from 'vitest';
import { PROLOGUE_ENGINE, PROLOGUE_START_PARTS } from '../prologue-fixtures';
import { sandboxInterceptor } from './sandbox-api';
import { createSandbox, type SandboxEvent } from './sandbox-state';

const T0 = 1_700_000_000_000;
const MODULE = 'catalog:sandbox:passenger_cabin';

function fresh() {
  let now = T0;
  const sandbox = createSandbox({
    payouts: [646, 494, 2660],
    purse: 300,
    refuelCost: 100,
    moduleCost: 800,
    upgradeCost: 200,
    repairCost: 150,
    clock: () => now,
    profile: { id: 'player-1', name: 'Test Pilot', locale: 'en', role: 'PLAYER' },
  });
  const events: SandboxEvent[] = [];
  sandbox.subscribe((event) => events.push(event));
  const intercept = sandboxInterceptor(sandbox);
  const call = async (method: string, path: string, body?: unknown) => {
    const answer = await intercept({ method, path, body });
    if (!answer.handled) throw new Error(`not handled: ${method} ${path}`);
    return answer.value;
  };
  return {
    sandbox,
    events,
    call,
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
  };
}

type Env = ReturnType<typeof fresh>;

async function raceDone(env: Env) {
  await env.call('POST', '/v1/ships/prologue-ship/assemble', {
    layout: [
      ...PROLOGUE_START_PARTS.map((part) => part.target),
      { partInstanceId: PROLOGUE_ENGINE.id, gx: -4, gy: 0, rot: 0 },
    ],
  });
  await env.call('POST', '/v1/missions/sandbox-race/accept');
  await env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: 'sandbox-race' });
  env.advance(66);
  await env.call('GET', '/v1/missions/active');
}

describe('the sandbox port: the market and the refuel', () => {
  it('lists every module; a passenger job costs the same in two parts as a cargo job in one', async () => {
    const { call } = fresh();
    const market = MarketResponseSchema.parse(
      await call('GET', '/v1/locations/sandbox-dockside/market'),
    );
    expect(market.listings.map((listing) => listing.partType).sort()).toEqual([
      'cargo',
      'life_support',
      'passenger_cabin',
    ]);
    const price = (type: string) => market.listings.find((l) => l.partType === type)?.price;
    expect(price('cargo')).toBe(800);
    expect((price('passenger_cabin') ?? 0) + (price('life_support') ?? 0)).toBe(800);
  });

  it('shows the other job’s modules but will not sell them', async () => {
    const env = fresh();
    env.sandbox.addCredits(2000);
    env.sandbox.choose('passengers');
    const market = MarketResponseSchema.parse(
      await env.call('GET', '/v1/locations/sandbox-dockside/market'),
    );
    const blocked = market.listings.filter((l) => l.blockedReason !== undefined);
    expect(blocked.map((l) => l.partType)).toEqual(['cargo']);
    await expect(
      env.call('POST', '/v1/market/buy', {
        listingId: 'catalog:sandbox:cargo',
        expectedPrice: 800,
      }),
    ).rejects.toMatchObject({ code: 'LISTING_BLOCKED' });
  });

  it('takes a bought part off the shelf', async () => {
    const env = fresh();
    env.sandbox.addCredits(2000);
    env.sandbox.choose('passengers');
    await env.call('POST', '/v1/market/buy', { listingId: MODULE, expectedPrice: 400 });
    const market = MarketResponseSchema.parse(
      await env.call('GET', '/v1/locations/sandbox-dockside/market'),
    );
    expect(market.listings.map((listing) => listing.partType).sort()).toEqual([
      'cargo',
      'life_support',
    ]);
    await expect(
      env.call('POST', '/v1/market/buy', { listingId: MODULE, expectedPrice: 400 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a purchase the pilot cannot pay for, and one at a stale price', async () => {
    const { call } = fresh();
    await expect(
      call('POST', '/v1/market/buy', { listingId: MODULE, expectedPrice: 400 }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_FUNDS',
    });
    await expect(
      call('POST', '/v1/market/buy', { listingId: MODULE, expectedPrice: 1 }),
    ).rejects.toMatchObject({
      code: 'PRICE_CHANGED',
    });
  });

  it('sells a module for the price: the credits drop and the part waits in the hold', async () => {
    const env = fresh();
    env.sandbox.addCredits(1000);
    const bought = BuyResponseSchema.parse(
      await env.call('POST', '/v1/market/buy', { listingId: MODULE, expectedPrice: 400 }),
    );
    expect(bought.price).toBe(400);
    expect(bought.credits).toBe(900);
    expect(env.events).toContainEqual({ type: 'bought', partType: 'passenger_cabin' });
    const inventory = ((await env.call('GET', '/v1/inventory')) as unknown[]).map((item) =>
      InventoryItemSchema.parse(item),
    );
    const part = inventory.find((item) => item.id === bought.partInstanceId);
    expect(part?.location).toBe('INVENTORY');
    expect(part?.catalog.pressurized).toBe(true);
    const me = (await env.call('GET', '/v1/players/me')) as { credits: number };
    expect(me.credits).toBe(900);
  });

  it('repairs the worn parts for the opening’s one repair price, then there is nothing left to repair', async () => {
    const env = fresh();
    env.sandbox.addCredits(500);
    const worn = env.sandbox.wornParts();
    expect(worn.length).toBeGreaterThan(0);
    const targets = worn.map((part) => ({ partInstanceId: part.id, toCondition: 100 }));
    const quote = (await env.call('POST', '/v1/ships/prologue-ship/repair/quote', { targets })) as {
      cost: number;
    };
    expect(quote.cost).toBe(150);
    const before = env.sandbox.state.credits;
    await env.call('POST', '/v1/ships/prologue-ship/repair', { targets });
    expect(env.sandbox.state.credits).toBe(before - 150);
    expect(env.sandbox.wornParts()).toEqual([]);
    expect(env.events).toContainEqual({ type: 'repaired' });
    await expect(
      env.call('POST', '/v1/ships/prologue-ship/repair/quote', { targets }),
    ).rejects.toMatchObject({ code: 'NO_REPAIR_TARGETS' });
  });

  it('quotes a full tank at the opening’s refuel price and fills it', async () => {
    const env = fresh();
    await raceDone(env);
    const quote = RefuelQuoteResponseSchema.parse(
      await env.call('POST', '/v1/ships/prologue-ship/refuel/quote', { mode: 'full' }),
    );
    expect(quote.cost).toBe(100);
    expect(quote.space).toBeGreaterThan(0);
    const credits = env.sandbox.state.credits;
    const done = RefuelResponseSchema.parse(
      await env.call('POST', '/v1/ships/prologue-ship/refuel', { mode: 'full' }),
    );
    expect(done.fuel).toBe(done.fuelCap);
    expect(env.sandbox.state.credits).toBe(credits - 100);
    expect(env.events).toContainEqual({ type: 'refuelled' });
    const again = RefuelQuoteResponseSchema.parse(
      await env.call('POST', '/v1/ships/prologue-ship/refuel/quote', { mode: 'full' }),
    );
    expect(again.units).toBe(0);
    expect(again.cost).toBe(0);
  });

  it('refuses a refuel the pilot cannot pay for', async () => {
    const env = fresh();
    await raceDone(env);
    env.sandbox.addCredits(-env.sandbox.state.credits);
    await expect(
      env.call('POST', '/v1/ships/prologue-ship/refuel', { mode: 'full' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });

  it('keeps the money exact: the race, the refuel, the module and the second job leave the pilot with the start credits', async () => {
    const env = fresh();
    await raceDone(env);
    await env.call('POST', '/v1/ships/prologue-ship/refuel', { mode: 'full' });
    env.sandbox.choose('passengers');
    // a passenger job's two parts cost what one cargo hold does
    const cabin = BuyResponseSchema.parse(
      await env.call('POST', '/v1/market/buy', { listingId: MODULE, expectedPrice: 400 }),
    );
    const life = BuyResponseSchema.parse(
      await env.call('POST', '/v1/market/buy', {
        listingId: 'catalog:sandbox:life_support',
        expectedPrice: 400,
      }),
    );
    await env.call('POST', '/v1/ships/prologue-ship/assemble', {
      layout: [
        ...PROLOGUE_START_PARTS.map((part) => part.target),
        { partInstanceId: PROLOGUE_ENGINE.id, gx: -4, gy: 0, rot: 0 },
        { partInstanceId: cabin.partInstanceId, gx: 1, gy: 0, rot: 0 },
        { partInstanceId: life.partInstanceId, gx: 2, gy: 0, rot: 0 },
      ],
    });
    for (const slot of [1, 2]) {
      if (slot === 2) {
        // between the two jobs the friend hands over scrap and the pilot upgrades the hull
        env.sandbox.giveScrap(5);
        await env.call('POST', '/v1/parts/prologue-hull/upgrade');
      }
      const [first] = (await env.call(
        'GET',
        `/v1/locations/${env.sandbox.state.locationId}/missions`,
      )) as Array<{ id: string; type: string }>;
      expect(first?.type).toBe('TRANSPORT');
      await env.call('POST', `/v1/missions/${first?.id}/accept`);
      await env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: first?.id });
      env.advance(60);
      await env.call('GET', '/v1/missions/active');
      expect(env.sandbox.state.slot).toBe(slot + 1);
    }
    expect(env.sandbox.state.credits).toBe(300 + 646 - 100 - 800 + 494 - 200 + 2660);
    expect(env.sandbox.state.credits).toBe(3000);
  });
});

describe('the sandbox passenger job: a head count that seats and life support must cover', () => {
  type Offer = {
    type: string;
    info: {
      requirements: Array<{
        code: string;
        met: boolean;
        needed?: number;
        actual?: number;
        unit?: string;
      }>;
    };
  };

  it('shows the three checks, unmet before the cabin and met once the cabin and life support are fitted', async () => {
    const env = fresh();
    await raceDone(env);
    await env.call('POST', '/v1/ships/prologue-ship/refuel', { mode: 'full' });
    env.sandbox.choose('passengers');
    const board = async () =>
      ((await env.call('GET', `/v1/locations/${env.sandbox.state.locationId}/missions`)) as Offer[])
        .find((offer) => offer.type === 'TRANSPORT')!
        .info.requirements.filter((check) =>
          ['PRESSURIZED_LIFE_SUPPORT', 'PASSENGER_SEATS', 'LIFE_SUPPORT_CAPACITY'].includes(
            check.code,
          ),
        );
    const before = await board();
    expect(before.map((check) => check.code)).toEqual([
      'PRESSURIZED_LIFE_SUPPORT',
      'PASSENGER_SEATS',
      'LIFE_SUPPORT_CAPACITY',
    ]);
    expect(before.every((check) => !check.met)).toBe(true);
    expect(before[1]).toMatchObject({ needed: 2, actual: 0, unit: 'passengers' });

    const cabin = BuyResponseSchema.parse(
      await env.call('POST', '/v1/market/buy', { listingId: MODULE, expectedPrice: 400 }),
    );
    const life = BuyResponseSchema.parse(
      await env.call('POST', '/v1/market/buy', {
        listingId: 'catalog:sandbox:life_support',
        expectedPrice: 400,
      }),
    );
    await env.call('POST', '/v1/ships/prologue-ship/assemble', {
      layout: [
        ...PROLOGUE_START_PARTS.map((part) => part.target),
        { partInstanceId: PROLOGUE_ENGINE.id, gx: -4, gy: 0, rot: 0 },
        { partInstanceId: cabin.partInstanceId, gx: 1, gy: 0, rot: 0 },
        { partInstanceId: life.partInstanceId, gx: 2, gy: 0, rot: 0 },
      ],
    });
    const after = await board();
    expect(after.every((check) => check.met)).toBe(true);
    expect(after[1]?.actual).toBeGreaterThanOrEqual(after[1]?.needed ?? Infinity);
    expect(after[2]?.actual).toBeGreaterThanOrEqual(after[2]?.needed ?? Infinity);
  });
});

async function sheetNow(env: ReturnType<typeof fresh>) {
  const ships = (await env.call('GET', '/v1/ships')) as Array<{
    sheet: { hp: number; pdf: number };
  }>;
  return ships[0]!.sheet;
}

describe('the sandbox upgrade: the hull, with the scrap the friend gives', () => {
  it('quotes only the hull, takes the credits and the scrap, and makes the sheet stronger', async () => {
    const env = fresh();
    await raceDone(env);
    const before = await sheetNow(env);

    const none = PartUpgradeQuoteResponseSchema.parse(
      await env.call('POST', '/v1/parts/prologue-engine/upgrade/quote'),
    );
    expect(none.eligible).toBe(false);

    env.sandbox.giveScrap(5);
    const credits = env.sandbox.state.credits;
    const quote = PartUpgradeQuoteResponseSchema.parse(
      await env.call('POST', '/v1/parts/prologue-hull/upgrade/quote'),
    );
    expect(quote).toMatchObject({ eligible: true, cost: 200, nextRarity: 'UNCOMMON' });
    expect(quote.materials).toEqual([expect.objectContaining({ needed: 5, have: 5 })]);

    PartUpgradeResponseSchema.parse(await env.call('POST', '/v1/parts/prologue-hull/upgrade'));
    expect(env.sandbox.state.credits).toBe(credits - 200);
    expect(env.sandbox.state.scrap).toBe(0);
    expect(env.events).toContainEqual({ type: 'upgraded', partId: 'prologue-hull' });
    const after = await sheetNow(env);
    // the catalog's own tier: more hit points, and a hull never gives firepower
    expect(after.hp).toBeGreaterThan(before.hp);
    expect(after.pdf).toBe(before.pdf);
    const again = PartUpgradeQuoteResponseSchema.parse(
      await env.call('POST', '/v1/parts/prologue-hull/upgrade/quote'),
    );
    expect(again.eligible).toBe(false);
  });

  it('refuses without the scrap, or without the credits', async () => {
    const env = fresh();
    await raceDone(env);
    await expect(env.call('POST', '/v1/parts/prologue-hull/upgrade')).rejects.toMatchObject({
      code: 'INSUFFICIENT_MATERIALS',
    });
    env.sandbox.giveScrap(5);
    env.sandbox.addCredits(-env.sandbox.state.credits);
    await expect(env.call('POST', '/v1/parts/prologue-hull/upgrade')).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
  });
});
