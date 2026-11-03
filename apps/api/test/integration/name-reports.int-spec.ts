import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { accessTokenFrom, seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

const httpServer = (app: INestApplication): Server => app.getHttpServer() as Server;

interface Pilot {
  token: string;
  playerId: string;
  accountId: string;
  name: string;
}

describe('name reports and their review', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let tokens: TokenService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwords = testApp.app.get(PasswordService);
    tokens = testApp.app.get(TokenService);
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed(prisma);
  });
  afterAll(async () => {
    await testApp.close();
  });

  async function pilot(name: string): Promise<Pilot> {
    const seeded = await seedAccountWithPlayer(prisma, passwords, { name });
    const token = await tokens.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    return { token, playerId: seeded.player.id, accountId: seeded.account.id, name };
  }

  async function admin(): Promise<string> {
    const email = `admin-${randomUUID()}@example.com`;
    await prisma.account.create({
      data: {
        email,
        passwordHash: await passwords.hash('admin-password-1'),
        role: 'ADMIN',
        player: {
          create: { name: `a_${randomUUID().replaceAll('-', '').slice(0, 20)}`, locale: 'en' },
        },
      },
    });
    const login = await request(httpServer(testApp.app))
      .post('/v1/auth/login')
      .send({ email, password: 'admin-password-1' });
    return accessTokenFrom(login);
  }

  const report = (from: Pilot, body: Record<string, unknown>) =>
    request(httpServer(testApp.app))
      .post('/v1/moderation/reports')
      .set('Authorization', `Bearer ${from.token}`)
      .send(body);
  const errorOf = (res: { body: unknown }) =>
    (res.body as { message: { error: string } }).message.error;
  const review = (token: string, id: string, action: string, note?: string) =>
    request(httpServer(testApp.app))
      .post(`/v1/admin/moderation/reports/${id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ action, ...(note === undefined ? {} : { note }) });

  it('files a report by pilot name and keeps the text reported', async () => {
    const [alice, bob] = [await pilot('Alice'), await pilot('Bob')];
    await prisma.ship.updateMany({
      where: { ownerPlayerId: bob.playerId },
      data: { name: 'LUN-Bad Name' },
    });
    const res = await report(alice, {
      playerName: 'Bob',
      subject: 'SHIP_NAME',
      reason: 'OFFENSIVE',
      note: ' rude ',
    });
    expect(res.status).toBe(201);
    const row = await prisma.nameReport.findFirstOrThrow({});
    expect(row).toMatchObject({
      reporterId: alice.playerId,
      targetId: bob.playerId,
      subject: 'SHIP_NAME',
      reportedText: 'LUN-Bad Name',
      status: 'OPEN',
      note: 'rude',
    });
  });

  it('refuses unknown pilots, yourself, a repeat while open, and bad values', async () => {
    const [alice, bob] = [await pilot('Alice'), await pilot('Bob')];
    const ok = { playerName: 'Bob', subject: 'PILOT_NAME', reason: 'OTHER' };
    expect((await report(alice, { ...ok, playerName: 'Nobody1' })).status).toBe(404);
    const self = await report(alice, { ...ok, playerName: 'Alice' });
    expect([self.status, errorOf(self)]).toEqual([409, 'CANNOT_REPORT_SELF']);
    expect((await report(alice, ok)).status).toBe(201);
    const again = await report(alice, ok);
    expect([again.status, errorOf(again)]).toEqual([409, 'ALREADY_REPORTED']);
    // another subject on the same pilot is a different report
    expect((await report(alice, { ...ok, subject: 'SHIP_NAME' })).status).toBe(201);
    // (the per-account throttle is 5 per ten minutes, so the bad values go through bob)
    expect((await report(bob, { ...ok, playerName: 'Alice', reason: 'SPAM' })).status).toBe(400);
    expect((await report(bob, { ...ok, playerName: 'Alice', note: 'x'.repeat(301) })).status).toBe(
      400,
    );
    const noToken = await request(httpServer(testApp.app)).post('/v1/moderation/reports').send(ok);
    expect(noToken.status).toBe(401);
  });

  it('is for admins only to read and review', async () => {
    const alice = await pilot('Alice');
    const list = await request(httpServer(testApp.app))
      .get('/v1/admin/moderation/reports')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(list.status).toBe(403);
  });

  it('lists open reports with who and what, and dismisses one', async () => {
    const [alice, bob] = [await pilot('Alice'), await pilot('Bob')];
    await report(alice, { playerName: 'Bob', subject: 'PILOT_NAME', reason: 'OFFENSIVE' });
    const token = await admin();
    const list = await request(httpServer(testApp.app))
      .get('/v1/admin/moderation/reports')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const rows = list.body as Array<{
      id: string;
      reporter: { name: string };
      target: { name: string };
      reportsAgainstTarget: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reporter: { name: 'Alice' },
      target: { name: 'Bob' },
      reportsAgainstTarget: 1,
    });

    const done = await review(token, rows[0]!.id, 'DISMISS', 'looks fine');
    expect(done.status).toBe(200);
    expect(await prisma.nameReport.findUniqueOrThrow({ where: { id: rows[0]!.id } })).toMatchObject(
      {
        status: 'DISMISSED',
        outcome: 'DISMISS',
        reviewNote: 'looks fine',
      },
    );
    expect(await prisma.player.findUniqueOrThrow({ where: { id: bob.playerId } })).toMatchObject({
      name: 'Bob',
    });
    const again = await review(token, rows[0]!.id, 'DISMISS');
    expect([again.status, errorOf(again)]).toEqual([409, 'REPORT_ALREADY_REVIEWED']);
    expect(await prisma.adminAuditLog.count({ where: { action: 'NAME_REPORT_REVIEW' } })).toBe(1);
  });

  it('resets a reported ship name, and settles every open report on the same name', async () => {
    const [alice, bob, carol] = [await pilot('Alice'), await pilot('Bob'), await pilot('Carol')];
    await prisma.ship.updateMany({
      where: { ownerPlayerId: bob.playerId },
      data: { name: 'LUN-Bad Name' },
    });
    const body = { playerName: 'Bob', subject: 'SHIP_NAME', reason: 'OFFENSIVE' };
    await report(alice, body);
    await report(carol, body);
    const token = await admin();
    const first = await prisma.nameReport.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });

    expect((await review(token, first.id, 'RESET_SHIP_NAME', 'rude')).status).toBe(200);
    const ship = await prisma.ship.findFirstOrThrow({ where: { ownerPlayerId: bob.playerId } });
    expect(ship.name).toMatch(/^LUN-Bob-[A-Za-z]+$/);
    expect(await prisma.nameReport.count({ where: { status: 'OPEN' } })).toBe(0);
    expect(
      await prisma.nameReport.count({ where: { status: 'ACTIONED', outcome: 'RESET_SHIP_NAME' } }),
    ).toBe(2);
  });

  it('resets a pilot name to a neutral one, and bans an account', async () => {
    const [alice, bob, carol] = [await pilot('Alice'), await pilot('Bob'), await pilot('Carol')];
    await report(alice, { playerName: 'Bob', subject: 'PILOT_NAME', reason: 'OFFENSIVE' });
    await report(alice, { playerName: 'Carol', subject: 'PILOT_NAME', reason: 'OFFENSIVE' });
    const token = await admin();
    const open = await prisma.nameReport.findMany({ orderBy: { createdAt: 'asc' } });

    expect((await review(token, open[0]!.id, 'RESET_PILOT_NAME')).status).toBe(200);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: bob.playerId } })).name).toMatch(
      /^Pilot-[0-9a-f]{6}$/,
    );

    expect((await review(token, open[1]!.id, 'BAN', 'abusive')).status).toBe(200);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: carol.accountId } })).status,
    ).toBe('BANNED');
  });
});
