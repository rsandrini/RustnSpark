import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../admin.api';
import { ReplayPanel } from './ReplayPanel';
import { SupportActions } from './SupportActions';

// Screen D entry: find a player by name or account email (GDD §17 "Jogadores / Inspetor").
export function InspectorListScreen() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');

  const query = useQuery({
    queryKey: ['admin', 'players', q],
    queryFn: () => adminApi.searchPlayers(q === '' ? undefined : q),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setQ(input.trim());
  };

  return (
    <div>
      <h2>{t('admin.players')}</h2>
      <form onSubmit={submit} role="search">
        <label htmlFor="player-search">{t('admin.searchPlayers')}</label>
        <input
          id="player-search"
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit">{t('admin.search')}</button>
      </form>
      {query.isLoading && <p>{t('loading')}</p>}
      {query.isError && <p role="alert">{t('admin.loadError')}</p>}
      <table>
        <thead>
          <tr>
            <th scope="col">{t('admin.name')}</th>
            <th scope="col">{t('admin.email')}</th>
            <th scope="col">{t('admin.credits')}</th>
            <th scope="col">{t('admin.status')}</th>
          </tr>
        </thead>
        <tbody>
          {(query.data?.items ?? []).map((player) => (
            <tr key={player.id}>
              <td>
                <Link to={`/admin/players/${player.id}`}>{player.name}</Link>
              </td>
              <td>{player.accountEmail}</td>
              <td>{player.credits}</td>
              <td>{player.accountStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The sheet itself: account, wallet, fleet, cargo, active mission, timeline, report
// history with replay, and the support actions (S11.4).
export function InspectorDetailScreen() {
  const { t } = useTranslation();
  const { playerId = '' } = useParams();
  const queryClient = useQueryClient();
  const [selectedMission, setSelectedMission] = useState<string | null>(null);

  const sheet = useQuery({
    queryKey: ['admin', 'sheet', playerId],
    queryFn: () => adminApi.playerSheet(playerId),
    enabled: playerId !== '',
  });

  const timeline = useInfiniteQuery({
    queryKey: ['admin', 'timeline', playerId],
    queryFn: ({ pageParam }) => adminApi.playerTimeline(playerId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: playerId !== '',
  });

  const reports = useQuery({
    queryKey: ['admin', 'reports', playerId],
    queryFn: () => adminApi.playerReports(playerId),
    enabled: playerId !== '',
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
  };

  if (sheet.isLoading) return <p>{t('loading')}</p>;
  if (sheet.isError) return <p role="alert">{t('admin.loadError')}</p>;
  const data = sheet.data!;

  const timelineItems = (timeline.data?.pages ?? []).flatMap((page) => page.items);

  return (
    <div>
      <p>
        <Link to="/admin/players">{t('admin.backToList')}</Link>
      </p>
      <h2>{data.player.name}</h2>

      <SupportActions
        playerId={playerId}
        ships={data.ships}
        fastOpsOn={data.player.debugFastOps}
        onChanged={refreshAll}
      />

      <section aria-label={t('admin.account')}>
        <h3>{t('admin.account')}</h3>
        <table>
          <tbody>
            <tr>
              <th scope="row">{t('admin.email')}</th>
              <td>{data.account.email}</td>
            </tr>
            <tr>
              <th scope="row">{t('admin.status')}</th>
              <td>{data.account.status}</td>
            </tr>
            <tr>
              <th scope="row">{t('admin.credits')}</th>
              <td>{data.player.credits}</td>
            </tr>
            <tr>
              <th scope="row">{t('admin.fastOps')}</th>
              <td>{data.player.debugFastOps ? t('admin.fastOpsOn') : t('admin.fastOpsOff')}</td>
            </tr>
            <tr>
              <th scope="row">{t('admin.faction')}</th>
              <td>{data.player.factionId ?? t('admin.noFaction')}</td>
            </tr>
            <tr>
              <th scope="row">{t('admin.createdAt')}</th>
              <td>{new Date(data.player.createdAt).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-label={t('admin.ships')}>
        <h3>{t('admin.ships')}</h3>
        <table>
          <thead>
            <tr>
              <th scope="col">{t('admin.name')}</th>
              <th scope="col">{t('admin.status')}</th>
              <th scope="col">{t('admin.stance')}</th>
              <th scope="col">{t('admin.fuel')}</th>
              <th scope="col">{t('admin.location')}</th>
            </tr>
          </thead>
          <tbody>
            {data.ships.map((ship) => (
              <tr key={ship.id}>
                <td>{ship.name}</td>
                <td>{ship.status}</td>
                <td>{ship.stance}</td>
                <td>{ship.fuel}</td>
                <td>{ship.currentLocationId ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label={t('admin.materials')}>
        <h3>{t('admin.materials')}</h3>
        {data.materials.length === 0 ? (
          <p>{t('admin.noMaterials')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">{t('admin.material')}</th>
                <th scope="col">{t('admin.quantity')}</th>
              </tr>
            </thead>
            <tbody>
              {data.materials.map((holding) => (
                <tr key={holding.materialId}>
                  <td>{holding.materialId}</td>
                  <td>{holding.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label={t('admin.activeMissions')}>
        <h3>{t('admin.activeMissions')}</h3>
        {data.activeMissions.length === 0 ? (
          <p>{t('admin.noActiveMissions')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">{t('admin.mission')}</th>
                <th scope="col">{t('admin.status')}</th>
                <th scope="col">{t('admin.origin')}</th>
                <th scope="col">{t('admin.destination')}</th>
              </tr>
            </thead>
            <tbody>
              {data.activeMissions.map((mission) => (
                <tr key={mission.id}>
                  <td>{mission.type}</td>
                  <td>{mission.status}</td>
                  <td>{mission.originId}</td>
                  <td>{mission.destinationId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>


      <section aria-label={t('admin.timeline')}>
        <h3>{t('admin.timeline')}</h3>
        {timeline.isError && <p role="alert">{t('admin.loadError')}</p>}
        <table>
          <thead>
            <tr>
              <th scope="col">{t('admin.at')}</th>
              <th scope="col">{t('admin.event')}</th>
              <th scope="col">{t('admin.creditsDelta')}</th>
              <th scope="col">{t('admin.payload')}</th>
            </tr>
          </thead>
          <tbody>
            {timelineItems.map((event) => (
              <tr key={event.id}>
                <td>{new Date(event.at).toLocaleString()}</td>
                <td>{event.type}</td>
                <td>{event.creditsDelta ?? ''}</td>
                <td>{event.payload === null ? '' : JSON.stringify(event.payload)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {timeline.hasNextPage && (
          <button
            type="button"
            onClick={() => void timeline.fetchNextPage()}
            disabled={timeline.isFetchingNextPage}
          >
            {t('admin.loadMore')}
          </button>
        )}
      </section>

      <section aria-label={t('admin.reports')}>
        <h3>{t('admin.reports')}</h3>
        {reports.isError && <p role="alert">{t('admin.loadError')}</p>}
        <table>
          <thead>
            <tr>
              <th scope="col">{t('admin.mission')}</th>
              <th scope="col">{t('admin.outcome')}</th>
              <th scope="col">{t('admin.credits')}</th>
              <th scope="col">{t('admin.legs')}</th>
              <th scope="col">{t('admin.createdAt')}</th>
              <th scope="col">{t('admin.actionsColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {(reports.data?.items ?? []).map((report) => (
              <tr key={report.missionId}>
                <td>{report.missionId}</td>
                <td>{report.outcome}</td>
                <td>{report.credits}</td>
                <td>{report.legs}</td>
                <td>{new Date(report.createdAt).toLocaleString()}</td>
                <td>
                  <button type="button" onClick={() => setSelectedMission(report.missionId)}>
                    {t('admin.replay')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {selectedMission !== null && (
          <ReplayPanel
            playerId={playerId}
            missionId={selectedMission}
            onClose={() => setSelectedMission(null)}
          />
        )}
      </section>
    </div>
  );
}
