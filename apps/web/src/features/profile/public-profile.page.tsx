import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { errorText } from '../../api/errors';
import type { PublicProfileResponse } from '../../api/generated';
import { PilotCard } from './pilot-card';
import { PageTitle } from '../../ui/PageTitle';

export function PublicProfilePage() {
  const { t } = useTranslation();
  const { name } = useParams<{ name: string }>();

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
    </main>
  );
}
