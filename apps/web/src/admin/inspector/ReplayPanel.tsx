import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../admin.api';
import type * as dto from '../../api/generated';

type ViewName = 'summary' | 'narrative' | 'log';

// D19/S7.6 replay in the browser: the API re-runs the stored MissionLog against its
// frozen rulesHash; `matchesStored` tells the operator whether today's engine still
// reproduces the stored outcome, and the rendered report is built from the recomputed
// events so a mismatch is visible instead of papered over.
export function ReplayPanel({
  playerId,
  missionId,
  onClose,
}: {
  playerId: string;
  missionId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<ViewName>('summary');

  const query = useQuery({
    queryKey: ['admin', 'replay', playerId, missionId, view],
    queryFn: () => adminApi.replayReport(playerId, missionId, view),
  });

  if (query.isLoading) return <p>{t('loading')}</p>;
  if (query.isError) return <p role="alert">{t('admin.loadError')}</p>;
  const { report, matchesStored, stored, replay } = query.data!;

  const renderLines = (lines: dto.ReportLine[]) => (
    <ol>
      {lines.map((line, index) => (
        <li key={index}>{line.text}</li>
      ))}
    </ol>
  );

  return (
    <section aria-label={t('admin.replay')}>
      <h3>{t('admin.replay')}</h3>
      <p>
        {t('admin.replaySummary', {
          stored: stored.outcome,
          replayed: replay.outcome,
          events: stored.events,
        })}
      </p>
      <p>{matchesStored ? t('admin.matchesStored') : t('admin.mismatch')}</p>
      <label>
        {t('admin.view')}
        <select value={view} onChange={(event) => setView(event.target.value as ViewName)}>
          <option value="summary">{t('admin.viewSummary')}</option>
          <option value="narrative">{t('admin.viewNarrative')}</option>
          <option value="log">{t('admin.viewLog')}</option>
        </select>
      </label>
      <p>{t('admin.outcomeValue', { value: report.outcome })}</p>
      {'chapters' in report ? (
        <div>
          {report.chapters.map((chapter, index) => (
            <div key={index}>
              <h4>{chapter.header.text}</h4>
              <ol>
                {chapter.lines.map((line, lineIndex) => (
                  <li key={lineIndex}>{line.text}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ) : (
        renderLines(report.lines)
      )}
      <button type="button" onClick={onClose}>
        {t('admin.closeReplay')}
      </button>
    </section>
  );
}
