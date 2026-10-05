import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { client, serverNow } from '../../api/client';
import type { ActiveMission } from '../../api/generated';
import { useAuthContext } from '../auth/auth.context';
import { transitPollInterval } from './poll';

/** The pilot's current mission (accepted, held, flying or resolving), polled at the transit cadence. */
export function useActiveMissions() {
  return useQuery({
    queryKey: ['active'],
    refetchInterval: (query) => transitPollInterval(query.state.data, serverNow()),
    queryFn: () => client.get<ActiveMission[]>('/v1/missions/active'),
  });
}

/**
 * Keeps the wallet honest when a mission ends on the server. Missions resolve in the worker, so
 * nothing on the page triggers a profile read; without this the balance only changed after an F5.
 * The moment a flying mission drops off the active list, the profile is re-read.
 */
export function useWalletSync(): void {
  const { reloadProfile } = useAuthContext();
  const active = useActiveMissions();
  const flying = useRef<string | null>(null);
  const missions = active.data;

  useEffect(() => {
    if (missions === undefined) return;
    const inFlight = missions.find(
      (mission) => mission.status === 'IN_TRANSIT' || mission.status === 'RESOLVING',
    );
    if (inFlight !== undefined) {
      flying.current = inFlight.id;
      return;
    }
    if (flying.current !== null) {
      flying.current = null;
      void reloadProfile();
    }
  }, [missions, reloadProfile]);
}
