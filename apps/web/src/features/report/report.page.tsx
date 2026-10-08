import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type {
  CatalogDetail,
  MissionCombatRound,
  ReportMission,
  ReportStats,
  WorldResponse,
  ReportLine,
  ReportResponse,
  ReportSegment,
  ReportViewName,
} from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { formatDuration } from '../../ui/duration';
import { useAuthContext } from '../auth/auth.context';
import { FactionBadge } from '../../ui/FactionBadge';
import { conditionTone, Gauge } from '../../ui/Gauge';
import { placeArtUrl, usePlaceArt } from '../../ui/PlaceArt';
import { Popup } from '../../ui/Popup';

const infoGlyph = 'i';

export interface ReportPageProps {
  /** Placeholder for the future guided tour (GDD §16; not built in v0.1, S10.3). */
  guided?: boolean;
}

export function ReportPage({ guided = false }: ReportPageProps) {
  const { missionId = '' } = useParams();
  const location = useLocation();
  const { reloadProfile } = useAuthContext();
  // Opening a report is the moment a pilot looks at the money: make sure it is current.
  useEffect(() => {
    void reloadProfile();
  }, [reloadProfile]);
  const { t } = useTranslation();
  // "Details" (the parts-damage table) is a client-only tab: its data is `report.stats`, which
  // comes back on every server view alike, so it never needs a view of its own — it rides along
  // on whichever real view was last fetched (cheapest: 'summary').
  type ReportTab = ReportViewName | 'detail';
  const [tab, setTab] = useState<ReportTab>('narrative');
  const view: ReportViewName = tab === 'detail' ? 'summary' : tab;
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

  // Owner request: "an easy way to check that combat inside the history page" — a #combat link
  // from the mission history jumps straight to the first fight's round-by-round popup, instead
  // of making the pilot hunt for the right line in what can be a multi-leg narrative. Guarded by
  // a ref (not just the hash) so closing the popup afterward doesn't immediately reopen it. Must
  // run before the isLoading early return below (rules of hooks), so it reads the query directly.
  const combatAutoOpened = useRef(false);
  useEffect(() => {
    const data = reportQuery.data;
    if (combatAutoOpened.current) return;
    if (location.hash !== '#combat' || data === undefined || data.view !== 'narrative') return;
    for (const chapter of data.chapters) {
      const index = chapter.lines.findIndex(
        (line) => line.detail?.rounds !== undefined && line.detail.rounds.length > 0,
      );
      if (index !== -1) {
        combatAutoOpened.current = true;
        setPopupLine(`${chapter.leg}-${index}`);
        return;
      }
    }
  }, [location.hash, reportQuery.data]);

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

  const tabs: readonly ReportTab[] = ['narrative', 'summary', 'log', 'detail'];

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
            {tabs.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                className={`tab${tab === name ? ' on' : ''}`}
                onClick={() => setTab(name)}
              >
                {t(`report.tabs.${name}`)}
              </button>
            ))}
          </div>

          {tab === 'detail' && <PartsDamageTable stats={report.stats} />}

          {tab !== 'detail' && report.view === 'summary' && (
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
        className="combat-log-modal"
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

// Owner request: show the roll's own breakdown (die + firepower + first-strike bonus) instead
// of a bare "roll / DC" that can look inconsistent with the Hit/Miss result for any attacker
// with nonzero firepower — the hit check is actually `roll + pdf + bonus >= dc`, not `roll >=
// dc`. `pdf`/`bonus` are optional (reports resolved before this breakdown existed have rounds
// but lack them): fall back to the old plain format rather than showing a broken sum.
function rollBreakdownText(round: MissionCombatRound): string {
  if (round.pdf === undefined) return `${round.roll} / ${round.dc}`;
  const bonus = round.bonus ?? 0;
  const terms = bonus === 0 ? [round.roll, round.pdf] : [round.roll, round.pdf, bonus];
  const total = terms.reduce((sum, term) => sum + term, 0);
  return `${terms.join(' + ')} = ${total} / ${round.dc}`;
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
  const rounds = line?.detail?.rounds;
  return (
    <div className="stack">
      {Object.entries(cascade).map(([field, value]) => (
        <div className="statrow" key={field}>
          <span>{t(`report.cascade.${field}`, { defaultValue: field })}</span>
          <b>{value}</b>
        </div>
      ))}
      {rounds !== undefined && rounds.length > 0 && (
        <>
          <p className="muted part-compare-note">{t('report.combatLog.title')}</p>
          <table className="part-stats-table combat-log-table">
            <thead>
              <tr>
                <th>{t('report.combatLog.round')}</th>
                <th>{t('report.combatLog.attacker')}</th>
                <th>{t('report.combatLog.rollDc')}</th>
                <th>{t('report.combatLog.result')}</th>
                <th>{t('report.combatLog.target')}</th>
                <th>{t('report.cascade.shield')}</th>
                <th>{t('report.cascade.armor')}</th>
                <th>{t('report.cascade.hp')}</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((round, index) => (
                <tr
                  key={index}
                  className={[round.hit ? '' : 'muted', `attacker-${round.attacker}`]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <td>{round.round}</td>
                  <td>
                    <span className={`attacker-${round.attacker}`}>
                      {t(`report.combatLog.side.${round.attacker}`)}
                    </span>
                  </td>
                  <td>{rollBreakdownText(round)}</td>
                  <td>
                    <span className={`pill ${round.hit ? 'pill-hit' : 'pill-miss'}`}>
                      {round.hit ? t('report.combatLog.hit') : t('report.combatLog.miss')}
                    </span>
                  </td>
                  <td>
                    {/* The Shield/Armor/Hull columns are always the TARGET's damage, not
                        the attacker's — spelling the target out (colored by side, same as
                        Attacker) removes the need to invert the Attacker column mentally on
                        every row (owner: "show how much damage we take, like we show about
                        the enemy"). */}
                    <span className={`attacker-${round.attacker === 'player' ? 'enemy' : 'player'}`}>
                      {t(`report.combatLog.side.${round.attacker === 'player' ? 'enemy' : 'player'}`)}
                    </span>
                  </td>
                  <td className={round.hit ? 'dmg-shield' : undefined}>
                    {round.hit ? round.shieldAbsorbed : '—'}
                  </td>
                  <td className={round.hit ? 'dmg-armor' : undefined}>
                    {round.hit ? round.armorAbsorbed : '—'}
                  </td>
                  <td className={round.hit ? 'dmg-hull' : undefined}>
                    {round.hit ? round.hullDamage : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
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

/**
 * "Details" tab (S10.8 follow-up, owner request): every part that lost condition during the
 * run, dispatch versus now, as a bar — reuses the same Gauge the repair screen draws its
 * "current → target" preview with, just inverted (value = now, planned = the higher dispatch
 * figure, so the lighter segment reads as what was lost).
 */
function PartsDamageTable({ stats }: { stats: ReportStats }) {
  const { t } = useTranslation();
  const rows = stats.partsDamage;
  return (
    <section className="stack" data-testid="parts-damage">
      <h2>{t('report.detail.partsDamage')}</h2>
      <p className="sub">{t('report.detail.partsDamageIntro')}</p>
      {rows.length === 0 ? (
        <p className="sub">{t('report.detail.noDamage')}</p>
      ) : (
        <ul className="stack parts-damage-list">
          {rows.map((row) => (
            <li key={row.partId} className="parts-damage-row">
              <span className="parts-damage-name">{row.name}</span>
              <Gauge
                value={row.after}
                max={100}
                planned={row.before}
                tone={conditionTone(row.after)}
                ariaLabel={row.name}
                label={`${row.before}% → ${row.after}%`}
              />
              <span className="parts-damage-lost error-text">
                {t('report.detail.lost', { amount: row.before - row.after })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
  const placeArt = usePlaceArt();
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
          style={{ backgroundImage: `url(${placeArtUrl(mission.destinationId, 'wide', placeArt)})` }}
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
                mission.originId === mission.destinationId
                  ? place(mission.originId)
                  : [place(mission.originId), place(mission.destinationId)].join(' → '),
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
              ? // A ship with no shield never has one to report 0 damage to.
                t(
                  stats.hasShield
                    ? 'report.debrief.damageValue'
                    : 'report.debrief.damageValueNoShield',
                  {
                    shield: stats.damage.shield,
                    armor: stats.damage.armor,
                    hull: stats.damage.hull,
                  },
                )
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

      {stats.race !== null && (
        <div className="debrief-race" data-testid="debrief-race">
          <b>{t('report.debrief.raceTitle', { place: stats.race.place })}</b>
          <table className="mcard-race">
            <thead>
              <tr>
                <th>{t('board.race.pilot')}</th>
                <th>{t('board.race.speed')}</th>
                <th>{t('board.race.time')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.race.standings.map((row, index) => (
                <tr key={`${row.name}-${index}`} className={row.you ? 'race-you' : undefined}>
                  <td>
                    {t('board.race.rank', { place: index + 1 })}{' '}
                    {row.you ? t('board.race.you') : row.name}
                  </td>
                  <td>{row.mobility}</td>
                  <td>{formatDuration(row.seconds * (stats.race?.timeScale ?? 1), t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stats.found.length > 0 && (
        <div className="debrief-loot" data-testid="debrief-found">
          <b>{t('report.debrief.found')}</b>
          {stats.found.map((entry, index) => (
            <span key={`${entry.partType}-${index}`} className="loot-chip">
              {entry.kind === 'scrap'
                ? t('report.debrief.foundScrap', { name: entry.name })
                : t('report.debrief.foundPart', { name: entry.name, condition: entry.condition })}
            </span>
          ))}
        </div>
      )}

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
