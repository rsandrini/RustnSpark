import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { MAX_BOARD_SHARE } from '../../src/missions/generator/giver.picker.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { accessTokenFrom, seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

const ART_DIR = mkdtempSync(join(tmpdir(), 'rs-giver-art-'));
process.env.ART_DIR = ART_DIR;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('portrait-bytes'),
]);

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
    rmSync(ART_DIR, { recursive: true, force: true });
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

  async function adminToken(): Promise<string> {
    const email = `admin-${randomUUID()}@example.com`;
    await prisma.account.create({
      data: {
        email,
        passwordHash: await testApp.app.get(PasswordService).hash('admin-password-1'),
        role: 'ADMIN',
        player: {
          create: {
            name: `admin_${randomUUID().replaceAll('-', '').slice(0, 22)}`,
            credits: 0,
            locale: 'en',
          },
        },
      },
    });
    const login = await request(httpServer(testApp.app))
      .post('/v1/auth/login')
      .send({ email, password: 'admin-password-1' });
    return accessTokenFrom(login);
  }

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
      const publicRows = stored.filter((row) => row.privatePlayerId === null);
      const perGiver = new Map<string, number>();
      for (const row of publicRows) {
        if (row.giverId !== null) perGiver.set(row.giverId, (perGiver.get(row.giverId) ?? 0) + 1);
      }
      // The mix comes before the giver (slice 2.1, ruling 4): when everyone who could voice the type
      // the board still needs is already at the half-share cap, the offer is posted without a giver
      // (explorations plan, ruling 12). Every voiceless slot on this board must say why.
      const shareCap = Math.max(1, Math.floor(publicRows.length * MAX_BOARD_SHARE));
      const active = await prisma.questGiver.findMany({
        where: { role: 'GIVER', active: true, factionId: faction },
      });
      for (const row of publicRows) {
        if (row.giver === null) {
          const couldVoice = active.filter((giver) => {
            const types = (giver.personality as { types: Record<string, number> }).types;
            const worksHere =
              giver.locationIds.length === 0 || giver.locationIds.includes(player.home);
            return worksHere && (types[row.type] ?? 0) > 0;
          });
          expect(
            couldVoice.length === 0 ||
              couldVoice.every((giver) => (perGiver.get(giver.id) ?? 0) >= shareCap),
          ).toBe(true);
          continue;
        }
        expect(row.giver?.role).toBe('GIVER');
        expect(row.giver?.factionId).toBe(faction);
        const personality = row.giver?.personality as { types: Record<string, number> };
        expect(personality.types[row.type] ?? 0).toBeGreaterThan(0);
      }
      for (const count of perGiver.values()) {
        expect(count).toBeLessThanOrEqual(Math.max(1, Math.floor(publicRows.length / 2) + 1));
      }
      // the offers carry who gave them (or nobody, for a voiceless slot), and a brief that reads
      for (const offer of offers.filter((entry) => entry.privatePlayerId === null)) {
        const row = stored.find((entry) => entry.id === offer.id)!;
        expect(offer.info.giver?.id ?? null).toBe(row.giverId);
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
      const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: offer.id } });
      // the card names the giver when the offer has one, and never invents one when it has none
      expect(offer.info.giver?.id ?? null).toBe(stored.giverId);
      const template = await prisma.missionTemplate.findFirstOrThrow({
        where: { id: stored.templateId },
      });
      expect(offer.info.description.en).toBe((template.description as { en: string }).en);
    }
  });

  it('an admin uploads a portrait for a giver: it shows on the mentor, the faction list and the board, and resets', async () => {
    await freshWorld();
    const email = `admin-${randomUUID()}@example.com`;
    await prisma.account.create({
      data: {
        email,
        passwordHash: await testApp.app.get(PasswordService).hash('admin-password-1'),
        role: 'ADMIN',
        player: {
          create: {
            name: `admin_${randomUUID().replaceAll('-', '').slice(0, 22)}`,
            credits: 0,
            locale: 'en',
          },
        },
      },
    });
    const login = await request(httpServer(testApp.app))
      .post('/v1/auth/login')
      .send({ email, password: 'admin-password-1' });
    const adminToken = accessTokenFrom(login);

    const up = await request(httpServer(testApp.app))
      .post('/v1/admin/tuning/quest-givers/luna_mentor_ines/art/portrait')
      .set(auth(adminToken))
      .set('Content-Type', 'image/png')
      .send(PNG);
    expect(up.status).toBe(200);
    const { url } = up.body as { url: string };
    expect(url).toMatch(/^\/v1\/art\/luna_mentor_ines-portrait-[a-f0-9]{12}\.png$/);
    expect((await request(httpServer(testApp.app)).get(url)).status).toBe(200);

    const player = await onboard('luna');
    const mentor = await request(httpServer(testApp.app))
      .get('/v1/players/me/mentor')
      .set(auth(player.token));
    expect((mentor.body as { giver: Giver }).giver.portraitUrl).toBe(url);
    const offers = await boardOf(player.token, player.home);
    expect(offers[0]!.info.giver?.portraitUrl).toBe(url);
    const factions = await request(httpServer(testApp.app))
      .get('/v1/factions')
      .set(auth(player.token));
    const luna = (
      factions.body as { factions: Array<{ id: string; mentor?: { portraitUrl: string | null } }> }
    ).factions.find((f) => f.id === 'luna');
    expect(luna?.mentor?.portraitUrl).toBe(url);

    const badSlot = await request(httpServer(testApp.app))
      .post('/v1/admin/tuning/quest-givers/luna_mentor_ines/art/banner')
      .set(auth(adminToken))
      .set('Content-Type', 'image/png')
      .send(PNG);
    expect(badSlot.status).toBe(400);

    const reset = await request(httpServer(testApp.app))
      .delete('/v1/admin/tuning/quest-givers/luna_mentor_ines/art/portrait')
      .set(auth(adminToken));
    expect(reset.body).toEqual({ slot: 'portrait', url: null });
    expect((await request(httpServer(testApp.app)).get(url)).status).toBe(404);
  });

  describe('Admin editing', () => {
    const validGiver = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      factionId: 'luna',
      role: 'GIVER',
      name: 'Test Giver',
      title: { en: 'Tester', 'pt-BR': 'Testador' },
      personality: { types: { RESCUE: 50 }, minZone: 0, maxZone: 3, tone: 'formal' },
      lines: { 'offer.RESCUE': [{ en: 'Save them.', 'pt-BR': 'Salve-os.' }] },
      locationIds: [],
      weight: 10,
      ...overrides,
    });
    const create = (token: string, data: Record<string, unknown>) =>
      request(httpServer(testApp.app))
        .post('/v1/admin/tuning/quest-givers')
        .set(auth(token))
        .send({ data, reason: 'test' });

    it('creates, lists and edits a giver; one who works anywhere is saved with no places', async () => {
      await freshWorld();
      const token = await adminToken();
      const created = await create(token, validGiver('test_rescuer'));
      expect(created.status).toBe(201);
      const list = await request(httpServer(testApp.app))
        .get('/v1/admin/tuning/quest-givers')
        .set(auth(token));
      expect((list.body as Array<{ id: string }>).map((row) => row.id)).toContain('test_rescuer');
      const patched = await request(httpServer(testApp.app))
        .patch('/v1/admin/tuning/quest-givers/test_rescuer')
        .set(auth(token))
        .send({ data: { weight: 99, locationIds: ['ceres'] }, reason: 'test' });
      expect(patched.status).toBe(200);
      expect(
        (patched.body as { row: { weight: number; locationIds: string[] } }).row,
      ).toMatchObject({
        weight: 99,
        locationIds: ['ceres'],
      });
    });

    it('refuses a malformed personality or line pool with a reason', async () => {
      await freshWorld();
      const token = await adminToken();
      const bad = async (overrides: Record<string, unknown>) =>
        (await create(token, validGiver('bad_one', overrides))).status;
      expect(
        await bad({ personality: { types: { NONSENSE: 5 }, minZone: 0, maxZone: 3, tone: 'x' } }),
      ).toBe(400);
      expect(
        await bad({ personality: { types: { RESCUE: -1 }, minZone: 0, maxZone: 3, tone: 'x' } }),
      ).toBe(400);
      expect(await bad({ personality: { types: {}, minZone: 0, maxZone: 3, tone: 'x' } })).toBe(
        400,
      );
      expect(
        await bad({ personality: { types: { RESCUE: 1 }, minZone: 3, maxZone: 1, tone: 'x' } }),
      ).toBe(400);
      expect(await bad({ lines: { 'offer.RESCUE': [{ en: 'only english', 'pt-BR': '' }] } })).toBe(
        400,
      );
      expect(await bad({ lines: { 'offer.RESCUE': 'not a list' } })).toBe(400);
      expect(await bad({ id: 'Bad Id!' })).toBe(400);
      expect(await bad({ factionId: 'nowhere' })).toBe(400);
      expect(await prisma.questGiver.count({ where: { id: 'bad_one' } })).toBe(0);
    });

    it('keeps exactly one active mentor per faction', async () => {
      await freshWorld();
      const token = await adminToken();
      // a second active mentor for luna is refused with the reason
      const second = await create(token, validGiver('luna_second_mentor', { role: 'MENTOR' }));
      expect(second.status).toBe(400);
      expect(JSON.stringify(second.body)).toContain('already has an active mentor');
      // retiring the only mentor is refused
      const retire = await request(httpServer(testApp.app))
        .patch('/v1/admin/tuning/quest-givers/luna_mentor_ines')
        .set(auth(token))
        .send({ data: { active: false }, reason: 'test' });
      expect(retire.status).toBe(400);
      expect(JSON.stringify(retire.body)).toContain('must keep an active mentor');
      // an inactive second mentor is fine, and promoting it needs the old one gone first
      const spare = await create(
        token,
        validGiver('luna_spare_mentor', { role: 'MENTOR', active: false }),
      );
      expect(spare.status).toBe(201);
    });

    it('saves an edit to the opening guides: the free faction has three mentors at once', async () => {
      await freshWorld();
      const token = await adminToken();
      for (const id of ['free_mentor_kite', 'free_mentor_dara', 'free_mentor_oren']) {
        const saved = await request(httpServer(testApp.app))
          .patch(`/v1/admin/tuning/quest-givers/${id}`)
          .set(auth(token))
          .send({ data: { weight: 11 }, reason: 'edit the opening' });
        expect(saved.status).toBe(200);
      }
      expect(await prisma.questGiver.count({ where: { factionId: 'free', role: 'MENTOR' } })).toBe(
        3,
      );
    });

    it('a giver added in Admin starts offering on boards', async () => {
      await freshWorld();
      const token = await adminToken();
      // the only active giver left serves DELIVERY and RESCUE, heavily weighted
      await prisma.questGiver.updateMany({
        where: { role: 'GIVER', factionId: 'luna' },
        data: { active: false },
      });
      expect(
        (
          await create(
            token,
            validGiver('only_giver', {
              weight: 1000,
              personality: {
                types: { DELIVERY: 1, RESCUE: 1 },
                minZone: 0,
                maxZone: 3,
                tone: 'formal',
              },
            }),
          )
        ).status,
      ).toBe(201);
      await config.refresh();
      const player = await onboard('luna');
      await makeVeteran(player.playerId);
      const offers = await boardOf(player.token, player.home);
      const publicOffers = offers.filter((offer) => offer.privatePlayerId === null);
      expect(publicOffers.length).toBeGreaterThan(0);
      // The new giver is the only voice on the board; the slots its personality cannot serve are
      // posted without a giver (slice 2.1, ruling 4) rather than with somebody else's words.
      const onlyGiver = await prisma.questGiver.findUniqueOrThrow({ where: { id: 'only_giver' } });
      const types = (onlyGiver.personality as { types: Record<string, number> }).types;
      expect(publicOffers.some((offer) => offer.info.giver?.id === 'only_giver')).toBe(true);
      for (const offer of publicOffers) {
        if (offer.info.giver == null) {
          expect(types[offer.type] ?? 0).toBe(0);
        } else {
          expect(offer.info.giver.id).toBe('only_giver');
        }
      }
    });
  });
});
