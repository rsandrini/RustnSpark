import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
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
import { journeyNodeIds } from './journey';
import { transitPollInterval } from './poll';
import { Countdown } from '../../ui/Countdown';
import { RiskBadge } from '../../ui/RiskBadge';
import { legRouteIds, summarizeLegs } from '../missions/mission-facts';
import { ShipStage } from '../../ui/ShipStage';

export interface TransitPageProps {
  /** Placeholder for the future guided tour (GDD §16; not built in v0.1, S10.3). */
  guided?: boolean;
  /** Mounted as a My Ship section (round-3 nav consolidation): no own <main>/<h1>/ShipStage —
      the host's own ActiveShipStage already shows the parked/flying/scavenging scene; renders
      nothing at all when there is no active mission (the host's idle scene already covers it). */
  embedded?: boolean;
  /** Embedded only: switches the host to its own "Board" tab (a route Link there would just
      reload the current page, since /board now redirects back to /hangar). */
  onGoToBoard?: () => void;
}

export function TransitPage({
  guided = false,
  embedded = false,
  onGoToBoard,
}: TransitPageProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const legSeparator = ' · ';
  const [dispatchServerTime, setDispatchServerTime] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeQuery = useQuery({
    queryKey: ['active'],
    refetchInterval: (query) => transitPollInterval(query.state.data, serverNow()),
    queryFn: () => client.get<ActiveMission[]>('/v1/missions/active'),
  });
  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  // The newest finished run, straight from the server: it survives a reload, and its
  // outcome (not the mere absence of an active mission) decides what the page says.
  //
  // It is only needed once nothing is in flight, and it must be fetched AFTER the mission ends:
  // a copy read at page load (before the worker finished) would keep showing "no report". So it
  // is enabled by the active list going empty, which fetches fresh data at that moment.
  const watched = useRef<string | null>(null);
  const activeIsEmpty = activeQuery.isSuccess && (activeQuery.data ?? []).length === 0;
  const latestReportQuery = useQuery({
    queryKey: ['reports', 'latest'],
    enabled: activeIsEmpty,
    // The mission can leave the active list a beat before its report is stored: while a watched
    // flight has no report yet, keep asking instead of settling on "no report".
    refetchInterval: (query) =>
      watched.current !== null && query.state.data?.items[0]?.missionId !== watched.current
        ? 2000
        : false,
    queryFn: () => client.get<ReportListResponse>('/v1/reports?limit=1'),
  });
  const worldQuery = useQuery({
    queryKey: ['world'],
    queryFn: () => client.get<WorldResponse>('/v1/locations'),
  });

  const missions = activeQuery.data ?? [];
  const mission = missions[0] ?? null;

  // A pilot watching this screen when the mission ends is taken to its report: remember the flight
  // being watched, and once the active list is empty and the newest report is that mission, go.
  const navigate = useNavigate();
  useEffect(() => {
    if (mission !== null && (mission.status === 'IN_TRANSIT' || mission.status === 'RESOLVING')) {
      watched.current = mission.id;
    }
  }, [mission]);
  const newestReport = latestReportQuery.data?.items[0];
  useEffect(() => {
    if (
      activeIsEmpty &&
      !latestReportQuery.isFetching &&
      watched.current !== null &&
      newestReport?.missionId === watched.current
    ) {
      const finished = watched.current;
      watched.current = null;
      void navigate(`/report/${finished}`);
    }
  }, [activeIsEmpty, latestReportQuery.isFetching, newestReport?.missionId, navigate]);

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

  // Backing out: a held offer is released, an accepted one (not yet dispatched) is abandoned.
  // Either way the offer returns to the board and the pilot is free to pick another.
  const backOut = useMutation({
    mutationFn: () =>
      mission?.status === 'HELD'
        ? client.delete(`/v1/missions/${mission.id}/hold`)
        : client.post(`/v1/missions/${mission?.id ?? ''}/abandon`),
    onSuccess: () => {
      setActionError(null);
      invalidateActive();
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (error) => setActionError(errorText(t, error, t('transit.failed'))),
  });

  if (
    activeQuery.isLoading ||
    shipsQuery.isLoading ||
    worldQuery.isLoading ||
    // A previous (stale) answer must not flash the empty state while the fresh one loads.
    (activeIsEmpty && latestReportQuery.isFetching)
  ) {
    return embedded ? null : (
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
    if (embedded) {
      // Nothing active: the host's own idle scene already says "docked", and the last report
      // (if there is one) reaches the pilot through the persistent top bar now — only the rescue
      // banner (a ship can go ADRIFT with no mission running) is worth adding here.
      return <RescueBanner />;
    }
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

  const summary = summarizeLegs(mission.legs);
  const rewardText = `${new Intl.NumberFormat(i18n.language).format(mission.reward)} ¢`;
  const destinationRisk = worldQuery.data?.locations.find(
    (entry) => entry.id === mission.destinationId,
  )?.risk;

  // Each leg reads "from → to" in the direction the ship flies (routes themselves are undirected).
  const nodeIds = journeyNodeIds(mission.originId, windows, worldQuery.data?.routes ?? []);
  const legLabel = (routeId: string, index: number) => {
    const from = nodeIds[index];
    const to = nodeIds[index + 1];
    if (from !== undefined && to !== undefined) {
      return `${locationName(from)} → ${locationName(to)}`;
    }
    const route = worldQuery.data?.routes.find((entry) => entry.id === routeId);
    if (route === undefined) return routeId;
    return `${locationName(route.nodeAId)} → ${locationName(route.nodeBId)}`;
  };

  // The leg WINDOWS above only exist once dispatched (written pro-rata at dispatch time);
  // the stored plan's own routeId per leg is there from generation onward, so the
  // pre-dispatch screen can show the same kind of leg-by-leg breakdown (owner: "in My Ship,
  // before dispatch... I cannot see the origin -> destination, I cannot see the details").
  const plannedRouteIds = legRouteIds(mission.legs);
  const plannedNodeIds = journeyNodeIds(
    mission.originId,
    plannedRouteIds.map((routeId) => ({ routeId })),
    worldQuery.data?.routes ?? [],
  );
  const plannedLegLabel = (routeId: string, index: number) => {
    const from = plannedNodeIds[index];
    const to = plannedNodeIds[index + 1];
    if (from !== undefined && to !== undefined) {
      return `${locationName(from)} → ${locationName(to)}`;
    }
    const route = worldQuery.data?.routes.find((entry) => entry.id === routeId);
    if (route === undefined) return routeId;
    return `${locationName(route.nodeAId)} → ${locationName(route.nodeBId)}`;
  };

  const briefTitle = pickLocalized(mission.brief.title, i18n.language);
  const briefText = pickLocalized(mission.brief.description, i18n.language);

  const body = (
    <>
      {!embedded && (
        <header className="topbar">
          <h1>{t('transit.title')}</h1>
          <span className="sub">{routeLabel}</span>
        </header>
      )}
      {briefTitle !== '' && (
        <p className="mission-brief-line">
          <b>{briefTitle}</b>
          {briefText !== '' && (
            <button
              type="button"
              className="btn info-btn mission-why-tag"
              aria-label={`${t('transit.briefLabel')}: ${briefTitle}`}
              title={briefText}
            >
              {t('parts.infoGlyph')}
            </button>
          )}
        </p>
      )}
      <div className="briefing" data-testid="briefing">
        <div className="fact fact-route">
          <div className="k">{t('transit.facts.route')}</div>
          <div className="v">{routeLabel}</div>
        </div>
        {mission.type !== 'TRAVEL' && mission.type !== 'SCAVENGE' && (
          <div className="fact">
            <div className="k">{t('transit.facts.reward')}</div>
            <div className="v spark">{rewardText}</div>
          </div>
        )}
        {mission.type !== 'SCAVENGE' && (
          <>
            <div className="fact">
              <div className="k">{t('transit.facts.distance')}</div>
              <div className="v">{summary.totalDistance}</div>
            </div>
            <div className="fact">
              <div className="k">{t('transit.facts.legs')}</div>
              <div className="v">{summary.legCount}</div>
            </div>
          </>
        )}
        {destinationRisk !== undefined && (
          <div className="fact">
            <div className="k">{t('transit.facts.danger')}</div>
            <div className="v">
              <RiskBadge band={destinationRisk} />
            </div>
          </div>
        )}
      </div>

      {mission.type === 'RACE' && <RaceRivals cargo={mission.cargo} />}

      {actionError !== null && (
        <p className="error-text" role="alert">
          {actionError}
        </p>
      )}

      <RescueBanner />

      {mission.status === 'HELD' ? (
        <section data-testid="held">
          <p>{t('transit.held')}</p>
          <div className="actions">
            {embedded && onGoToBoard !== undefined ? (
              <button type="button" className="btn primary" onClick={onGoToBoard}>
                {t('board.title')}
              </button>
            ) : (
              <Link className="btn primary" to="/board">
                {t('board.title')}
              </Link>
            )}
            <button
              type="button"
              className="btn"
              disabled={backOut.isPending}
              onClick={() => backOut.mutate()}
            >
              {t('board.release')}
            </button>
          </div>
        </section>
      ) : mission.status === 'RESOLVING' ? (
        <p data-testid="resolving">{t('transit.resolving')}</p>
      ) : mission.status === 'ACCEPTED' ? (
        <section>
          {!embedded && <ShipStage mode="idle" placeId={mission.originId} />}
          <p>{t('transit.accepted')}</p>
          {plannedRouteIds.length > 1 && (
            <>
              <p className="sub">{t('transit.legPlanTitle')}</p>
              <ol className="mission-leg-plan" data-testid="leg-plan">
                {plannedRouteIds.map((routeId, index) => (
                  <li key={`${routeId}-${index}`}>{plannedLegLabel(routeId, index)}</li>
                ))}
              </ol>
            </>
          )}
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
          </button>{' '}
          <button
            type="button"
            className="btn"
            disabled={backOut.isPending}
            onClick={() => backOut.mutate()}
          >
            {t('transit.cancelMission')}
          </button>
          {ship === undefined && <p className="sub">{t('board.noShip')}</p>}
        </section>
      ) : (
        <section data-testid="in-transit">
          {!embedded && <ShipStage mode={mission.type === 'SCAVENGE' ? 'scavenging' : 'flying'} />}
          {/* Round-10 owner follow-up ("too big... don't show enough information"): a
              single-leg trip has nothing an itinerary box would add over one compact line
              (route + overall arrival together); a multi-leg trip gets the fuller itinerary
              instead, each leg with its own arrival, so the overview line above it would
              only restate the current leg's own row. */}
          {windows.length > 1 ? (
            <p className="sub">
              {t('transit.arrivesIn')}{' '}
              {(mission.arrivalAt ?? '') !== '' && (
                <Countdown until={mission.arrivalAt ?? ''} serverTime={dispatchServerTime} />
              )}
            </p>
          ) : (
            <p className="sub">
              {currentIndex !== -1 && windows[0] !== undefined
                ? t('transit.nowFlying', { route: legLabel(windows[0].routeId, 0) })
                : t('transit.waitingLeg')}
              {legSeparator}
              {t('transit.arrivesIn')}{' '}
              {(mission.arrivalAt ?? '') !== '' && (
                <Countdown until={mission.arrivalAt ?? ''} serverTime={dispatchServerTime} />
              )}
            </p>
          )}
          <div className="legbar" role="progressbar" aria-valuenow={Math.round(progress)}>
            <div className="legbar-fill" style={{ width: `${progress}%` }} />
          </div>
          {windows.length > 1 && (
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
                    <span>{legLabel(window.routeId, index)}</span>
                    <span className="sub">
                      {state === 'done' ? (
                        t('transit.legDone')
                      ) : state === 'waiting' ? (
                        t('transit.waitingLeg')
                      ) : (
                        <>
                          {t('transit.arrivesIn')} <Countdown until={window.to} serverTime={dispatchServerTime} />
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}
    </>
  );

  if (embedded) return body;
  return (
    <main className="app" data-guided={guided ? '' : undefined}>
      {body}
    </main>
  );
}

interface Rival {
  name: string;
  mobility: number;
}

/** The rivals of an accepted race, fastest first — frozen in the mission when the offer was made. */
function RaceRivals({ cargo }: { cargo: unknown }) {
  const { t } = useTranslation();
  const race = (cargo as { race?: { competitors?: unknown } } | null)?.race;
  const rivals = (Array.isArray(race?.competitors) ? (race.competitors as Rival[]) : [])
    .filter((rival) => typeof rival?.name === 'string' && typeof rival.mobility === 'number')
    .sort((a, b) => b.mobility - a.mobility);
  if (rivals.length === 0) return null;
  return (
    <section className="mcard-race" data-testid="race-rivals" aria-label={t('transit.race.title')}>
      <b>{t('transit.race.title')}</b>
      <ul>
        {rivals.map((rival) => (
          <li key={rival.name}>
            {t('transit.race.rival', { name: rival.name, mobility: rival.mobility })}
          </li>
        ))}
      </ul>
    </section>
  );
}
