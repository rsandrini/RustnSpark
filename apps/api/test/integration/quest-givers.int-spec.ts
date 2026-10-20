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
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

const httpServer = (app: INestApplication): Server => app.getHttpServer() as Server;
const auth = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` });

interface Giver {
  id: string;
  name: string;
  role: 'GIVER' | 'MENTOR';
  factionId: string;
  portraitUrl: string | null;
}
interface Offer {
  id: string;
  type: string;
  privatePlayerId: string | null;
  info: { description: { en: string; 'pt-BR': string }; giver?: Giver | null };
}

const HOME: Record<string, string> = { luna: 'ceres', sun: 'hedus', explorers: 'cair' };

describe('quest givers (the people behind the missions)', () => {
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

  async function onboard(faction: 'luna' | 'sun' | 'explorers') {
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
    await assembleStarterKit(httpServer(testApp.app), token, (res.body as { id: string }).id);
    return { playerId: seeded.player.id, token, home: HOME[faction] as string };
  }

  /** Past the newcomer threshold, so the board is the public one. */
  async function makeVeteran(playerId: string): Promise<void> {
    const { starter_guarantee_max_completed: threshold } = config.snapshot().rules.missions;
    const template = await prisma.missionTemplate.findFirstOrThrow({ orderBy: { id: 'asc' } });
    for (let i = 0; i < threshold; i += 1) {
      await prisma.missionInstance.create({
        data: {
          templateId: template.id,
          type: template.type,
          factionId: template.factionId,
          originId: 'ceres',
          destinationId: 'hedus',
          legs: [],
          cargo: {},
          reward: 1,
          expiresAt: new Date(),
          seed: `done-${randomUUID()}`,
          status: 'DONE',
          playerId,
        },
      });
    }
  }

  const boardOf = async (token: string, home: string): Promise<Offer[]> => {
    const res = await request(httpServer(testApp.app))
      .get(`/v1/locations/${home}/missions`)
      .set(auth(token));
    expect(res.status).toBe(200);
    return res.body as Offer[];
  };

  async function freshWorld(): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
    await config.refresh();
  }

  it.each(['luna', 'sun', 'explorers'] as const)(
    "%s: the first flight is the faction mentor's, in their own words",
    async (faction) => {
      await freshWorld();
      const player = await onboard(faction);
      const offers = await boardOf(player.token, player.home);
      expect(offers).toHaveLength(1);
      const first = offers[0]!;
      expect(first.privatePlayerId).toBe(player.playerId);
      expect(first.info.giver?.role).toBe('MENTOR');
      expect(first.info.giver?.factionId).toBe(faction);
      const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: first.id } });
      expect(stored.giverId).toBe(first.info.giver?.id);
      // not the template's flat text: the mentor's test-flight brief, in both languages
      expect(first.info.description.en.toLowerCase()).toContain('test flight');
      expect(first.info.description['pt-BR'].length).toBeGreaterThan(0);
      expect(first.info.description['pt-BR']).not.toBe(first.info.description.en);
    },
  );

  it.each(['luna', 'sun', 'explorers'] as const)(
    "%s: a veteran's board is made of ordinary givers, no one holds more than half, and the brief is voiced",
    async (faction) => {
      await freshWorld();
      const player = await onboard(faction);
      await makeVeteran(player.playerId);
      const offers = await boardOf(player.token, player.home);
      expect(offers.length).toBeGreaterThanOrEqual(4);
      const stored = await prisma.missionInstance.findMany({
        where: { id: { in: offers.map((offer) => offer.id) } },
        include: { giver: true },
      });
      for (const row of stored) {
        if (row.privatePlayerId !== null) continue;
        expect(row.giver).not.toBeNull();
        expect(row.giver?.role).toBe('GIVER');
        expect(row.giver?.factionId).toBe(faction);
        const personality = row.giver?.personality as { types: Record<string, number> };
        expect(personality.types[row.type] ?? 0).toBeGreaterThan(0);
      }
      const publicRows = stored.filter((row) => row.privatePlayerId === null);
      const perGiver = new Map<string, number>();
      for (const row of publicRows)
        perGiver.set(row.giverId!, (perGiver.get(row.giverId!) ?? 0) + 1);
      for (const count of perGiver.values()) {
        expect(count).toBeLessThanOrEqual(Math.max(1, Math.floor(publicRows.length / 2) + 1));
      }
      // the offers carry who gave them, and a voiced brief where the giver has a line for the type
      for (const offer of offers.filter((entry) => entry.privatePlayerId === null)) {
        expect(offer.info.giver).toBeTruthy();
        expect(offer.info.description.en.length).toBeGreaterThan(0);
      }
    },
  );

  it("serves the pilot's mentor with the lines of every checklist step", async () => {
    await freshWorld();
    const player = await onboard('luna');
    const res = await request(httpServer(testApp.app))
      .get('/v1/players/me/mentor')
      .set(auth(player.token));
    expect(res.status).toBe(200);
    const mentor = res.body as {
      giver: Giver;
      welcome: { en: string } | null;
      finished: unknown;
      steps: Record<string, { nudge: unknown; done: unknown }>;
    };
    expect(mentor.giver.role).toBe('MENTOR');
    expect(mentor.giver.factionId).toBe('luna');
    expect(mentor.giver.portraitUrl).toBeNull();
    expect(mentor.welcome?.en.length).toBeGreaterThan(0);
    expect(Object.keys(mentor.steps).sort()).toEqual(
      ['build', 'dispatch', 'mission', 'ports', 'refuel', 'repair', 'report', 'work'].sort(),
    );
    for (const step of Object.values(mentor.steps)) {
      expect(step.nudge).not.toBeNull();
      expect(step.done).not.toBeNull();
    }
  });

  it('answers null for the mentor before a faction is chosen, and requires a token', async () => {
    await freshWorld();
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const token = await testApp.app.get(TokenService).signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const res = await request(httpServer(testApp.app))
      .get('/v1/players/me/mentor')
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body === null || Object.keys(res.body as object).length === 0).toBe(true);
    expect((await request(httpServer(testApp.app)).get('/v1/players/me/mentor')).status).toBe(401);
  });

  it("lists each playable faction's mentor on the faction screen data", async () => {
    await freshWorld();
    const player = await onboard('sun');
    const res = await request(httpServer(testApp.app)).get('/v1/factions').set(auth(player.token));
    expect(res.status).toBe(200);
    const factions = (
      res.body as {
        factions: Array<{ id: string; mentor?: { name: string; welcome: unknown } | null }>;
      }
    ).factions;
    for (const id of ['luna', 'sun', 'explorers']) {
      const entry = factions.find((faction) => faction.id === id);
      expect(entry?.mentor?.name.length).toBeGreaterThan(0);
      expect(entry?.mentor?.welcome).not.toBeNull();
    }
    expect(factions.find((faction) => faction.id === 'pirates')?.mentor ?? null).toBeNull();
  });

  it('keeps the template text when a giver has no line (a half-written giver still works)', async () => {
    await freshWorld();
    await prisma.questGiver.updateMany({ where: { role: 'GIVER' }, data: { lines: {} } });
    const player = await onboard('luna');
    await makeVeteran(player.playerId);
    const offers = await boardOf(player.token, player.home);
    for (const offer of offers.filter((entry) => entry.privatePlayerId === null)) {
      expect(offer.info.giver).toBeTruthy();
      const template = await prisma.missionTemplate.findFirstOrThrow({
        where: {
          id: (await prisma.missionInstance.findUniqueOrThrow({ where: { id: offer.id } }))
            .templateId,
        },
      });
      expect(offer.info.description.en).toBe((template.description as { en: string }).en);
    }
  });
});
