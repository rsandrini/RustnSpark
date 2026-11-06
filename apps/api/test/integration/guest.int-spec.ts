import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
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
});
