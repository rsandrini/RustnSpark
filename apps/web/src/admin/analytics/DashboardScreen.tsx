import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../admin.api';
import { useAnalyticsWindow } from './WindowPicker';

// Screen A (GDD §17): players, mission success, real winrate vs the 55% sweep baseline,
// tier distribution — all over the API's default last-7-days window.
export function DashboardScreen() {
  const { t } = useTranslation();
  const period = useAnalyticsWindow();
  const query = useQuery({
    queryKey: ['admin', 'analytics', 'dashboard', period.key],
    queryFn: () => adminApi.dashboard(period.range()),
  });

  if (query.isLoading || query.isError) {
    return (
      <div>
        <h2>{t('admin.dashboard')}</h2>
        {period.picker}
        {query.isLoading ? <p>{t('loading')}</p> : <p role="alert">{t('admin.loadError')}</p>}
      </div>
    );
  }
  const { window: bounds, data } = query.data!;

  return (
    <div>
      <h2>{t('admin.dashboard')}</h2>
      {period.picker}
      <p>
        {t('admin.windowLabel', {
          from: new Date(bounds.from).toLocaleString(),
          to: new Date(bounds.to).toLocaleString(),
        })}
      </p>

      <h3>{t('admin.players')}</h3>
      <table>
        <tbody>
          <tr>
            <th scope="row">{t('admin.playersNew')}</th>
            <td>{data.players.new}</td>
          </tr>
          <tr>
            <th scope="row">{t('admin.playersActive')}</th>
            <td>{data.players.active}</td>
          </tr>
        </tbody>
      </table>

      <h3>{t('admin.missions')}</h3>
      <table>
        <tbody>
          <tr>
            <th scope="row">{t('admin.missionTotal')}</th>
            <td>{data.missions.total}</td>
          </tr>
          <tr>
            <th scope="row">{t('admin.missionSuccess')}</th>
            <td>
              {t('admin.successValue', {
                success: data.missions.success,
                total: data.missions.total,
                percent: Math.round(data.missions.successRate * 100),
              })}
            </td>
          </tr>
          <tr>
            <th scope="row">{t('admin.missionPartial')}</th>
            <td>{data.missions.partialFailure}</td>
          </tr>
          <tr>
            <th scope="row">{t('admin.missionFailed')}</th>
            <td>{data.missions.failed}</td>
          </tr>
        </tbody>
      </table>

      <h3>{t('admin.combat')}</h3>
      <table>
        <tbody>
          <tr>
            <th scope="row">{t('admin.winrate')}</th>
            <td>
              {t('admin.winrateValue', {
                percent: Math.round(data.combat.winrate * 100),
                wins: data.combat.wins,
                losses: data.combat.losses,
                encounters: data.combat.encounters,
              })}
            </td>
          </tr>
          <tr>
            <th scope="row">{t('admin.baseline')}</th>
            <td>{t('admin.percentValue', { percent: Math.round(data.combat.baseline * 100) })}</td>
          </tr>
        </tbody>
      </table>

      <h3>{t('admin.tiers')}</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('admin.tier')}</th>
            <th scope="col">{t('admin.ships')}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data.tiers.tiers).map(([tier, count]) => (
            <tr key={tier}>
              <td>{tier}</td>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{t('admin.tierShipsTotal', { count: data.tiers.ships })}</p>
    </div>
  );
}
