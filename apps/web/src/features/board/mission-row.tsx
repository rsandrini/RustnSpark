import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MissionOffer, WorldLocation, WorldResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { formatDuration } from '../../ui/duration';
import { Countdown } from '../../ui/Countdown';
import { FactionBadge } from '../../ui/FactionBadge';
import { useNow } from '../../ui/useNow';
import { RiskBadge } from '../../ui/RiskBadge';
import { scaleSpeed, useDisplay } from '../../ui/display';
import { MissionCard } from './mission-card';

const DOT = ' · ';

export interface MissionRowProps {
  offer: MissionOffer;
  origin: WorldLocation | undefined;
  destination: WorldLocation | undefined;
  fuelHave?: number;
  fuelCap?: number;
  fuelUse?: number;
  world?: WorldResponse;
  mine: boolean;
  /** Accept / Hold / Release (or "Go to ship" on the pinned row), shown in the pay column. */
  actions: ReactNode;
  /** The mission already taken: pinned row with this tag, no eligibility verdict. */
  tag?: string;
  taken?: boolean;
  engineLevels?: { chem: number; ion: number };
}

/** One offer as a line to scan: what, where, what it asks, what it costs, what it pays. The whole
    card sits behind "Details", so every fact and test id the card carries is still in the page. */
export function MissionRow({
  offer,
  origin,
  destination,
  fuelHave,
  fuelCap,
  fuelUse,
  world,
  mine,
  actions,
  tag,
  taken = false,
  engineLevels,
}: MissionRowProps) {
  const { t, i18n } = useTranslation();
  const display = useDisplay();
  const { info } = offer;
  const money = (value: number) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`;
  const place = (location: WorldLocation | undefined, fallback: string) =>
    location === undefined ? fallback : pickLocalized(location.displayName, i18n.language);
  const expired = Date.parse(offer.expiresAt) <= useNow(true);
  const blocked = !taken && !offer.eligibility.eligible;
  const burnsFuel = fuelUse === undefined || fuelUse > 0;
  const number = (value: number, unit: string | undefined) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
      unit === 'mobility' ? scaleSpeed(value, display) : value,
    );

  return (
    <li
      className={`mrow type-${offer.type.toLowerCase()}${blocked ? ' dim' : ''}${tag !== undefined ? ' pinned' : ''}`}
      data-testid={tag !== undefined ? 'board-active-mission' : undefined}
    >
      <div className="mrow-main">
        <div className="mrow-type">
          {tag !== undefined && <span className="mrow-tag">{tag}</span>}
          <span className="mrow-pip" aria-hidden="true" />
          {t(`board.type.${offer.type}`)}
        </div>

        <div className="mrow-job">
          <h3 className="mrow-title">{pickLocalized(info.title, i18n.language)}</h3>
          <p className="mrow-route">
            {place(origin, offer.originId)}
            <span aria-hidden="true"> {t('board.arrow')} </span>
            {place(destination, offer.destinationId)}
            <span className="mrow-dist">
              {DOT}
              {info.totalDistance}
            </span>
          </p>
          <p className="mrow-badges">
            {origin !== undefined && <FactionBadge factionId={offer.factionId} />}
            {(!taken || offer.status === 'ACCEPTED' || offer.status === 'HELD') && (
              <span className="mrow-expires">
                {expired ? (
                  t('board.expiredLabel')
                ) : (
                  <>
                    {t(taken ? 'board.startBefore' : 'board.expires')}{' '}
                    <Countdown until={offer.expiresAt} />
                  </>
                )}
              </span>
            )}
            {!taken && (
              <span className={`badge ${offer.eligibility.eligible ? 'ok' : 'warn'}`}>
                {offer.eligibility.eligible ? t('board.eligible') : t('board.blocked')}
              </span>
            )}
            {offer.privatePlayerId !== null && (
              <span className="badge ok">{t('board.starterBadge')}</span>
            )}
            {offer.status !== 'AVAILABLE' && (
              <span className="badge">{t(`board.status.${offer.status}`)}</span>
            )}
          </p>
        </div>

        <ul className="mrow-needs" aria-label={t('board.needsTitle')}>
          {info.requirements.map((req) => (
            <li key={req.code} className={req.met ? 'met' : 'unmet'}>
              <span aria-hidden="true">{req.met ? '✓' : '✗'}</span>{' '}
              {t(`board.requirements.${req.code}`, { defaultValue: req.message })}
              {!req.met && req.needed !== undefined && req.actual !== undefined && (
                <small>
                  {' '}
                  {t('board.requirementNumbers', {
                    actual: number(req.actual, req.unit),
                    needed: number(req.needed, req.unit),
                  })}
                </small>
              )}
            </li>
          ))}
        </ul>

        <div className="mrow-trip">
          <span>
            {info.estimate === null ? '—' : formatDuration(info.estimate.durationSeconds, t)}
          </span>
          {info.estimate !== null && burnsFuel && (
            <span>{t('board.fuelUses', { needed: Math.round(info.estimate.fuelNeeded) })}</span>
          )}
          {destination !== undefined && <RiskBadge band={destination.risk} />}
        </div>

        <div className="mrow-pay">
          <b className="mrow-reward">{money(offer.reward)}</b>
          <div className="mrow-actions">{actions}</div>
        </div>
      </div>

      <details className="mrow-details">
        <summary>{t('board.details')}</summary>
        <MissionCard
          offer={offer}
          origin={origin}
          destination={destination}
          mine={mine}
          actions={null}
          taken={taken}
          {...(fuelHave !== undefined ? { fuelHave } : {})}
          {...(fuelCap !== undefined ? { fuelCap } : {})}
          {...(fuelUse !== undefined ? { fuelUse } : {})}
          {...(world !== undefined ? { world } : {})}
          {...(engineLevels !== undefined ? { engineLevels } : {})}
        />
      </details>
    </li>
  );
}
