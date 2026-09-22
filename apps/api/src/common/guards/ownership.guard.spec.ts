import { describe, expect, it } from '@jest/globals';
import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CurrentUserPayload } from '../decorators/current-user.decorator.js';
import { OWNED_RESOURCE_KEY, type OwnedResourceOptions } from '../decorators/owned-resource.decorator.js';
import { OwnershipGuard } from './ownership.guard.js';
import { OwnershipResolverRegistry } from './ownership-resolver.registry.js';

class DummyController {}

function makeContext(
  options: OwnedResourceOptions | undefined,
  params: Record<string, string>,
  user: CurrentUserPayload | undefined,
): ExecutionContext {
  function handler() {
    /* stand-in route handler used only as a metadata target */
  }
  if (options !== undefined) {
    Reflect.defineMetadata(OWNED_RESOURCE_KEY, options, handler);
  }
  return {
    getHandler: () => handler,
    getClass: () => DummyController,
    switchToHttp: () => ({ getRequest: () => ({ params, user }) }),
  } as unknown as ExecutionContext;
}

describe('OwnershipGuard', () => {
  const reflector = new Reflector();
  const player = { accountId: 'acc-1', playerId: 'ply-owner', role: 'PLAYER' as const };

  it('allows the request when the resource belongs to the current player', async () => {
    const registry = new OwnershipResolverRegistry();
    registry.register('ship', () => Promise.resolve({ ownerPlayerId: 'ply-owner' }));
    const guard = new OwnershipGuard(reflector, registry);
    const context = makeContext({ type: 'ship', param: 'id' }, { id: 'ship-1' }, player);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects with 403 when the resource belongs to another player', async () => {
    const registry = new OwnershipResolverRegistry();
    registry.register('ship', () => Promise.resolve({ ownerPlayerId: 'someone-else' }));
    const guard = new OwnershipGuard(reflector, registry);
    const context = makeContext({ type: 'ship', param: 'id' }, { id: 'ship-1' }, player);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejects with 404 when the resolver reports the resource does not exist', async () => {
    const registry = new OwnershipResolverRegistry();
    registry.register('ship', () => Promise.resolve(null));
    const guard = new OwnershipGuard(reflector, registry);
    const context = makeContext({ type: 'ship', param: 'id' }, { id: 'missing' }, player);

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
  });

  it('throws a plain error (not 404/403) when no resolver is registered for the type', async () => {
    const registry = new OwnershipResolverRegistry();
    const guard = new OwnershipGuard(reflector, registry);
    const context = makeContext({ type: 'mission', param: 'id' }, { id: 'm-1' }, player);

    await expect(guard.canActivate(context)).rejects.toThrow(
      /No ownership resolver registered for type "mission"/,
    );
  });

  it('throws when applied to a route with no @OwnedResource() metadata (misconfiguration)', async () => {
    const registry = new OwnershipResolverRegistry();
    const guard = new OwnershipGuard(reflector, registry);
    const context = makeContext(undefined, { id: 'ship-1' }, player);

    await expect(guard.canActivate(context)).rejects.toThrow(/@OwnedResource/);
  });

  it("throws when the @OwnedResource() param name doesn't match any route param (misconfiguration)", async () => {
    const registry = new OwnershipResolverRegistry();
    const guard = new OwnershipGuard(reflector, registry);
    const context = makeContext({ type: 'ship', param: 'shipId' }, { id: 'ship-1' }, player);

    await expect(guard.canActivate(context)).rejects.toThrow(/shipId/);
  });
});
