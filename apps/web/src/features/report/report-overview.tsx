import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReportMission, ReportStats, WorldResponse } from '../../api/generated';
import { RouteMap, pathOfLegs } from '../../ui/RouteMap';

const ANIMATION_DELAY_MS = 350;
const FULL = 100;

/**
 * A bar that plays the loss: it starts at the level before and sinks to the level after, with the
 * part that was lost left showing in red behind it. (With reduced motion it just shows the end.)
 */
function LossBar({
  before,
  after,
  max,
  label,
  tone,
}: {
  before: number;
  after: number;
  max: number;
  label: string;
  tone: 'ok' | 'warn' | 'bad';
}) {
  const [shown, setShown] = useState(before);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(after), ANIMATION_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [after]);
  const percent = (value: number) =>
    `${Math.round(Math.min(FULL, Math.max(0, (value / max) * FULL)) * FULL) / FULL}%`;
  return (
    <div
      className={`lossbar ${tone}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={after}
      aria-label={label}
    >
      <div className="lossbar-lost" style={{ width: percent(before) }} />
      <div className="lossbar-fill" style={{ width: percent(shown) }} />
    </div>
  );
}

function conditionTone(value: number): 'ok' | 'warn' | 'bad' {
  const LOW = 30;
  const MID = 60;
  return value < LOW ? 'bad' : value < MID ? 'warn' : 'ok';
}

// The run at a glance: where it went, what the trip cost the ship on the way and in fights, and
// which parts paid for it (their condition sinking from what it was to what it is now).
export function ReportOverview({
  stats,
  mission,
  world,
}: {
  stats: ReportStats;
  mission: ReportMission | undefined;
  world: WorldResponse | undefined;
}) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  const path =
    mission === undefined
      ? []
      : pathOfLegs(
          (mission.routeIds ?? []).map((routeId) => ({ routeId })),
          world,
          mission.originId,
        );
  const combat = stats.damage;
  const combatMax = Math.max(1, combat.shield, combat.armor, combat.hull);
  const combatTotal = combat.shield + combat.armor + combat.hull;
  const wear = stats.travelWear;

  return (
    <section className="stack report-overview" data-testid="report-overview">
      {path.length > 1 && <RouteMap path={path} world={world} />}

      <div className="damage-split">
        <article className="panel" data-testid="damage-combat">
          <h2>{t('report.overview.combatTitle')}</h2>
          {combatTotal === 0 ? (
            <p className="sub">{t('report.overview.noCombatDamage')}</p>
          ) : (
            <ul className="stack">
              {(['shield', 'armor', 'hull'] as const)
                .filter((layer) => layer !== 'shield' || stats.hasShield)
                .map((layer) => (
                  <li key={layer} className="loss-row">
                    <span>{t(`report.overview.layer.${layer}`)}</span>
                    <LossBar
                      before={0}
                      after={combat[layer]}
                      max={combatMax}
                      label={t(`report.overview.layer.${layer}`)}
                      tone="bad"
                    />
                    <b className="error-text">{number(combat[layer])}</b>
                  </li>
                ))}
            </ul>
          )}
        </article>

        <article className="panel" data-testid="damage-travel">
          <h2>{t('report.overview.travelTitle')}</h2>
          {wear.points === 0 ? (
            <p className="sub">{t('report.overview.noWear')}</p>
          ) : (
            <p>
              {t('report.overview.wear', { points: number(wear.points), parts: wear.parts })}
            </p>
          )}
          <p className="sub">{t('report.overview.travelNote')}</p>
        </article>
      </div>

      <article className="panel" data-testid="parts-damage">
        <h2>{t('report.detail.partsDamage')}</h2>
        <p className="sub">{t('report.detail.partsDamageIntro')}</p>
        {stats.partsDamage.length === 0 ? (
          <p className="sub">{t('report.detail.noDamage')}</p>
        ) : (
          <ul className="stack parts-damage-list">
            {stats.partsDamage.map((row) => (
              <li key={row.partId} className="parts-damage-row">
                <span className="parts-damage-name">{row.name}</span>
                <LossBar
                  before={row.before}
                  after={row.after}
                  max={FULL}
                  label={row.name}
                  tone={conditionTone(row.after)}
                />
                <span className="parts-damage-lost">
                  {t('report.overview.fromTo', { before: row.before, after: row.after })}{' '}
                  <b className="error-text">{t('report.detail.lost', { amount: row.before - row.after })}</b>
                </span>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
