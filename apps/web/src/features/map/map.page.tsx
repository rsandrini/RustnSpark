import { useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EmptyShipNotice } from '../ship/empty-ship-notice';
import { client, serverNow } from '../../api/client';
import type {
  ActiveMission,
  DispatchResponse,
  MissionOffer,
  ShipResponse,
  TravelQuote,
  WorldLocation,
  WorldResponse,
} from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { FactionBadge } from '../../ui/FactionBadge';
import { Countdown } from '../../ui/Countdown';
import { formatDuration } from '../../ui/duration';
import { Gauge } from '../../ui/Gauge';
import { Popup } from '../../ui/Popup';
import { errorText } from '../../api/errors';
import { RiskBadge } from '../../ui/RiskBadge';
import { useNow } from '../../ui/useNow';
import { journeyNodeIds, journeyStops, positionAt } from '../transit/journey';
import { transitPollInterval } from '../transit/poll';

const NODE_RADIUS = 9;
const VIEW_PADDING = 70;

const FACTION_VAR: Record<string, string> = {
  luna: '--luna',
  sun: '--sun',
  explorers: '--explorers',
  pirates: '--pirata',
};

export interface MapPageProps {
  /** Placeholder for the future guided tour (GDD §16; not built in v0.1, S10.3). */
  guided?: boolean;
}

