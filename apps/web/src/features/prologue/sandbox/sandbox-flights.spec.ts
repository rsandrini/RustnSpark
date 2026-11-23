import {
  ActiveMissionSchema,
  DispatchResponseSchema,
  MissionOfferSchema,
  ReportListResponseSchema,
  ReportResponseSchema,
} from '@rustandspark/contract';
import { SANDBOX_WORLD } from './sandbox-world';
import { describe, expect, it } from 'vitest';
import { PROLOGUE_CARGO, PROLOGUE_ENGINE, PROLOGUE_START_PARTS } from '../prologue-fixtures';
import { sandboxInterceptor } from './sandbox-api';
import { createSandbox, type SandboxEvent } from './sandbox-state';
import { PLACE, SANDBOX_LIFE_SUPPORT, SANDBOX_PASSENGER_CABIN } from './sandbox-world';

const T0 = 1_700_000_000_000;

function fresh() {
  let now = T0;
  const sandbox = createSandbox({
    payouts: [646, 494, 2660],
    purse: 300,
    refuelCost: 100,
    moduleCost: 800,
    upgradeCost: 200,
    repairCost: 150,
    friendName: 'Kite',
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

const layoutWith = (...extra: Array<{ id: string; gx: number; gy: number }>) => [
  ...PROLOGUE_START_PARTS.map((part) => part.target),
  ...extra.map((part) => ({ partInstanceId: part.id, gx: part.gx, gy: part.gy, rot: 0 as const })),
];

async function fitEngine(env: Env) {
  await env.call('POST', '/v1/ships/prologue-ship/assemble', {
    layout: layoutWith({ id: PROLOGUE_ENGINE.id, gx: -4, gy: 0 }),
  });
}

async function board(env: Env) {
  const offers = (await env.call(
    'GET',
    `/v1/locations/${env.sandbox.state.locationId}/missions`,
  )) as unknown[];
  return offers.map((offer) => MissionOfferSchema.parse(offer));
}

async function flyRace(env: Env) {
  await fitEngine(env);
  await env.call('POST', '/v1/missions/sandbox-race/accept');
  await env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: 'sandbox-race' });
  env.advance(66);
  await env.call('GET', '/v1/missions/active');
}

describe('the sandbox board, the accept, the dispatch and the arrival', () => {
  it('shows the race at the start, and it needs an engine until the engine is fitted', async () => {
    const env = fresh();
    const [race] = await board(env);
    expect(race?.type).toBe('RACE');
    expect(race?.eligibility.eligible).toBe(false);
    expect(race?.eligibility.reasons.map((reason) => reason.code)).toContain('NO_ENGINE');

    await fitEngine(env);
    const [fitted] = await board(env);
    expect(fitted?.eligibility.eligible).toBe(true);
    expect(fitted?.info.race?.rivals).toHaveLength(1);
    expect(fitted?.info.race?.rivals[0]?.name).toBe('Kite');
  });

  it('refuses to take a job the ship does not qualify for, and says why', async () => {
    const env = fresh();
    await expect(env.call('POST', '/v1/missions/sandbox-race/accept')).rejects.toMatchObject({
      status: 409,
      code: 'NOT_ELIGIBLE',
    });
  });

  it('keeps the card honest when the ship changes after the job is taken', async () => {
    const env = fresh();
    await fitEngine(env);
    await env.call('POST', '/v1/missions/sandbox-race/accept');
    // the taken job is the active mission, pinned on its own: the board does not offer it a second time
    expect(await board(env)).toHaveLength(0);
    const active = async () =>
      (
        (await env.call('GET', '/v1/missions/active')) as Array<{
          eligibility: { eligible: boolean };
        }>
      )[0];
    expect((await active())?.eligibility.eligible).toBe(true);
    // the engine comes off: the same card must now say the ship no longer qualifies
    await env.call('POST', '/v1/ships/prologue-ship/assemble', { layout: layoutWith() });
    expect((await active())?.eligibility.eligible).toBe(false);
    await expect(
      env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: 'sandbox-race' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('sends the race out over three legs that each take as long as their line on the map', async () => {
    const env = fresh();
    await fitEngine(env);
    await env.call('POST', '/v1/missions/sandbox-race/accept');
    const sent = DispatchResponseSchema.parse(
      await env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: 'sandbox-race' }),
    );
    expect(sent.durationSeconds).toBeCloseTo(54.9, 5);
    const [active] = (await env.call('GET', '/v1/missions/active')) as unknown[];
    const mission = ActiveMissionSchema.parse(active);
    expect(mission.status).toBe('IN_TRANSIT');
    expect(mission.legWindows).toHaveLength(3);
    const seconds = mission.legWindows.map(
      (window) => (Date.parse(window.to) - Date.parse(window.from)) / 1000,
    );
    expect(seconds).toEqual([17.7, 18.4, 18.8]);
    // the ship on the map follows the clock: every leg's share of the time is its share of the drawn route
    const world = SANDBOX_WORLD;
    const spot = (id: string) => world.locations.find((entry) => entry.id === id)!;
    const lengths = mission.legWindows.map((window, index) => {
      const route = world.routes.find((entry) => entry.id === window.routeId)!;
      const from = spot(index === 0 ? mission.originId : route.nodeAId);
      const to = spot(route.nodeBId);
      return Math.hypot(from.x - to.x, from.y - to.y);
    });
    const ratio = seconds.map((value, index) => value / (lengths[index] ?? 1));
    ratio.forEach((value) => expect(value).toBeCloseTo(ratio[0] ?? 0, 1));
    const ships = (await env.call('GET', '/v1/ships')) as Array<{ status: string }>;
    expect(ships[0]?.status).toBe('ON_MISSION');
    expect(await board(env)).toEqual([]);
  });

  it('shows the standings after each leg: the pilot leads the first, the friend takes over', async () => {
    const env = fresh();
    await fitEngine(env);
    await env.call('POST', '/v1/missions/sandbox-race/accept');
    await env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: 'sandbox-race' });
    const [active] = (await env.call('GET', '/v1/missions/active')) as unknown[];
    const projection = ActiveMissionSchema.parse(active).info?.race?.projection ?? [];
    expect(projection).toHaveLength(3);
    expect(projection[0]?.standings[0]?.you).toBe(true);
    expect(projection[1]?.standings[0]?.you).toBe(false);
    expect(projection[2]?.standings[0]?.you).toBe(false);
  });

  it('brings the ship in on time: paid, docked at the destination, a report left behind', async () => {
    const env = fresh();
    await flyRace(env);
    expect(env.sandbox.state.credits).toBe(300 + 646);
    expect(env.sandbox.state.locationId).toBe(PLACE.dockside);
    expect(env.sandbox.state.slot).toBe(1);
    expect(env.sandbox.state.fuel).toBe(4);
    expect(env.events).toContainEqual({ type: 'arrived', missionId: 'sandbox-race' });
    expect(await env.call('GET', '/v1/missions/active')).toEqual([]);

    const list = ReportListResponseSchema.parse(await env.call('GET', '/v1/reports?limit=1'));
    expect(list.items[0]?.missionId).toBe('sandbox-race');
    for (const view of ['summary', 'narrative', 'log']) {
      const report = ReportResponseSchema.parse(
        await env.call('GET', `/v1/reports/sandbox-race?view=${view}`),
      );
      expect(report.stats.race?.place).toBe(2);
      expect(report.stats.race?.standings[0]?.name).toBe('Kite');
    }
    expect(env.events).toContainEqual({ type: 'report_opened', missionId: 'sandbox-race' });
  });

  it('does not let the ship leave without the fuel the trip needs', async () => {
    const env = fresh();
    await flyRace(env);
    await env.call('POST', '/v1/ships/prologue-ship/assemble', {
      layout: layoutWith({ id: PROLOGUE_ENGINE.id, gx: -4, gy: 0 }),
    });
    const offers = await board(env);
    expect(offers).toHaveLength(2);
    env.sandbox.addPart(SANDBOX_PASSENGER_CABIN, SANDBOX_PASSENGER_CABIN.id);
    env.sandbox.addPart(SANDBOX_LIFE_SUPPORT, SANDBOX_LIFE_SUPPORT.id);
    await env.call('POST', '/v1/ships/prologue-ship/assemble', {
      layout: layoutWith(
        { id: PROLOGUE_ENGINE.id, gx: -4, gy: 0 },
        { id: SANDBOX_PASSENGER_CABIN.id, gx: 1, gy: 0 },
        { id: SANDBOX_LIFE_SUPPORT.id, gx: 2, gy: 0 },
      ),
    });
    await env.call('POST', `/v1/missions/${offers[0]?.id}/accept`);
    env.sandbox.setFuel(0);
    await expect(
      env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: offers[0]?.id }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUEL' });
  });

  it('offers a job of each kind at the first stop, to different places, each needing its module', async () => {
    const env = fresh();
    await flyRace(env);
    const offers = await board(env);
    expect(offers.map((offer) => offer.type).sort()).toEqual(['DELIVERY', 'TRANSPORT']);
    expect(new Set(offers.map((offer) => offer.destinationId)).size).toBe(2);
    expect(offers[0]?.reward).toBe(494);
    expect(offers[1]?.reward).toBe(494);
    for (const offer of offers) {
      expect(offer.eligibility.eligible).toBe(false);
    }
  });

  it('offers the second stop in the kind of the module that was fitted, to different places', async () => {
    const env = fresh();
    await flyRace(env);
    env.sandbox.addPart(PROLOGUE_CARGO, PROLOGUE_CARGO.id);
    await env.call('POST', '/v1/ships/prologue-ship/assemble', {
      layout: layoutWith(
        { id: PROLOGUE_ENGINE.id, gx: -4, gy: 0 },
        { id: PROLOGUE_CARGO.id, gx: 1, gy: 0 },
      ),
    });
    env.sandbox.setFuel(300);
    const first = (await board(env)).find((offer) => offer.type === 'DELIVERY');
    expect(first?.eligibility.eligible).toBe(true);
    await env.call('POST', `/v1/missions/${first?.id}/accept`);
    await env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: first?.id });
    env.advance(60);
    await env.call('GET', '/v1/missions/active');
    expect(env.sandbox.state.credits).toBe(300 + 646 + 494);
    const second = await board(env);
    expect(second).toHaveLength(2);
    expect(second.every((offer) => offer.type === 'DELIVERY')).toBe(true);
    expect(new Set(second.map((offer) => offer.destinationId)).size).toBe(2);
    expect(second[0]?.reward).toBe(2660);
  });

  it('loses the ship on the final run: nothing is paid and the report says so', async () => {
    const env = fresh();
    await flyRace(env);
    env.sandbox.addPart(PROLOGUE_CARGO, PROLOGUE_CARGO.id);
    await env.call('POST', '/v1/ships/prologue-ship/assemble', {
      layout: layoutWith(
        { id: PROLOGUE_ENGINE.id, gx: -4, gy: 0 },
        { id: PROLOGUE_CARGO.id, gx: 1, gy: 0 },
      ),
    });
    env.sandbox.setFuel(300);
    // jump to the final board
    for (let slot = 1; slot < 3; slot += 1) {
      const job = (await board(env)).find((offer) => offer.type === 'DELIVERY');
      await env.call('POST', `/v1/missions/${job?.id}/accept`);
      await env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: job?.id });
      env.advance(60);
      await env.call('GET', '/v1/missions/active');
      env.sandbox.setFuel(300);
    }
    const credits = env.sandbox.state.credits;
    const [final] = await board(env);
    expect(final?.info.peakDanger).toBeGreaterThan(0);
    expect(final?.info.legCount).toBeGreaterThanOrEqual(1);
    expect(final?.reward).toBe(2500);
    // a cargo ship gets a final run of crates: eligible as it is, a delivery, not a passenger run
    expect(final?.type).toBe('DELIVERY');
    expect(final?.eligibility.eligible).toBe(true);
    expect(final?.info.cargo?.need).toBeGreaterThan(0);
    await env.call('POST', `/v1/missions/${final?.id}/accept`);
    await env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: final?.id });
    env.advance(120);
    await env.call('GET', '/v1/missions/active');
    expect(env.sandbox.state.credits).toBe(credits);
    expect(env.sandbox.state.shipLost).toBe(true);
    const report = ReportResponseSchema.parse(
      await env.call('GET', `/v1/reports/${final?.id}?view=summary`),
    );
    expect(report.outcome).toBe('failed');
    expect(report.stats.credits).toBe(0);
  });
});

