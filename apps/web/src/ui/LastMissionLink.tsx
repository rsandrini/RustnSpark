import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { client } from '../api/client';
import type { ActiveMission, ReportListResponse } from '../api/generated';

/**
 * A compact link to the most recent completed mission report, living in the persistent top bar.
 * Hidden while a mission is active, so it only appears when there is actually a "last" mission.
 */
export function LastMissionLink() {
  const { t } = useTranslation();
  const activeQuery = useQuery({
    queryKey: ['active'],
    queryFn: () => client.get<ActiveMission[]>('/v1/missions/active'),
  });
  const activeIsEmpty = activeQuery.isSuccess && (activeQuery.data ?? []).length === 0;
  const latestReportQuery = useQuery({
    queryKey: ['reports', 'latest'],
    enabled: activeIsEmpty,
    queryFn: () => client.get<ReportListResponse>('/v1/reports?limit=1'),
  });

  const report = latestReportQuery.data?.items[0];
  if (report === undefined) return null;

  return (
    <Link className="nav-link last-mission-link" to={`/report/${report.missionId}`}>
      {t('transit.lastMission')}
    </Link>
  );
}
