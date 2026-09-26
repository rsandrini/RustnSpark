import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type {
  CatalogDetail,
  ReportMission,
  ReportStats,
  WorldResponse,
  ReportLine,
  ReportResponse,
  ReportSegment,
  ReportViewName,
} from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { useAuthContext } from '../auth/auth.context';
import { FactionBadge } from '../../ui/FactionBadge';
import { placeArtUrl } from '../../ui/PlaceArt';
import { Popup } from '../../ui/Popup';

const infoGlyph = 'i';

export interface ReportPageProps {
  /** Placeholder for the future guided tour (GDD §16; not built in v0.1, S10.3). */
  guided?: boolean;
}

export function ReportPage({ guided = false }: ReportPageProps) {
  const { missionId = '' } = useParams();
  const { reloadProfile } = useAuthContext();
  // Opening a report is the moment a pilot looks at the money: make sure it is current.
  useEffect(() => {
    void reloadProfile();
  }, [reloadProfile]);
  const { t } = useTranslation();
  const [view, setView] = useState<ReportViewName>('narrative');
  const [popupLine, setPopupLine] = useState<string | null>(null);
  const [refPopup, setRefPopup] = useState<Extract<ReportSegment, { t: 'ref' }> | null>(null);

  const reportQuery = useQuery({
    queryKey: ['report', missionId, view],
    queryFn: () => client.get<ReportResponse>(`/v1/reports/${missionId}?view=${view}`),
    // Switching tabs keeps the current view on screen until the next one arrives, instead
    // of blanking the whole page (and its tab bar) behind a loading message.
    placeholderData: keepPreviousData,
  });

  const worldQuery = useQuery({
    queryKey: ['world'],
    queryFn: () => client.get<WorldResponse>('/v1/locations'),
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

  const views: readonly ReportViewName[] = ['narrative', 'summary', 'log'];

  return (
    <main className="app" data-guided={guided ? '' : undefined}>
      <header className="topbar">
        <h1>{t('report.title')}</h1>
      </header>

      {report !== undefined && (
        <Debrief
          outcome={report.outcome}
          stats={report.stats}
          mission={report.mission}
          world={worldQuery.data}
          onRef={setRefPopup}
        />
      )}

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
            <section className="stack report-story">
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

function outcomeTone(outcome: string): 'ok' | 'warn' | 'bad' {
  if (outcome === 'failed' || outcome === 'adrift') return 'bad';
  if (outcome === 'partial_failure') return 'warn';
  return 'ok';
}

interface DebriefProps {
  outcome: string;
  stats: ReportStats;
  mission: ReportMission | undefined;
  world: WorldResponse | undefined;
  onRef: (segment: Extract<ReportSegment, { t: 'ref' }>) => void;
}

// The first thing after a flight: how it ended, what it was, what it paid, and what it cost.
// Everything here is read from the stored run (stats), never worked out on the client.
function Debrief({ outcome, stats, mission, world, onRef }: DebriefProps) {
  const { t, i18n } = useTranslation();
  const tone = outcomeTone(outcome);
  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  const place = (id: string) => {
    const found = world?.locations.find((entry) => entry.id === id);
    return found === undefined ? id : pickLocalized(found.displayName, i18n.language);
  };
  const destination =
    mission === undefined
      ? undefined
      : world?.locations.find((entry) => entry.id === mission.destinationId);
  const earned = stats.credits;
  const creditsText = `${earned >= 0 ? '+' : '−'}${number(Math.abs(earned))} ¢`;
  const hasFights =
    stats.fights.won +
      stats.fights.lost +
      stats.fights.escaped +
      stats.fights.drawn +
      stats.fights.pvp >
    0;
  const damageTotal = stats.damage.shield + stats.damage.armor + stats.damage.hull;

  return (
    <section className={`debrief ${tone}`} data-testid="debrief">
      {mission !== undefined && (
        <div
          className="debrief-art"
          aria-hidden="true"
          style={{ backgroundImage: `url(${placeArtUrl(mission.destinationId, 'wide')})` }}
        />
      )}
      <div className="debrief-verdict">
        <span className="debrief-glyph" aria-hidden="true">
          {t(`report.glyph.${tone}`)}
        </span>
        <div>
          <div className="debrief-outcome">
            {t(`report.outcome.${outcome}`, { defaultValue: outcome })}
          </div>
          {mission !== undefined && (
            <div className="debrief-mission">
              {[
                mission.type === 'TRAVEL'
                  ? t('board.type.TRAVEL')
                  : pickLocalized(mission.title, i18n.language),
                [place(mission.originId), place(mission.destinationId)].join(' → '),
              ].join(' · ')}
              {destination !== undefined && <FactionBadge factionId={destination.factionId} />}
            </div>
          )}
        </div>
        <div className="debrief-credits">
          <b className={earned < 0 ? 'neg' : earned > 0 ? 'pos' : undefined}>{creditsText}</b>
          {stats.balanceAfter !== null && (
            <small>{t('report.debrief.balance', { balance: number(stats.balanceAfter) })}</small>
          )}
        </div>
      </div>

      <dl className="debrief-tiles">
        <div>
          <dt>{t('report.debrief.legs')}</dt>
          <dd>{stats.legs}</dd>
        </div>
        <div>
          <dt>{t('report.debrief.distance')}</dt>
          <dd>{number(stats.distance)}</dd>
        </div>
        <div>
          <dt>{t('report.debrief.fights')}</dt>
          <dd>
            {hasFights
              ? t(
                  stats.fights.drawn > 0
                    ? 'report.debrief.fightsValueDrawn'
                    : 'report.debrief.fightsValue',
                  {
                    won: stats.fights.won,
                    lost: stats.fights.lost,
                    escaped: stats.fights.escaped,
                    drawn: stats.fights.drawn,
                  },
                )
              : t('report.debrief.noFights')}
          </dd>
        </div>
        <div className={damageTotal > 0 ? 'bad' : undefined}>
          <dt>{t('report.debrief.damage')}</dt>
          <dd>
            {damageTotal > 0
              ? t('report.debrief.damageValue', {
                  shield: stats.damage.shield,
                  armor: stats.damage.armor,
                  hull: stats.damage.hull,
                })
              : t('report.debrief.noDamage')}
          </dd>
        </div>
        {stats.pirates.stolenParts > 0 && (
          <div className="bad">
            <dt>{t('report.debrief.stolen')}</dt>
            <dd>{stats.pirates.stolenParts}</dd>
          </div>
        )}
        {stats.pirates.motive === 'territory' && (
          <div className="bad">
            <dt>{t('report.debrief.pirates')}</dt>
            <dd>{t('report.debrief.drivenOff')}</dd>
          </div>
        )}
        {stats.pirates.motive === 'cargo' && (
          <div className="bad">
            <dt>{t('report.debrief.pirates')}</dt>
            <dd>{t('report.debrief.cargoLost')}</dd>
          </div>
        )}
        {stats.partFailures > 0 && (
          <div className="bad">
            <dt>{t('report.debrief.failures')}</dt>
            <dd>{stats.partFailures}</dd>
          </div>
        )}
        {stats.fuelLost > 0 && (
          <div className="bad">
            <dt>{t('report.debrief.fuelLost')}</dt>
            <dd>{stats.fuelLost}</dd>
          </div>
        )}
      </dl>

      {stats.loot.length > 0 && (
        <div className="debrief-loot">
          <b>{t('report.debrief.loot')}</b>
          {stats.loot.map((entry) => (
            <button
              key={entry.materialId}
              type="button"
              className="ref loot-chip"
              onClick={() =>
                onRef({ t: 'ref', kind: 'loot', id: entry.materialId, value: entry.name })
              }
            >
              {t('report.debrief.lootItem', { quantity: entry.quantity, name: entry.name })}
            </button>
          ))}
        </div>
      )}

      {damageTotal > 0 && <p className="debrief-hint">{t('report.debrief.repairHint')}</p>}
    </section>
  );
}
