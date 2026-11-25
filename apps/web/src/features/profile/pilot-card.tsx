import { useTranslation } from 'react-i18next';
import type { PublicProfileResponse } from '../../api/generated';
import { ShipRadar } from '../../ui/kit/ShipRadar';
import { FactionBadge } from '../../ui/FactionBadge';
import { PilotAvatar } from './pilot-avatar';
import { pilotNumbersOf } from './pilot-numbers';

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
  const n = pilotNumbersOf(profile);

  const typeName = t(`hangar.classes.${profile.ship?.shipClass ?? ''}`, {
    defaultValue: profile.ship?.shipClass ?? '',
  });
  const modifier = profile.ship?.profileModifier;
  const classLabel = modifier
    ? t('hangar.classWithModifier', {
        type: typeName,
        modifier: t(`hangar.classModifier.${modifier}`),
      })
    : typeName;
  const bridgeRarityLabel = t(`market.rarities.${profile.ship?.bridgeRarity ?? ''}`, {
    defaultValue: profile.ship?.bridgeRarity ?? '',
  });

  return (
    <article className="pilot-card">
      <header className="pilot-header">
        <PilotAvatar name={profile.name} factionId={profile.factionId} size={56} />
        <div className="pilot-ident">
          <h2 className="pilot-name">{profile.name}</h2>
          {profile.factionId !== null && <FactionBadge factionId={profile.factionId} />}
        </div>
      </header>

      {profile.ship !== null && (
        <section className="pilot-ship">
          <div className="pilot-ship-text">
            <h3 className="pilot-ship-title">{profile.ship.title}</h3>
            <p className="pilot-ship-meta">
              {classLabel}
              {SEPARATOR}
              {bridgeRarityLabel} {t('profile.stats.bridge')}
            </p>
          </div>
          {profile.ship.profile !== undefined && (
            <ShipRadar values={profile.ship.profile} size={120} label={t('hangar.profile.title')} />
          )}
        </section>
      )}

      {!n.hasFlown ? (
        <p className="pilot-empty">{t('profile.stats.noFlights')}</p>
      ) : (
        <>
          <dl className="pilot-stats">
            <div className="pilot-stat">
              <dt>{t('profile.stats.missions')}</dt>
              <dd>{numberFormat.format(n.missions)}</dd>
            </div>
            <div className="pilot-stat">
              <dt>{t('profile.stats.successRate')}</dt>
              <dd>{n.successPct !== null ? percentFormat.format(n.successPct) : '—'}</dd>
            </div>
            <div className="pilot-stat">
              <dt>{t('profile.stats.distance')}</dt>
              <dd>{numberFormat.format(n.distance)}</dd>
            </div>
            <div className="pilot-stat">
              <dt>{t('profile.stats.raceWins')}</dt>
              <dd>{numberFormat.format(n.raceWins)}</dd>
            </div>
          </dl>
          <dl className="pilot-details">
            <div>
              <dt>{t('profile.stats.fightsWon')}</dt>
              <dd>{numberFormat.format(n.fightsWon)}</dd>
            </div>
            <div>
              <dt>{t('profile.stats.races')}</dt>
              <dd>
                {t('profile.stats.racesValue', {
                  entered: totals['races.entered'] ?? 0,
                  won: n.raceWins,
                  podium: totals['races.podium'] ?? 0,
                })}
              </dd>
            </div>
            <div>
              <dt>{t('profile.stats.bestRacePlace')}</dt>
              <dd>{n.bestRacePlace !== null ? numberFormat.format(n.bestRacePlace) : '—'}</dd>
            </div>
          </dl>
        </>
      )}

      {/* Reserved for the pilot's rank and medals: no such system exists yet, so this renders nothing. */}
    </article>
  );
}
