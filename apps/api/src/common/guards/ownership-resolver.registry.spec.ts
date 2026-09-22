import { describe, expect, it } from '@jest/globals';
import {
  OwnershipResolverAlreadyRegisteredError,
  OwnershipResolverNotFoundError,
  OwnershipResolverRegistry,
} from './ownership-resolver.registry.js';

describe('OwnershipResolverRegistry', () => {
  it('resolves to the resolver registered for a type', async () => {
    const registry = new OwnershipResolverRegistry();
    const resolver = (resourceId: string) =>
      Promise.resolve({ ownerPlayerId: `owner-of-${resourceId}` });
    registry.register('ship', resolver);

    expect(registry.resolve('ship')).toBe(resolver);
    await expect(registry.resolve('ship')('ship-1')).resolves.toEqual({
      ownerPlayerId: 'owner-of-ship-1',
    });
  });

  it('throws a dedicated error on duplicate registration instead of silently overwriting', () => {
    const registry = new OwnershipResolverRegistry();
    const first = () => Promise.resolve({ ownerPlayerId: 'first' });
    const second = () => Promise.resolve({ ownerPlayerId: 'second' });
    registry.register('ship', first);

    expect(() => registry.register('ship', second)).toThrow(
      OwnershipResolverAlreadyRegisteredError,
    );
    expect(() => registry.register('ship', second)).toThrow(/ship/);
    // The first registration survives the rejected duplicate.
    expect(registry.resolve('ship')).toBe(first);
  });

  it('throws a clear error for a type nobody registered (programming error, not 404/403)', () => {
    const registry = new OwnershipResolverRegistry();
    expect(() => registry.resolve('mission')).toThrow(OwnershipResolverNotFoundError);
    expect(() => registry.resolve('mission')).toThrow(/mission/);
  });
});
