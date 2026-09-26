import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { MissionInstance } from '@prisma/client';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { PricingService } from '../../src/economy/pricing.service.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer, type SeededPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

interface AuthPair {
  seeded: SeededPlayer;
  token: string;
  shipId: string;
}

// S7.7 acceptance (plan line 454): while the ship is ON_MISSION, assemble, stance,
// repair, sell of installed parts and a second dispatch all return 409.
// Ship state comes from a real dispatch (S7.2), not a direct status poke.
describe('in-transit lock API (S7.7)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;
  let queue: Queue;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
    queue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  async function freshSeededApp(): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
  }

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

  async function onboardPlayer(): Promise<AuthPair> {
    const passwords = testApp.app.get(PasswordService);
    const tokens = testApp.app.get(TokenService);
    const seeded = await seedAccountWithPlayer(prisma, passwords);
    const token = await tokens.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set(auth(token))
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    await assembleStarterKit(httpServer(testApp.app), token, (onboarded.body as { id: string }).id);
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  async function createMission(player: AuthPair): Promise<MissionInstance> {
    const template = await prisma.missionTemplate.findFirstOrThrow({
      where: { type: 'DELIVERY' },
      orderBy: { id: 'asc' },
    });
    const route = await prisma.route.findFirstOrThrow({ orderBy: { id: 'asc' } });
    return prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type: 'DELIVERY',
        factionId: template.factionId,
        originId: 'ceres',
        destinationId: 'hedus',
        legs: [
          {
            routeId: route.id,
            distance: 40,
            danger: 1,
            zone: 0,
            env: { id: 'belt', level: 1, fuelMult: 1 },
          },
        ],
        cargo: {},
        reward: 100,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        seed: `s7.7-${randomUUID()}`,
        status: 'ACCEPTED',
        playerId: player.seeded.player.id,
        shipId: player.shipId,
        acceptedAt: new Date(),
      },
    });
  }

  async function dispatchOnMission(player: AuthPair): Promise<MissionInstance> {
    const mission = await createMission(player);
    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/dispatch`)
      .set(auth(player.token))
      .send({ missionId: mission.id });
    expect(response.status).toBe(200);
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.status).toBe('ON_MISSION');
    return mission;
  }

  it('rejects assemble with 409 while ON_MISSION', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await dispatchOnMission(player);

    const parts = await prisma.partInstance.findMany({
      where: { ownerPlayerId: player.seeded.player.id },
    });
    const layout = parts.map((part, index) => ({
      partInstanceId: part.id,
      gx: index,
      gy: 0,
      rot: 0,
    }));

    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/assemble`)
      .set(auth(player.token))
      .send({ layout });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_ON_MISSION' },
    });
  });

  it('rejects stance with 409 while ON_MISSION', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await dispatchOnMission(player);

    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/stance`)
      .set(auth(player.token))
      .send({ stance: 'AGGRESSIVE' });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_ON_MISSION' },
    });
  });

  it('rejects repair with 409 while ON_MISSION', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await dispatchOnMission(player);

    const part = await prisma.partInstance.findFirstOrThrow({
      where: { ownerPlayerId: player.seeded.player.id, location: 'INSTALLED' },
    });

    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/repair`)
      .set(auth(player.token))
      .set('Idempotency-Key', randomUUID())
      .send({ targets: [{ partInstanceId: part.id, toCondition: 100 }] });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_ON_MISSION' },
    });
  });

  it('rejects sell of an installed part with 409 while ON_MISSION', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await dispatchOnMission(player);

    const part = await prisma.partInstance.findFirstOrThrow({
      where: {
        ownerPlayerId: player.seeded.player.id,
        location: 'INSTALLED',
        shipId: player.shipId,
      },
      include: { partCatalog: true },
    });

    const response = await request(httpServer(testApp.app))
      .post('/v1/market/sell')
      .set(auth(player.token))
      .set('Idempotency-Key', randomUUID())
      .send({ partInstanceId: part.id, expectedPrice: 1 });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_ON_MISSION' },
    });
  });

  it('rejects a second dispatch with 409 while ON_MISSION', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const first = await dispatchOnMission(player);

    // Free the one-active-per-player slot without releasing the ship, then accept a
    // second mission — the dispatch itself must still fail on ship status.
    await prisma.missionInstance.update({
      where: { id: first.id },
      data: { status: 'DONE' },
    });
    const second = await createMission(player);
    await prisma.missionInstance.update({
      where: { id: second.id },
      data: { status: 'AVAILABLE', playerId: null, shipId: null, acceptedAt: null },
    });

    const accept = await request(httpServer(testApp.app))
      .post(`/v1/missions/${second.id}/accept`)
      .set(auth(player.token))
      .send({ shipId: player.shipId });
    expect(accept.status).toBe(200);

    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/dispatch`)
      .set(auth(player.token))
      .send({ missionId: second.id });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_NOT_IN_PORT' },
    });
  });

  // S8.7 review (items 6–7): a ship in transit trades nothing — the trade POSTs join the
  // S7.7 lock family (buy, inventory-part sell, materials sell all 409) while reads of the
  // board stay open, and ADRIFT still trades: stripping a drifting hull is the designed
  // path into the restart kit.
  it('rejects buy with 409 while ON_MISSION; the board still reads', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await dispatchOnMission(player);

    const board = await request(httpServer(testApp.app))
      .get('/v1/locations/ceres/market')
      .set(auth(player.token));
    expect(board.status).toBe(200);
    const listing = (board.body as { listings: Array<{ listingId: string }> }).listings[0]!;

    const response = await request(httpServer(testApp.app))
      .post('/v1/market/buy')
      .set(auth(player.token))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.listingId, expectedPrice: 1 });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_ON_MISSION' },
    });
  });

  it('rejects sell of an inventory part with 409 while ON_MISSION', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const part = await prisma.partInstance.create({
      data: {
        partType: 'hull',
        ownerPlayerId: player.seeded.player.id,
        condition: 80,
        location: 'INVENTORY',
      },
    });
    await dispatchOnMission(player);

    const response = await request(httpServer(testApp.app))
      .post('/v1/market/sell')
      .set(auth(player.token))
      .set('Idempotency-Key', randomUUID())
      .send({ partInstanceId: part.id, expectedPrice: 1 });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_ON_MISSION' },
    });
    await expect(
      prisma.partInstance.findUnique({ where: { id: part.id } }),
    ).resolves.not.toBeNull();
  });

  it('rejects selling materials with 409 while ON_MISSION', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await prisma.playerMaterial.create({
      data: { playerId: player.seeded.player.id, materialId: 'common_ore', quantity: 5 },
    });
    await dispatchOnMission(player);

    const response = await request(httpServer(testApp.app))
      .post('/v1/market/sell-material')
      .set(auth(player.token))
      .set('Idempotency-Key', randomUUID())
      .send({ materialId: 'common_ore', quantity: 2, expectedPrice: 1 });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_ON_MISSION' },
    });
    const held = await prisma.playerMaterial.findUnique({
      where: {
        playerId_materialId: { playerId: player.seeded.player.id, materialId: 'common_ore' },
      },
    });
    expect(held?.quantity).toBe(5);
  });

  it('an ADRIFT ship still trades: an inventory part sells at its port price', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const part = await prisma.partInstance.create({
      data: {
        partType: 'hull',
        ownerPlayerId: player.seeded.player.id,
        condition: 80,
        location: 'INVENTORY',
      },
      include: { partCatalog: true },
    });
    await prisma.ship.update({
      where: { id: player.shipId },
      data: { status: 'ADRIFT' },
    });

    const pricing = testApp.app.get(PricingService);
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    const context = await pricing.contextForLocation(
      ship.currentLocationId,
      player.seeded.player.id,
    );
    const expectedPrice = pricing.sell(context, part, { basePrice: part.partCatalog.basePrice });

    const response = await request(httpServer(testApp.app))
      .post('/v1/market/sell')
      .set(auth(player.token))
      .set('Idempotency-Key', randomUUID())
      .send({ partInstanceId: part.id, expectedPrice });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ partInstanceId: part.id, price: expectedPrice });
    await expect(prisma.partInstance.findUnique({ where: { id: part.id } })).resolves.toBeNull();
  });
});
