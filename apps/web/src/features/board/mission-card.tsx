import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DisplayResponse,
  MissionOffer,
  WorldLocation,
  WorldResponse,
} from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { Countdown } from '../../ui/Countdown';
import { formatDuration } from '../../ui/duration';
import { FactionBadge } from '../../ui/FactionBadge';
import { RiskBadge } from '../../ui/RiskBadge';
import { Gauge } from '../../ui/Gauge';
import { scaleSpeed, useDisplay } from '../../ui/display';
import { RouteMap, pathOfLegs } from '../../ui/RouteMap';
import { factionName, useFactions } from '../../ui/factions';
import { serverNow } from '../../api/client';

/** The game compares whole-number speeds: "needs 3" means 2.5 or more on the unrounded sheet. */
const HALF = 0.5;

export interface MissionCardProps {
  offer: MissionOffer;
  origin: WorldLocation | undefined;
  destination: WorldLocation | undefined;
  /** Fuel aboard, to say whether the trip is affordable. */
  fuelHave?: number;
  /** Tank size, to draw the fuel-aboard bar the trip's cost is carved out of. */
  fuelCap?: number;
  mine: boolean;
  actions: ReactNode;
  /** The sector map, for the route drawing (the card reads it itself when not given). */
  world?: WorldResponse;
}

/** A requirement figure as the player reads it: mobility on the display scale (like the ship sheet),
    everything else as it is. */
function requirementNumber(
  value: number,
  unit: string | undefined,
  display: DisplayResponse,
): string {
  const shown = unit === 'mobility' ? scaleSpeed(value, display) : value;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(shown);
}

