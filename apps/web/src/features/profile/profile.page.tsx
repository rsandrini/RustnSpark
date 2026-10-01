import { useEffect } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type { ReportListResponse } from '../../api/generated';
import { useAuthContext } from '../auth/auth.context';
import { FactionBadge } from '../../ui/FactionBadge';
import { ItemCard } from '../../ui/ItemCard';

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

  const money = (value: number) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`;
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <main className="app" data-guided={guided ? '' : undefined}>
      <header className="topbar">
        <div>
          <h1>{t('profile.title')}</h1>
          <span className="sub">{user?.name ?? ''}</span>
        </div>
        <div className="wallet">
          <div className="lbl">{t('profile.wallet')}</div>
          <div className="amt" data-testid="wallet">
            {money(user?.credits ?? 0)}
          </div>
        </div>
      </header>

      {user?.factionId != null && <FactionBadge factionId={user.factionId} />}

      <h2>{t('profile.history')}</h2>
      {reportsQuery.isLoading && <p>{t('loading')}</p>}
      {!reportsQuery.isLoading && (reportsQuery.data?.items.length ?? 0) === 0 && (
        <p className="sub">{t('profile.noHistory')}</p>
      )}
      <div className="stack">
        {reportsQuery.data?.items.map((item) => (
          <ItemCard
            key={item.missionId}
            name={t(`report.outcome.${item.outcome}`, { defaultValue: item.outcome })}
            description={
              <>
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
                ].join(' · ')}
              </>
            }
            action={
              <Link className="btn" to={`/report/${item.missionId}`}>
                {t('transit.viewReport')}
              </Link>
            }
          />
        ))}
      </div>

      <div className="actions" style={{ marginTop: 16 }}>
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
