import { useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EmptyShipNotice } from '../ship/empty-ship-notice';
import { client } from '../../api/client';
import type { ShipResponse, WorldLocation, WorldResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { FactionBadge } from '../../ui/FactionBadge';
import { RiskBadge } from '../../ui/RiskBadge';

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

  const world = worldQuery.data;
  const shipLocation = shipsQuery.data?.[0]?.currentLocationId ?? null;

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

  if (worldQuery.isLoading || shipsQuery.isLoading) {
    return <main className="app">{t('loading')}</main>;
  }
  if (world === undefined || bounds === null) {
    return <main className="app">{t('error.unexpected')}</main>;
  }

  const nameOf = (location: WorldLocation) => pickLocalized(location.displayName, i18n.language);
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
          {world.locations.map((location) => {
            const isHere = location.id === shipLocation;
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
                  <circle
                    className="here-ring"
                    cx={location.x}
                    cy={location.y}
                    r={NODE_RADIUS + 7}
                    fill="none"
                    stroke="var(--spark)"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
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

      {selected !== undefined && (
        <div className="sheet open" role="dialog" aria-label={nameOf(selected)}>
          <div className="ph">
            <div>
              <h2>{nameOf(selected)}</h2>
              <div className="sub">
                {t(`map.types.${selected.type}`, { defaultValue: selected.type })}
              </div>
            </div>
            <button type="button" className="btn" onClick={() => setSelectedId(null)}>
              {t('ui.close')}
            </button>
          </div>
          <div className="pc">
            <p className="sub">{descriptionOf(selected)}</p>
            <div className="row-between">
              <FactionBadge factionId={selected.factionId} />
              <RiskBadge band={selected.risk} />
            </div>
            <div className="statrow">
              <span>{t('map.zone', { zone: selected.zone })}</span>
              <b>
                {selected.missionCount > 0
                  ? t('map.missions', { count: selected.missionCount })
                  : t('map.noMissions')}
              </b>
            </div>
            {selected.id === shipLocation && (
              <p className="sub">
                <b>{t('map.youAreHere')}</b>
              </p>
            )}
            <Link
              className="btn primary block"
              to={`/board?location=${selected.id}`}
              style={{ marginTop: 12, textAlign: 'center', textDecoration: 'none' }}
            >
              {t('map.board')}
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
