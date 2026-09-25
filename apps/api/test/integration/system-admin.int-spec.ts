import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  AdminSystemNoticeSchema,
  SystemFlagSchema,
  SystemNoticesResponseSchema,
} from '@rustandspark/contract';
import { z } from 'zod';
import { contract } from '../support/contract.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { accessTokenFrom, seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

interface AdminCredentials {
  accountId: string;
  token: string;
}

// Fresh admin per call: the login route is throttled 5/min per ip+email (like the
// config-tuning suite), so reusing one admin across tests would trip the budget.
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

async function makePlayer(
  prisma: PrismaService,
  passwordService: PasswordService,
  server: Server,
): Promise<string> {
  const seeded = await seedAccountWithPlayer(prisma, passwordService);
  const response = await request(server)
    .post('/v1/auth/login')
    .send({ email: seeded.email, password: seeded.password });
  expect(response.status).toBe(200);
  return accessTokenFrom(response);
}

describe('admin system: flags, broadcast, maintenance (S11.2)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let server: Server;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    server = httpServer(testApp.app);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  it('sets a flag with an audit row carrying actor, action, target, before/after and ip', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const auth = `Bearer ${admin.token}`;

    const first = await request(server)
      .put('/v1/admin/system/flags/register.open')
      .set('Authorization', auth)
      .send({ value: false });
    expect(first.status).toBe(200);
    contract(SystemFlagSchema, first.body, 'PUT /admin/system/flags/:key');
    expect(first.body).toMatchObject({
      key: 'register.open',
      value: false,
      updatedBy: admin.accountId,
    });

    const [created] = await prisma.adminAuditLog.findMany({ orderBy: { id: 'asc' } });
    expect(created).toMatchObject({
      action: 'FLAG_SET',
      target: 'register.open',
      actor: admin.accountId,
      before: null,
      after: false,
    });
    expect(created?.ip).toBeTruthy();

    const second = await request(server)
      .put('/v1/admin/system/flags/register.open')
      .set('Authorization', auth)
      .send({ value: true });
    expect(second.status).toBe(200);

    const rows = await prisma.adminAuditLog.findMany({ orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ before: false, after: true, target: 'register.open' });
  });

  it('rejects a non-boolean flag value and unknown body fields', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const auth = `Bearer ${admin.token}`;

    const badValue = await request(server)
      .put('/v1/admin/system/flags/x')
      .set('Authorization', auth)
      .send({ value: 'yes' });
    expect(badValue.status).toBe(400);

    const extraField = await request(server)
      .put('/v1/admin/system/flags/x')
      .set('Authorization', auth)
      .send({ value: true, nonsense: 1 });
    expect(extraField.status).toBe(400);

    expect(await prisma.adminAuditLog.count()).toBe(0);
  });

  it('closes and reopens registration from the flag without a restart', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const auth = `Bearer ${admin.token}`;
    const register = () =>
      request(server).post('/v1/auth/register').send({
        email: 'closed-player@example.com',
        password: 'password-1234',
        name: 'closedpilot',
      });

    const closed = await request(server)
      .put('/v1/admin/system/flags/register.open')
      .set('Authorization', auth)
      .send({ value: false });
    expect(closed.status).toBe(200);

    const rejected = await register();
    expect(rejected.status).toBe(403);
    expect(rejected.body).toEqual({
      statusCode: 403,
      message: { error: 'REGISTRATION_CLOSED' },
      requestId: expect.any(String),
    });

    const reopened = await request(server)
      .put('/v1/admin/system/flags/register.open')
      .set('Authorization', auth)
      .send({ value: true });
    expect(reopened.status).toBe(200);

    // Same app instance: the flag is read per request, no restart happened in between.
    const accepted = await register();
    expect(accepted.status).toBe(201);
  });

  it('maintenance mode blocks player intents but not reads, admins or public routes', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const playerToken = await makePlayer(prisma, testApp.app.get(PasswordService), server);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const playerAuth = { Authorization: `Bearer ${playerToken}` };

    const on = await request(server)
      .put('/v1/admin/system/flags/maintenance')
      .set(adminAuth)
      .send({ value: true });
    expect(on.status).toBe(200);
    const auditRow = await prisma.adminAuditLog.findFirst({ where: { target: 'maintenance' } });
    expect(auditRow).toMatchObject({ action: 'FLAG_SET', after: true });

    // Player intent -> 503 with the machine-readable code.
    const intent = await request(server)
      .post('/v1/players/me/locale')
      .set(playerAuth)
      .send({ locale: 'pt-BR' });
    expect(intent.status).toBe(503);
    expect(intent.body).toMatchObject({ statusCode: 503, message: { error: 'MAINTENANCE' } });

    // Reads keep working...
    const read = await request(server).get('/v1/players/me').set(playerAuth);
    expect(read.status).toBe(200);

    // ...admins keep writing...
    const adminWrite = await request(server)
      .put('/v1/admin/system/flags/register.open')
      .set(adminAuth)
      .send({ value: true });
    expect(adminWrite.status).toBe(200);

    // ...and public routes (login) are untouched, so players keep their sessions.
    const publicPost = await request(server)
      .post('/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password-1' });
    expect(publicPost.status).toBe(401);

    const off = await request(server)
      .put('/v1/admin/system/flags/maintenance')
      .set(adminAuth)
      .send({ value: false });
    expect(off.status).toBe(200);

    const afterOff = await request(server)
      .post('/v1/players/me/locale')
      .set(playerAuth)
      .send({ locale: 'pt-BR' });
    expect(afterOff.status).toBe(200);
    expect(afterOff.body).toMatchObject({ locale: 'pt-BR' });
  });

  it('broadcasts are audited, served immediately and stop after dismissal', async () => {
    const admin = await makeAdmin(prisma, testApp.app.get(PasswordService), server);
    const playerToken = await makePlayer(prisma, testApp.app.get(PasswordService), server);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const playerAuth = { Authorization: `Bearer ${playerToken}` };
    const message = { en: 'Server party at five', 'pt-BR': 'Festa no servidor às cinco' };

    const created = await request(server)
      .post('/v1/admin/system/notices')
      .set(adminAuth)
      .send({ message });
    expect(created.status).toBe(201);
    const noticeId = (created.body as { id: string }).id;

    const createAudit = await prisma.adminAuditLog.findFirst({
      where: { action: 'BROADCAST_CREATE' },
    });
    expect(createAudit).toMatchObject({
      target: noticeId,
      actor: admin.accountId,
      after: { message, active: true },
      before: null,
    });
    expect(createAudit?.ip).toBeTruthy();

    // Effective immediately for players: same app instance, no restart.
    const forPlayer = await request(server).get('/v1/system/notices').set(playerAuth);
    expect(forPlayer.status).toBe(200);
    contract(SystemNoticesResponseSchema, forPlayer.body, 'GET /system/notices');
    const playerBody = forPlayer.body as { items: Array<{ id: string; message: unknown }> };
    expect(playerBody.items).toEqual([{ id: noticeId, message }]);

    const dismissed = await request(server)
      .post(`/v1/admin/system/notices/${noticeId}/dismiss`)
      .set(adminAuth);
    expect(dismissed.status).toBe(200);
    expect(dismissed.body).toMatchObject({ id: noticeId, active: false });

    const dismissAudit = await prisma.adminAuditLog.findFirst({
      where: { action: 'BROADCAST_DISMISS' },
    });
    expect(dismissAudit).toMatchObject({
      target: noticeId,
      actor: admin.accountId,
      before: { active: true },
      after: { active: false },
    });

    const afterDismiss = await request(server).get('/v1/system/notices').set(playerAuth);
    expect(afterDismiss.body).toEqual({ items: [] });

    // The admin view keeps the dismissed row for history.
    const adminView = await request(server).get('/v1/admin/system/notices').set(adminAuth);
    expect(adminView.status).toBe(200);
    contract(z.array(AdminSystemNoticeSchema), adminView.body, 'GET /admin/system/notices');
    const adminBody = adminView.body as Array<{ id: string; active: boolean }>;
    expect(adminBody).toHaveLength(1);
    expect(adminBody[0]).toMatchObject({ id: noticeId, active: false });
  });
});
