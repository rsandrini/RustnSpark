import { describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException, type ExecutionContext } from '@nestjs/common';
import { AccountRole } from '@prisma/client';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';
import { MAINTENANCE_FLAG_KEY, SystemFlagService } from './system-flag.service.js';
import { MaintenanceGuard } from './maintenance.guard.js';

function makeContext(method: string, user?: CurrentUserPayload): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, user }) }),
  } as unknown as ExecutionContext;
}

function makeGuard(enabled: boolean) {
  const isEnabled = jest.fn<(key: string, fallback: boolean) => Promise<boolean>>();
  isEnabled.mockResolvedValue(enabled);
  const flags = { isEnabled } as unknown as SystemFlagService;
  return { guard: new MaintenanceGuard(flags), isEnabled };
}

describe('MaintenanceGuard (S11.2)', () => {
  it('lets reads through without reading the flag', async () => {
    const { guard, isEnabled } = makeGuard(true);

    await expect(guard.canActivate(makeContext('GET'))).resolves.toBe(true);
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it('rejects a player intent with 503 while the flag is on', async () => {
    const { guard, isEnabled } = makeGuard(true);
    const user: CurrentUserPayload = { accountId: 'a', playerId: 'p', role: AccountRole.PLAYER };

    await expect(guard.canActivate(makeContext('POST', user))).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(isEnabled).toHaveBeenCalledWith(MAINTENANCE_FLAG_KEY, false);
  });

  it('lets player intents through while the flag is off', async () => {
    const { guard } = makeGuard(false);
    const user: CurrentUserPayload = { accountId: 'a', playerId: 'p', role: AccountRole.PLAYER };

    await expect(guard.canActivate(makeContext('POST', user))).resolves.toBe(true);
  });

  it('never blocks admins, even mid-maintenance', async () => {
    const { guard, isEnabled } = makeGuard(true);
    const admin: CurrentUserPayload = { accountId: 'a', playerId: 'p', role: AccountRole.ADMIN };

    await expect(guard.canActivate(makeContext('PUT', admin))).resolves.toBe(true);
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it('never blocks public routes, where no user was attached', async () => {
    const { guard, isEnabled } = makeGuard(true);

    await expect(guard.canActivate(makeContext('POST'))).resolves.toBe(true);
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('treats %s as a mutating intent too', async (method) => {
    const { guard } = makeGuard(true);
    const user: CurrentUserPayload = { accountId: 'a', playerId: 'p', role: AccountRole.PLAYER };

    await expect(guard.canActivate(makeContext(method, user))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
