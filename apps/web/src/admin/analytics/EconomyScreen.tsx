import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../admin.api';
import { useAnalyticsWindow } from './WindowPicker';

// Screen B (GDD §17): inflation at a glance — credits entering vs leaving — plus the
// sources and sinks breakdown that confirms where the money dies.
export function EconomyScreen() {
  const { t } = useTranslation();
  const period = useAnalyticsWindow();
  const query = useQuery({
    queryKey: ['admin', 'analytics', 'economy', period.key],
    queryFn: () => adminApi.economy(period.range()),
  });

  if (query.isLoading || query.isError) {
    return (
      <div>
        <h2>{t('admin.economy')}</h2>
        {period.picker}
        {query.isLoading ? <p>{t('loading')}</p> : <p role="alert">{t('admin.loadError')}</p>}
      </div>
    );
  }
  const { window: bounds, data } = query.data!;

  return (
    <div>
      <h2>{t('admin.economy')}</h2>
      {period.picker}
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
          <tr>
            <th scope="row">{t('admin.adjustmentsGranted')}</th>
            <td>{data.adjustments.granted}</td>
          </tr>
          <tr>
            <th scope="row">{t('admin.adjustmentsRemoved')}</th>
            <td>{data.adjustments.removed}</td>
          </tr>
        </tbody>
      </table>
      <p>{t('admin.adjustmentsNote')}</p>

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
