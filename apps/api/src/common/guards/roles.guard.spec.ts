import { describe, expect, it } from '@jest/globals';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CurrentUserPayload } from '../decorators/current-user.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

class DummyController {}

function makeContext(
  requiredRoles: string[] | undefined,
  user: CurrentUserPayload | undefined,
): ExecutionContext {
  function handler() {
    /* stand-in route handler used only as a metadata target */
  }
  if (requiredRoles !== undefined) {
    Reflect.defineMetadata(ROLES_KEY, requiredRoles, handler);
  }
  return {
    getHandler: () => handler,
    getClass: () => DummyController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

// Table-driven per the brief: no @Roles() route exists yet (S2.3's job), so this guard-level
// unit test is the acceptance evidence for the role-checking behaviour.
describe('RolesGuard', () => {
  const reflector = new Reflector();

  const cases: Array<{
    name: string;
    requiredRoles: string[] | undefined;
    user: CurrentUserPayload | undefined;
    allowed: boolean;
  }> = [
    {
      name: 'no @Roles() metadata at all: allow through',
      requiredRoles: undefined,
      user: { accountId: 'a', playerId: 'p', role: 'PLAYER' },
      allowed: true,
    },
    {
      name: 'empty @Roles() list: allow through',
      requiredRoles: [],
      user: { accountId: 'a', playerId: 'p', role: 'PLAYER' },
      allowed: true,
    },
    {
      name: "user's role is in the required list: allow",
      requiredRoles: ['ADMIN', 'PLAYER'],
      user: { accountId: 'a', playerId: 'p', role: 'PLAYER' },
      allowed: true,
    },
    {
      name: "user's role is not in the required list: deny",
      requiredRoles: ['ADMIN'],
      user: { accountId: 'a', playerId: 'p', role: 'PLAYER' },
      allowed: false,
    },
    {
      name: 'no user on the request at all: deny',
      requiredRoles: ['ADMIN'],
      user: undefined,
      allowed: false,
    },
  ];

  it.each(cases)('$name', ({ requiredRoles, user, allowed }) => {
    const guard = new RolesGuard(reflector);
    const context = makeContext(requiredRoles, user);

    if (allowed) {
      expect(guard.canActivate(context)).toBe(true);
    } else {
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    }
  });
});
