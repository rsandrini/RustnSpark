import { useQuery } from '@tanstack/react-query';
import { client } from '../../api/client';
import type {
  ActiveMission,
  ReportListResponse,
  ShipResponse,
  TutorialProgress,
} from '../../api/generated';
import { useVisited } from './tutorial-store';

export type StepId =
  'build' | 'ports' | 'mission' | 'dispatch' | 'report' | 'refuel' | 'repair' | 'work';

export interface TutorialStep {
  id: StepId;
  done: boolean;
  /** Where "Take me there" goes; null when there is nowhere to go yet (no report until the mission is done). */
  to: string | null;
}

export const STEP_ORDER: readonly StepId[] = [
  'build',
  'ports',
  'refuel',
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

  // What the pilot really did (refuelled, repaired, scavenged or mined), from the game's own records: it
  // survives a cleared browser and counts what was done before the checklist existed.
  const progress = useQuery({
    queryKey: ['tutorial-progress'],
    enabled,
    queryFn: () => client.get<TutorialProgress>('/v1/players/me/tutorial-progress'),
  });

  const ship = ships.data?.[0];
  const built = (ship?.sheet.structureUsed ?? 0) > 0;
  // "Check the connections" is only done with every part connected: a red port has to be fixed, not just seen.
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
    // these three ask for an action: opening the tab is not enough (a new ship starts with a low tank,
    // so the first step is to fill it)
    refuel: progress.data?.refuelled === true || visited.includes('refuelled'),
    repair: progress.data?.repaired === true || visited.includes('repaired'),
    work: progress.data?.worked === true || visited.includes('worked'),
  };
  const to: Record<StepId, string | null> = {
    build: '/ship',
    ports: '/ship',
    mission: '/missions',
    dispatch: '/ship',
    // the link to the report only appears once the mission is complete and there is a report to read
    report: latest === undefined ? null : `/report/${latest}`,
    refuel: '/port?tab=refuel',
    repair: '/port?tab=repair',
    work: '/port?tab=scavenging',
  };
  return STEP_ORDER.map((id) => ({ id, done: done[id], to: to[id] }));
}