export function MapPage({ guided = false }: MapPageProps) {
  const { t, i18n } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const worldQuery = useQuery({
    queryKey: ['world'],
    queryFn: () => client.get<WorldResponse>('/v1/locations'),
  });
  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });

  const activeQuery = useQuery({
    queryKey: ['active'],
    refetchInterval: (query) => transitPollInterval(query.state.data, serverNow()),
    queryFn: () => client.get<ActiveMission[]>('/v1/missions/active'),
  });

  const world = worldQuery.data;
  const shipLocation = shipsQuery.data?.[0]?.currentLocationId ?? null;
  const flight = (activeQuery.data ?? []).find(
    (mission) => mission.status === 'IN_TRANSIT' && mission.legWindows.length > 0,
  );
  const now = useNow(flight !== undefined);

  const bounds = useMemo(() => {
    if (world === undefined || world.locations.length === 0) return null;
    const xs = world.locations.map((location) => location.x);
    const ys = world.locations.map((location) => location.y);
    const minX = Math.min(...xs) - VIEW_PADDING;
    const minY = Math.min(...ys) - VIEW_PADDING;
    const maxX = Math.max(...xs) + VIEW_PADDING;
    const maxY = Math.max(...ys) + VIEW_PADDING + 24;
    return { minX, minY, width: maxX - minX, height: maxY - minY };
  }, [world]);

  const byId = useMemo(
    () => new Map((world?.locations ?? []).map((location) => [location.id, location])),
    [world],
  );
  const selected = selectedId === null ? undefined : byId.get(selectedId);

  const journey = useMemo(() => {
    if (flight === undefined || world === undefined) return null;
    const nodeIds = journeyNodeIds(flight.originId, flight.legWindows, world.routes);
    return { nodeIds, stops: journeyStops(nodeIds, world.locations) };
  }, [flight, world]);
  const position =
    flight !== undefined && journey !== null
      ? positionAt(journey.stops, flight.legWindows, now)
      : null;
  const inFlight = position !== null && !position.docked;

  if (worldQuery.isLoading || shipsQuery.isLoading) {
    return <main className="app">{t('loading')}</main>;
  }
  if (world === undefined || bounds === null) {
    return <main className="app">{t('error.unexpected')}</main>;
  }

  const nameOf = (location: WorldLocation) => pickLocalized(location.displayName, i18n.language);
  const placeName = (id: string) => {
    const place = byId.get(id);
    return place === undefined ? id : nameOf(place);
  };
  const descriptionOf = (location: WorldLocation) =>
    pickLocalized(location.description, i18n.language);

  const selectNode = (id: string) => setSelectedId((current) => (current === id ? null : id));

  const handleNodeKeyDown = (event: ReactKeyboardEvent, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectNode(id);
    }
  };

  return (
    <main className="app wide" data-guided={guided ? '' : undefined}>
      <header className="topbar">
        <h1>{t('map.title')}</h1>
        <span className="sub">{t('map.hint')}</span>
      </header>
      <p className="map-status" role="status" data-testid="map-status">
        {inFlight && flight !== undefined ? (
          <>
            <span className="you-badge">{t('map.inTransit')}</span>{' '}
            {t('map.headingTo', {
              destination: placeName(flight.destinationId),
            })}{' '}
            <Countdown until={flight.arrivalAt ?? ''} />
          </>
        ) : shipLocation !== null && byId.get(shipLocation) !== undefined ? (
          <>
            <span className="you-badge">{t('map.youAreHere')}</span>{' '}
            {t('map.dockedAt', { place: nameOf(byId.get(shipLocation)!) })}
          </>
        ) : null}
      </p>
      <EmptyShipNotice />

      <div className="stage">
        <svg
          viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
          role="group"
          aria-label={t('map.title')}
        >
          {world.routes.map((route) => {
            const from = byId.get(route.nodeAId);
            const to = byId.get(route.nodeBId);
            if (from === undefined || to === undefined) return null;
            return (
              <line
                key={route.id}
                className={`edge${route.hot ? ' hot' : ''}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            );
          })}
          {journey !== null && inFlight && (
            <polyline
              className="flight-path"
              points={journey.stops.map((stop) => `${stop.x},${stop.y}`).join(' ')}
            />
          )}
          {world.locations.map((location) => {
            const isHere = location.id === shipLocation && !inFlight;
            const isDestination = inFlight && flight?.destinationId === location.id;
            const label = isHere
              ? `${nameOf(location)} — ${t('map.youAreHere')}`
              : nameOf(location);
            const factionVar = FACTION_VAR[location.factionId] ?? '--neutro';
            return (
              <g
                key={location.id}
                className={`node-hit${selectedId === location.id ? ' sel' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={label}
                onClick={() => selectNode(location.id)}
                onKeyDown={(event) => handleNodeKeyDown(event, location.id)}
              >
                <circle
                  className="nhit"
                  cx={location.x}
                  cy={location.y}
                  r={NODE_RADIUS + 16}
                  fill="transparent"
                />
                <circle
                  className="ncore"
                  cx={location.x}
                  cy={location.y}
                  r={NODE_RADIUS}
                  fill="var(--bg)"
                />
                <circle
                  className="nring"
                  cx={location.x}
                  cy={location.y}
                  r={NODE_RADIUS + 3}
                  style={{ stroke: `var(${factionVar})` }}
                />
                {isHere && (
                  <>
                    <circle
                      className="here-pulse"
                      cx={location.x}
                      cy={location.y}
                      r={NODE_RADIUS + 6}
                    />
                    <g
                      className="you-tag"
                      transform={`translate(${location.x} ${location.y - 34})`}
                    >
                      <rect x={-50} y={-11} width={100} height={18} rx={9} />
                      <text y={2}>{t('map.youAreHere')}</text>
                      <path d="M-5,7 L0,13 L5,7 Z" />
                    </g>
                  </>
                )}
                {isDestination && (
                  <circle
                    className="dest-ring"
                    cx={location.x}
                    cy={location.y}
                    r={NODE_RADIUS + 8}
                  />
                )}
                <text className="nlabel" x={location.x} y={location.y + 24}>
                  {nameOf(location)}
                </text>
                <text className="nsub" x={location.x} y={location.y + 35}>
                  {t(`map.types.${location.type}`, { defaultValue: location.type })}
                </text>
                {location.missionCount > 0 && (
                  <text className="miss-count" x={location.x} y={location.y - 16}>
                    {location.missionCount}
                  </text>
                )}
              </g>
            );
          })}
          {position !== null && inFlight && (
            <g
              className="ship-marker"
              transform={`translate(${position.x} ${position.y}) rotate(${position.heading})`}
              role="img"
              aria-label={t('map.shipHere')}
            >
              <circle className="ship-halo" r={13} />
              <path className="ship-glyph" d="M11,0 L-8,-7 L-4,0 L-8,7 Z" />
            </g>
          )}
        </svg>
      </div>

      <div className="legend">
        <span>
          <span className="dotleg" style={{ background: 'var(--risk-lo)' }} />
          {t('ui.risk.lo')}
        </span>
        <span>
          <span className="dotleg" style={{ background: 'var(--risk-md)' }} />
          {t('ui.risk.md')}
        </span>
        <span>
          <span className="dotleg" style={{ background: 'var(--risk-hi)' }} />
          {t('ui.risk.hi')}
        </span>
        <span>
          <span className="dotleg" style={{ background: 'var(--spark)' }} />
          {t('map.youAreHere')}
        </span>
      </div>

      <Popup
        open={selected !== undefined}
        title={selected === undefined ? '' : nameOf(selected)}
        onClose={() => setSelectedId(null)}
      >
        {selected !== undefined && (
          <PlaceDetails
            canTravel={shipLocation !== null && !inFlight}
            place={selected}
            description={descriptionOf(selected)}
            isHere={selected.id === shipLocation && !inFlight}
            byId={byId}
          />
        )}
      </Popup>
    </main>
  );
}

interface PlaceDetailsProps {
  /** The ship is docked (not flying): only then can the pilot ask for a trip. */
  canTravel: boolean;
  place: WorldLocation;
  description: string;
  isHere: boolean;
  byId: ReadonlyMap<string, WorldLocation>;
}

// What a place offers, in one dialog: who runs it, how risky it is, and the missions on its
// board (each with reward, destination and whether the ship can take it). The pilot decides
// where to go from here without leaving the map.
function PlaceDetails({ canTravel, place, description, isHere, byId }: PlaceDetailsProps) {
  const { t, i18n } = useTranslation();
  const boardQuery = useQuery({
    queryKey: ['board', place.id],
    queryFn: () => client.get<MissionOffer[]>(`/v1/locations/${place.id}/missions`),
  });
  const offers = boardQuery.data ?? [];
  const destinationName = (id: string) => {
    const destination = byId.get(id);
    return destination === undefined ? id : pickLocalized(destination.displayName, i18n.language);
  };

  return (
    <div className="stack place-details">
      <p className="sub">
        {[
          t(`map.types.${place.type}`, { defaultValue: place.type }),
          t('map.zone', { zone: place.zone }),
        ].join(' · ')}
      </p>
      <p>{description}</p>
      <div className="row-between">
        <FactionBadge factionId={place.factionId} />
        <RiskBadge band={place.risk} />
      </div>
      {isHere && (
        <p>
          <span className="you-badge">{t('map.youAreHere')}</span>
        </p>
      )}

      {!isHere && canTravel && <TravelSection place={place} byId={byId} />}

      <h3>{t('map.popup.missionsHere')}</h3>
      {boardQuery.isLoading && <p className="sub">{t('loading')}</p>}
      {boardQuery.isSuccess && offers.length === 0 && <p className="sub">{t('map.noMissions')}</p>}
      <ul className="place-missions">
        {offers.map((offer) => (
          <li key={offer.id} className="place-mission">
            <div className="row-between">
              <b>{pickLocalized(offer.info.title, i18n.language)}</b>
              <span className="spark">{t('board.reward', { amount: offer.reward })}</span>
            </div>
            <div className="sub">
              {t('map.popup.to', { destination: destinationName(offer.destinationId) })}
            </div>
            <span className={`badge ${offer.eligibility.eligible ? 'ok' : 'warn'}`}>
              {offer.eligibility.eligible ? t('board.eligible') : t('board.blocked')}
            </span>
          </li>
        ))}
      </ul>

      <Link
        className="btn primary block"
        to={`/board?location=${place.id}`}
        style={{ textAlign: 'center', textDecoration: 'none' }}
      >
        {t('map.board')}
      </Link>
    </div>
  );
}

interface TravelSectionProps {
  place: WorldLocation;
  byId: ReadonlyMap<string, WorldLocation>;
}

// "Fly there without a mission": the server prices the trip (route, time, fuel) and says
// whether the ship can leave; the pilot only confirms. The trip costs fuel and pays nothing.
function TravelSection({ place, byId }: TravelSectionProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const quoteQuery = useQuery({
    queryKey: ['travelQuote', place.id],
    queryFn: () => client.get<TravelQuote>(`/v1/travel/quote?destinationId=${place.id}`),
  });
  const fly = useMutation({
    mutationFn: () => client.post<DispatchResponse>('/v1/travel', { destinationId: place.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['active'] });
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      void navigate('/transit');
    },
  });
  const quote = quoteQuery.data;
  const nameOf = (id: string) => {
    const found = byId.get(id);
    return found === undefined ? id : pickLocalized(found.displayName, i18n.language);
  };

  return (
    <section className="travel-box" data-testid="travel">
      <h3>{t('map.travel.title')}</h3>
      {quoteQuery.isLoading && <p className="sub">{t('loading')}</p>}
      {quote !== undefined && quote.legs.length > 0 && (
        <>
          <p className="sub">
            {[nameOf(quote.originId), ...quote.legs.map((leg) => nameOf(leg.toId))].join(' → ')}
          </p>
          <div className="statrow">
            <span>{t('map.travel.time')}</span>
            <b>{formatDuration(quote.durationSeconds, t)}</b>
          </div>
          <div className="statrow">
            <span>{t('map.travel.distance')}</span>
            <b>{quote.totalDistance}</b>
          </div>
          <Gauge
            value={Math.min(quote.fuelNeeded, quote.fuelHave)}
            max={Math.max(quote.fuelHave, quote.fuelNeeded, 1)}
            tone={quote.fuelNeeded > quote.fuelHave ? 'bad' : 'fuel'}
            ariaLabel={t('map.travel.fuel')}
            label={t('map.travel.fuelNeeded', {
              needed: Math.round(quote.fuelNeeded),
              have: Math.round(quote.fuelHave),
            })}
          />
          <p className="sub">{t('map.travel.noPay')}</p>
        </>
      )}
      {quote !== undefined && quote.blockers.length > 0 && (
        <ul className="reasons">
          {quote.blockers.map((blocker) => (
            <li key={blocker}>{t(`map.travel.blockers.${blocker}`)}</li>
          ))}
        </ul>
      )}
      {fly.isError && (
        <p className="error-text" role="alert">
          {errorText(t, fly.error, t('map.travel.failed'))}
        </p>
      )}
      <button
        type="button"
        className="btn primary block"
        disabled={quote === undefined || !quote.canDepart || fly.isPending}
        onClick={() => fly.mutate()}
      >
        {t('map.travel.go', { place: nameOf(place.id) })}
      </button>
    </section>
  );
}
