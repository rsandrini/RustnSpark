import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
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

interface Offer {
  id: string;
  type: string;
  status: string;
  originId: string;
  destinationId: string;
  playerId: string | null;
  privatePlayerId: string | null;
  legs: Array<{ zone: number }>;
  eligibility: { eligible: boolean; reasons: Array<{ code: string }> };
}

interface Player {
  playerId: string;
  token: string;
  shipId: string;
  home: string;
}

const HOME: Record<string, string> = { luna: 'ceres', sun: 'hedus', explorers: 'cair' };

/**
 * D43: a brand-new player must always be able to take a first mission. The seeded board offers
 * ONE public mission per port and most templates need parts the starter ship lacks, so the API
 * adds a private, start-safe DELIVERY when nothing on the player's board is takeable — visible
 * and acceptable only by that player, created once, tunable through Admin.
 */
describe('private start-safe mission (D43)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let config: GameConfigService;
  let queue: Queue;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    config = testApp.app.get(GameConfigService);
    queue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  // `publicOffers: 0` empties the shared boards so nothing takeable can be there by luck: the
  // seeded default lists one random public offer per port, which is sometimes takeable (and then
  // the guarantee rightly does nothing). Tests about the private mission need it to be the only
  // candidate; one test below runs on the default boards.
  async function freshWorld(publicOffers = 0): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
    await config.refresh();
    if (publicOffers !== 1) {
      await config.setValue('missions.board_min_per_location', publicOffers, 'tester', 'D43 test');
    }
  }

  async function onboard(faction: 'luna' | 'sun' | 'explorers'): Promise<Player> {
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const token = await testApp.app.get(TokenService).signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const res = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set(auth(token))
      .send({ faction });
    expect(res.status).toBe(200);
    return {
      playerId: seeded.player.id,
      token,
      shipId: (res.body as { id: string }).id,
      home: HOME[faction]!,
    };
  }

  async function board(player: Player): Promise<Offer[]> {
    const res = await request(httpServer(testApp.app))
      .get(`/v1/locations/${player.home}/missions`)
      .set(auth(player.token));
    expect(res.status).toBe(200);
    return res.body as Offer[];
  }

  const privateCount = (playerId: string) =>
    prisma.missionInstance.count({ where: { privatePlayerId: playerId } });

  it.each(['luna', 'sun', 'explorers'] as const)(
    '%s: a new player gets a takeable, private, safe-zone DELIVERY on the home board',
    async (faction) => {
      await freshWorld();
      const player = await onboard(faction);

      const offers = await board(player);
      const mine = offers.filter((offer) => offer.privatePlayerId === player.playerId);
      expect(mine).toHaveLength(1);
      const starter = mine[0]!;
      expect(starter.eligibility).toEqual({ eligible: true, reasons: [] });
      expect(starter.type).toBe('DELIVERY');
      expect(starter.status).toBe('AVAILABLE');
      expect(starter.originId).toBe(player.home);
      expect(starter.playerId).toBeNull(); // not held or accepted: just offered
      // The safe core (GDD §2: zones 0-1 have no PvP), and never riskier than the home port
      // itself: Sun lives in zone 2, so its starter route may use zone 2.
      const home = await prisma.location.findUniqueOrThrow({ where: { id: player.home } });
      for (const leg of starter.legs) {
        expect(leg.zone).toBeLessThanOrEqual(Math.max(1, home.zone));
      }
    },
  );

  it.each(['luna', 'sun', 'explorers'] as const)(
    '%s: on the DEFAULT board (one random public offer) a new player still has something to accept',
    async (faction) => {
      await freshWorld(1);
      const player = await onboard(faction);
      const offers = await board(player);
      expect(offers.some((offer) => offer.eligibility.eligible)).toBe(true);
    },
  );

  it('is private: another player never sees it and cannot hold or accept it', async () => {
    await freshWorld();
    const owner = await onboard('luna');
    const other = await onboard('luna');
    const starter = (await board(owner)).find((offer) => offer.privatePlayerId === owner.playerId)!;

    const seenByOther = await board(other);
    expect(seenByOther.some((offer) => offer.id === starter.id)).toBe(false);
    // ...and the other player got their OWN, distinct start-safe mission.
    const theirs = seenByOther.filter((offer) => offer.privatePlayerId === other.playerId);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]!.id).not.toBe(starter.id);

    const hold = await request(httpServer(testApp.app))
      .post(`/v1/missions/${starter.id}/hold`)
      .set(auth(other.token));
    expect(hold.status).toBe(404);
    const accept = await request(httpServer(testApp.app))
      .post(`/v1/missions/${starter.id}/accept`)
      .set(auth(other.token))
      .send({ shipId: other.shipId });
    expect(accept.status).toBe(404);
    expect(
      (await prisma.missionInstance.findUniqueOrThrow({ where: { id: starter.id } })).status,
    ).toBe('AVAILABLE');
  });

  it('is created once, even when the board is read many times in parallel', async () => {
    await freshWorld();
    const player = await onboard('sun');
    await Promise.all(Array.from({ length: 6 }, () => board(player)));
    await board(player);
    expect(await privateCount(player.playerId)).toBe(1);
  });

  it('the owner can accept it and dispatch the ship', async () => {
    await freshWorld();
    const player = await onboard('explorers');
    const starter = (await board(player)).find(
      (offer) => offer.privatePlayerId === player.playerId,
    )!;

    const accepted = await request(httpServer(testApp.app))
      .post(`/v1/missions/${starter.id}/accept`)
      .set(auth(player.token))
      .send({ shipId: player.shipId });
    expect(accepted.status).toBe(200);
    const dispatched = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/dispatch`)
      .set(auth(player.token))
      .send({ missionId: starter.id });
    expect(dispatched.status).toBe(200);

    // A mission is in flight: no second starter mission is created for it.
    await board(player);
    expect(await privateCount(player.playerId)).toBe(1);
  });

  it('is replaced (once) when it expires unused', async () => {
    await freshWorld();
    const player = await onboard('luna');
    const first = (await board(player)).find((offer) => offer.privatePlayerId === player.playerId)!;
    await prisma.missionInstance.update({
      where: { id: first.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const again = (await board(player)).filter(
      (offer) => offer.privatePlayerId === player.playerId,
    );
    expect(again).toHaveLength(1);
    expect(again[0]!.id).not.toBe(first.id);
    expect(await privateCount(player.playerId)).toBe(2);
  });

  it('stops once the player has completed enough missions (starter_guarantee_max_completed)', async () => {
    await freshWorld();
    await config.setValue('missions.starter_guarantee_max_completed', 1, 'tester', 'D43 test');
    const player = await onboard('luna');
    // The starter mission gets flown and finished: one completed mission is enough to leave the
    // guarantee behind (max_completed = 1), so a second one is not created.
    const starter = (await board(player)).find(
      (offer) => offer.privatePlayerId === player.playerId,
    )!;
    await prisma.missionInstance.update({
      where: { id: starter.id },
      data: { status: 'DONE', playerId: player.playerId },
    });

    await board(player);
    expect(await privateCount(player.playerId)).toBe(1);
  });

  it('can be switched off through Admin tuning (0 = off)', async () => {
    await freshWorld();
    await config.setValue('missions.starter_guarantee_max_completed', 0, 'tester', 'D43 test');
    const player = await onboard('sun');
    await board(player);
    expect(await privateCount(player.playerId)).toBe(0);
  });

  it('is not offered on a board the ship is not at (it is a home-port guarantee)', async () => {
    await freshWorld();
    const player = await onboard('luna');
    const elsewhere = await request(httpServer(testApp.app))
      .get('/v1/locations/gate/missions')
      .set(auth(player.token));
    expect(elsewhere.status).toBe(200);
    expect(await privateCount(player.playerId)).toBe(0);
  });

  it('a private mission does not count toward the shared board the map reports', async () => {
    await freshWorld();
    const player = await onboard('luna');
    await board(player); // creates the starter
    const world = await request(httpServer(testApp.app))
      .get('/v1/locations')
      .set(auth(player.token));
    const ceres = (
      world.body as { locations: Array<{ id: string; missionCount: number }> }
    ).locations.find((location) => location.id === 'ceres')!;
    const publicLive = await prisma.missionInstance.count({
      where: {
        originId: 'ceres',
        status: 'AVAILABLE',
        privatePlayerId: null,
        expiresAt: { gt: new Date() },
      },
    });
    expect(ceres.missionCount).toBe(publicLive);
  });
});
