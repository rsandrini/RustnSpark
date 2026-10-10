import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { client, serverNow } from '../../api/client';
import type { ShipResponse } from '../../api/generated';
import { useAuthContext } from '../auth/auth.context';

/**
 * A rescue the pilot is waiting for arrives when its time is up. The server settles it when asked
 * (and refuses before then), so this just asks at the right moment — from the always-present top
 * bar, so it happens wherever the pilot is, and straight away on a reload after the time passed.
 */
export function useRescueSettle(ship: ShipResponse | undefined): void {
  const queryClient = useQueryClient();
  const { reloadProfile } = useAuthContext();
  const shipId = ship?.id;
  const dueAt = ship?.status === 'ADRIFT' ? (ship.rescue?.dueAt ?? null) : null;

  useEffect(() => {
    if (shipId === undefined || dueAt === null) return undefined;
    const wait = Math.max(0, Date.parse(dueAt) - serverNow());
    const timer = window.setTimeout(() => {
      client
        .post(`/v1/ships/${shipId}/rescue/settle`)
        .then(() => {
          void reloadProfile();
          void queryClient.invalidateQueries({ queryKey: ['ships'] });
          void queryClient.invalidateQueries({ queryKey: ['inventory'] });
        })
        .catch(() => {
          // not due yet (clock drift) or already settled elsewhere: the next refresh tells
          void queryClient.invalidateQueries({ queryKey: ['ships'] });
        });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [shipId, dueAt, queryClient, reloadProfile]);
}
