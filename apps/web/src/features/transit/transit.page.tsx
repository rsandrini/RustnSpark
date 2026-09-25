import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client, serverNow } from '../../api/client';
import { errorText } from '../../api/errors';
import type {
  ActiveMission,
  DispatchResponse,
  ReportListResponse,
  ShipResponse,
  WorldResponse,
} from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { RescueBanner } from '../rescue/rescue-banner';
import { Countdown } from '../../ui/Countdown';

const ACTIVE_REFETCH_MS = 2000;

export interface TransitPageProps {
  /** Placeholder for the future guided tour (GDD §16; not built in v0.1, S10.3). */
  guided?: boolean;
}

export function TransitPage({ guided = false }: TransitPageProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [dispatchServerTime, setDispatchServerTime] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeQuery = useQuery({
    queryKey: ['active'],
    refetchInterval: ACTIVE_REFETCH_MS,
    queryFn: () => client.get<ActiveMission[]>('/v1/missions/active'),
  });
  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  // The newest finished run, straight from the server: it survives a reload, and its
  // outcome (not the mere absence of an active mission) decides what the page says.
  const latestReportQuery = useQuery({
    queryKey: ['reports', 'latest'],
    queryFn: () => client.get<ReportListResponse>('/v1/reports?limit=1'),
  });
  const worldQuery = useQuery({
    queryKey: ['world'],
    queryFn: () => client.get<WorldResponse>('/v1/locations'),
  });

  const missions = activeQuery.data ?? [];
  const mission = missions[0] ?? null;

  const ship = shipsQuery.data?.[0];

  const invalidateActive = () => {
    void queryClient.invalidateQueries({ queryKey: ['active'] });
    void queryClient.invalidateQueries({ queryKey: ['ships'] });
  };
  const dispatch = useMutation({
    mutationFn: () =>
      client.post<DispatchResponse>(`/v1/ships/${ship?.id ?? ''}/dispatch`, {
        missionId: mission?.id ?? '',
      }),
    onSuccess: (response) => {
      setDispatchServerTime(response.serverTime);
      setActionError(null);
      invalidateActive();
    },
    onError: (error) => {
      setActionError(errorText(t, error, t('transit.failed')));
    },
  });

  if (
    activeQuery.isLoading ||
    shipsQuery.isLoading ||
    worldQuery.isLoading ||
    latestReportQuery.isLoading
  ) {
    return (
      <main className="app" data-guided={guided ? '' : undefined}>
        {t('loading')}
      </main>
    );
  }

  const locationName = (id: string) => {
    const location = worldQuery.data?.locations.find((entry) => entry.id === id);
    if (location === undefined) return id;
    return pickLocalized(location.displayName, i18n.language);
  };

  if (mission === null) {
    const latest = latestReportQuery.data?.items[0];
    return (
      <main className="app" data-guided={guided ? '' : undefined}>
        <header className="topbar">
          <h1>{t('transit.title')}</h1>
        </header>
        <RescueBanner />
        {latest === undefined ? (
          <p className="sub">{t('transit.empty')}</p>
        ) : (
          <section className="stack" data-testid="last-mission">
            <h2>{t('transit.lastMission')}</h2>
            <p className="sub">
              {t(`report.outcome.${latest.outcome}`, { defaultValue: latest.outcome })}
            </p>
            <Link className="btn primary" to={`/report/${latest.missionId}`}>
              {t('transit.lastReport')}
            </Link>
          </section>
        )}
        <div className="actions">
          <Link className="btn primary" to="/board">
            {t('board.title')}
          </Link>
          <Link className="btn" to="/map">
            {t('transit.backToMap')}
          </Link>
        </div>
      </main>
    );
  }

  const routeLabel = `${locationName(mission.originId)} → ${locationName(mission.destinationId)}`;
  const windows = mission.legWindows;
  const now = serverNow();
  const currentIndex = windows.findIndex((window) => Date.parse(window.to) > now);
  const firstFrom = windows[0] === undefined ? null : Date.parse(windows[0].from);
  const lastTo =
    mission.arrivalAt !== null && mission.arrivalAt !== undefined
      ? Date.parse(mission.arrivalAt)
      : windows.length > 0
        ? Date.parse(windows[windows.length - 1]?.to ?? '')
        : null;
  const progress =
    firstFrom !== null && lastTo !== null && lastTo > firstFrom
      ? Math.min(100, Math.max(0, ((now - firstFrom) / (lastTo - firstFrom)) * 100))
      : 0;

  const legLabel = (routeId: string) => {
    const route = worldQuery.data?.routes.find((entry) => entry.id === routeId);
    if (route === undefined) return routeId;
    return `${locationName(route.nodeAId)} → ${locationName(route.nodeBId)}`;
  };

  return (
    <main className="app" data-guided={guided ? '' : undefined}>
      <header className="topbar">
        <h1>{t('transit.title')}</h1>
        <span className="sub">{routeLabel}</span>
      </header>
      <p className="sub">{t('board.reward', { amount: mission.reward })}</p>

      {actionError !== null && (
        <p className="error-text" role="alert">
          {actionError}
        </p>
      )}

      <RescueBanner />

      {mission.status === 'HELD' ? (
        <section data-testid="held">
          <p>{t('transit.held')}</p>
          <Link className="btn primary" to="/board">
            {t('board.title')}
          </Link>
        </section>
      ) : mission.status === 'RESOLVING' ? (
        <p data-testid="resolving">{t('transit.resolving')}</p>
      ) : mission.status === 'ACCEPTED' ? (
        <section>
          <p>{t('transit.accepted')}</p>
          {mission.deadlineAt !== null && (
            <p className="sub">
              {t('transit.startDeadline')} <Countdown until={mission.deadlineAt} />
            </p>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={dispatch.isPending || ship === undefined}
            onClick={() => dispatch.mutate()}
          >
            {t('transit.dispatch')}
          </button>
          {ship === undefined && <p className="sub">{t('board.noShip')}</p>}
        </section>
      ) : (
        <section data-testid="in-transit">
          <p className="sub">
            {t('transit.arrivesIn')}{' '}
            {(mission.arrivalAt ?? '') !== '' && (
              <Countdown until={mission.arrivalAt ?? ''} serverTime={dispatchServerTime} />
            )}
          </p>
          <div className="legbar" role="progressbar" aria-valuenow={Math.round(progress)}>
            <div className="legbar-fill" style={{ width: `${progress}%` }} />
          </div>
          {windows.length === 0 ? (
            <p className="sub">{t('transit.waitingLeg')}</p>
          ) : (
            <ol className="stack legs">
              {windows.map((window, index) => {
                const state =
                  currentIndex === -1 || index < currentIndex
                    ? 'done'
                    : index === currentIndex
                      ? 'current'
                      : 'waiting';
                return (
                  <li key={window.legIndex} className={`leg ${state}`}>
                    <b>{t('transit.leg', { index: index + 1, total: windows.length })}</b>
                    <span>{legLabel(window.routeId)}</span>
                    <span className="sub">
                      {state === 'done'
                        ? t('transit.legDone')
                        : state === 'waiting'
                          ? t('transit.waitingLeg')
                          : t('transit.arrivesIn')}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}
    </main>
  );
}
