import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { client, serverNow } from '../../api/client';
import type { ShipResponse } from '../../api/generated';
import { useAuthContext } from '../auth/auth.context';

const RETRY_MS = 2000;
const MAX_RETRIES = 15;

/**
 * A rescue the pilot is waiting for arrives when its time is up. The server settles it when asked
 * (and refuses before then), so this just asks at the right moment — from the always-present top
 * bar, so it happens wherever the pilot is, and straight away on a reload after the time passed.
 * The browser's and the server's clocks can differ by a moment: a "not due yet" answer is asked
 * again a couple of seconds later, so the pilot never has to reload to be rescued.
 */
export function useRescueSettle(ship: ShipResponse | undefined): void {
  const queryClient = useQueryClient();
  const { reloadProfile } = useAuthContext();
  const shipId = ship?.id;
  const dueAt = ship?.status === 'ADRIFT' ? (ship.rescue?.dueAt ?? null) : null;

  useEffect(() => {
    if (shipId === undefined || dueAt === null) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const attempt = (retries: number) => {
      client
        .post(`/v1/ships/${shipId}/rescue/settle`)
        .then(() => {
          void reloadProfile();
          void queryClient.invalidateQueries({ queryKey: ['ships'] });
          void queryClient.invalidateQueries({ queryKey: ['inventory'] });
        })
        .catch(() => {
          // not due yet (clock drift) or already settled elsewhere: look again, then ask again
          void queryClient.invalidateQueries({ queryKey: ['ships'] });
          if (!cancelled && retries < MAX_RETRIES) {
            timer = window.setTimeout(() => attempt(retries + 1), RETRY_MS);
          }
        });
    };
    timer = window.setTimeout(attempt, Math.max(0, Date.parse(dueAt) - serverNow()), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shipId, dueAt, queryClient, reloadProfile]);
}
