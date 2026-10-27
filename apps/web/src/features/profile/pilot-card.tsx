import { useTranslation } from 'react-i18next';
import type { PublicProfileResponse } from '../../api/generated';
import { FactionBadge } from '../../ui/FactionBadge';

export interface PilotCardProps {
  profile: PublicProfileResponse;
}

const SEPARATOR = ' · ';

function raceTimeText(seconds: number | null, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return t('profile.stats.raceTimeValue', { m: minutes, s: remainder });
}

export function PilotCard({ profile }: PilotCardProps) {
  const { t, i18n } = useTranslation();
  const numberFormat = new Intl.NumberFormat(i18n.language);
  const percentFormat = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 1,
  });

  const totals = profile.totals;
  const missions = totals['missions.started'] ?? 0;
  const hasFlown = missions > 0;

  const classLabel = t(`hangar.classes.${profile.ship?.shipClass ?? ''}`, {
    defaultValue: profile.ship?.shipClass ?? '',
  });
  const bridgeRarityLabel = t(`market.rarities.${profile.ship?.bridgeRarity ?? ''}`, {
    defaultValue: profile.ship?.bridgeRarity ?? '',
  });

  const joinedDate = new Date(profile.joinedAt).toLocaleDateString(i18n.language, {
    dateStyle: 'medium',
  });

  return (
    <article className="pilot-card">
      <header className="pilot-header">
        <h2 className="pilot-name">{profile.name}</h2>
        {profile.factionId !== null && <FactionBadge factionId={profile.factionId} />}
        <p className="pilot-joined">
          {t('profile.stats.joinedAt', { date: joinedDate })}
        </p>
      </header>

      {profile.ship !== null && (
        <section className="pilot-ship">
          <h3 className="pilot-ship-title">{profile.ship.title}</h3>
          <p className="pilot-ship-meta">
            {classLabel}
            {SEPARATOR}
            {bridgeRarityLabel} {t('profile.stats.bridge')}
          </p>
        </section>
      )}

      {!hasFlown ? (
        <p className="pilot-empty">{t('profile.stats.noFlights')}</p>
      ) : (
        <dl className="pilot-stats">
          <div className="pilot-stat">
            <dt>{t('profile.stats.missions')}</dt>
            <dd>{numberFormat.format(missions)}</dd>
          </div>
          <div className="pilot-stat">
            <dt>{t('profile.stats.successRate')}</dt>
            <dd>
              {profile.successRate !== null
                ? percentFormat.format(profile.successRate)
                : '—'}
            </dd>
          </div>
          <div className="pilot-stat">
            <dt>{t('profile.stats.distance')}</dt>
            <dd>{numberFormat.format(totals['flight.distance'] ?? 0)}</dd>
          </div>
          <div className="pilot-stat">
            <dt>{t('profile.stats.fightsWon')}</dt>
            <dd>{numberFormat.format(totals['fights.won'] ?? 0)}</dd>
          </div>
          <div className="pilot-stat">
            <dt>{t('profile.stats.races')}</dt>
            <dd>
              {t('profile.stats.racesValue', {
                entered: totals['races.entered'] ?? 0,
                won: totals['races.won'] ?? 0,
                podium: totals['races.podium'] ?? 0,
              })}
            </dd>
          </div>
          <div className="pilot-stat">
            <dt>{t('profile.stats.bestRacePlace')}</dt>
            <dd>
              {profile.records['best.race_place'] !== undefined
                ? numberFormat.format(profile.records['best.race_place'].value)
                : '—'}
            </dd>
          </div>
          <div className="pilot-stat">
            <dt>{t('profile.stats.fastestRace')}</dt>
            <dd>{raceTimeText(profile.records['best.race_seconds']?.value ?? null, t)}</dd>
          </div>
          <div className="pilot-stat">
            <dt>{t('profile.stats.scavengeRuns')}</dt>
            <dd>
              {t('profile.stats.scavengeRunsValue', {
                ship: totals['scavenge.ship_runs'] ?? 0,
                foot: totals['scavenge.foot_runs'] ?? 0,
              })}
            </dd>
          </div>
        </dl>
      )}
    </article>
  );
}
