import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { describeError } from '../../api/errors';
import { Popup } from '../../ui/Popup';

const SUBJECTS = ['SHIP_NAME', 'PILOT_NAME'] as const;
const REASONS = ['OFFENSIVE', 'IMPERSONATION', 'OTHER'] as const;
const NOTE_MAX = 300;

/** Reporting another pilot's ship name or pilot name as not acceptable; a person on the team reviews it. */
export function ReportPilotDialog({
  playerName,
  open,
  onClose,
}: {
  playerName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number]>('SHIP_NAME');
  const [reason, setReason] = useState<(typeof REASONS)[number]>('OFFENSIVE');
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: () =>
      client.post<{ id: string }>('/v1/moderation/reports', {
        playerName,
        subject,
        reason,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      }),
  });

  const close = () => {
    setNote('');
    send.reset();
    onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!send.isPending) send.mutate();
  };

  return (
    <Popup open={open} title={t('moderation.report.title', { name: playerName })} onClose={close}>
      {send.isSuccess ? (
        <>
          <p role="status">{t('moderation.report.thanks')}</p>
          <button type="button" className="btn" onClick={close}>
            {t('moderation.report.close')}
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <p className="sub">{t('moderation.report.help')}</p>
          <label className="field">
            <span className="label">{t('moderation.report.subject')}</span>
            <select
              value={subject}
              onChange={(event) => setSubject(event.target.value as (typeof SUBJECTS)[number])}
            >
              {SUBJECTS.map((value) => (
                <option key={value} value={value}>
                  {t(`moderation.subject.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">{t('moderation.report.reason')}</span>
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value as (typeof REASONS)[number])}
            >
              {REASONS.map((value) => (
                <option key={value} value={value}>
                  {t(`moderation.reason.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">{t('moderation.report.note')}</span>
            <textarea
              value={note}
              rows={3}
              maxLength={NOTE_MAX}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {send.isError && (
            <p role="alert" className="error">
              {describeError(t, send.error, t('moderation.report.failed'))}
            </p>
          )}
          <button type="submit" className="btn primary" disabled={send.isPending}>
            {send.isPending ? t('moderation.report.sending') : t('moderation.report.send')}
          </button>
        </form>
      )}
    </Popup>
  );
}
