import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { SystemFlagService } from '../../src/admin/system/system-flag.service.js';
import { createHash } from 'node:crypto';
import { AuthService } from '../../src/auth/auth.service.js';
import { GuestService } from '../../src/auth/guest.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { resetDatabase } from '../support/test-db.js';

// Guest accounts: an ordinary account and player flagged isGuest, signed in again by a random key
// the browser keeps (only its hash is stored here).
describe('guest accounts', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let guests: GuestService;
  let auth: AuthService;

  beforeEach(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    guests = testApp.app.get(GuestService);
    auth = testApp.app.get(AuthService);
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await testApp.close();
  });

  it('createGuest makes a flagged account with a mail-proof email and a guest-xxxxxx name, and keeps only the key hash', async () => {
    const first = await guests.createGuest('en');
    const second = await guests.createGuest('pt-BR');

    expect(first.player.isGuest).toBe(true);
    expect(first.player.name).toMatch(/^guest-[a-z0-9]{6}$/);
    expect(second.player.name).toMatch(/^guest-[a-z0-9]{6}$/);
    expect(second.player.name).not.toBe(first.player.name);
    expect(second.player.locale).toBe('pt-BR');
    expect(first.accessToken).toEqual(expect.any(String));

    const account = await prisma.account.findFirstOrThrow({
      where: { player: { id: first.player.id } },
    });
    expect(account.isGuest).toBe(true);
    expect(account.email.endsWith('@guest.invalid')).toBe(true);
    expect(first.guestKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(account.guestKeyHash).toBe(createHash('sha256').update(first.guestKey).digest('hex'));
    expect(JSON.stringify(account)).not.toContain(first.guestKey);
  });

  it('a registered pilot is not a guest', async () => {
    const session = await auth.register({
      email: 'real@example.com',
      password: 'real-password-1',
      name: 'real_pilot',
      locale: 'en',
    });
    expect(session.player.isGuest).toBe(false);
  });

  describe('over HTTP', () => {
    const server = () => testApp.app.getHttpServer() as Server;
    const start = () => request(server()).post('/v1/auth/guest').send({ locale: 'en' });

    it('POST /v1/auth/guest answers 201 with a session, the key and a refresh cookie, and the token works', async () => {
      const response = await start();
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
        guestKey: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        player: { isGuest: true, name: expect.stringMatching(/^guest-[a-z0-9]{6}$/) },
      });
      expect(String(response.headers['set-cookie'])).toContain('rid=');

      const me = await request(server())
        .get('/v1/players/me')
        .set('Authorization', `Bearer ${(response.body as { accessToken: string }).accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ isGuest: true });
    });

    it('a daily cap of 0 turns guests off, and the cap is a limit per day', async () => {
      const config = testApp.app.get(GameConfigService);
      await config.setValue('admin.guest_daily_cap', 0, 'test', 'guest off');
      const off = await start();
      expect(off.status).toBe(403);
      expect(off.body).toMatchObject({ message: { error: 'GUEST_DISABLED' } });

      await config.setValue('admin.guest_daily_cap', 1, 'test', 'one a day');
      expect((await start()).status).toBe(201);
      const full = await start();
      expect(full.status).toBe(503);
      expect(full.body).toMatchObject({ message: { error: 'GUEST_CAP_REACHED' } });
    });

    it('a guest cannot start while registration is closed', async () => {
      await prisma.systemFlag.create({ data: { key: 'register.open', value: false } });
      const response = await start();
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ message: { error: 'REGISTRATION_CLOSED' } });
      expect(testApp.app.get(SystemFlagService)).toBeDefined();
    });

    it('resume signs the guest back in with the key; a wrong key gets 401; a frozen guest gets GUEST_FROZEN', async () => {
      const first = await start();
      const { guestKey, player } = first.body as { guestKey: string; player: { id: string } };

      const resumed = await request(server()).post('/v1/auth/guest/resume').send({ guestKey });
      expect(resumed.status).toBe(200);
      expect(resumed.body).toMatchObject({
        accessToken: expect.any(String),
        player: { id: player.id },
      });
      expect(resumed.body).not.toHaveProperty('guestKey');
      expect(String(resumed.headers['set-cookie'])).toContain('rid=');

      const wrong = await request(server())
        .post('/v1/auth/guest/resume')
        .send({ guestKey: 'x'.repeat(43) });
      expect(wrong.status).toBe(401);

      await prisma.account.updateMany({
        where: { player: { id: player.id } },
        data: { status: 'FROZEN' },
      });
      const frozen = await request(server()).post('/v1/auth/guest/resume').send({ guestKey });
      expect(frozen.status).toBe(403);
      expect(frozen.body).toMatchObject({ message: { error: 'GUEST_FROZEN' } });
    });
  });
});
