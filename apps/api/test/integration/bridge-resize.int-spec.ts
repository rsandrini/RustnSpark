import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { MISSION_QUEUE_NAME, REPAIR_QUEUE_NAME } from '../../src/jobs/queues.js';
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

// Bridge size changes (docs/TODO.md, bridges 2x2): Expand pays the 2x2 one rarity below in full and
// consumes the 1x1; Shrink sells the 2x2 and buys the same-rarity 1x1. Either way the new bridge
// lands loose in the inventory and the ship is left without a bridge.
describe('bridge expand / shrink API', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;
  let missionQueue: Queue;
  let repairQueue: Queue;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
    missionQueue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
    repairQueue = testApp.app.get(getQueueToken(REPAIR_QUEUE_NAME));
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await missionQueue.obliterate({ force: true }).catch(() => undefined);
    await repairQueue.obliterate({ force: true }).catch(() => undefined);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  async function freshSeededApp(): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
  }

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

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

  async function setCredits(playerId: string, credits: number): Promise<void> {
    await prisma.player.update({ where: { id: playerId }, data: { credits } });
  }

  async function currentCredits(playerId: string): Promise<number> {
    const player = await prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { credits: true },
    });
    return player.credits;
  }

  async function addLoosePart(
    playerId: string,
    partType: string,
    condition = 100,
  ): Promise<string> {
    const created = await prisma.partInstance.create({
      data: { partType, ownerPlayerId: playerId, condition, location: 'INVENTORY' },
    });
    return created.id;
  }

  function post(token: string, path: string, key?: string) {
    const req = request(httpServer(testApp.app)).post(path).set(auth(token));
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send();
  }

  async function installedBridge(player: AuthPair) {
    return prisma.partInstance.findFirstOrThrow({
      where: {
        shipId: player.shipId,
        location: 'INSTALLED',
        partCatalog: { partClass: 'BRIDGE' },
      },
      include: { partCatalog: true },
    });
  }

  /** Swaps the installed starter bridge for another bridge type, in place (same instance). */
  async function setBridgeType(player: AuthPair, partType: string): Promise<string> {
    const bridge = await installedBridge(player);
    await prisma.partInstance.update({ where: { id: bridge.id }, data: { partType } });
    return bridge.id;
  }

  it('a COMMON 1x1 cannot expand: there is no rarity below it', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const bridge = await installedBridge(player);

    const quote = await post(player.token, `/v1/parts/${bridge.id}/expand/quote`);
    expect(quote.status).toBe(200);
    expect(quote.body).toMatchObject({ eligible: false, reason: 'RARITY_TOO_LOW' });
    const expand = await post(player.token, `/v1/parts/${bridge.id}/expand`, randomUUID());
    expect(expand.status).toBe(409);
    expect(await prisma.partInstance.findUnique({ where: { id: bridge.id } })).not.toBeNull();
  });

  it('expands an UNCOMMON 1x1 into a COMMON 2x2: full price, old bridge consumed, new one loose at 100%', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const bridgeId = await setBridgeType(player, 'bridge_uncommon');
    const target = await prisma.partCatalog.findUniqueOrThrow({
      where: { partType: 'bridge_2x2' },
    });
    await setCredits(player.seeded.player.id, target.basePrice + 500);
    await prisma.partInstance.update({ where: { id: bridgeId }, data: { condition: 70 } });

    const quote = await post(player.token, `/v1/parts/${bridgeId}/expand/quote`);
    expect(quote.body).toMatchObject({
      eligible: true,
      targetPartType: 'bridge_2x2',
      targetRarity: 'COMMON',
      cost: target.basePrice,
    });

    const response = await post(player.token, `/v1/parts/${bridgeId}/expand`, randomUUID());
    expect(response.status).toBe(200);
    const body = response.body as { partInstanceId: string; partType: string; condition: number };
    expect(body).toMatchObject({ partType: 'bridge_2x2', condition: 100 });

    expect(await prisma.partInstance.findUnique({ where: { id: bridgeId } })).toBeNull();
    const created = await prisma.partInstance.findUniqueOrThrow({
      where: { id: body.partInstanceId },
    });
    expect(created).toMatchObject({ location: 'INVENTORY', shipId: null, condition: 100 });
    expect(await currentCredits(player.seeded.player.id)).toBe(500);
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    const layout = ship.layout as Array<{ partInstanceId: string }>;
    expect(layout.some((placement) => placement.partInstanceId === bridgeId)).toBe(false);
  });

  it('refuses an expand the pilot cannot pay for, changing nothing', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const bridgeId = await setBridgeType(player, 'bridge_uncommon');
    await setCredits(player.seeded.player.id, 10);

    const response = await post(player.token, `/v1/parts/${bridgeId}/expand`, randomUUID());
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ message: { error: 'INSUFFICIENT_FUNDS' } });
    expect(await prisma.partInstance.findUnique({ where: { id: bridgeId } })).not.toBeNull();
    expect(await currentCredits(player.seeded.player.id)).toBe(10);
  });

  it("does not touch another player's bridge", async () => {
    await freshSeededApp();
    const owner = await onboardPlayer();
    const thief = await onboardPlayer();
    const bridgeId = await setBridgeType(owner, 'bridge_uncommon');
    await setCredits(thief.seeded.player.id, 1_000_000);

    const response = await post(thief.token, `/v1/parts/${bridgeId}/expand`, randomUUID());
    expect(response.status).toBe(404);
  });

  it('shrinks a loose 2x2 into the same-rarity 1x1: sold at market, 1x1 bought at catalog price', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const big = await addLoosePart(player.seeded.player.id, 'bridge_2x2_uncommon');
    await setCredits(player.seeded.player.id, 0);

    const quote = await post(player.token, `/v1/parts/${big}/shrink/quote`);
    expect(quote.body).toMatchObject({
      eligible: true,
      targetPartType: 'bridge_uncommon',
      targetRarity: 'UNCOMMON',
    });
    const { credit, cost } = quote.body as { credit: number; cost: number };
    const rules = configService.snapshot().rules;
    const catalog = await prisma.partCatalog.findUniqueOrThrow({
      where: { partType: 'bridge_2x2_uncommon' },
    });
    // Never more than the sell ratio of the 2x2's catalog price: nothing to farm.
    expect(credit).toBeLessThanOrEqual(Math.floor(catalog.basePrice * rules.economy.sell_ratio));
    expect(credit).toBeGreaterThan(0);

    const response = await post(player.token, `/v1/parts/${big}/shrink`, randomUUID());
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ partType: 'bridge_uncommon', condition: 100 });
    expect(await prisma.partInstance.findUnique({ where: { id: big } })).toBeNull();
    expect(await currentCredits(player.seeded.player.id)).toBe(credit - cost);
  });

  it('expand then shrink back always loses money', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const bridgeId = await setBridgeType(player, 'bridge_rare');
    await setCredits(player.seeded.player.id, 1_000_000);
    const before = await currentCredits(player.seeded.player.id);

    const expanded = await post(player.token, `/v1/parts/${bridgeId}/expand`, randomUUID());
    expect(expanded.status).toBe(200);
    const big = (expanded.body as { partInstanceId: string }).partInstanceId;
    const shrunk = await post(player.token, `/v1/parts/${big}/shrink`, randomUUID());
    expect(shrunk.status).toBe(200);

    expect(await currentCredits(player.seeded.player.id)).toBeLessThan(before);
  });

  it('blocks shrinking an installed 2x2 while the ship stands on a big format', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const bridgeId = await setBridgeType(player, 'bridge_2x2');
    // The seed carries no size-2 format yet: make the ship's own one a big format.
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    await prisma.shipFormat.update({ where: { id: ship.formatId }, data: { minBridgeSize: 2 } });

    const response = await post(player.token, `/v1/parts/${bridgeId}/shrink`, randomUUID());
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ message: { error: 'FORMAT_REQUIRES_BRIDGE' } });
  });

  it('refuses while the ship is out on a mission', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const bridgeId = await setBridgeType(player, 'bridge_uncommon');
    await setCredits(player.seeded.player.id, 1_000_000);
    await prisma.ship.update({ where: { id: player.shipId }, data: { status: 'ON_MISSION' } });

    const response = await post(player.token, `/v1/parts/${bridgeId}/expand`, randomUUID());
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ message: { error: 'SHIP_ON_MISSION' } });
  });
});
