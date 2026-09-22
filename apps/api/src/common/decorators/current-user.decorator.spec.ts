import { describe, expect, it } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { extractCurrentUser, type CurrentUserPayload } from './current-user.decorator.js';

function makeContext(user?: CurrentUserPayload): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('CurrentUser decorator', () => {
  it('returns the user object JwtAuthGuard attached to the request', () => {
    const user: CurrentUserPayload = { accountId: 'acc-1', playerId: 'ply-1', role: 'PLAYER' };
    expect(extractCurrentUser(undefined, makeContext(user))).toBe(user);
  });

  it('throws when used on a route without JwtAuthGuard having run', () => {
    expect(() => extractCurrentUser(undefined, makeContext(undefined))).toThrow(
      /JwtAuthGuard/,
    );
  });
});
