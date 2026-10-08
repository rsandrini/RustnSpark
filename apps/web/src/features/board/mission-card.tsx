import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MissionOffer, WorldLocation } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { Countdown } from '../../ui/Countdown';
import { formatDuration } from '../../ui/duration';
import { FactionBadge } from '../../ui/FactionBadge';
import { RiskBadge } from '../../ui/RiskBadge';
import { Gauge } from '../../ui/Gauge';
import { serverNow } from '../../api/client';

export interface MissionCardProps {
  offer: MissionOffer;
  origin: WorldLocation | undefined;
  destination: WorldLocation | undefined;
  /** Fuel aboard, to say whether the trip is affordable. */
  fuelHave?: number;
  /** Tank size, to draw the fuel-aboard bar the trip's cost is carved out of. */
  fuelCap?: number;
  /** The viewer's ship speed, to rank it against a race's rivals. */
  shipMobility?: number;
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
  fuelCap,
  shipMobility,
  mine,
  actions,
}: MissionCardProps) {
  const { t, i18n } = useTranslation();
  const { info } = offer;
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
          faction: t(`factions.${location.factionId}`, { defaultValue: t('factions.independent') }),
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

      {info.race !== null && (
        <RaceField
          race={info.race}
          reward={offer.reward}
          shipMobility={shipMobility}
          yourSeconds={info.estimate?.durationSeconds ?? null}
          money={money}
        />
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
      {notEnoughFuel && <p className="error-text">{t('board.lowFuel')}</p>}

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

// A race offer's grid: every rival's speed and time over this route, with the viewer's own ship
// ranked among them (same speed -> time formula the server resolves with), plus the prize per place.
function RaceField({
  race,
  reward,
  shipMobility,
  yourSeconds,
  money,
}: {
  race: NonNullable<MissionOffer['info']['race']>;
  reward: number;
  shipMobility: number | undefined;
  yourSeconds: number | null;
  money: (value: number) => string;
}) {
  const { t } = useTranslation();
  const rows = [
    ...race.rivals.map((rival) => ({
      key: rival.name,
      name: rival.name,
      mobility: rival.mobility,
      seconds: rival.durationSeconds,
      you: false,
    })),
    {
      key: 'you',
      name: t('board.race.you'),
      mobility: shipMobility ?? null,
      seconds: yourSeconds,
      you: true,
    },
  ].sort((a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity));
  const topShare = race.prizeShares[0] ?? 1;
  return (
    <section className="mcard-race" aria-label={t('board.race.title')} data-testid="race-field">
      <b>{t('board.race.title')}</b>
      <table>
        <thead>
          <tr>
            <th>{t('board.race.pilot')}</th>
            <th>{t('board.race.speed')}</th>
            <th>{t('board.race.time')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} className={row.you ? 'race-you' : undefined}>
              <td>
                {t('board.race.rank', { place: index + 1 })} {row.name}
              </td>
              <td>{row.mobility === null ? '—' : row.mobility}</td>
              <td>{row.seconds === null ? '—' : formatDuration(row.seconds, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <small className="sub">
        {t('board.race.entry', { mobility: race.minMobility })}{' '}
        {race.prizeShares
          .map((share, index) =>
            t('board.race.prize', { place: index + 1, amount: money(Math.round((reward * share) / topShare)) }),
          )
          .join(' · ')}
      </small>
    </section>
  );
}
