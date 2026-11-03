import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { errorText } from '../../api/errors';
import type { PublicProfileResponse } from '../../api/generated';
import { useAuth } from '../auth/auth.hooks';
import { PilotCard } from './pilot-card';
import { ReportPilotDialog } from './report-pilot-dialog';
import { PageTitle } from '../../ui/PageTitle';

export function PublicProfilePage() {
  const { t } = useTranslation();
  const { name } = useParams<{ name: string }>();
  const { user } = useAuth();
  const [reporting, setReporting] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['public-profile', name],
    queryFn: () =>
      client.get<PublicProfileResponse>(
        `/v1/players/by-name/${encodeURIComponent(name ?? '')}/profile`,
      ),
    enabled: name !== undefined,
  });

  return (
    <main className="app">
      <PageTitle title={t('profile.title')} />
      {profileQuery.isLoading && <p>{t('loading')}</p>}
      {profileQuery.isError && (
        <p className="error-text" role="alert">
          {errorText(t, profileQuery.error, t('profile.stats.loadFailed'))}
        </p>
      )}
      {profileQuery.data !== undefined && <PilotCard profile={profileQuery.data} />}
      {profileQuery.data !== undefined && profileQuery.data.name !== user?.name && (
        <>
          <button
            type="button"
            className="btn tiny"
            data-testid="report-pilot"
            onClick={() => setReporting(true)}
          >
            {t('moderation.report.button')}
          </button>
          <ReportPilotDialog
            playerName={profileQuery.data.name}
            open={reporting}
            onClose={() => setReporting(false)}
          />
        </>
      )}
    </main>
  );
}
