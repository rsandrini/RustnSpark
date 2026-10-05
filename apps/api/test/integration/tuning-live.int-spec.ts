import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

const auth = (token: string): { Authorization: string } => ({
  Authorization: `Bearer ${token}`,
});

interface PlayerSession {
  playerId: string;
  token: string;
  shipId: string;
}

interface MarketBody {
  listings: Array<{ listingId: string; kind: string; partType: string; price: number }>;
  sellOffers: Array<{ partInstanceId: string; price: number }>;
}

/**
 * S3.7 acceptance, at the HTTP level (plan: "change `economy.start_credits`, onboard a new
 * player, assert the new balance"): an Admin edit through the tuning API reaches gameplay
 * immediately (D33 — the database wins, no restart, no redeploy). The existing tuning spec
 * proves the snapshot changes; these prove real player-facing endpoints react to it, for the
 * keys that arrived after Step 3 as well (rescue ration, sell ratio, scavenging cooldown).
 */
describe('Admin tuning reaches gameplay over HTTP (S3.7, D33)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let config: GameConfigService;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    config = testApp.app.get(GameConfigService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed(prisma);
    await config.refresh();
    adminToken = await createAdminToken();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  async function createAdminToken(): Promise<string> {
    const passwords = testApp.app.get(PasswordService);
    const tokens = testApp.app.get(TokenService);
    const account = await prisma.account.create({
      data: {
        email: `admin-${randomUUID()}@example.com`,
        passwordHash: await passwords.hash('admin-password-1'),
        role: 'ADMIN',
        player: {
          create: { name: `admin_${randomUUID().replaceAll('-', '').slice(0, 22)}`, credits: 0 },
        },
      },
      include: { player: true },
    });
    return tokens.signAccessToken({
      accountId: account.id,
      playerId: account.player!.id,
      role: 'ADMIN',
    });
  }

  async function tune(key: string, value: number): Promise<void> {
    const latest = await prisma.tuningRevision.findFirst({ orderBy: { id: 'desc' } });
    const response = await request(httpServer(testApp.app))
      .patch(`/v1/admin/tuning/config/${key}`)
      .set(auth(adminToken))
      .send({ value, expectedRevision: Number(latest?.id ?? 0n), reason: 'S3.7 live tuning test' });
    expect({ status: response.status, body: response.body as unknown }).toMatchObject({
      status: 200,
    });
    // Published on Redis and applied within 2 s (D33); wait for THIS process to see it so the
    // assertions below exercise the gameplay path, not the pub/sub latency.
    const deadline = Date.now() + 2000;
    const read = () => config.snapshot().rules as unknown as Record<string, unknown>;
    const [group, name] = key.split('.') as [string, string];
    while ((read()[group] as Record<string, unknown>)[name] !== value && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async function onboard(): Promise<PlayerSession> {
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const token = await testApp.app.get(TokenService).signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const response = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set(auth(token))
      .send({ faction: 'luna' });
    expect(response.status).toBe(200);
    await assembleStarterKit(httpServer(testApp.app), token, (response.body as { id: string }).id);
    return { playerId: seeded.player.id, token, shipId: (response.body as { id: string }).id };
  }

  it('economy.start_credits: the next player onboarded gets the tuned balance', async () => {
    const before = await onboard();
    const beforeProfile = await request(httpServer(testApp.app))
      .get('/v1/players/me')
      .set(auth(before.token));
    expect((beforeProfile.body as { credits: number }).credits).toBe(200);

    await tune('economy.start_credits', 3333);

    const after = await onboard();
    const profile = await request(httpServer(testApp.app))
      .get('/v1/players/me')
      .set(auth(after.token));
    expect((profile.body as { credits: number }).credits).toBe(3333);
  });

  it('economy.rescue_fuel_fraction: the next rescue leaves the tuned share of the tank', async () => {
    await tune('economy.rescue_fuel_fraction', 0.5);
    const player = await onboard();
    const ship = await request(httpServer(testApp.app))
      .get(`/v1/ships/${player.shipId}`)
      .set(auth(player.token));
    const fuelCap = (ship.body as { sheet: { fuelCap: number } }).sheet.fuelCap;
    await prisma.ship.update({
      where: { id: player.shipId },
      data: { status: 'ADRIFT', fuel: 0 },
    });

    const rescued = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/rescue`)
      .set(auth(player.token))
      .set('Idempotency-Key', randomUUID());
    expect(rescued.status).toBe(200);
    expect((rescued.body as { fuel: number }).fuel).toBe(Math.round(fuelCap * 0.5));
  });

  it('economy.sell_ratio: the port quote for the same part changes with the ratio', async () => {
    const player = await onboard();
    const market = () =>
      request(httpServer(testApp.app)).get('/v1/locations/ceres/market').set(auth(player.token));

    // Give the player a part to sell (a starter kit part is installed, not for sale).
    const board = (await market()).body as MarketBody;
    const listing = board.listings.find((entry) => entry.kind === 'catalog' && entry.price > 1)!;
    await prisma.player.update({ where: { id: player.playerId }, data: { credits: 100000 } });
    const bought = await request(httpServer(testApp.app))
      .post('/v1/market/buy')
      .set(auth(player.token))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.listingId, expectedPrice: listing.price });
    expect(bought.status).toBe(200);

    const quoteAt06 = ((await market()).body as MarketBody).sellOffers[0]!.price;
    await tune('economy.sell_ratio', 0.3);
    const quoteAt03 = ((await market()).body as MarketBody).sellOffers[0]!.price;

    expect(quoteAt03).toBeLessThan(quoteAt06);
    // Half the ratio, half the price (± the 1-credit rounding of each quote).
    expect(Math.abs(quoteAt03 - quoteAt06 / 2)).toBeLessThanOrEqual(1);
  });

  it('scavenging.cooldown_seconds: lowering it releases the per-location cooldown at once', async () => {
    const player = await onboard();
    const scavenge = () =>
      request(httpServer(testApp.app)).post('/v1/locations/ceres/scavenge').set(auth(player.token));

    expect((await scavenge()).status).toBe(200);
    // Free the ship (as if the job had ended) so what stops the next job is the cooldown itself.
    const jobs = await prisma.missionInstance.findMany({
      where: { type: 'SCAVENGE' },
      select: { id: true },
    });
    await prisma.routePresence.deleteMany({
      where: { missionId: { in: jobs.map((job) => job.id) } },
    });
    await prisma.missionInstance.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } });
    await prisma.ship.updateMany({
      where: { ownerPlayerId: player.playerId },
      data: { status: 'IN_PORT' },
    });
    const blocked = await scavenge();
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ message: { error: 'SCAVENGE_COOL_DOWN' } });

    await tune('scavenging.cooldown_seconds', 0);
    expect((await scavenge()).status).toBe(200);
  });
});
