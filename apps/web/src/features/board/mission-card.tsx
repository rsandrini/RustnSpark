import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MissionOffer, WorldLocation } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { Countdown } from '../../ui/Countdown';
import { formatDuration } from '../../ui/duration';
import { FactionBadge } from '../../ui/FactionBadge';
import { RiskBadge } from '../../ui/RiskBadge';
import { serverNow } from '../../api/client';

export interface MissionCardProps {
  offer: MissionOffer;
  origin: WorldLocation | undefined;
  destination: WorldLocation | undefined;
  /** Fuel aboard, to say whether the trip is affordable. */
  fuelHave?: number;
  mine: boolean;
  actions: ReactNode;
}

// One offer with everything needed to decide: what the job is, where it goes, what it pays, how
// long and how much fuel it takes for THIS ship, what it demands, and whether the ship can take it.
export function MissionCard({
  offer,
  origin,
  destination,
  fuelHave,
  mine,
  actions,
}: MissionCardProps) {
  const { t, i18n } = useTranslation();
  const { info } = offer;
  const title = pickLocalized(info.title, i18n.language);
  const money = (value: number) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`;
  const place = (location: WorldLocation | undefined, fallback: string) =>
    location === undefined ? fallback : pickLocalized(location.displayName, i18n.language);
  const expired = Date.parse(offer.expiresAt) <= serverNow();
  const notEnoughFuel =
    info.estimate !== null && fuelHave !== undefined && info.estimate.fuelNeeded > fuelHave;

  return (
    <article className={`mcard type-${offer.type.toLowerCase()}`}>
      <header className="mcard-head">
        <div>
          <span className="mcard-type">{t(`board.type.${offer.type}`)}</span>
          <h2 className="mcard-title">{title}</h2>
        </div>
        <div className="mcard-reward">
          <b>{money(offer.reward)}</b>
          <small>{t('board.estimate', { amount: money(offer.rewardEstimate) })}</small>
        </div>
      </header>

      <div className="mcard-route">
        <span>{place(origin, offer.originId)}</span>
        <span className="arrow" aria-hidden="true">
          {t('board.arrow')}
        </span>
        <span>{place(destination, offer.destinationId)}</span>
        {destination !== undefined && <RiskBadge band={destination.risk} />}
      </div>

      <p className="mcard-desc">{pickLocalized(info.description, i18n.language)}</p>

      {info.material !== null && (
        <p className="mcard-material">
          {info.material.contracted && info.material.quantity !== null
            ? t('board.mining.contracted', {
                quantity: info.material.quantity,
                material: pickLocalized(info.material.name, i18n.language),
              })
            : t('board.mining.free', {
                material: pickLocalized(info.material.name, i18n.language),
              })}
        </p>
      )}

      <dl className="mcard-facts">
        <div>
          <dt>{t('board.facts.distance')}</dt>
          <dd>{info.totalDistance}</dd>
        </div>
        <div>
          <dt>{t('board.facts.legs')}</dt>
          <dd>{info.legCount}</dd>
        </div>
        <div>
          <dt>{t('board.facts.time')}</dt>
          <dd>{info.estimate === null ? '—' : formatDuration(info.estimate.durationSeconds, t)}</dd>
        </div>
        <div className={notEnoughFuel ? 'bad' : undefined}>
          <dt>{t('board.facts.fuel')}</dt>
          <dd>{info.estimate === null ? '—' : Math.round(info.estimate.fuelNeeded)}</dd>
        </div>
      </dl>
      {notEnoughFuel && <p className="error-text">{t('board.lowFuel')}</p>}

      <p className="mcard-needs">
        <b>{t('board.needsTitle')}</b> {t(`board.needs.${offer.type}`)}
      </p>

      <div className="mcard-meta">
        {origin !== undefined && <FactionBadge factionId={offer.factionId} />}
        <span className="sub">
          {expired ? (
            t('board.expiredLabel')
          ) : (
            <>
              {t('board.expires')} <Countdown until={offer.expiresAt} />
            </>
          )}
        </span>
        <span className={`badge ${offer.eligibility.eligible ? 'ok' : 'warn'}`}>
          {offer.eligibility.eligible ? t('board.eligible') : t('board.blocked')}
        </span>
        {offer.privatePlayerId !== null && (
          <span className="badge ok" data-testid="starter-badge">
            {t('board.starterBadge')}
          </span>
        )}
        {offer.status !== 'AVAILABLE' && (
          <span className="badge">
            {t(`board.status.${offer.status}`)}
            {mine && offer.status === 'HELD' ? '' : ''}
          </span>
        )}
      </div>

      {!offer.eligibility.eligible && (
        <ul className="reasons">
          {offer.eligibility.reasons.map((reason, index) => (
            <li key={`${reason.code}-${index}`}>
              {t(`board.reasons.${reason.code}`, {
                defaultValue: t(`error.${reason.code}`, { defaultValue: reason.message }),
              })}
            </li>
          ))}
        </ul>
      )}

      <footer className="mcard-actions">{actions}</footer>
    </article>
  );
}
