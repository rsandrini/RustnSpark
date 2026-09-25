import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type {
  CatalogDetail,
  ReportLine,
  ReportResponse,
  ReportSegment,
  ReportViewName,
} from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { Popup } from '../../ui/Popup';

function verdictClass(outcome: string): string {
  if (outcome === 'failed' || outcome === 'adrift') return 'verdict bad';
  return 'verdict ok';
}

const infoGlyph = 'i';

export interface ReportPageProps {
  /** Placeholder for the future guided tour (GDD §16; not built in v0.1, S10.3). */
  guided?: boolean;
}

export function ReportPage({ guided = false }: ReportPageProps) {
  const { missionId = '' } = useParams();
  const { t } = useTranslation();
  const [view, setView] = useState<ReportViewName>('summary');
  const [popupLine, setPopupLine] = useState<string | null>(null);
  const [refPopup, setRefPopup] = useState<Extract<ReportSegment, { t: 'ref' }> | null>(null);

  const reportQuery = useQuery({
    queryKey: ['report', missionId, view],
    queryFn: () => client.get<ReportResponse>(`/v1/reports/${missionId}?view=${view}`),
    // Switching tabs keeps the current view on screen until the next one arrives, instead
    // of blanking the whole page (and its tab bar) behind a loading message.
    placeholderData: keepPreviousData,
  });

  if (reportQuery.isLoading) {
    return (
      <main className="app" data-guided={guided ? '' : undefined}>
        {t('loading')}
      </main>
    );
  }

  const report = reportQuery.data;

  const renderLine = (line: ReportLine, key: string) => (
    <span key={key}>
      {line.segments.map((segment, index) =>
        segment.t === 'ref' ? (
          // Loot and part names open a detail popup (S10.8).
          <button key={index} type="button" className="ref" onClick={() => setRefPopup(segment)}>
            {segment.value}
          </button>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </span>
  );

  const views: readonly ReportViewName[] = ['summary', 'narrative', 'log'];

  return (
    <main className="app" data-guided={guided ? '' : undefined}>
      <header className="topbar">
        <h1>{t('report.title')}</h1>
        {report !== undefined && (
          <span className={verdictClass(report.outcome)}>
            {t(`report.outcome.${report.outcome}`, { defaultValue: report.outcome })}
          </span>
        )}
      </header>

      {report === undefined && <p className="sub">{t('report.noReport')}</p>}

      {report !== undefined && (
        <>
          <div className="tabs" role="tablist" aria-label={t('report.title')}>
            {views.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={view === name}
                className={`tab${view === name ? ' on' : ''}`}
                onClick={() => setView(name)}
              >
                {t(`report.tabs.${name}`)}
              </button>
            ))}
          </div>

          {report.view === 'summary' && (
            <section className="stack">
              {report.lines.map((line, index) => (
                <p key={index} className={index === 0 ? 'sub' : undefined}>
                  {renderLine(line, `l${index}`)}
                </p>
              ))}
            </section>
          )}

          {report.view === 'log' && (
            <ol className="stack mono log-lines">
              {report.lines.map((line, index) => (
                <li key={index}>{renderLine(line, `l${index}`)}</li>
              ))}
            </ol>
          )}

          {report.view === 'narrative' && (
            <section className="stack">
              {report.chapters.map((chapter) => (
                <article key={chapter.leg} className="event">
                  <h2>{renderLine(chapter.header, `h${chapter.leg}`)}</h2>
                  <ol className="stack">
                    {chapter.lines.map((line, index) => {
                      const key = `${chapter.leg}-${index}`;
                      const hasDetail = line.detail !== undefined;
                      return (
                        <li key={key}>
                          {renderLine(line, key)}
                          {hasDetail && (
                            <>
                              {' '}
                              <button
                                type="button"
                                className="btn tiny"
                                aria-label={t('report.eventDetails')}
                                onClick={() => setPopupLine(key)}
                              >
                                {infoGlyph}
                              </button>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </article>
              ))}
            </section>
          )}
        </>
      )}

      <Popup
        open={refPopup !== null}
        title={refPopup?.value ?? ''}
        onClose={() => setRefPopup(null)}
      >
        {refPopup !== null && <RefDetail segment={refPopup} />}
      </Popup>

      <Popup
        open={popupLine !== null}
        title={t('report.eventDetails')}
        onClose={() => setPopupLine(null)}
      >
        {popupLine !== null && <CascadeDetail report={report} lineKey={popupLine} />}
      </Popup>

      <div className="actions" style={{ marginTop: 16 }}>
        <Link className="btn" to="/map">
          {t('report.backMap')}
        </Link>
        <Link className="btn" to="/board">
          {t('report.backBoard')}
        </Link>
        <Link className="btn" to="/port">
          {t('port.title')}
        </Link>
      </div>
    </main>
  );
}

function CascadeDetail({
  report,
  lineKey,
}: {
  report: ReportResponse | undefined;
  lineKey: string;
}) {
  const { t } = useTranslation();
  if (report === undefined || report.view !== 'narrative') return null;
  const [legRaw, indexRaw] = lineKey.split('-');
  const chapter = report.chapters.find((entry) => String(entry.leg) === legRaw);
  const line = chapter?.lines[Number(indexRaw ?? '-1')];
  const cascade = line?.detail?.cascade;
  if (cascade === undefined) return null;
  return (
    <div className="stack">
      {Object.entries(cascade).map(([field, value]) => (
        <div className="statrow" key={field}>
          <span>{t(`report.cascade.${field}`, { defaultValue: field })}</span>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

/**
 * Detail for a part or loot reference in a report: name, kind, description and class/rarity
 * from the catalog. A stored log may name something that has since left the catalog (404), in
 * which case the popup still shows the name and kind the report already carries.
 */
function RefDetail({ segment }: { segment: Extract<ReportSegment, { t: 'ref' }> }) {
  const { t, i18n } = useTranslation();
  const path =
    segment.kind === 'part'
      ? `/v1/catalog/parts/${encodeURIComponent(segment.id)}`
      : `/v1/catalog/materials/${encodeURIComponent(segment.id)}`;
  const detail = useQuery({
    queryKey: ['catalog', segment.kind, segment.id],
    queryFn: () => client.get<CatalogDetail>(path),
    retry: false,
  });
  return (
    <div className="stack">
      <div className="statrow">
        <span>{t('report.refDetails')}</span>
        <b>{t(`report.refKind.${segment.kind}`)}</b>
      </div>
      {detail.isLoading && <p className="sub">{t('loading')}</p>}
      {detail.data !== undefined && (
        <>
          <p>{pickLocalized(detail.data.description, i18n.language)}</p>
          <div className="statrow">
            <span>{t(`report.refCategory.${segment.kind}`)}</span>
            <b>{detail.data.category}</b>
          </div>
        </>
      )}
    </div>
  );
}
