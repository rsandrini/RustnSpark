import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AccountStatusCache } from './account-status.cache.js';
import { AccountStatusGuard } from './account-status.guard.js';

function contextFor(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function makeGuard(status: string | null) {
  const findUnique = jest
    .fn<(args: unknown) => Promise<{ status: string } | null>>()
    .mockResolvedValue(status === null ? null : { status });
  const prisma = { account: { findUnique } } as unknown as PrismaService;
  return { guard: new AccountStatusGuard(new AccountStatusCache(prisma)), findUnique };
}

const user = { accountId: 'a1', playerId: 'p1', role: 'PLAYER' };

describe('AccountStatusGuard', () => {
  it('lets public routes through without a lookup', async () => {
    const { guard, findUnique } = makeGuard('ACTIVE');
    await expect(guard.canActivate(contextFor(undefined))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('accepts an ACTIVE account and caches the verdict', async () => {
    const { guard, findUnique } = makeGuard('ACTIVE');
    await guard.canActivate(contextFor(user));
    await guard.canActivate(contextFor(user));
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('forget() makes a ban visible at once', async () => {
    const findUnique = jest
      .fn<(args: unknown) => Promise<{ status: string }>>()
      .mockResolvedValueOnce({ status: 'ACTIVE' })
      .mockResolvedValueOnce({ status: 'BANNED' });
    const cache = new AccountStatusCache({ account: { findUnique } } as unknown as PrismaService);
    expect(await cache.isActive('a1')).toBe(true);
    expect(await cache.isActive('a1')).toBe(true); // still trusted: cached
    cache.forget('a1');
    expect(await cache.isActive('a1')).toBe(false);
  });

  it('leaves a token for a deleted account to the handler (404 there, as before)', async () => {
    const { guard } = makeGuard(null);
    await expect(guard.canActivate(contextFor(user))).resolves.toBe(true);
  });

  it('refuses a non-ACTIVE account with ACCOUNT_BANNED', async () => {
    for (const status of ['BANNED']) {
      const { guard } = makeGuard(status);
      const error = await guard.canActivate(contextFor(user)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual({ error: 'ACCOUNT_BANNED' });
    }
  });
});
