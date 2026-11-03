import { useTranslation } from 'react-i18next';
import type { PublicProfileResponse } from '../../api/generated';
import { FactionBadge } from '../../ui/FactionBadge';

export interface PilotCardProps {
  profile: PublicProfileResponse;
}

const SEPARATOR = ' · ';

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

  return (
    <article className="pilot-card">
      <header className="pilot-header">
        <h2 className="pilot-name">{profile.name}</h2>
        {profile.factionId !== null && <FactionBadge factionId={profile.factionId} />}
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
              {profile.successRate !== null ? percentFormat.format(profile.successRate) : '—'}
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
        </dl>
      )}
    </article>
  );
}
