import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../admin.api';

// Screen B (GDD §17): inflation at a glance — credits entering vs leaving — plus the
// sources and sinks breakdown that confirms where the money dies.
export function EconomyScreen() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['admin', 'analytics', 'economy'],
    queryFn: adminApi.economy,
  });

  if (query.isLoading) return <p>{t('loading')}</p>;
  if (query.isError) return <p role="alert">{t('admin.loadError')}</p>;
  const { window: bounds, data } = query.data!;

  return (
    <div>
      <h2>{t('admin.economy')}</h2>
      <p>
        {t('admin.windowLabel', {
          from: new Date(bounds.from).toLocaleString(),
          to: new Date(bounds.to).toLocaleString(),
        })}
      </p>

      <table>
        <tbody>
          <tr>
            <th scope="row">{t('admin.creditsEntering')}</th>
            <td>{data.entering}</td>
          </tr>
          <tr>
            <th scope="row">{t('admin.creditsLeaving')}</th>
            <td>{data.leaving}</td>
          </tr>
          <tr>
            <th scope="row">{t('admin.creditsNet')}</th>
            <td>{data.net}</td>
          </tr>
        </tbody>
      </table>

      <h3>{t('admin.sources')}</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('admin.reason')}</th>
            <th scope="col">{t('admin.total')}</th>
          </tr>
        </thead>
        <tbody>
          {data.sources.map((source) => (
            <tr key={source.reason}>
              <td>{source.reason}</td>
              <td>{source.total}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{t('admin.sinks')}</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('admin.reason')}</th>
            <th scope="col">{t('admin.total')}</th>
          </tr>
        </thead>
        <tbody>
          {data.sinks.map((sink) => (
            <tr key={sink.reason}>
              <td>{sink.reason}</td>
              <td>{sink.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
