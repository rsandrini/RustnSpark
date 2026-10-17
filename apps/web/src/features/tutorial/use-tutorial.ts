import { useQuery } from '@tanstack/react-query';
import { client } from '../../api/client';
import type { ActiveMission, ReportListResponse, ShipResponse } from '../../api/generated';
import { useVisited } from './tutorial-store';

export type StepId = 'build' | 'ports' | 'mission' | 'dispatch' | 'report' | 'repair' | 'work';

export interface TutorialStep {
  id: StepId;
  done: boolean;
  /** Where "Take me there" goes. */
  to: string;
}

export const STEP_ORDER: readonly StepId[] = [
  'build',
  'ports',
  'mission',
  'dispatch',
  'report',
  'repair',
  'work',
];

/** The checklist, ticked from game state (ship, active mission, reports) and from the screens the pilot
    has opened. Reads the same queries the screens use, so it adds no requests of its own once they ran. */
export function useTutorialSteps(playerId: string | undefined, enabled: boolean): TutorialStep[] {
  const visited = useVisited(playerId);
  const ships = useQuery({
    queryKey: ['ships'],
    enabled,
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const active = useQuery({
    queryKey: ['active'],
    enabled,
    queryFn: () => client.get<ActiveMission[]>('/v1/missions/active'),
  });
  const reports = useQuery({
    queryKey: ['reports'],
    enabled,
    queryFn: () => client.get<ReportListResponse>('/v1/reports'),
  });

  const ship = ships.data?.[0];
  const built = (ship?.sheet.structureUsed ?? 0) > 0;
  // "Read the ports" is only done with every part connected: a red port has to be fixed, not just seen.
  const connected = built && (ship?.disconnectedPartIds ?? []).length === 0;
  const reportItems = reports.data?.items ?? [];
  const hasReport = reportItems.length > 0;
  const hasMission = (active.data ?? []).length > 0 || hasReport;
  const dispatched = hasReport || (active.data ?? []).some((m) => m.status === 'IN_TRANSIT');
  const latest = reportItems[0]?.missionId;

  const done: Record<StepId, boolean> = {
    build: built,
    ports: connected && visited.includes('yard'),
    mission: hasMission,
    dispatch: dispatched,
    report: visited.includes('report'),
    repair: visited.includes('repair'),
    work: ['refuel', 'scavenging', 'mining'].some((key) => visited.some((v) => v === key)),
  };
  const to: Record<StepId, string> = {
    build: '/ship',
    ports: '/ship',
    mission: '/missions',
    dispatch: '/ship',
    report: latest === undefined ? '/profile' : `/report/${latest}`,
    repair: '/port',
    work: '/port',
  };
  return STEP_ORDER.map((id) => ({ id, done: done[id], to: to[id] }));
}
