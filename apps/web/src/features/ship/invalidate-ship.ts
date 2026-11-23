import type { QueryClient } from '@tanstack/react-query';

/**
 * Anything that changes what the ship is (parts, layout, fuel, engine, repair, rescue, escort) also changes
 * whether it still qualifies for the accepted mission, so the active card refetches with the ship.
 */
export function invalidateShip(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['ships'] });
  void queryClient.invalidateQueries({ queryKey: ['inventory'] });
  void queryClient.invalidateQueries({ queryKey: ['active'] });
}
