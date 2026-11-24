import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TravelQuote, WorldLocation } from '../../api/generated';
import { errorText } from '../../api/errors';
import { pickLocalized } from '../../i18n/localized';
import { formatDuration } from '../../ui/duration';
import { factionName, useFactions } from '../../ui/factions';
import { GiverBadge } from '../../ui/GiverBadge';
import { BlockerChip } from '../../ui/kit/BlockerChip';
import { RiskPips } from '../../ui/kit/RiskPips';
import { fuelStatus } from '../board/fuel-status';
import { fixHref, fuelFix } from '../board/requirement-fix';
import { useFlyTo } from './use-travel';

const LEVEL = { lo: 1, md: 2, hi: 3 } as const;
const DOT = ' · ';

export interface PlaceSheetProps {
  place: WorldLocation;
  /** The server's price of the trip; undefined while loading or when there is nothing to price. */
  quote: TravelQuote | undefined;
  quoteLoading: boolean;
  hasShip: boolean;
  inFlight: boolean;
  /** The ship is docked at this very place. */
  isHere: boolean;
  /** The ship's fuel burn rate (0 = pure ion: no fuel to show). */
  fuelUse?: number | undefined;
  /** The full details (mining, services, missions), shown by the Details toggle. */
  details: ReactNode;
  onClose: () => void;
}

/** The sheet over the chart's bottom: who runs the place, what the trip costs and the Plan trip button. */
export function PlaceSheet({
  place,
  quote,
  quoteLoading,
  hasShip,
  inFlight,
  isHere,
  fuelUse,
  details,
  onClose,
}: PlaceSheetProps) {
  const { t, i18n } = useTranslation();
  const factions = useFactions().byId;
  const fly = useFlyTo(place.id);
  const [open, setOpen] = useState(false);
  const name = pickLocalized(place.displayName, i18n.language);
  const faction =
    factionName(factions[place.factionId], i18n.language) ??
    t(`factions.${place.factionId}`, { defaultValue: t('factions.independent') });
  const type = t(`map.types.${place.type}`, { defaultValue: place.type });
  const priced = quote !== undefined && quote.legs.length > 0;
  const burnsFuel = fuelUse === undefined || fuelUse > 0;
  const fuel = priced
    ? fuelStatus(
        quote.fuelHave,
        quote.fuelNeeded,
        Math.max(quote.fuelCap ?? 0, Math.round(quote.fuelNeeded)),
      )
    : undefined;
  const fuelHref = fuel === undefined ? undefined : fixHref(fuelFix(fuel.state));
  const fuelLow = burnsFuel && fuel !== undefined && fuel.state !== 'ok';

  // Why the button is off, in words (null when it is just busy or loading).
  const reason: string | null = !hasShip
    ? t('map.sheet.noShip')
    : inFlight
      ? t('map.sheet.flying')
      : fuelLow
        ? t(fuel.state === 'tank' ? 'map.sheet.tankSmall' : 'map.sheet.fuelShort', {
            missing: fuel.missing,
          })
        : quote !== undefined && quote.blockers.length > 0
          ? t(`map.travel.blockers.${quote.blockers[0]}`)
          : null;
  const canGo = hasShip && !inFlight && quote !== undefined && quote.canDepart && !fuelLow;

  return (
    <section className="place-sheet" aria-label={name} data-testid="place-sheet">
      <header className="place-sheet-head">
        <GiverBadge
          name={name}
          title={`${faction}${DOT}${type}`}
          factionId={place.factionId}
          size="row"
        />
        <button type="button" className="btn" onClick={onClose}>
          {t('ui.close')}
        </button>
      </header>
      <p className="sub place-sheet-line">
        <Link to={`/missions?location=${place.id}`} data-testid="sheet-contracts">
          {t('map.sheet.contracts', { count: place.missionCount })}
        </Link>
        {isHere && (
          <>
            {DOT}
            <b>{t('map.youAreHere')}</b>
          </>
        )}
      </p>
      {!isHere && (
        <>
          <div className="place-sheet-stats">
            {quoteLoading && <span className="sub">{t('loading')}</span>}
            {priced && (
              <>
                <span className="place-sheet-stat" data-testid="sheet-time">
                  <small>{t('map.travel.time')}</small>
                  <b>{formatDuration(quote.durationSeconds, t)}</b>
                </span>
                {burnsFuel && fuel !== undefined && (
                  <span className="place-sheet-stat" data-testid="sheet-fuel">
                    <small>{t('map.travel.fuel')}</small>
                    {fuelLow ? (
                      <BlockerChip
                        label={t('map.sheet.fuelNeeded', { needed: fuel.needed, have: fuel.have })}
                        {...(fuelHref === undefined ? {} : { to: fuelHref })}
                        testId="sheet-fuel-chip"
                      />
                    ) : (
                      <b>{t('map.sheet.fuelOk', { needed: fuel.needed })}</b>
                    )}
                  </span>
                )}
              </>
            )}
            <span className="place-sheet-stat">
              <small>{t('map.sheet.risk')}</small>
              <span className="place-sheet-risk">
                <RiskPips level={LEVEL[place.risk]} label={t(`ui.risk.${place.risk}`)} />
                <b>{t(`ui.risk.${place.risk}`)}</b>
              </span>
            </span>
          </div>
          {fly.isError && (
            <p className="error-text" role="alert">
              {errorText(t, fly.error, t('map.travel.failed'))}
            </p>
          )}
          <button
            type="button"
            className="btn primary block"
            disabled={!canGo || fly.isPending}
            aria-describedby={reason === null ? undefined : 'place-sheet-reason'}
            onClick={() => fly.mutate()}
          >
            {t('map.sheet.plan')}
          </button>
          {reason !== null && (
            <p
              className="sub place-sheet-reason"
              id="place-sheet-reason"
              data-testid="sheet-reason"
            >
              {reason}
            </p>
          )}
        </>
      )}
      <button
        type="button"
        className="btn place-sheet-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? t('map.sheet.hideDetails') : t('map.sheet.details')}
      </button>
      {open && <div className="place-sheet-details">{details}</div>}
    </section>
  );
}
