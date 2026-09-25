import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../admin.api';

// Screen C (GDD §17): traffic per route, pirate encounters and mission generation vs
// consumption per zone of the seeded map.
export function WorldScreen() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['admin', 'analytics', 'world'],
    queryFn: adminApi.world,
  });

  if (query.isLoading) return <p>{t('loading')}</p>;
  if (query.isError) return <p role="alert">{t('admin.loadError')}</p>;
  const { window: bounds, data } = query.data!;

  return (
    <div>
      <h2>{t('admin.world')}</h2>
      <p>
        {t('admin.windowLabel', {
          from: new Date(bounds.from).toLocaleString(),
          to: new Date(bounds.to).toLocaleString(),
        })}
      </p>
      <p>{t('admin.pirateEncounters', { count: data.encounters })}</p>

      <h3>{t('admin.routeTraffic')}</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('admin.route')}</th>
            <th scope="col">{t('admin.crossings')}</th>
          </tr>
        </thead>
        <tbody>
          {data.traffic.map((row) => (
            <tr key={row.routeId}>
              <td>{row.routeId}</td>
              <td>{row.crossings}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{t('admin.zoneMissions')}</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('admin.zone')}</th>
            <th scope="col">{t('admin.generated')}</th>
            <th scope="col">{t('admin.consumed')}</th>
          </tr>
        </thead>
        <tbody>
          {data.zones.map((row) => (
            <tr key={row.zone}>
              <td>{row.zone}</td>
              <td>{row.generated}</td>
              <td>{row.consumed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