// One offer with everything needed to decide: what the job is, where it goes, what it pays, how
// long and how much fuel it takes for THIS ship, what it demands, and whether the ship can take it.
export function MissionCard({
  offer,
  origin,
  destination,
  fuelHave,
  fuelCap,
  mine,
  actions,
  world,
}: MissionCardProps) {
  const { t, i18n } = useTranslation();
  const { info } = offer;
  const factions = useFactions().byId;
  const display = useDisplay();
  const title = pickLocalized(info.title, i18n.language);
  const money = (value: number) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`;
  const place = (location: WorldLocation | undefined, fallback: string) =>
    location === undefined ? fallback : pickLocalized(location.displayName, i18n.language);
  // Owner request: "show destination area controller in quests, hover on place name" — the
  // controlling faction as a native title tooltip, so it reads without opening anything.
  const controllerHint = (location: WorldLocation | undefined): string | undefined =>
    location === undefined
      ? undefined
      : t('board.controlledBy', {
          faction:
            factionName(factions[location.factionId], i18n.language) ??
            t(`factions.${location.factionId}`, { defaultValue: t('factions.independent') }),
        });
  const expired = Date.parse(offer.expiresAt) <= serverNow();
  // info.requirements is the full checklist (met + unmet); eligibility.reasons also carries
  // general blocking reasons (viability, no ship, already on a mission). Anything the
  // checklist already names is dropped from the old reasons list below, so neither duplicates
  // the other on screen.
  const requirementCodes = new Set(offer.info.requirements.map((req) => req.code));
  const otherReasons = offer.eligibility.reasons.filter(
    (reason) => !requirementCodes.has(reason.code),
  );
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
          {/* The estimate is only worth a second line when it actually differs from the
              reward — showing the same number twice was noise (owner: "kinda bullshit if
              it's all equal"). */}
          {offer.rewardEstimate !== offer.reward && (
            <small>{t('board.estimate', { amount: money(offer.rewardEstimate) })}</small>
          )}
        </div>
      </header>

      <div className="mcard-route">
        <span title={controllerHint(origin)}>{place(origin, offer.originId)}</span>
        <span className="arrow" aria-hidden="true">
          {t('board.arrow')}
        </span>
        <span title={controllerHint(destination)}>{place(destination, offer.destinationId)}</span>
        {destination !== undefined && <RiskBadge band={destination.risk} />}
      </div>

      <p className="mcard-desc">{pickLocalized(info.description, i18n.language)}</p>

      <RouteMap path={pathOfLegs(offer.legs, world, offer.originId)} world={world} compact />

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

      {info.race !== null && <RaceField race={info.race} reward={offer.reward} money={money} />}

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
      </dl>

      <div className="mcard-needs">
        <b>{t('board.needsTitle')}</b>
        {offer.info.requirements.length === 0 ? (
          <span> {t(`board.needs.${offer.type}`)}</span>
        ) : (
          <ul className="mcard-requirements">
            {offer.info.requirements.map((req) => (
              <li key={req.code} className={req.met ? 'req-met' : 'req-unmet'}>
                <span className={`badge ${req.met ? 'ok' : 'warn'}`} aria-hidden="true">
                  {req.met ? '✓' : '✗'}
                </span>
                {t(`board.requirements.${req.code}`, { defaultValue: req.message })}
                {req.needed !== undefined && req.actual !== undefined && (
                  <span className="req-numbers" data-testid={`req-${req.code}`}>
                    {t('board.requirementNumbers', {
                      actual: requirementNumber(req.actual, req.unit, display),
                      needed: requirementNumber(req.needed, req.unit, display),
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Fuel moved out of the facts grid (owner: cards were "broken" — a fuel bar's label
          text has no room in a narrow 1/4-width grid cell) and placed after what the mission
          needs, as its own full-width row. */}
      {info.estimate !== null && (
        <div className={`mcard-fuel${notEnoughFuel ? ' bad' : ''}`}>
          <span className="k">{t('board.facts.fuel')}</span>
          {fuelHave !== undefined && fuelCap !== undefined && fuelCap > 0 ? (
            <>
              {/* The fuel aboard as a bar, not just a number: the amount this trip would burn is
                  carved out of the current fill in a highlighted colour. The in-bar label stays
                  short (a bar has no room for a sentence, even a full-width one); the full
                  wording is still the accessible name, and "uses N" sits beside the bar where
                  there's no width limit. */}
              <Gauge
                value={fuelHave}
                max={fuelCap}
                remainingAfter={fuelHave - info.estimate.fuelNeeded}
                tone={notEnoughFuel ? 'bad' : 'fuel'}
                ariaLabel={t('board.facts.fuel')}
                label={`${Math.round(fuelHave)}/${Math.round(fuelCap)}`}
              />
              <span className="mcard-fuel-need">
                {t('board.fuelUses', { needed: Math.round(info.estimate.fuelNeeded) })}
              </span>
            </>
          ) : (
            <b>{Math.round(info.estimate.fuelNeeded)}</b>
          )}
        </div>
      )}
      {notEnoughFuel && info.estimate !== null && (
        <p className="error-text">
          {fuelCap !== undefined && info.estimate.fuelNeeded > fuelCap
            ? t('board.lowFuelCapacity', {
                needed: Math.round(info.estimate.fuelNeeded),
                cap: Math.round(fuelCap),
              })
            : t('board.lowFuel')}
        </p>
      )}

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

      {otherReasons.length > 0 && (
        <ul className="reasons">
          {otherReasons.map((reason, index) => (
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

// A race offer's grid: every rival's speed and how long it should take over this route (its
// expected time and its best day: form, luck and trouble make the real result differ), with the
// viewer's own ship ranked among them, plus the prize per place.
function RaceField({
  race,
  reward,
  money,
}: {
  race: NonNullable<MissionOffer['info']['race']>;
  reward: number;
  money: (value: number) => string;
}) {
  const { t, i18n } = useTranslation();
  const display = useDisplay();
  const speed = (raw: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
      scaleSpeed(raw, display),
    );
  const rows = [
    ...race.rivals.map((rival) => ({
      key: rival.name,
      name: rival.name,
      mobility: rival.mobility,
      expected: rival.durationSeconds,
      best: rival.bestSeconds,
      you: false,
    })),
    {
      key: 'you',
      name: t('board.race.you'),
      mobility: null as number | null,
      expected: race.you?.durationSeconds ?? null,
      best: race.you?.bestSeconds ?? null,
      you: true,
    },
  ].sort((a, b) => (a.expected ?? Infinity) - (b.expected ?? Infinity));
  const topShare = race.prizeShares[0] ?? 1;
  return (
    <section className="mcard-race" aria-label={t('board.race.title')} data-testid="race-field">
      <b>{t('board.race.title')}</b>
      <table>
        <thead>
          <tr>
            <th>{t('board.race.pilot')}</th>
            <th>{t('board.race.speed')}</th>
            <th title={t('board.race.expectedHint')}>{t('board.race.expected')}</th>
            <th title={t('board.race.bestHint')}>{t('board.race.best')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} className={row.you ? 'race-you' : undefined}>
              <td>
                {t('board.race.rank', { place: index + 1 })} {row.name}
              </td>
              <td>{row.mobility === null ? t('board.race.none') : speed(row.mobility)}</td>
              <td>
                {row.expected === null ? t('board.race.none') : formatDuration(row.expected, t)}
              </td>
              <td>{row.best === null ? t('board.race.none') : formatDuration(row.best, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <small className="sub">
        {t('board.race.entry', { mobility: speed(Math.ceil(race.minMobility) - HALF) })}{' '}
        {race.prizeShares
          .map((share, index) =>
            t('board.race.prize', {
              place: index + 1,
              amount: money(Math.round((reward * share) / topShare)),
            }),
          )
          .join(' · ')}
      </small>
      <small className="sub">{t('board.race.dynamic')}</small>
    </section>
  );
}
