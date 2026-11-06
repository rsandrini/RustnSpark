import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { seed } from '../../prisma/seed.js';
import { runAccountCommand } from '../../src/admin/cli/account-commands.js';
import { GuestFreezeService } from '../../src/auth/guest-freeze.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import type { GameConfigService } from '../../src/config/game-config.service.js';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

const prisma = getTestPrismaClient();
const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-12-01T12:00:00Z');
const daysAgo = (days: number): Date => new Date(now.getTime() - days * DAY);

// The freeze only reads one setting, so a stub stands in for the whole config service.
function service(freezeDays = 30): GuestFreezeService {
  const config = {
    snapshot: () => ({ rules: { admin: { guest_freeze_days: freezeDays } } }),
  } as unknown as GameConfigService;
  return new GuestFreezeService(prisma as unknown as PrismaService, config);
}

async function pilot(
  name: string,
  options: { guest?: boolean; idleDays?: number | null; createdDaysAgo?: number } = {},
) {
  const created = await prisma.account.create({
    data: {
      email: `${name}@x.test`,
      passwordHash: 'x',
      isGuest: options.guest ?? true,
      createdAt: daysAgo(options.createdDaysAgo ?? 100),
      player: { create: { name, locale: 'en' } },
    },
    include: { player: true },
  });
  if (options.idleDays !== null && options.idleDays !== undefined) {
    await prisma.playerStats.create({
      data: { playerId: created.player!.id, lastActiveAt: daysAgo(options.idleDays) },
    });
  }
  return created;
}
const statusOf = async (id: string) =>
  (await prisma.account.findUniqueOrThrow({ where: { id } })).status;

describe('freezing idle guests', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
  });
  afterAll(async () => {
    await closeTestPrismaClient();
  });

  it('freezes unclaimed guests idle longer than the setting, and nobody else', async () => {
    const idle = await pilot('guest-idle', { idleDays: 40 });
    const recent = await pilot('guest-recent', { idleDays: 5 });
    const claimed = await pilot('claimed', { guest: false, idleDays: 400 });
    const neverPlayed = await pilot('guest-never', { idleDays: null, createdDaysAgo: 45 });
    const brandNew = await pilot('guest-new', { idleDays: null, createdDaysAgo: 1 });

    expect(await service().freezeIdle(now)).toBe(2);

    expect(await statusOf(idle.id)).toBe('FROZEN');
    expect(await statusOf(neverPlayed.id)).toBe('FROZEN');
    expect(await statusOf(recent.id)).toBe('ACTIVE');
    expect(await statusOf(claimed.id)).toBe('ACTIVE');
    expect(await statusOf(brandNew.id)).toBe('ACTIVE');
  });

  it('follows the setting, and leaves the data of a frozen guest untouched', async () => {
    const idle = await pilot('guest-idle', { idleDays: 40 });
    await prisma.player.update({ where: { id: idle.player!.id }, data: { credits: 321 } });

    expect(await service(60).freezeIdle(now)).toBe(0);
    expect(await statusOf(idle.id)).toBe('ACTIVE');

    expect(await service(30).freezeIdle(now)).toBe(1);
    expect(
      (await prisma.player.findUniqueOrThrow({ where: { id: idle.player!.id } })).credits,
    ).toBe(321);
    // a second sweep has nothing left to do
    expect(await service(30).freezeIdle(now)).toBe(0);
  });

  it('never freezes a guest whose flight is still under way', async () => {
    const flying = await pilot('guest-flying', { idleDays: 40 });
    await seed(prisma);
    const template = await prisma.missionTemplate.findFirstOrThrow();
    await prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type: 'DELIVERY',
        factionId: template.factionId,
        originId: 'ceres',
        destinationId: 'hedus',
        legs: [],
        cargo: {},
        reward: 1,
        expiresAt: daysAgo(-1),
        seed: 'x',
        status: 'IN_TRANSIT',
        playerId: flying.player!.id,
      },
    });
    expect(await service().freezeIdle(now)).toBe(0);
    expect(await statusOf(flying.id)).toBe('ACTIVE');
  });

  it('unfreeze brings a guest back by pilot name and counts it as active, so the next sweep leaves it alone', async () => {
    const idle = await pilot('guest-idle', { idleDays: 40 });
    await service().freezeIdle(now);

    const result = await runAccountCommand(prisma, (p) => Promise.resolve(p), 'unfreeze', {
      player: 'guest-idle',
    });
    expect(result).toMatchObject({ status: 'ACTIVE', changed: true });
    expect(await statusOf(idle.id)).toBe('ACTIVE');
    expect(await service().freezeIdle(new Date())).toBe(0);
    expect(await prisma.adminAuditLog.count({ where: { action: 'account.unfreeze' } })).toBe(1);
  });
});
