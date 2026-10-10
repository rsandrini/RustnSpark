import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { MissionInstance, Prisma } from '@prisma/client';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  AdminWorldResponseSchema,
  DashboardResponseSchema,
  EconomyResponseSchema,
} from '@rustandspark/contract';
import { contract } from '../support/contract.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { accessTokenFrom, seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// The window every request asks for: one hour back, a minute into the future so rows
// stamped "now" are always inside it. OLD rows sit 30 days back, outside any window.
function windowBounds(): { from: Date; to: Date } {
  return { from: new Date(Date.now() - HOUR), to: new Date(Date.now() + 60_000) };
}
const OLD = (): Date => new Date(Date.now() - 30 * DAY);
const query = (window: { from: Date; to: Date }): string =>
  `?from=${window.from.toISOString()}&to=${window.to.toISOString()}`;

interface AdminCredentials {
  accountId: string;
  token: string;
}

// Fresh admin per call: the login route is throttled 5/min per ip+email (same budget as
// the system-admin suite). Its nested player is backdated so the dashboard's "new
// players" count isn't polluted by the admin login itself.
async function makeAdmin(
  prisma: PrismaService,
  passwordService: PasswordService,
  server: Server,
): Promise<AdminCredentials> {
  const email = `admin-${crypto.randomUUID()}@example.com`;
  const account = await prisma.account.create({
    data: {
      email,
      passwordHash: await passwordService.hash('admin-password-1'),
      role: 'ADMIN',
      player: {
        create: {
          name: `a_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
          credits: 0,
          locale: 'en',
          createdAt: OLD(),
        },
      },
    },
  });
  const response = await request(server)
    .post('/v1/auth/login')
    .send({ email, password: 'admin-password-1' });
  expect(response.status).toBe(200);
  return { accountId: account.id, token: accessTokenFrom(response) };
}

// S11.3 acceptance: "with a seeded fixture the aggregates are exact … queries are
// time-windowed and indexed". Every number below is pinned by rows this file writes.
describe('admin analytics: dashboard, economy, world (S11.3)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let server: Server;
  let rulesHash: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    server = httpServer(testApp.app);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed(prisma);
    await testApp.app.get(GameConfigService).refresh();
    const snapshot = await prisma.rulesSnapshot.create({
      data: { hash: 's11.3-rules', rules: {} },
    });
    rulesHash = snapshot.hash;
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  async function makeMission(
    overrides: Partial<{
      originId: string;
      playerId: string | null;
      createdAt: Date;
      acceptedAt: Date | null;
    }> = {},
  ): Promise<MissionInstance> {
    const template = await prisma.missionTemplate.findFirstOrThrow({
      where: { type: 'DELIVERY' },
      orderBy: { id: 'asc' },
    });
    return prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type: 'DELIVERY',
        factionId: template.factionId,
        originId: 'ceres',
        destinationId: 'hedus',
        legs: [],
        cargo: {},
        reward: 100,
        expiresAt: new Date(Date.now() + HOUR),
        seed: randomUUID(),
        ...overrides,
      },
    });
  }

  // A stored MissionLog as resolve.service writes it: `{ legs, events }` inside legs.
  // Its mission row is backdated so log fixtures never pollute generation counts.
  async function makeLog(input: {
    playerId: string;
    outcome: string;
    events: readonly unknown[];
    at: Date;
  }): Promise<void> {
    const mission = await makeMission({
      playerId: input.playerId,
      createdAt: OLD(),
      acceptedAt: null,
    });
    await prisma.missionLog.create({
      data: {
        missionId: mission.id,
        playerId: input.playerId,
        seed: randomUUID(),
        rulesHash,
        outcome: input.outcome,
        shipSnapshot: {},
        legs: {
          legs: [{ index: 0, status: 'completed' }],
          events: input.events as Prisma.InputJsonArray,
        },
        createdAt: input.at,
      },
    });
  }

  async function makeShip(
    ownerPlayerId: string,
    options: { installedValue?: number } = {},
  ): Promise<{ id: string }> {
    const ship = await prisma.ship.create({
      data: {
        ownerPlayerId,
        name: `ship-${randomUUID().slice(0, 8)}`,
        layout: {},
        currentLocationId: 'ceres',
      },
    });
    if (options.installedValue !== undefined) {
      const catalog = await prisma.partCatalog.findFirstOrThrow({ orderBy: { basePrice: 'desc' } });
      const count = Math.floor(options.installedValue / catalog.basePrice) + 1;
      await prisma.partInstance.createMany({
        data: Array.from({ length: count }, () => ({
          partType: catalog.partType,
          ownerPlayerId,
          shipId: ship.id,
          condition: 1,
          location: 'INSTALLED' as const,
        })),
      });
    }
    return ship;
  }

  async function addPresence(
    missionId: string,
    shipId: string,
    routeId: string,
    legIndex: number,
    from: Date,
    to: Date,
  ): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO "RoutePresence" ("id", "missionId", "shipId", "routeId", "legIndex", "window")
      VALUES (
        gen_random_uuid(), ${missionId}, ${shipId}, ${routeId}, ${legIndex},
        tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)
      )
    `;
  }

  const combat = (type: 'combat_win' | 'combat_loss'): Record<string, unknown> => ({
    leg: 0,
    category: 'combat',
    type,
    actors: { enemy: 'pirate' },
    magnitude: 1,
  });

  it('aggregates players, mission success, winrate vs baseline and tiers exactly', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const auth = `Bearer ${admin.token}`;
    const window = windowBounds();

    // p1 new+active, p2 new but quiet in the window, p3 active but created long ago.
    const p1 = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const p2 = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const p3 = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    await prisma.player.update({ where: { id: p3.player.id }, data: { createdAt: OLD() } });
    await prisma.playerEvent.createMany({
      data: [
        { playerId: p1.player.id, type: 'leg_travel' },
        { playerId: p3.player.id, type: 'leg_travel' },
        { playerId: p2.player.id, type: 'leg_travel', at: OLD() },
      ],
    });

    // 4 in-window logs (2 success, 1 partial, 1 failed) + 1 success from long ago.
    await makeLog({
      playerId: p1.player.id,
      outcome: 'success',
      events: [combat('combat_win'), combat('combat_win'), combat('combat_loss')],
      at: new Date(),
    });
    await makeLog({
      playerId: p1.player.id,
      outcome: 'success',
      events: [combat('combat_win')],
      at: new Date(),
    });
    await makeLog({
      playerId: p1.player.id,
      outcome: 'partial_failure',
      events: [],
      at: new Date(),
    });
    await makeLog({ playerId: p1.player.id, outcome: 'failed', events: [], at: new Date() });
    await makeLog({
      playerId: p1.player.id,
      outcome: 'success',
      events: [combat('combat_win'), combat('combat_win'), combat('combat_win')],
      at: OLD(),
    });

    // Tier 1 = bare ship; tier 5 = installed catalog value at/above the rules threshold.
    await makeShip(p1.player.id);
    const rules = testApp.app.get(GameConfigService).snapshot().rules;
    const tier5Value = (rules.economy.ship_tier_thresholds as Record<string, number>)['5'];
    expect(tier5Value).toBeGreaterThan(0);
    await makeShip(p2.player.id, { installedValue: tier5Value });

    const response = await request(server)
      .get(`/v1/admin/analytics/dashboard${query(window)}`)
      .set('Authorization', auth);
    expect(response.status).toBe(200);
    contract(DashboardResponseSchema, response.body, 'GET /admin/analytics/dashboard');
    expect(response.body).toEqual({
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      data: {
        players: { new: 2, active: 2 },
        missions: {
          total: 4,
          success: 2,
          partialFailure: 1,
          failed: 1,
          adrift: 0,
          successRate: 0.5,
        },
        combat: { encounters: 4, wins: 3, losses: 1, winrate: 0.75, baseline: 0.55 },
        tiers: { tiers: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 1 }, ships: 2 },
      },
    });
  });

  it('splits credits entering vs leaving and breaks the sinks down by reason', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const auth = `Bearer ${admin.token}`;
    const player = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));

    await prisma.playerEvent.createMany({
      data: [
        {
          playerId: player.player.id,
          type: 'wallet.credit',
          creditsDelta: 100,
          payload: { reason: 'onboarding starter credits' },
        },
        {
          playerId: player.player.id,
          type: 'wallet.credit',
          creditsDelta: 50,
          payload: { reason: `mission:${randomUUID()}:payout` },
        },
        {
          playerId: player.player.id,
          type: 'wallet.debit',
          creditsDelta: -30,
          payload: { reason: 'repair.start:ship-1' },
        },
        {
          playerId: player.player.id,
          type: 'wallet.debit',
          creditsDelta: -10,
          payload: { reason: 'refuel:ship-1' },
        },
        {
          playerId: player.player.id,
          type: 'wallet.debit',
          creditsDelta: -5,
          payload: { reason: 'market.buy:listing-1' },
        },
        // Admin adjustments are reported apart, never as organic flow.
        {
          playerId: player.player.id,
          type: 'wallet.credit',
          creditsDelta: 700,
          payload: { reason: 'support.grant' },
        },
        {
          playerId: player.player.id,
          type: 'wallet.debit',
          creditsDelta: -200,
          payload: { reason: 'support.remove' },
        },
        // Outside the window — must not count.
        {
          playerId: player.player.id,
          type: 'wallet.debit',
          creditsDelta: -999,
          payload: { reason: 'repair.start:ship-1' },
          at: OLD(),
        },
        // Inside the window but not a wallet movement — must not count.
        { playerId: player.player.id, type: 'mission.resolved', creditsDelta: 999 },
      ],
    });

    const window = windowBounds();
    const response = await request(server)
      .get(`/v1/admin/analytics/economy${query(window)}`)
      .set('Authorization', auth);
    expect(response.status).toBe(200);
    contract(EconomyResponseSchema, response.body, 'GET /admin/analytics/economy');
    expect(response.body).toEqual({
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      data: {
        entering: 150,
        leaving: 45,
        net: 105,
        sources: [
          { reason: 'onboarding', total: 100 },
          { reason: 'mission.payout', total: 50 },
        ],
        sinks: [
          { reason: 'repair', total: 30 },
          { reason: 'refuel', total: 10 },
          { reason: 'market.buy', total: 5 },
        ],
        adjustments: { granted: 700, removed: 200 },
      },
    });
  });

  it('reports traffic per route, pirate encounters and generation vs consumption per zone', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const auth = `Bearer ${admin.token}`;
    const window = windowBounds();
    const player = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));

    // Traffic: two rows of route r1 overlap the window, one of r1 does not, one of r2 does.
    const routes = await prisma.route.findMany({ orderBy: { id: 'asc' } });
    const [r1, r2] = routes;
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    const carrier = await makeMission({ createdAt: OLD(), acceptedAt: null });
    const ship = await makeShip(player.player.id);
    await addPresence(
      carrier.id,
      ship.id,
      r1!.id,
      0,
      new Date(Date.now() - 2 * HOUR),
      new Date(Date.now() - 60_000),
    );
    await addPresence(
      carrier.id,
      ship.id,
      r1!.id,
      1,
      new Date(Date.now() - 30 * 60_000),
      new Date(Date.now() + 30 * 60_000),
    );
    await addPresence(carrier.id, ship.id, r1!.id, 2, OLD(), new Date(Date.now() - 29 * DAY));
    await addPresence(
      carrier.id,
      ship.id,
      r2!.id,
      0,
      new Date(Date.now() - 10 * 60_000),
      new Date(Date.now() + 10 * 60_000),
    );

    // Generation/consumption across two distinct zones of the seeded world.
    const locations = await prisma.location.findMany({ orderBy: [{ zone: 'asc' }, { id: 'asc' }] });
    const zoneA = locations[0]!;
    const zoneB = locations.find((location) => location.zone !== zoneA.zone);
    expect(zoneB).toBeDefined();
    await makeMission({ originId: zoneA.id, createdAt: new Date(), acceptedAt: new Date() });
    await makeMission({ originId: zoneA.id, createdAt: new Date(), acceptedAt: null });
    await makeMission({ originId: zoneB!.id, createdAt: OLD(), acceptedAt: new Date() });
    await makeMission({ originId: zoneA.id, createdAt: OLD(), acceptedAt: OLD() });

    // Pirate encounters: 3 in-window fights (a pvp_encounter does not count), 1 old win.
    await makeLog({
      playerId: player.player.id,
      outcome: 'success',
      events: [
        combat('combat_win'),
        combat('combat_win'),
        combat('combat_loss'),
        { leg: 0, category: 'combat', type: 'pvp_encounter', actors: {}, magnitude: 1 },
      ],
      at: new Date(),
    });
    await makeLog({ playerId: player.player.id, outcome: 'failed', events: [], at: new Date() });
    await makeLog({
      playerId: player.player.id,
      outcome: 'success',
      events: [combat('combat_win')],
      at: OLD(),
    });

    const response = await request(server)
      .get(`/v1/admin/analytics/world${query(window)}`)
      .set('Authorization', auth);
    expect(response.status).toBe(200);
    contract(AdminWorldResponseSchema, response.body, 'GET /admin/analytics/world');
    expect(response.body).toEqual({
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      data: {
        traffic: [
          { routeId: r1!.id, crossings: 2 },
          { routeId: r2!.id, crossings: 1 },
        ],
        encounters: 3,
        zones: [
          { zone: zoneA.zone, generated: 2, consumed: 1 },
          { zone: zoneB!.zone, generated: 0, consumed: 1 },
        ],
      },
    });
  });

  it('requires admin, defaults the window to the last 7 days and rejects bad bounds', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const auth = `Bearer ${admin.token}`;

    const player = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const playerToken = await testApp.app.get(TokenService).signAccessToken({
      accountId: player.account.id,
      playerId: player.player.id,
      role: 'PLAYER',
    });
    const denied = await request(server)
      .get('/v1/admin/analytics/dashboard')
      .set('Authorization', `Bearer ${playerToken}`);
    expect(denied.status).toBe(403);

    const unauthenticated = await request(server).get('/v1/admin/analytics/dashboard');
    expect(unauthenticated.status).toBe(401);

    const defaulted = await request(server)
      .get('/v1/admin/analytics/dashboard')
      .set('Authorization', auth);
    expect(defaulted.status).toBe(200);
    const bounds = (defaulted.body as { window: { from: string; to: string } }).window;
    expect(new Date(bounds.to).getTime() - new Date(bounds.from).getTime()).toBe(7 * DAY);

    const malformed = await request(server)
      .get('/v1/admin/analytics/economy?from=yesterday')
      .set('Authorization', auth);
    expect(malformed.status).toBe(400);

    const inverted = await request(server)
      .get('/v1/admin/analytics/world?from=2026-09-02T00:00:00.000Z&to=2026-09-01T00:00:00.000Z')
      .set('Authorization', auth);
    expect(inverted.status).toBe(400);
  });
});
