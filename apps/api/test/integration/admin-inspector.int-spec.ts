import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { MissionInstance } from '@prisma/client';
import { Queue } from 'bullmq';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import type { DispatchJobData } from '../../src/missions/dispatch.service.js';
import { MissionResolveService } from '../../src/missions/resolve.service.js';
import { MissionProcessor } from '../../src/jobs/processors/mission.processor.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  PlayerListResponseSchema,
  PlayerSheetSchema,
  ReplayResponseSchema,
  SupportResultSchema,
  TimelinePageSchema,
} from '@rustandspark/contract';
import { contract } from '../support/contract.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { accessTokenFrom, seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

interface AuthPair {
  playerId: string;
  token: string;
  shipId: string;
}

async function makeAdmin(
  prisma: PrismaService,
  passwordService: PasswordService,
  server: Server,
): Promise<{ accountId: string; playerId: string; token: string }> {
  const email = `admin-${randomUUID()}@example.com`;
  const account = await prisma.account.create({
    data: {
      email,
      passwordHash: await passwordService.hash('admin-password-1'),
      role: 'ADMIN',
      player: {
        create: {
          name: `a_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
          credits: 0,
          locale: 'en',
        },
      },
    },
    include: { player: true },
  });
  if (account.player === null) throw new Error('admin player missing');
  const response = await request(server)
    .post('/v1/auth/login')
    .send({ email, password: 'admin-password-1' });
  expect(response.status).toBe(200);
  return { accountId: account.id, playerId: account.player.id, token: accessTokenFrom(response) };
}

// S11.4 acceptance: inspector sheet/timeline/replay plus the six audited support
// actions (GDD §17 screen D). Replay runs against a real dispatch+resolve fixture so
// matchesStored proves the live engine still reproduces the stored MissionLog.
describe('admin player inspector (S11.4)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let server: Server;
  let queue: Queue<DispatchJobData>;
  let processor: MissionProcessor;
  let startCredits: number;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    server = httpServer(testApp.app);
    queue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
    processor = new MissionProcessor(testApp.app.get(MissionResolveService));
  });

  afterAll(async () => {
    await testApp?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed(prisma);
    await testApp.app.get(GameConfigService).refresh();
    startCredits = testApp.app.get(GameConfigService).snapshot().rules.economy.start_credits;
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  // Support actions are @Idempotent(): every call carries a fresh key unless a test pins one.
  const auth = (token: string, key: string = randomUUID()): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    'Idempotency-Key': key,
  });

  async function makePlayer(): Promise<AuthPair> {
    const passwordService = testApp.app.get(PasswordService);
    const seeded = await seedAccountWithPlayer(prisma, passwordService);
    const token = await testApp.app.get(TokenService).signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(server)
      .post('/v1/players/me/onboarding')
      .set(auth(token))
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    await assembleStarterKit(server, token, (onboarded.body as { id: string }).id);
    return { playerId: seeded.player.id, token, shipId: (onboarded.body as { id: string }).id };
  }

  async function createAcceptedMission(
    player: AuthPair,
    missionSeed: string,
  ): Promise<MissionInstance> {
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
            distance: 150,
            danger: 0,
            zone: 0,
            env: { id: 'open', level: 1, fuelMult: 1 },
          },
          {
            routeId: route.id,
            distance: 100,
            danger: 0,
            zone: 0,
            env: { id: 'open', level: 1, fuelMult: 1 },
          },
        ],
        cargo: {},
        reward: 100,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        seed: missionSeed,
        status: 'ACCEPTED',
        playerId: player.playerId,
        shipId: player.shipId,
        acceptedAt: new Date(),
      },
    });
  }

  async function resolveMissionFixture(player: AuthPair, missionId: string): Promise<void> {
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 10_000 } });
    const dispatched = await request(server)
      .post(`/v1/ships/${player.shipId}/dispatch`)
      .set(auth(player.token))
      .send({ missionId });
    expect(dispatched.status).toBe(200);
    const job = await queue.getJob(missionId);
    expect(job).toBeTruthy();
    const result = await processor.process(job!);
    expect(result.skipped).toBe(false);
  }

  it('finds players, serves the full sheet and pages the timeline with the report cursor format', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const player = await makePlayer();
    const other = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));

    // Search by partial email — the S11.5 list entry point.
    const byEmail = await request(server)
      .get(`/v1/admin/players?q=${other.email.slice(0, 12)}`)
      .set(auth(admin.token));
    expect(byEmail.status).toBe(200);
    contract(PlayerListResponseSchema, byEmail.body, 'GET /admin/players');
    const found = (byEmail.body as { items: Array<{ id: string }> }).items;
    expect(found.map((item) => item.id)).toContain(other.player.id);
    expect(found.map((item) => item.id)).not.toContain(player.playerId);

    // Sheet: exact account/player/fleet/cargo/mission shape.
    const dbPlayer = await prisma.player.findUniqueOrThrow({
      where: { id: player.playerId },
      include: { account: true },
    });
    const mission = await createAcceptedMission(player, 's11.4-sheet');
    const sheet = await request(server)
      .get(`/v1/admin/players/${player.playerId}`)
      .set(auth(admin.token));
    expect(sheet.status).toBe(200);
    contract(PlayerSheetSchema, sheet.body, 'GET /admin/players/:id');
    expect(sheet.body).toEqual({
      account: {
        id: dbPlayer.account.id,
        email: dbPlayer.account.email,
        role: 'PLAYER',
        status: 'ACTIVE',
        createdAt: dbPlayer.account.createdAt.toISOString(),
      },
      player: {
        id: player.playerId,
        name: dbPlayer.name,
        credits: startCredits,
        locale: 'en',
        factionId: 'luna',
        createdAt: dbPlayer.createdAt.toISOString(),
      },
      ships: [
        {
          id: player.shipId,
          name: expect.any(String) as unknown as string,
          status: 'IN_PORT',
          stance: expect.any(String) as unknown as string,
          fuel: expect.any(Number) as unknown as number,
          currentLocationId: 'ceres',
        },
      ],
      materials: [],
      activeMissions: [
        {
          id: mission.id,
          type: 'DELIVERY',
          status: 'ACCEPTED',
          originId: 'ceres',
          destinationId: 'hedus',
          acceptedAt: mission.acceptedAt!.toISOString(),
        },
      ],
    });

    // Timeline: newest first, (at, id) descending cursor — same pagination as /v1/reports.
    await prisma.playerEvent.deleteMany({ where: { playerId: player.playerId } });
    const base = Date.now() - 60_000;
    const oldest = await prisma.playerEvent.create({
      data: {
        playerId: player.playerId,
        type: 'leg_travel',
        at: new Date(base),
        payload: { leg: 0 },
      },
    });
    const middle = await prisma.playerEvent.create({
      data: {
        playerId: player.playerId,
        type: 'leg_travel',
        at: new Date(base + 1000),
        payload: { leg: 1 },
      },
    });
    const newest = await prisma.playerEvent.create({
      data: {
        playerId: player.playerId,
        type: 'leg_travel',
        at: new Date(base + 2000),
        payload: { leg: 2 },
      },
    });
    const firstPage = await request(server)
      .get(`/v1/admin/players/${player.playerId}/events?limit=2`)
      .set(auth(admin.token));
    expect(firstPage.status).toBe(200);
    contract(TimelinePageSchema, firstPage.body, 'GET /admin/players/:id/events');
    const page1 = firstPage.body as {
      items: Array<{ id: string; at: string; type: string; payload: unknown }>;
      nextCursor?: string;
    };
    expect(page1.items.map((item) => item.id)).toEqual([newest.id, middle.id]);
    expect(page1.nextCursor).toEqual(expect.any(String));
    const secondPage = await request(server)
      .get(`/v1/admin/players/${player.playerId}/events?limit=2&cursor=${page1.nextCursor}`)
      .set(auth(admin.token));
    const page2 = secondPage.body as { items: Array<{ id: string }>; nextCursor?: string };
    expect(page2.items.map((item) => item.id)).toEqual([oldest.id]);
    expect(page2.nextCursor).toBeUndefined();

    // The report history reuses the player's own list route semantics.
    const reports = await request(server)
      .get(`/v1/admin/players/${player.playerId}/reports`)
      .set(auth(admin.token));
    expect(reports.status).toBe(200);
    expect((reports.body as { items: unknown[] }).items).toEqual([]);

    const missing = await request(server)
      .get('/v1/admin/players/no-such-player')
      .set(auth(admin.token));
    expect(missing.status).toBe(404);
  });

  it('replays a stored report exactly, renders it through the player renderer, and stays frozen after a config edit', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const player = await makePlayer();
    const mission = await createAcceptedMission(player, 's11.4-replay-seed');
    await resolveMissionFixture(player, mission.id);

    const log = await prisma.missionLog.findUniqueOrThrow({ where: { missionId: mission.id } });
    expect(log.outcome).toBe('success');

    const replay = await request(server)
      .get(`/v1/admin/players/${player.playerId}/reports/${mission.id}/replay?view=narrative`)
      .set(auth(admin.token));
    expect(replay.status).toBe(200);
    contract(ReplayResponseSchema, replay.body, 'GET /admin/players/:id/reports/:mission/replay');
    const body = replay.body as {
      missionId: string;
      rulesHash: string;
      matchesStored: boolean;
      stored: { outcome: string; events: number };
      replay: { outcome: string; events: unknown[] };
      report: Record<string, unknown>;
    };
    expect(body.missionId).toBe(mission.id);
    expect(body.rulesHash).toBe(log.rulesHash);
    expect(body.stored.outcome).toBe('success');
    expect(body.stored.events).toBeGreaterThan(0);
    expect(body.matchesStored).toBe(true);
    expect(body.replay.outcome).toBe('success');

    // The replayed report is exactly what the player's own route renders for this log.
    const playerReport = await request(server)
      .get(`/v1/reports/${mission.id}?view=narrative`)
      .set(auth(player.token));
    expect(playerReport.status).toBe(200);
    expect(body.report).toEqual(playerReport.body);

    // Admin edits the live rules after the run: the replay must keep using the frozen
    // rulesHash snapshot, not the edited config.
    const revision = await prisma.tuningRevision.findFirst({ orderBy: { id: 'desc' } });
    const edit = await request(server)
      .patch('/v1/admin/tuning/config/economy.reward_per_tier')
      .set(auth(admin.token))
      .send({
        value: 500,
        expectedRevision: Number(revision?.id ?? 0n),
        reason: 'S11.4 replay must ignore live config',
      });
    expect(edit.status).toBe(200);
    const configService = testApp.app.get(GameConfigService);
    expect(configService.snapshot().hash).not.toBe(log.rulesHash);
    expect((await configService.byHash(log.rulesHash)).economy.reward_per_tier).toBe(120);

    // The world the run read is stored in the log: re-tuning the map afterwards must not
    // change what the replay sees.
    const stored = (log.legs as { context?: { isolation?: unknown; factionRelation?: unknown } })
      .context;
    expect(typeof stored?.isolation).toBe('number');
    expect(typeof stored?.factionRelation).toBe('string');
    await prisma.location.updateMany({ data: { isolation: 9 } });

    const afterEdit = await request(server)
      .get(`/v1/admin/players/${player.playerId}/reports/${mission.id}/replay`)
      .set(auth(admin.token));
    expect(afterEdit.status).toBe(200);
    const frozen = afterEdit.body as { matchesStored: boolean; report: { outcome: string } };
    expect(frozen.matchesStored).toBe(true);
    expect(frozen.report.outcome).toBe('success');
  });

  it('scopes replay: wrong player 404s, player tokens get 403, unknown views 400', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const owner = await makePlayer();
    const bystander = await makePlayer();
    const mission = await createAcceptedMission(owner, 's11.4-scope');
    await resolveMissionFixture(owner, mission.id);

    const wrongPlayer = await request(server)
      .get(`/v1/admin/players/${bystander.playerId}/reports/${mission.id}/replay`)
      .set(auth(admin.token));
    expect(wrongPlayer.status).toBe(404);
    expect(wrongPlayer.body).toEqual({
      statusCode: 404,
      message: { error: 'REPORT_NOT_FOUND' },
      requestId: expect.any(String),
    });

    const playerToken = await request(server)
      .get(`/v1/admin/players/${owner.playerId}/reports/${mission.id}/replay`)
      .set(auth(owner.token));
    expect(playerToken.status).toBe(403);

    const sheetAsPlayer = await request(server)
      .get(`/v1/admin/players/${owner.playerId}`)
      .set(auth(owner.token));
    expect(sheetAsPlayer.status).toBe(403);

    const unknownView = await request(server)
      .get(`/v1/admin/players/${owner.playerId}/reports/${mission.id}/replay?view=bogus`)
      .set(auth(admin.token));
    expect(unknownView.status).toBe(400);
    expect(unknownView.body).toEqual({
      statusCode: 400,
      message: { error: 'UNKNOWN_VIEW' },
      requestId: expect.any(String),
    });
  });

  it('requires a reason on every support action and a positive amount where credits move', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const player = await makePlayer();

    const reasonless: ReadonlyArray<{ path: string; body: Record<string, unknown> }> = [
      { path: `/v1/admin/players/${player.playerId}/credits/grant`, body: { amount: 10 } },
      {
        path: `/v1/admin/players/${player.playerId}/credits/grant`,
        body: { reason: 'x', amount: 0 },
      },
      { path: `/v1/admin/players/${player.playerId}/credits/remove`, body: { amount: 10 } },
      { path: `/v1/admin/players/${player.playerId}/clear-balance`, body: {} },
      { path: `/v1/admin/players/${player.playerId}/ban`, body: {} },
      { path: `/v1/admin/players/${player.playerId}/reset`, body: {} },
      { path: `/v1/admin/players/${player.playerId}/ships/any-ship/unstick`, body: {} },
    ];
    for (const entry of reasonless) {
      const response = await request(server)
        .post(entry.path)
        .set(auth(admin.token))
        .send(entry.body);
      expect(response.status).toBe(400);
    }

    // Nothing happened: no audit rows from the rejected attempts.
    expect(await prisma.adminAuditLog.count({ where: { actor: admin.accountId } })).toBe(0);
  });

  it('replays a retried support action instead of applying it twice (same Idempotency-Key)', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const player = await makePlayer();
    const before = (await prisma.player.findUniqueOrThrow({ where: { id: player.playerId } }))
      .credits;
    const key = randomUUID();
    const send = () =>
      request(server)
        .post(`/v1/admin/players/${player.playerId}/credits/grant`)
        .set(auth(admin.token, key))
        .send({ amount: 40, reason: 'double click' });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(200);
    contract(SupportResultSchema, first.body, 'POST /admin/players/:id/credits/grant');
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    const after = (await prisma.player.findUniqueOrThrow({ where: { id: player.playerId } }))
      .credits;
    expect(after).toBe(before + 40);
    expect(await prisma.adminAuditLog.count({ where: { action: 'SUPPORT_GRANT_CREDITS' } })).toBe(
      1,
    );

    const missing = await request(server)
      .post(`/v1/admin/players/${player.playerId}/credits/grant`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ amount: 1, reason: 'no key' });
    expect(missing.status).toBe(400);
  });

  it('a ban cuts the player off even while their access token is still valid', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const player = await makePlayer();
    await request(server)
      .post(`/v1/admin/players/${player.playerId}/ban`)
      .set(auth(admin.token))
      .send({ reason: 'abuse' })
      .expect(200);
    const after = await request(server).get('/v1/players/me').set(auth(player.token));
    expect(after.status).toBe(403);
    expect(after.body).toMatchObject({ message: { error: 'ACCOUNT_BANNED' } });
  });

  it('applies credit actions with audit rows and maps overdraw to 409 without an audit row', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const player = await makePlayer();
    const initial = (await prisma.player.findUniqueOrThrow({ where: { id: player.playerId } }))
      .credits;

    const granted = await request(server)
      .post(`/v1/admin/players/${player.playerId}/credits/grant`)
      .set(auth(admin.token))
      .send({ amount: 250, reason: 'event prize correction' });
    expect(granted.status).toBe(200);
    expect(granted.body).toEqual({
      action: 'SUPPORT_GRANT_CREDITS',
      target: player.playerId,
      before: { credits: initial },
      after: { credits: initial + 250 },
    });
    const grantEvent = await prisma.playerEvent.findFirstOrThrow({
      where: { playerId: player.playerId, type: 'wallet.credit', creditsDelta: 250 },
    });
    expect((grantEvent.payload as { reason: string }).reason).toBe('support.grant');

    const removed = await request(server)
      .post(`/v1/admin/players/${player.playerId}/credits/remove`)
      .set(auth(admin.token))
      .send({ amount: 100, reason: 'reversed duplicate credit' });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ after: { credits: initial + 150 } });

    const auditsBefore = await prisma.adminAuditLog.count({ where: { actor: admin.accountId } });
    expect(auditsBefore).toBe(2);

    const overdraw = await request(server)
      .post(`/v1/admin/players/${player.playerId}/credits/remove`)
      .set(auth(admin.token))
      .send({ amount: 1_000_000_000, reason: 'should not fit' });
    expect(overdraw.status).toBe(409);
    expect(overdraw.body).toEqual({
      statusCode: 409,
      message: { error: 'INSUFFICIENT_FUNDS' },
      requestId: expect.any(String),
    });
    expect(await prisma.adminAuditLog.count({ where: { actor: admin.accountId } })).toBe(
      auditsBefore,
    );
    expect(
      (await prisma.player.findUniqueOrThrow({ where: { id: player.playerId } })).credits,
    ).toBe(initial + 150);

    // Negative balance → cleared to exactly zero, audited with the reason.
    await prisma.player.update({ where: { id: player.playerId }, data: { credits: -80 } });
    const cleared = await request(server)
      .post(`/v1/admin/players/${player.playerId}/clear-balance`)
      .set(auth(admin.token))
      .send({ reason: 'compensation for stuck mission' });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({
      action: 'SUPPORT_CLEAR_NEGATIVE_BALANCE',
      target: player.playerId,
      before: { credits: -80 },
      after: { credits: 0 },
    });
    const clearAudit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actor: admin.accountId, action: 'SUPPORT_CLEAR_NEGATIVE_BALANCE' },
    });
    expect(clearAudit.target).toBe(player.playerId);
    expect((clearAudit.after as { reason: string }).reason).toBe('compensation for stuck mission');
    expect(
      (await prisma.player.findUniqueOrThrow({ where: { id: player.playerId } })).credits,
    ).toBe(0);
  });

  it('bans a player: status flips, sessions die, login refuses; admin accounts are protected', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const player = await makePlayer();

    const accountId = (await prisma.player.findUniqueOrThrow({ where: { id: player.playerId } }))
      .accountId;
    const beforeBan = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });

    const beforeLogin = await request(server)
      .post('/v1/auth/login')
      .send({ email: beforeBan.email, password: 'fixture-password-1' });
    expect(beforeLogin.status).toBe(200);

    await prisma.refreshToken.create({
      data: {
        accountId,
        familyId: randomUUID(),
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const banned = await request(server)
      .post(`/v1/admin/players/${player.playerId}/ban`)
      .set(auth(admin.token))
      .send({ reason: 'third ban appeal denied' });
    expect(banned.status).toBe(200);
    expect(banned.body).toEqual({
      action: 'SUPPORT_BAN',
      target: player.playerId,
      before: { status: 'ACTIVE' },
      after: { status: 'BANNED' },
    });

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.status).toBe('BANNED');
    expect(await prisma.refreshToken.count({ where: { accountId } })).toBe(0);

    const afterLogin = await request(server)
      .post('/v1/auth/login')
      .send({ email: account.email, password: 'fixture-password-1' });
    expect(afterLogin.status).toBe(401);

    const adminBan = await request(server)
      .post(`/v1/admin/players/${admin.playerId}/ban`)
      .set(auth(admin.token))
      .send({ reason: 'self-ban attempt' });
    expect(adminBan.status).toBe(400);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: admin.accountId } })).status,
    ).toBe('ACTIVE');

    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actor: admin.accountId, action: 'SUPPORT_BAN' },
    });
    expect(audit.target).toBe(player.playerId);
    expect((audit.after as { reason: string }).reason).toBe('third ban appeal denied');
  });

  it('sets a new password: old one stops working, new one logs in, sessions die, audit never carries the password', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const player = await makePlayer();
    const accountId = (await prisma.player.findUniqueOrThrow({ where: { id: player.playerId } }))
      .accountId;
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });

    await prisma.refreshToken.create({
      data: {
        accountId,
        familyId: randomUUID(),
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const result = await request(server)
      .post(`/v1/admin/players/${player.playerId}/password`)
      .set(auth(admin.token))
      .send({ password: 'a-brand-new-strong-password', reason: 'pilot locked out, verified over email' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      action: 'SUPPORT_SET_PASSWORD',
      target: player.playerId,
      before: { passwordChanged: false },
      after: { passwordChanged: true },
    });

    expect(await prisma.refreshToken.count({ where: { accountId } })).toBe(0);

    const oldLogin = await request(server)
      .post('/v1/auth/login')
      .send({ email: account.email, password: 'fixture-password-1' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(server)
      .post('/v1/auth/login')
      .send({ email: account.email, password: 'a-brand-new-strong-password' });
    expect(newLogin.status).toBe(200);

    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actor: admin.accountId, action: 'SUPPORT_SET_PASSWORD' },
    });
    expect(audit.target).toBe(player.playerId);
    expect(audit.after).toEqual({
      passwordChanged: true,
      reason: 'pilot locked out, verified over email',
    });
    expect(JSON.stringify(audit.after)).not.toContain('a-brand-new-strong-password');
  });

  it('rejects a password change with too short a password or no reason', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const player = await makePlayer();

    const tooShort = await request(server)
      .post(`/v1/admin/players/${player.playerId}/password`)
      .set(auth(admin.token))
      .send({ password: 'short', reason: 'testing' });
    expect(tooShort.status).toBe(400);

    const noReason = await request(server)
      .post(`/v1/admin/players/${player.playerId}/password`)
      .set(auth(admin.token))
      .send({ password: 'a-brand-new-strong-password' });
    expect(noReason.status).toBe(400);
  });

  it('unsticks a hull: active mission expires, ship parks in port, ship id is the audit target', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const player = await makePlayer();
    const mission = await createAcceptedMission(player, 's11.4-unstick');
    await prisma.ship.update({ where: { id: player.shipId }, data: { status: 'ON_MISSION' } });

    const foreign = await makePlayer();
    const wrongShip = await request(server)
      .post(`/v1/admin/players/${player.playerId}/ships/${foreign.shipId}/unstick`)
      .set(auth(admin.token))
      .send({ reason: 'wrong hull' });
    expect(wrongShip.status).toBe(404);

    const unstuck = await request(server)
      .post(`/v1/admin/players/${player.playerId}/ships/${player.shipId}/unstick`)
      .set(auth(admin.token))
      .send({ reason: 'stuck ON_MISSION after crash' });
    expect(unstuck.status).toBe(200);
    expect(unstuck.body).toEqual({
      action: 'SUPPORT_UNSTICK_SHIP',
      target: player.shipId,
      before: { status: 'ON_MISSION' },
      after: { status: 'IN_PORT', expiredMissions: 1 },
    });

    const expired = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(expired.status).toBe('EXPIRED');
    expect(expired.shipId).toBeNull();
    expect(expired.playerId).toBe(player.playerId);
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.status).toBe('IN_PORT');
    expect(ship.stance).toBe('NEUTRAL');

    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actor: admin.accountId, action: 'SUPPORT_UNSTICK_SHIP' },
    });
    expect(audit.target).toBe(player.shipId);
  });

  it('resets a pilot: live state wiped, wallet back to start credits, starter kit re-applied, history kept', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const player = await makePlayer();
    // One-active-mission-per-player index: the history mission resolves first, then the
    // still-active one it leaves behind for reset to expire.
    const resolvedMission = await createAcceptedMission(player, 's11.4-reset-done');
    await resolveMissionFixture(player, resolvedMission.id);
    const mission = await createAcceptedMission(player, 's11.4-reset-active');
    await prisma.ship.update({
      where: { id: player.shipId },
      data: { status: 'ON_MISSION', currentLocationId: 'gate' },
    });
    await prisma.player.update({
      where: { id: player.playerId },
      data: { credits: startCredits + 137 },
    });
    const partsBefore = await prisma.partInstance.count({
      where: { ownerPlayerId: player.playerId },
    });
    const logsBefore = await prisma.missionLog.count({ where: { playerId: player.playerId } });
    const eventsBefore = await prisma.playerEvent.count({ where: { playerId: player.playerId } });
    expect(partsBefore).toBeGreaterThan(0);

    const reset = await request(server)
      .post(`/v1/admin/players/${player.playerId}/reset`)
      .set(auth(admin.token))
      .send({ reason: 'pilot requested fresh start after corruption' });
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({
      action: 'SUPPORT_RESET',
      target: player.playerId,
      after: { credits: startCredits, factionId: 'luna', activeMissions: 0 },
    });

    const dbPlayer = await prisma.player.findUniqueOrThrow({ where: { id: player.playerId } });
    expect(dbPlayer.credits).toBe(startCredits);
    expect(dbPlayer.factionId).toBe('luna');
    expect(
      await prisma.missionInstance.count({
        where: { playerId: player.playerId, status: 'ACCEPTED' },
      }),
    ).toBe(0);
    const expired = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(expired.status).toBe('EXPIRED');
    expect(expired.shipId).toBeNull();
    expect(expired.playerId).toBeNull();
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.status).toBe('IN_PORT');
    expect(ship.stance).toBe('NEUTRAL');
    expect(ship.currentLocationId).toBe('ceres'); // luna's home port
    // The kit is re-applied the way onboarding applies it (D44): loose, not installed.
    expect(
      await prisma.partInstance.count({
        where: { ownerPlayerId: player.playerId, shipId: player.shipId, location: 'INSTALLED' },
      }),
    ).toBe(0);
    expect(
      await prisma.partInstance.count({
        where: { ownerPlayerId: player.playerId, location: 'INVENTORY' },
      }),
    ).toBeGreaterThan(0);
    expect(await prisma.refreshToken.count({ where: { accountId: dbPlayer.accountId } })).toBe(0);

    // History survives: logs and events are never rewritten by support.
    expect(await prisma.missionLog.count({ where: { playerId: player.playerId } })).toBe(
      logsBefore,
    );
    expect(
      await prisma.playerEvent.count({ where: { playerId: player.playerId } }),
    ).toBeGreaterThanOrEqual(eventsBefore);

    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actor: admin.accountId, action: 'SUPPORT_RESET' },
    });
    expect((audit.after as { reason: string }).reason).toBe(
      'pilot requested fresh start after corruption',
    );
  });

  it('reset puts a merely HELD (reserved, not accepted) mission back on the board', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const player = await makePlayer();
    const held = await createAcceptedMission(player, 's11.4-reset-held');
    await prisma.missionInstance.update({
      where: { id: held.id },
      data: { status: 'HELD', shipId: null },
    });
    await request(server)
      .post(`/v1/admin/players/${player.playerId}/reset`)
      .set(auth(admin.token))
      .send({ reason: 'release the reservation' })
      .expect(200);
    const released = await prisma.missionInstance.findUniqueOrThrow({ where: { id: held.id } });
    expect(released).toMatchObject({ status: 'AVAILABLE', playerId: null });
  });
});
