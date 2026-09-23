import { describe, expect, it } from '@jest/globals';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { AccountRole } from '@prisma/client';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';
import { AdminGuard } from './admin.guard.js';

function makeContext(user: CurrentUserPayload | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  it('allows requests whose user role is ADMIN', () => {
    const guard = new AdminGuard();
    const context = makeContext({ accountId: 'a', playerId: 'p', role: AccountRole.ADMIN });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies requests whose user role is PLAYER', () => {
    const guard = new AdminGuard();
    const context = makeContext({ accountId: 'a', playerId: 'p', role: AccountRole.PLAYER });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('denies requests with no user attached', () => {
    const guard = new AdminGuard();
    const context = makeContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
