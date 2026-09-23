import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { tuningApi } from './tuning.api';
import type * as dto from '../../api/generated';

export function RevisionHistory() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmRevert, setConfirmRevert] = useState<string | null>(null);

  const { data: revisions, isLoading } = useQuery<dto.TuningRevisionResponse[]>({
    queryKey: ['tuning', 'revisions'],
    queryFn: () => tuningApi.listRevisions({ limit: 100 }),
  });

  const revertMutation = useMutation({
    mutationFn: (id: string) =>
      tuningApi.revertRevision(id, t('tuning.revertReason')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'revisions'] });
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'config'] });
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'entities'] });
      setConfirmRevert(null);
    },
  });

  if (isLoading) return <p>{t('loading')}</p>;

  return (
    <div>
      <h2>{t('tuning.revisionHistoryTitle')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('tuning.entityType')}</th>
            <th>{t('tuning.entityId')}</th>
            <th>{t('tuning.actor')}</th>
            <th>{t('tuning.timestamp')}</th>
            <th>{t('tuning.reason')}</th>
            <th>{t('tuning.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {(revisions ?? []).map((revision) => (
            <tr key={revision.id}>
              <td>{revision.entityType}</td>
              <td>{revision.entityId}</td>
              <td>{revision.actor}</td>
              <td>{new Date(revision.at).toLocaleString()}</td>
              <td>{revision.reason}</td>
              <td>
                <button
                  type="button"
                  onClick={() => setConfirmRevert(revision.id)}
                  aria-label={`${t('tuning.revert')} ${revision.id}`}
                >
                  {t('tuning.revert')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {confirmRevert && (
        <div role="dialog" aria-modal="true">
          <p>{t('tuning.revertConfirm', { id: confirmRevert })}</p>
          <button
            type="button"
            onClick={() => revertMutation.mutate(confirmRevert)}
          >
            {t('tuning.confirm')}
          </button>
          <button type="button" onClick={() => setConfirmRevert(null)}>
            {t('tuning.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
