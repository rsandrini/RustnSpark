import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { errorText } from '../../api/errors';
import type {
  RaceRoutesResponse,
  RankingBoard,
  RankingResponse,
  RankingWindow,
} from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { FactionBadge } from '../../ui/FactionBadge';
import { PageTitle } from '../../ui/PageTitle';
import { useWorld } from '../ship/use-world';

const BOARDS: readonly RankingBoard[] = ['distance', 'fights_won', 'race_wins', 'race_time'];
const WINDOWS: readonly RankingWindow[] = ['weekly', 'lifetime'];
const SECONDS_PER_MINUTE = 60;
const SECOND_DIGITS = 2;

export function RankingsPage() {
  const { t, i18n } = useTranslation();
  const [board, setBoard] = useState<RankingBoard>('distance');
  const [window, setWindow] = useState<RankingWindow>('weekly');
  const [chosenRoute, setChosenRoute] = useState<string | null>(null);
  const world = useWorld();
  const numberFormat = new Intl.NumberFormat(i18n.language);

  const routesQuery = useQuery({
    queryKey: ['ranking-routes'],
    queryFn: () => client.get<RaceRoutesResponse>('/v1/rankings/race-routes'),
    enabled: board === 'race_time',
  });
  const routes = routesQuery.data?.routes ?? [];
  const route = board === 'race_time' ? (chosenRoute ?? routes[0]?.routeKey ?? null) : null;

  const rankingQuery = useQuery({
    queryKey: ['ranking', board, window, route],
    queryFn: () =>
      client.get<RankingResponse>(
        `/v1/rankings/${board}?window=${window}${route === null ? '' : `&route=${encodeURIComponent(route)}`}`,
      ),
    enabled: board !== 'race_time' || route !== null,
  });
  const ranking = rankingQuery.data;

  const placeName = (id: string): string => {
    const place = world.data?.locations.find((entry) => entry.id === id);
    return place === undefined ? id : pickLocalized(place.displayName, i18n.language);
  };

  const valueText = (value: number): string => {
    if (board !== 'race_time') return numberFormat.format(value);
    const seconds = Math.floor(value % SECONDS_PER_MINUTE)
      .toString()
      .padStart(SECOND_DIGITS, '0');
    return t('profile.stats.raceTimeValue', {
      m: Math.floor(value / SECONDS_PER_MINUTE),
      s: seconds,
    });
  };

  const ownInList = ranking?.entries.some((entry) => entry.isMe) === true;

  return (
    <main className="app rankings">
      <PageTitle title={t('rankings.title')} />

      <div className="rankings-tabs" role="tablist" aria-label={t('rankings.boards')}>
        {BOARDS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={board === name}
            className={board === name ? 'active' : undefined}
            onClick={() => setBoard(name)}
          >
            {t(`rankings.board.${name}`)}
          </button>
        ))}
      </div>

      <div
        className="rankings-tabs rankings-windows"
        role="group"
        aria-label={t('rankings.period')}
      >
        {WINDOWS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={window === name}
            className={window === name ? 'active' : undefined}
            onClick={() => setWindow(name)}
          >
            {t(`rankings.window.${name}`)}
          </button>
        ))}
      </div>

      {board === 'race_time' && routes.length > 0 && (
        <div className="rankings-route">
          <label htmlFor="ranking-route">{t('rankings.route')}</label>
          <select
            id="ranking-route"
            value={route ?? ''}
            onChange={(event) => setChosenRoute(event.target.value)}
          >
            {routes.map((entry) => (
              <option key={entry.routeKey} value={entry.routeKey}>
                {t('rankings.routeLabel', {
                  from: placeName(entry.originId),
                  to: placeName(entry.destinationId),
                })}
              </option>
            ))}
          </select>
        </div>
      )}

      {board === 'race_time' && routesQuery.isSuccess && routes.length === 0 && (
        <p className="sub">{t('rankings.noRaces')}</p>
      )}
      {rankingQuery.isLoading && <p>{t('loading')}</p>}
      {rankingQuery.isError && (
        <p className="error-text" role="alert">
          {errorText(t, rankingQuery.error, t('rankings.loadFailed'))}
        </p>
      )}

      {ranking !== undefined && (
        <>
          {ranking.entries.length === 0 ? (
            <p className="sub">{t('rankings.empty')}</p>
          ) : (
            <ol className="rankings-list" data-testid="ranking-list">
              {ranking.entries.map((entry) => (
                <li key={entry.rank} className={entry.isMe ? 'rankings-row me' : 'rankings-row'}>
                  <span className="rankings-rank">{entry.rank}</span>
                  <Link className="rankings-name" to={`/pilots/${encodeURIComponent(entry.name)}`}>
                    {entry.name}
                  </Link>
                  {entry.factionId !== null && <FactionBadge factionId={entry.factionId} />}
                  <span className="rankings-value">{valueText(entry.value)}</span>
                </li>
              ))}
            </ol>
          )}

          {!ownInList && (
            <p className="rankings-own" data-testid="ranking-own">
              {ranking.me === null
                ? t('rankings.noResult')
                : t('rankings.yourPosition', {
                    rank: numberFormat.format(ranking.me.rank),
                    value: valueText(ranking.me.value),
                  })}
            </p>
          )}
        </>
      )}
    </main>
  );
}
