import { useEffect } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type { MyStatsResponse, ReportListResponse } from '../../api/generated';
import { useAuthContext } from '../auth/auth.context';
import { FactionBadge } from '../../ui/FactionBadge';
import { PageTitle } from '../../ui/PageTitle';
import { MyStats } from './my-stats';

const SEPARATOR = ' · ';

export interface ProfilePageProps {
  /** Placeholder for the future guided tour (GDD §16; not built in v0.1, S10.3). */
  guided?: boolean;
}

export function ProfilePage({ guided = false }: ProfilePageProps) {
  const { t, i18n } = useTranslation();
  const { user, reloadProfile } = useAuthContext();

  // The balance may have moved while this tab was in the background (a mission ending): re-read
  // it on entry and whenever the window regains focus.
  useEffect(() => {
    void reloadProfile();
    const onFocus = () => void reloadProfile();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reloadProfile]);

  const reportsQuery = useQuery({
    queryKey: ['reports'],
    queryFn: () => client.get<ReportListResponse>('/v1/reports'),
  });

  const statsQuery = useQuery({
    queryKey: ['my-stats'],
    queryFn: () => client.get<MyStatsResponse>('/v1/players/me/stats'),
  });

  const money = (value: number) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`;
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <main className="app" data-guided={guided ? '' : undefined}>
      <PageTitle
        title={t('profile.title')}
        line={
          <>
            {user?.name ?? ''}
            {SEPARATOR}
            {t('profile.wallet')} <b data-testid="wallet">{money(user?.credits ?? 0)}</b>
          </>
        }
      />

      {user?.factionId != null && <FactionBadge factionId={user.factionId} />}

      {statsQuery.data !== undefined && <MyStats stats={statsQuery.data} />}

      <h2 className="profile-history">{t('profile.history')}</h2>
      {reportsQuery.isLoading && <p>{t('loading')}</p>}
      {!reportsQuery.isLoading && (reportsQuery.data?.items.length ?? 0) === 0 && (
        <p className="sub">{t('profile.noHistory')}</p>
      )}
      <ul className="run-list">
        {reportsQuery.data?.items.map((item) => (
          <li key={item.missionId} className={`run run-${item.outcome}`}>
            <span className="run-pip" aria-hidden="true" />
            <div className="run-main">
              <b className="run-outcome">
                {t(`report.outcome.${item.outcome}`, { defaultValue: item.outcome })}
              </b>
              <span className="run-meta">
                {item.hadCombat && (
                  <Link
                    className="pill pill-combat"
                    to={`/report/${item.missionId}#combat`}
                    title={t('profile.combatTagHint')}
                  >
                    {t('profile.combatTag')}
                  </Link>
                )}{' '}
                {[
                  t('profile.legCount', { count: item.legs }),
                  dateFormat.format(new Date(item.createdAt)),
                ].join(SEPARATOR)}
              </span>
            </div>
            <span className="run-credits">{t('profile.credits', { amount: item.credits })}</span>
            <Link className="btn" to={`/report/${item.missionId}`}>
              {t('transit.viewReport')}
            </Link>
          </li>
        ))}
      </ul>

      <div className="profile-links">
        <Link className="btn" to="/port">
          {t('port.title')}
        </Link>
        <Link className="btn" to="/map">
          {t('report.backMap')}
        </Link>
      </div>
    </main>
  );
}
