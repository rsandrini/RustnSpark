import { describe, expect, it } from '@jest/globals';
import {
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

  it('lets a later registration for the same type replace the earlier one', () => {
    const registry = new OwnershipResolverRegistry();
    const first = () => Promise.resolve({ ownerPlayerId: 'first' });
    const second = () => Promise.resolve({ ownerPlayerId: 'second' });
    registry.register('ship', first);
    registry.register('ship', second);

    expect(registry.resolve('ship')).toBe(second);
  });

  it('throws a clear error for a type nobody registered (programming error, not 404/403)', () => {
    const registry = new OwnershipResolverRegistry();
    expect(() => registry.resolve('mission')).toThrow(OwnershipResolverNotFoundError);
    expect(() => registry.resolve('mission')).toThrow(/mission/);
  });
});
