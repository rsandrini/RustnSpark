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
import { accessTokenFrom, seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

const httpServer = (app: INestApplication): Server => app.getHttpServer() as Server;
const auth = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` });

interface Scene {
  id: string;
  start: string;
  giver: { role: string; factionId: string };
  nodes: Array<{ id: string; text: { en: string; 'pt-BR': string } }>;
}
interface State {
  enabled: boolean;
  scene: Scene | null;
  replayable: Array<{ id: string; title: { en: string } }>;
}

describe('mentor dialogue scenes', () => {
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

  async function freshWorld(): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
    await config.refresh();
  }

  async function newPlayer(faction?: 'luna' | 'sun' | 'explorers', assemble = true) {
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const token = await testApp.app.get(TokenService).signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    let shipId = '';
    if (faction !== undefined) {
      const res = await request(httpServer(testApp.app))
        .post('/v1/players/me/onboarding')
        .set(auth(token))
        .send({ faction });
      expect(res.status).toBe(200);
      shipId = (res.body as { id: string }).id;
      if (assemble) await assembleStarterKit(httpServer(testApp.app), token, shipId);
    }
    return { playerId: seeded.player.id, token, shipId };
  }

  const stateOf = async (token: string): Promise<State> => {
    const res = await request(httpServer(testApp.app))
      .get('/v1/players/me/dialogue')
      .set(auth(token));
    expect(res.status).toBe(200);
    return res.body as State;
  };
  const post = (token: string, path: string, body?: Record<string, unknown>) =>
    request(httpServer(testApp.app))
      .post(`/v1/players/me/dialogue${path}`)
      .set(auth(token))
      .send(body ?? {});

  it('requires a token', async () => {
    expect((await request(httpServer(testApp.app)).get('/v1/players/me/dialogue')).status).toBe(
      401,
    );
  });

  it('has nothing to say before a faction is chosen', async () => {
    await freshWorld();
    const player = await newPlayer();
    expect(await stateOf(player.token)).toEqual({ enabled: true, scene: null, replayable: [] });
  });

  it.each(['luna', 'sun', 'explorers'] as const)(
    '%s: the first scene is the welcome, from the faction mentor, in both languages',
    async (faction) => {
      await freshWorld();
      const player = await newPlayer(faction, false);
      const state = await stateOf(player.token);
      expect(state.scene?.id).toBe('welcome');
      expect(state.scene?.giver).toMatchObject({ role: 'MENTOR', factionId: faction });
      expect(state.scene?.start).toBe('w1');
      for (const node of state.scene?.nodes ?? []) {
        expect(node.text.en.length).toBeGreaterThan(0);
        expect(node.text['pt-BR'].length).toBeGreaterThan(0);
      }
    },
  );

  it('walks through the scenes: advance remembers the node, done closes it and the next one is due', async () => {
    await freshWorld();
    const player = await newPlayer('luna', false);
    expect((await post(player.token, '/welcome', { event: 'advance', nodeId: 'w3' })).status).toBe(
      200,
    );
    // leaving mid-scene resumes where they were
    const resumed = await stateOf(player.token);
    expect(resumed.scene?.id).toBe('welcome');
    expect(resumed.scene?.start).toBe('w3');
    // repeating a call changes nothing
    expect((await post(player.token, '/welcome', { event: 'advance', nodeId: 'w3' })).status).toBe(
      200,
    );
    expect((await post(player.token, '/welcome', { event: 'done' })).status).toBe(200);
    expect((await post(player.token, '/welcome', { event: 'done' })).status).toBe(200);
    const next = await stateOf(player.token);
    expect(next.scene?.id).toBe('first_ship');
    expect(next.replayable.map((entry) => entry.id)).toEqual(['welcome']);
    // a skipped scene does not come back
    await post(player.token, '/first_ship', { event: 'skip' });
    const after = await stateOf(player.token);
    expect(after.scene).toBeNull(); // the ship is not built yet, nothing else is due
    expect(after.replayable.map((entry) => entry.id).sort()).toEqual(['first_ship', 'welcome']);
  });

  it('the first flight is due once the ship is built, and the tank scene only after a first flight', async () => {
    await freshWorld();
    const player = await newPlayer('luna', true);
    await post(player.token, '/welcome', { event: 'done' });
    await post(player.token, '/first_ship', { event: 'done' });
    expect((await stateOf(player.token)).scene?.id).toBe('first_flight');
    await post(player.token, '/first_flight', { event: 'done' });
    expect((await stateOf(player.token)).scene).toBeNull();

    // a finished mission: the report scene; and a failed one later: the failure scene
    const template = await prisma.missionTemplate.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const finished = (status: 'DONE' | 'FAILED') =>
      prisma.missionInstance.create({
        data: {
          templateId: template.id,
          type: template.type,
          factionId: template.factionId,
          originId: 'ceres',
          destinationId: 'ceres_pad',
          legs: [],
          cargo: {},
          reward: 1,
          expiresAt: new Date(0),
          seed: `d-${randomUUID()}`,
          status,
          playerId: player.playerId,
        },
      });
    await finished('DONE');
    expect((await stateOf(player.token)).scene?.id).toBe('after_first_report');
    await post(player.token, '/after_first_report', { event: 'done' });
    // the starter tank is a quarter full: low
    expect((await stateOf(player.token)).scene?.id).toBe('low_fuel');
    await post(player.token, '/low_fuel', { event: 'done' });
    expect((await stateOf(player.token)).scene).toBeNull();
    await finished('FAILED');
    expect((await stateOf(player.token)).scene?.id).toBe('first_failure');
  });

  it('replays a seen scene, refuses one never seen, and rejects unknown scenes and nodes', async () => {
    await freshWorld();
    const player = await newPlayer('sun', false);
    expect((await post(player.token, '/welcome/replay')).status).toBe(409);
    await post(player.token, '/welcome', { event: 'done' });
    await post(player.token, '/first_ship', { event: 'done' });
    expect((await stateOf(player.token)).scene).toBeNull();
    expect((await post(player.token, '/welcome/replay')).status).toBe(200);
    const again = await stateOf(player.token);
    expect(again.scene?.id).toBe('welcome');
    expect(again.scene?.start).toBe('w1');
    expect((await post(player.token, '/no_such_scene', { event: 'done' })).status).toBe(404);
    expect(
      (await post(player.token, '/welcome', { event: 'advance', nodeId: 'ghost' })).status,
    ).toBe(404);
    expect((await post(player.token, '/welcome', { event: 'dance' })).status).toBe(400);
  });

  it('turning dialogues off leaves the checklist only, and the history stays', async () => {
    await freshWorld();
    const player = await newPlayer('explorers', false);
    await post(player.token, '/welcome', { event: 'done' });
    expect((await post(player.token, '/settings', { enabled: false })).status).toBe(200);
    const off = await stateOf(player.token);
    expect(off.enabled).toBe(false);
    expect(off.scene).toBeNull();
    expect(off.replayable.map((entry) => entry.id)).toEqual(['welcome']);
    await post(player.token, '/settings', { enabled: true });
    expect((await stateOf(player.token)).scene?.id).toBe('first_ship');
    expect((await post(player.token, '/settings', { enabled: 'maybe' })).status).toBe(400);
  });

  it("one pilot's progress never touches another's", async () => {
    await freshWorld();
    const first = await newPlayer('luna', false);
    const second = await newPlayer('luna', false);
    await post(first.token, '/welcome', { event: 'done' });
    expect((await stateOf(second.token)).scene?.id).toBe('welcome');
  });

  describe('Admin', () => {
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

    it('saves valid scenes, refuses broken ones with the place, and the pilot hears the edit', async () => {
      await freshWorld();
      const token = await adminToken();
      const text = { en: 'Hello there', 'pt-BR': 'Olá' };
      const goodScene = {
        id: 'welcome',
        title: text,
        trigger: 'onboarded',
        order: 1,
        start: 'a',
        nodes: [
          {
            id: 'a',
            text,
            position: 'bottom',
            anchor: 'ship_grid',
            blocking: false,
            next: null,
            choices: [],
          },
        ],
      };
      const patch = (scenes: unknown) =>
        request(httpServer(testApp.app))
          .patch('/v1/admin/tuning/quest-givers/luna_mentor_ines')
          .set(auth(token))
          .send({ data: { scenes }, reason: 'test' });
      const bad = await patch([
        { ...goodScene, nodes: [{ ...goodScene.nodes[0], position: 'middle' }] },
      ]);
      expect(bad.status).toBe(400);
      expect(JSON.stringify(bad.body)).toContain('position');
      expect((await patch('not a list')).status).toBe(400);
      expect((await patch([goodScene])).status).toBe(200);

      const player = await newPlayer('luna', false);
      const state = await stateOf(player.token);
      expect(state.scene?.id).toBe('welcome');
      expect(state.scene?.nodes[0]?.text.en).toBe('Hello there');
    });
  });
});
