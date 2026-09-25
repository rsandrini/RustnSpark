import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, type LocalizedMessage } from '../admin.api';

// Screen E's flag/broadcast/maintenance controls (GDD §17; tuning lives in S3.10).
// Flag flips and notice dismissal open a confirmation before the request leaves —
// maintenance mode drops every player intent to 503, so it never toggles on one click.
export function SystemScreen() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmFlag, setConfirmFlag] = useState<string | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState<string | null>(null);
  const [en, setEn] = useState('');
  const [pt, setPt] = useState('');

  const flags = useQuery({
    queryKey: ['admin', 'flags'],
    queryFn: adminApi.listFlags,
  });
  const notices = useQuery({
    queryKey: ['admin', 'notices'],
    queryFn: adminApi.listNotices,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'flags'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'notices'] });
  };

  const flagMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: boolean }) => adminApi.setFlag(key, value),
    onSuccess: () => {
      setConfirmFlag(null);
      refresh();
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => adminApi.dismissNotice(id),
    onSuccess: () => {
      setConfirmDismiss(null);
      refresh();
    },
  });

  const createMutation = useMutation({
    mutationFn: (message: LocalizedMessage) => adminApi.createNotice(message),
    onSuccess: () => {
      setEn('');
      setPt('');
      refresh();
    },
  });

  const publish = (event: FormEvent) => {
    event.preventDefault();
    if (en.trim() === '' || pt.trim() === '') return;
    createMutation.mutate({ en: en.trim(), 'pt-BR': pt.trim() });
  };

  const flagLabel = (key: string): string => {
    if (key === 'maintenance') return t('admin.maintenanceFlag');
    if (key === 'register.open') return t('admin.registerOpenFlag');
    return key;
  };

  const activeNotices = (notices.data ?? []).filter((notice) => notice.active);

  return (
    <div>
      <h2>{t('admin.system')}</h2>

      <section aria-label={t('admin.flags')}>
        <h3>{t('admin.flags')}</h3>
        {flags.isLoading && <p>{t('loading')}</p>}
        {flags.isError && <p role="alert">{t('admin.loadError')}</p>}
        <table>
          <thead>
            <tr>
              <th scope="col">{t('admin.flag')}</th>
              <th scope="col">{t('admin.value')}</th>
              <th scope="col">{t('admin.actionsColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {(flags.data ?? []).map((flag) => (
              <tr key={flag.key}>
                <td>{flagLabel(flag.key)}</td>
                <td>{flag.value ? t('admin.on') : t('admin.off')}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => setConfirmFlag(flag.key)}
                    aria-label={`${t('admin.toggleFlag')} ${flagLabel(flag.key)}`}
                  >
                    {flag.value ? t('admin.disable') : t('admin.enable')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {confirmFlag !== null && (
          <div role="dialog" aria-modal="true" aria-label={t('admin.toggleFlag')}>
            <p>{t('admin.flagConfirm', { flag: flagLabel(confirmFlag) })}</p>
            <button
              type="button"
              onClick={() => {
                const flag = (flags.data ?? []).find((entry) => entry.key === confirmFlag);
                if (flag) flagMutation.mutate({ key: flag.key, value: !flag.value });
              }}
              disabled={flagMutation.isPending}
            >
              {t('admin.confirmAction')}
            </button>
            <button type="button" onClick={() => setConfirmFlag(null)}>
              {t('admin.cancelAction')}
            </button>
          </div>
        )}
      </section>

      <section aria-label={t('admin.broadcast')}>
        <h3>{t('admin.broadcast')}</h3>
        <form onSubmit={publish}>
          <label htmlFor="notice-en">{t('admin.noticeEn')}</label>
          <input id="notice-en" value={en} onChange={(event) => setEn(event.target.value)} />
          <label htmlFor="notice-pt">{t('admin.noticePt')}</label>
          <input id="notice-pt" value={pt} onChange={(event) => setPt(event.target.value)} />
          <button
            type="submit"
            disabled={en.trim() === '' || pt.trim() === '' || createMutation.isPending}
          >
            {t('admin.publish')}
          </button>
          {createMutation.isError && <p role="alert">{t('admin.loadError')}</p>}
        </form>

        {notices.isError && <p role="alert">{t('admin.loadError')}</p>}
        <table>
          <thead>
            <tr>
              <th scope="col">{t('admin.message')}</th>
              <th scope="col">{t('admin.actionsColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {activeNotices.map((notice) => (
              <tr key={notice.id}>
                <td>{notice.message[i18n.language === 'pt-BR' ? 'pt-BR' : 'en']}</td>
                <td>
                  <button type="button" onClick={() => setConfirmDismiss(notice.id)}>
                    {t('admin.dismiss')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {confirmDismiss !== null && (
          <div role="dialog" aria-modal="true" aria-label={t('admin.dismiss')}>
            <p>{t('admin.dismissConfirm')}</p>
            <button
              type="button"
              onClick={() => dismissMutation.mutate(confirmDismiss)}
              disabled={dismissMutation.isPending}
            >
              {t('admin.confirmAction')}
            </button>
            <button type="button" onClick={() => setConfirmDismiss(null)}>
              {t('admin.cancelAction')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
