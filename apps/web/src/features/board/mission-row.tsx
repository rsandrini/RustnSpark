import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MissionOffer, WorldLocation, WorldResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { formatDuration } from '../../ui/duration';
import { Countdown } from '../../ui/Countdown';
import { FactionBadge } from '../../ui/FactionBadge';
import { GiverBadge, giverBadgeOf } from '../../ui/GiverBadge';
import { useNow } from '../../ui/useNow';
import { RiskBadge } from '../../ui/RiskBadge';
import { scaleSpeed, useDisplay } from '../../ui/display';
import { fuelStatus } from './fuel-status';
import { MissionCard } from './mission-card';
import { RouteMap, pathOfLegs } from '../../ui/RouteMap';
import { usePrologueMode } from '../prologue/prologue-mode';

const DOT = ' · ';
const CROSS = '✗';
const CHEVRON = '▸';

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
  const opening = usePrologueMode().active;
  const expired = Date.parse(offer.expiresAt) <= useNow(true);
  const blocked = !taken && !offer.eligibility.eligible;
  const burnsFuel = fuelUse === undefined || fuelUse > 0;
  const number = (value: number, unit: string | undefined) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
      unit === 'mobility' ? scaleSpeed(value, display) : value,
    );

  const unmet = info.requirements.filter((req) => !req.met);
  const fuel =
    info.estimate !== null &&
    burnsFuel &&
    fuelHave !== undefined &&
    fuelCap !== undefined &&
    fuelCap > 0
      ? fuelStatus(fuelHave, info.estimate.fuelNeeded, fuelCap)
      : null;
  // the card's edge says whether the offer can be taken: green, yellow (needs fuel) or red (blocked)
  const state = taken
    ? 'taken'
    : blocked || fuel?.state === 'tank'
      ? 'blocked'
      : fuel?.state === 'short'
        ? 'short'
        : 'ok';
  const [open, setOpen] = useState(false);

  return (
    <li
      className={`mrow type-${offer.type.toLowerCase()} state-${state}${tag !== undefined ? ' pinned' : ''}`}
      data-testid={tag !== undefined ? 'board-active-mission' : undefined}
    >
      <div className="mrow-main">
        <div className="mrow-body">
          <div className="mrow-head">
            <div className="mrow-type">
              {tag !== undefined && <span className="mrow-tag">{tag}</span>}
              <span className="mrow-pip" aria-hidden="true" />
              {t(`board.type.${offer.type}`)}
              {origin !== undefined && <FactionBadge factionId={offer.factionId} />}
              {offer.privatePlayerId !== null && (
                <span className="badge ok">{t('board.starterBadge')}</span>
              )}
              {offer.status !== 'AVAILABLE' && (
                <span className="badge">{t(`board.status.${offer.status}`)}</span>
              )}
              {!opening && (!taken || offer.status === 'ACCEPTED' || offer.status === 'HELD') && (
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
            </div>
            <h2 className="mrow-title">{pickLocalized(info.title, i18n.language)}</h2>
            <p className="mrow-route">
              {place(origin, offer.originId)}
              <span aria-hidden="true"> {t('board.arrow')} </span>
              {place(destination, offer.destinationId)}
              <span className="mrow-dist">
                {DOT}
                {t('distanceValue', { n: info.totalDistance })}
              </span>
            </p>
            {/* The face on the row (plan §1); none for offers from before givers. */}
            {info.giver != null && (
              <p className="mrow-giver">
                <GiverBadge {...giverBadgeOf(info.giver, i18n.language)} />
              </p>
            )}
          </div>

          {/* the decision: what it pays, how long, how much fuel */}
          <div className="mrow-key">
            <b className="mrow-reward">{money(offer.reward)}</b>
            <span className="mrow-fig">
              {info.estimate === null ? '—' : formatDuration(info.estimate.durationSeconds, t)}
            </span>
            {info.estimate !== null && burnsFuel && (
              <span className={`mrow-fig${fuel !== null && fuel.state !== 'ok' ? ' warn' : ''}`}>
                {t('board.fuelUses', { needed: Math.round(info.estimate.fuelNeeded) })}
              </span>
            )}
            {destination !== undefined && destination.risk !== 'lo' && (
              <RiskBadge band={destination.risk} />
            )}
          </div>

          {/* what stops the pilot, said once */}
          {!taken && unmet.length > 0 && (
            <ul className="mrow-why bad" aria-label={t('board.needsTitle')}>
              {unmet.map((req) => (
                <li key={req.code}>
                  <span aria-hidden="true">{CROSS}</span>{' '}
                  {t(`board.requirements.${req.code}`, { defaultValue: req.message })}
                  {req.needed !== undefined && req.actual !== undefined && (
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
          )}
          {fuel !== null && fuel.state !== 'ok' && (
            <p className="mrow-why warn">
              <span
                className={`fuel-chip fuel-${fuel.state}`}
                data-testid="fuel-chip"
                data-state={fuel.state}
              >
                {t(`board.fuel.chip.${fuel.state}`, { missing: fuel.missing })}
              </span>
            </p>
          )}

          <div className="mrow-foot">
            <button
              type="button"
              className="mrow-toggle"
              aria-expanded={open}
              onClick={() => setOpen((was) => !was)}
            >
              <span className="mrow-chev" aria-hidden="true">
                {CHEVRON}
              </span>
              {t('board.details')}
            </button>
            <div className="mrow-actions">{actions}</div>
          </div>
        </div>
        {/* the route fills the right column of the card, top to bottom */}
        <div className="mrow-map">
          <RouteMap path={pathOfLegs(offer.legs, world, offer.originId)} world={world} />
        </div>
      </div>

      {/* in the opening the map and the numbers are shown at once: that is what the pilot weighs */}
      <div className={`mrow-details${open ? ' open' : ''}`}>
        <MissionCard
          offer={offer}
          origin={origin}
          destination={destination}
          mine={mine}
          actions={null}
          foldDetails={false}
          hideMap
          taken={taken}
          {...(fuelHave !== undefined ? { fuelHave } : {})}
          {...(fuelCap !== undefined ? { fuelCap } : {})}
          {...(fuelUse !== undefined ? { fuelUse } : {})}
          {...(world !== undefined ? { world } : {})}
          {...(engineLevels !== undefined ? { engineLevels } : {})}
        />
      </div>
    </li>
  );
}
