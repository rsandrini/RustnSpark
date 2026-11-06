import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { client, serverNow } from '../../api/client';
import type { ActiveMission, ReportListResponse } from '../../api/generated';
import { useFeedback } from '../../ui/feedback';
import { hasUnsavedLayout } from '../hangar/unsaved-layout';
import { transitPollInterval } from './poll';

/** Flights the pilot dispatched in this tab that may be over before the active list ever showed them. */
const dispatched = new Set<string>();
/** How often a finished-but-not-yet-reported flight asks for its report. */
const REPORT_RECHECK_MS = 2000;
export function watchFlight(missionId: string): void {
  dispatched.add(missionId);
}

/**
 * Takes the pilot to the report of a flight that ends while they are on any screen (the Map, the Port, the Board):
 * the flight is remembered from the moment it leaves, and once the active list is empty and the newest report is that
 * mission, we go. Jobs done in place (scavenging, mining) only take the pilot to the report from My Ship, as before.
 */
export function FlightWatcher() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const feedback = useFeedback();
  const { pathname } = useLocation();
  const watched = useRef<{ id: string; inPlace: boolean } | null>(null);

  const activeQuery = useQuery({
    queryKey: ['active'],
    refetchInterval: (query) => transitPollInterval(query.state.data, serverNow()),
    queryFn: () => client.get<ActiveMission[]>('/v1/missions/active'),
  });
  const mission = activeQuery.data?.[0] ?? null;
  const activeIsEmpty = activeQuery.isSuccess && (activeQuery.data ?? []).length === 0;

  useEffect(() => {
    if (mission !== null && (mission.status === 'IN_TRANSIT' || mission.status === 'RESOLVING')) {
      watched.current = { id: mission.id, inPlace: mission.type === 'SCAVENGE' };
      dispatched.delete(mission.id);
    }
  }, [mission]);

  const latestReportQuery = useQuery({
    queryKey: ['reports', 'latest'],
    enabled: activeIsEmpty,
    // The mission can leave the active list a beat before its report is stored: while a watched flight has no
    // report yet, keep asking instead of settling on "no report".
    refetchInterval: (query) =>
      (watched.current !== null || dispatched.size > 0) &&
      !(
        watched.current?.id === query.state.data?.items[0]?.missionId ||
        dispatched.has(query.state.data?.items[0]?.missionId ?? '')
      )
        ? 2000
        : false,
    queryFn: () => client.get<ReportListResponse>('/v1/reports?limit=1'),
  });
  const newest = latestReportQuery.data?.items[0]?.missionId;

  // A flight can end before the first look at the active list (a short hop, a fast server): the list
  // was empty before and still is, so nothing flips and the latest-report query keeps what it had.
  // While a dispatched/watched flight has not reached its report, ask again every couple of seconds.
  const refetchLatest = useRef(latestReportQuery.refetch);
  refetchLatest.current = latestReportQuery.refetch;
  useEffect(() => {
    if (!activeIsEmpty) return undefined;
    const timer = window.setInterval(() => {
      if (dispatched.size > 0 || watched.current !== null) void refetchLatest.current();
    }, REPORT_RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [activeIsEmpty]);

  useEffect(() => {
    if (!activeIsEmpty || latestReportQuery.isFetching || newest === undefined) return;
    const fromDispatch = dispatched.has(newest);
    const fromWatch = watched.current?.id === newest ? watched.current : null;
    if (!fromDispatch && fromWatch === null) return;
    if (!fromDispatch && fromWatch !== null && fromWatch.inPlace && pathname !== '/ship') {
      watched.current = null;
      return;
    }
    dispatched.delete(newest);
    watched.current = null;
    // The pilot is assembling the ship: leaving the screen would throw the edits away. Say the
    // report is ready and let them go when they choose.
    if (feedback.available && hasUnsavedLayout()) {
      feedback.notify(t('feedback.flightEndedUnsaved'), {
        next: { label: t('feedback.nextReport'), to: `/report/${newest}` },
      });
      return;
    }
    void navigate(`/report/${newest}`);
  }, [activeIsEmpty, latestReportQuery.isFetching, newest, navigate, pathname, feedback, t]);

  return null;
}
