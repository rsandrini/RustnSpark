import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateShip } from './invalidate-ship';

describe('invalidateShip', () => {
  it('refreshes the ships, the inventory and the accepted mission card', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    invalidateShip(client);
    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(expect.arrayContaining([['ships'], ['inventory'], ['active']]));
    expect(keys).toHaveLength(3);
  });
});
