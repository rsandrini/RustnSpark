import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { client, newIdempotencyKey } from '../../api/client';
import { describeError } from '../../api/errors';

type StatusFilter = 'OPEN' | 'DISMISSED' | 'ACTIONED' | 'ALL';
type ReviewAction = 'DISMISS' | 'RESET_SHIP_NAME' | 'RESET_PILOT_NAME' | 'BAN';

interface ReportRow {
  id: string;
  subject: 'SHIP_NAME' | 'PILOT_NAME';
  reason: string;
  note: string | null;
  reportedText: string;
  status: string;
  createdAt: string;
  reporter: { id: string; name: string };
  target: { id: string; name: string; shipName: string | null; banned: boolean };
  reportsAgainstTarget: number;
  review: { by: string; at: string; outcome: string | null; note: string | null } | null;
}

const SEP = ' \u00B7 ';
const COLON = ': ';
const FILTERS: readonly StatusFilter[] = ['OPEN', 'DISMISSED', 'ACTIONED', 'ALL'];

/** The name reports pilots filed, for a person to read and decide: dismiss, reset the name, or ban. */
export function ReportsScreen() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>('OPEN');
  const [notes, setNotes] = useState<Record<string, string>>({});

  const reportsQuery = useQuery({
    queryKey: ['admin', 'moderation', status],
    queryFn: () => client.get<ReportRow[]>(`/v1/admin/moderation/reports?status=${status}`),
  });
  const review = useMutation({
    mutationFn: (args: { id: string; action: ReviewAction }) =>
      client.post(
        `/v1/admin/moderation/reports/${args.id}/review`,
        {
          action: args.action,
          ...(notes[args.id]?.trim() ? { note: notes[args.id]?.trim() } : {}),
        },
        { idempotencyKey: newIdempotencyKey() },
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'moderation'] }),
  });
  const reportedLabel = `${t('admin.nameReports.reported')}${COLON}`;
  const bannedTag = ` ${t('admin.nameReports.banned')}`;
  const quoted = (text: string) => `\u201C${text}\u201D`;
  const nowNamedOf = (row: ReportRow) =>
    ` ${t('admin.nameReports.nowNamed', { name: row.target.shipName ?? '' })}`;
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language);

  return (
    <section data-testid="admin-reports">
      <h2>{t('admin.nameReports.title')}</h2>
      <p className="sub">{t('admin.nameReports.help')}</p>
      <div className="row-between" role="group" aria-label={t('admin.nameReports.filter')}>
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className={`btn tiny${value === status ? ' primary' : ''}`}
            aria-pressed={value === status}
            onClick={() => setStatus(value)}
          >
            {t(`admin.nameReports.status.${value}`)}
          </button>
        ))}
      </div>

      {reportsQuery.isLoading && <p>{t('tuning.loading')}</p>}
      {reportsQuery.isError && <p className="error-text">{t('admin.loadError')}</p>}
      {reportsQuery.data?.length === 0 && <p className="sub">{t('admin.nameReports.empty')}</p>}
      {review.isError && (
        <p role="alert" className="error-text">
          {describeError(t, review.error, t('admin.nameReports.failed'))}
        </p>
      )}

      <ul className="stack">
        {(reportsQuery.data ?? []).map((row) => (
          <li key={row.id} className="panel" data-testid="report-row" data-status={row.status}>
            <p>
              <b>{t(`moderation.subject.${row.subject}`)}</b>
              {SEP}
              {t(`moderation.reason.${row.reason}`)}
              {SEP}
              <span className="sub">{when(row.createdAt)}</span>
            </p>
            <p>
              {reportedLabel}
              <b data-testid="report-text">{row.reportedText}</b>
              {row.subject === 'SHIP_NAME' &&
                row.target.shipName !== null &&
                row.target.shipName !== row.reportedText && (
                  <span className="sub">{nowNamedOf(row)}</span>
                )}
            </p>
            <p className="sub">
              {t('admin.nameReports.by', { reporter: row.reporter.name })}
              {SEP}
              <Link to={`/admin/players/${row.target.id}`}>{row.target.name}</Link>
              {row.target.banned ? bannedTag : ''}
              {SEP}
              {t('admin.nameReports.againstTarget', { count: row.reportsAgainstTarget })}
            </p>
            {row.note !== null && <p className="sub">{quoted(row.note)}</p>}
            {row.review !== null ? (
              <p className="sub" data-testid="report-outcome">
                {[
                  t(`admin.nameReports.outcome.${row.review.outcome ?? 'DISMISS'}`),
                  when(row.review.at),
                  ...(row.review.note === null ? [] : [row.review.note]),
                ].join(SEP)}
              </p>
            ) : (
              <>
                <label className="field">
                  <span className="label">{t('admin.nameReports.reviewNote')}</span>
                  <input
                    value={notes[row.id] ?? ''}
                    maxLength={300}
                    onChange={(event) => setNotes({ ...notes, [row.id]: event.target.value })}
                  />
                </label>
                <div className="row-between">
                  {(
                    [
                      'DISMISS',
                      row.subject === 'SHIP_NAME' ? 'RESET_SHIP_NAME' : 'RESET_PILOT_NAME',
                      'BAN',
                    ] as const
                  ).map((action) => (
                    <button
                      key={action}
                      type="button"
                      className={`btn tiny${action === 'BAN' ? ' danger' : ''}`}
                      disabled={review.isPending}
                      onClick={() => review.mutate({ id: row.id, action })}
                    >
                      {t(`admin.nameReports.action.${action}`)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
