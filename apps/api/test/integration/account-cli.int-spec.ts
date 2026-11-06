import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { runAccountCommand, type AccountCommand } from '../../src/admin/cli/account-commands.js';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

// The emergency account tool (promote, demote, ban, unban, set-password) on a real database.
const prisma = getTestPrismaClient();
const hash = (plain: string): Promise<string> => Promise.resolve(`hashed:${plain}`);
const run = (command: AccountCommand, args: Parameters<typeof runAccountCommand>[3] = {}) =>
  runAccountCommand(prisma, hash, command, args);

async function account(email: string, role: 'PLAYER' | 'ADMIN' = 'PLAYER') {
  return prisma.account.create({
    data: {
      email,
      passwordHash: 'old',
      role,
      player: { create: { name: email.split('@')[0]!, credits: 0, locale: 'en' } },
    },
  });
}

describe('account CLI', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
  });
  afterAll(async () => {
    await closeTestPrismaClient();
  });

  it('promotes and demotes by email (any letter case), idempotently, and writes the audit log', async () => {
    const boss = await account('boss@x.test', 'ADMIN');
    const user = await account('user@x.test');
    expect(await run('promote', { email: 'User@X.test' })).toMatchObject({
      role: 'ADMIN',
      changed: true,
    });
    expect(await run('promote', { email: 'user@x.test' })).toMatchObject({ changed: false });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('ADMIN');
    expect(await run('demote', { email: 'user@x.test' })).toMatchObject({
      role: 'PLAYER',
      changed: true,
    });
    const log = await prisma.adminAuditLog.findMany({
      where: { actor: 'cli' },
      orderBy: { id: 'asc' },
    });
    expect(log.map((row) => row.action)).toEqual(['account.promote', 'account.demote']);
    expect(log[0]).toMatchObject({
      target: user.id,
      before: { role: 'PLAYER' },
      after: { role: 'ADMIN' },
    });
    expect(boss.id).toBeTruthy();
  });

  it('refuses to demote the only admin without --force', async () => {
    await account('only@x.test', 'ADMIN');
    await expect(run('demote', { email: 'only@x.test' })).rejects.toThrow('only admin');
    expect(await run('demote', { email: 'only@x.test', force: true })).toMatchObject({
      role: 'PLAYER',
    });
  });

  it('bans (signing the account out everywhere), refuses an admin, and unbans', async () => {
    await account('boss@x.test', 'ADMIN');
    const user = await account('user@x.test');
    await prisma.refreshToken.create({
      data: {
        accountId: user.id,
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(run('ban', { email: 'boss@x.test' })).rejects.toThrow('cannot be banned');
    expect(await run('ban', { email: 'user@x.test' })).toMatchObject({
      status: 'BANNED',
      changed: true,
    });
    expect(await prisma.refreshToken.count({ where: { accountId: user.id } })).toBe(0);
    expect(await run('unban', { email: 'user@x.test' })).toMatchObject({
      status: 'ACTIVE',
      changed: true,
    });
    expect(await run('unban', { email: 'user@x.test' })).toMatchObject({ changed: false });
  });

  it('resets a password (length checked, sessions ended) without putting it in the audit log', async () => {
    const user = await account('user@x.test');
    await prisma.refreshToken.create({
      data: {
        accountId: user.id,
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(run('set-password', { email: 'user@x.test', password: 'short' })).rejects.toThrow(
      '10-128',
    );
    await run('set-password', { email: 'user@x.test', password: 'a long enough password' });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(
      'hashed:a long enough password',
    );
    expect(await prisma.refreshToken.count({ where: { accountId: user.id } })).toBe(0);
    const log = await prisma.adminAuditLog.findFirstOrThrow({
      where: { action: 'account.set-password' },
    });
    expect(
      JSON.stringify({ before: log.before, after: log.after, target: log.target }),
    ).not.toContain('a long enough password');
  });

  it('shows an account and lists the admins; an unknown email fails clearly', async () => {
    await account('boss@x.test', 'ADMIN');
    await account('user@x.test');
    expect(await run('show', { email: 'user@x.test' })).toMatchObject({
      role: 'PLAYER',
      status: 'ACTIVE',
      pilot: 'user',
    });
    const { admins } = (await run('list-admins')) as { admins: Array<{ email: string }> };
    expect(admins.map((a) => a.email)).toEqual(['boss@x.test']);
    await expect(run('show', { email: 'nobody@x.test' })).rejects.toThrow(
      'no account for nobody@x.test',
    );
    await expect(run('promote')).rejects.toThrow('--email or --player is required');
  });
});
