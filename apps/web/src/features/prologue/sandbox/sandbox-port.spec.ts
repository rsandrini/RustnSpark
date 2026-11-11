import {
  BuyResponseSchema,
  InventoryItemSchema,
  MarketResponseSchema,
  RefuelQuoteResponseSchema,
  RefuelResponseSchema,
} from '@rustandspark/contract';
import { describe, expect, it } from 'vitest';
import { PROLOGUE_ENGINE, PROLOGUE_START_PARTS } from '../prologue-fixtures';
import { sandboxInterceptor } from './sandbox-api';
import { createSandbox, type SandboxEvent } from './sandbox-state';

const T0 = 1_700_000_000_000;
const MODULE = 'catalog:sandbox:passenger_module';

function fresh() {
  let now = T0;
  const sandbox = createSandbox({
    payouts: [720, 1080, 1800],
    purse: 300,
    refuelCost: 100,
    moduleCost: 800,
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
  it('lists the two modules at the opening’s one price', async () => {
    const { call } = fresh();
    const market = MarketResponseSchema.parse(
      await call('GET', '/v1/locations/sandbox-dockside/market'),
    );
    expect(market.listings.map((listing) => listing.partType).sort()).toEqual([
      'cargo',
      'passenger_module',
    ]);
    for (const listing of market.listings) expect(listing.price).toBe(800);
  });

  it('refuses a purchase the pilot cannot pay for, and one at a stale price', async () => {
    const { call } = fresh();
    await expect(
      call('POST', '/v1/market/buy', { listingId: MODULE, expectedPrice: 800 }),
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
      await env.call('POST', '/v1/market/buy', { listingId: MODULE, expectedPrice: 800 }),
    );
    expect(bought.price).toBe(800);
    expect(bought.credits).toBe(500);
    expect(env.events).toContainEqual({ type: 'bought', partType: 'passenger_module' });
    const inventory = ((await env.call('GET', '/v1/inventory')) as unknown[]).map((item) =>
      InventoryItemSchema.parse(item),
    );
    const part = inventory.find((item) => item.id === bought.partInstanceId);
    expect(part?.location).toBe('INVENTORY');
    expect(part?.catalog.pressurized).toBe(true);
    const me = (await env.call('GET', '/v1/players/me')) as { credits: number };
    expect(me.credits).toBe(500);
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
    const bought = BuyResponseSchema.parse(
      await env.call('POST', '/v1/market/buy', { listingId: MODULE, expectedPrice: 800 }),
    );
    await env.call('POST', '/v1/ships/prologue-ship/assemble', {
      layout: [
        ...PROLOGUE_START_PARTS.map((part) => part.target),
        { partInstanceId: PROLOGUE_ENGINE.id, gx: -4, gy: 0, rot: 0 },
        { partInstanceId: bought.partInstanceId, gx: 1, gy: 0, rot: 0 },
      ],
    });
    for (const slot of [1, 2]) {
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
    expect(env.sandbox.state.credits).toBe(300 + 720 - 100 - 800 + 1080 + 1800);
    expect(env.sandbox.state.credits).toBe(3000);
  });
});