describe('the final run follows the ship', () => {
  async function toFinalBoard(env: Env, kind: 'passengers' | 'crates') {
    await flyRace(env);
    if (kind === 'crates') {
      env.sandbox.addPart(PROLOGUE_CARGO, PROLOGUE_CARGO.id);
      await env.call('POST', '/v1/ships/prologue-ship/assemble', {
        layout: layoutWith(
          { id: PROLOGUE_ENGINE.id, gx: -4, gy: 0 },
          { id: PROLOGUE_CARGO.id, gx: 1, gy: 0 },
        ),
      });
    } else {
      env.sandbox.addPart(SANDBOX_PASSENGER_CABIN, SANDBOX_PASSENGER_CABIN.id);
      env.sandbox.addPart(SANDBOX_LIFE_SUPPORT, SANDBOX_LIFE_SUPPORT.id);
      await env.call('POST', '/v1/ships/prologue-ship/assemble', {
        layout: layoutWith(
          { id: PROLOGUE_ENGINE.id, gx: -4, gy: 0 },
          { id: SANDBOX_PASSENGER_CABIN.id, gx: 1, gy: 0 },
          { id: SANDBOX_LIFE_SUPPORT.id, gx: 2, gy: 0 },
        ),
      });
    }
    env.sandbox.setFuel(300);
    for (let slot = 1; slot < 3; slot += 1) {
      const type = kind === 'crates' ? 'DELIVERY' : 'TRANSPORT';
      const job = (await board(env)).find((offer) => offer.type === type);
      await env.call('POST', `/v1/missions/${job?.id}/accept`);
      await env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: job?.id });
      env.advance(60);
      await env.call('GET', '/v1/missions/active');
      env.sandbox.setFuel(300);
    }
    return board(env);
  }

  it('offers one final run of crates to a cargo ship, and it can take it', async () => {
    const env = fresh();
    const final = await toFinalBoard(env, 'crates');
    expect(final).toHaveLength(1);
    expect(final[0]?.type).toBe('DELIVERY');
    expect(final[0]?.eligibility.eligible).toBe(true);
    expect(final[0]?.info.title.en).toMatch(/crates/i);
  });

  it('offers one final run of passengers to a passenger ship, and it can take it', async () => {
    const env = fresh();
    const final = await toFinalBoard(env, 'passengers');
    expect(final).toHaveLength(1);
    expect(final[0]?.type).toBe('TRANSPORT');
    expect(final[0]?.eligibility.eligible).toBe(true);
    expect(final[0]?.info.title.en).toMatch(/passengers/i);
  });

  it('dispatch of an accepted job is refused with NOT_ELIGIBLE after the module is removed from the ship', async () => {
    const env = fresh();
    const final = await toFinalBoard(env, 'crates');
    await env.call('POST', `/v1/missions/${final[0]?.id}/accept`);
    await env.call('POST', '/v1/ships/prologue-ship/assemble', {
      layout: layoutWith({ id: PROLOGUE_ENGINE.id, gx: -4, gy: 0 }),
    });
    env.sandbox.setFuel(300);
    await expect(
      env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: final[0]?.id }),
    ).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });
    expect(env.sandbox.state.mission?.status).toBe('ACCEPTED');
  });
});

describe('the old ship', () => {
  it('starts with worn parts: the sheet and the hold say so', async () => {
    const env = fresh();
    const ships = (await env.call('GET', '/v1/ships')) as Array<{ sheet: { condition: number } }>;
    // far from new (the engine is not on the ship yet: bridge, tank and hull average about 40%)
    expect(ships[0]?.sheet.condition).toBeLessThan(50);
    expect(ships[0]?.sheet.condition).toBeGreaterThan(20);
    const hold = (await env.call('GET', '/v1/inventory')) as Array<{
      id: string;
      condition: number;
    }>;
    for (const part of hold) expect(part.condition).toBeLessThan(60);
  });

  it('burns a good part of the tank on the first race', async () => {
    const env = fresh();
    await fitEngine(env);
    await env.call('POST', '/v1/missions/sandbox-race/accept');
    const before = env.sandbox.state.fuel;
    await env.call('POST', '/v1/ships/prologue-ship/dispatch', { missionId: 'sandbox-race' });
    env.advance(60);
    await env.call('GET', '/v1/missions/active');
    expect(before - env.sandbox.state.fuel).toBeGreaterThan(30);
  });
});
