import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { client } from '../api/client';
import { describeError } from '../api/errors';
import { Popup } from './Popup';

const MIN_LENGTH = 10;
const MAX_LENGTH = 2000;

/** The beta "report a problem" form: a message sent by email to the team, with the screen it came from. */
export function BugReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const [message, setMessage] = useState('');
  const send = useMutation({
    mutationFn: () =>
      client.post<void>('/v1/feedback/bug', {
        message: message.trim(),
        page: pathname,
        locale: i18n.language,
      }),
  });
  const valid = message.trim().length >= MIN_LENGTH;

  const close = () => {
    setMessage('');
    send.reset();
    onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid && !send.isPending) send.mutate();
  };

  return (
    <Popup open={open} title={t('bugReport.title')} onClose={close}>
      {send.isSuccess ? (
        <>
          <p role="status">{t('bugReport.thanks')}</p>
          <button type="button" className="btn" onClick={close}>
            {t('bugReport.close')}
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <p className="sub">{t('bugReport.help')}</p>
          <label className="field">
            <span className="label">{t('bugReport.message')}</span>
            <textarea
              value={message}
              rows={6}
              maxLength={MAX_LENGTH}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <p className="sub">
            {t('bugReport.count', { n: message.trim().length, max: MAX_LENGTH })}
          </p>
          {send.isError && (
            <p role="alert" className="error">
              {describeError(t, send.error, t('bugReport.failed'))}
            </p>
          )}
          <button type="submit" className="btn primary" disabled={!valid || send.isPending}>
            {send.isPending ? t('bugReport.sending') : t('bugReport.send')}
          </button>
        </form>
      )}
    </Popup>
  );
}
