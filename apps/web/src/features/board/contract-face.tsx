import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MissionOffer, WorldLocation } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { Countdown } from '../../ui/Countdown';
import { FactionBadge } from '../../ui/FactionBadge';
import { GiverBadge, giverBadgeOf } from '../../ui/GiverBadge';
import { formatDuration } from '../../ui/duration';
import { scaleSpeed, useDisplay } from '../../ui/display';
import { BlockerChip } from '../../ui/kit/BlockerChip';
import { RiskPips } from '../../ui/kit/RiskPips';
import { usePrologueMode } from '../prologue/prologue-mode';
import type { FuelStatus } from './fuel-status';
import { missionKind } from './mission-kinds';
import { fixHref, fixOf, fuelFix } from './requirement-fix';
import { reasonLabel } from './reason-label';

const DOT = ' · ';
const RISK_LEVEL = { lo: 1, md: 2, hi: 3 } as const;

export interface ContractFaceProps {
  offer: MissionOffer;
  origin: WorldLocation | undefined;
  destination: WorldLocation | undefined;
  taken: boolean;
  /** The trip's fuel standing, when the row could work it out. */
  fuel: FuelStatus | null;
  burnsFuel: boolean;
  expired: boolean;
  /** The pinned row's tag ("Your mission"). */
  tag?: string | undefined;
  /** Accept / Hold / Release (or "Go to ship"), shown under the reward. */
  actions: ReactNode;
}

/** The face of a contract card: who sent it, what and where, how risky and long, what it pays, and
    one row of chips for whatever stops the pilot, each one leading to its fix. */
export function ContractFace({
  offer,
  origin,
  destination,
  taken,
  fuel,
  burnsFuel,
  expired,
  tag,
  actions,
}: ContractFaceProps) {
  const { t, i18n } = useTranslation();
  const display = useDisplay();
  const opening = usePrologueMode().active;
  const { info } = offer;
  const kind = missionKind(offer.type);
  const money = (value: number) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`;
  const place = (location: WorldLocation | undefined, fallback: string) =>
    location === undefined ? fallback : pickLocalized(location.displayName, i18n.language);
  const number = (value: number, unit: string | undefined) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
      unit === 'mobility' ? scaleSpeed(value, display) : value,
    );

  // What the checklist names (unmet, with numbers) plus the reasons it does not: the same dedupe
  // the details card does.
  const requirementCodes = new Set(info.requirements.map((req) => req.code));
  const blockers: { key: string; label: string; to: string | undefined }[] = taken
    ? []
    : [
        ...info.requirements
          .filter((req) => !req.met)
          // a trip longer than the tank is told once, by the fuel chip
          .filter((req) => !(req.code === 'FUEL_CAPACITY' && fuel?.state === 'tank'))
          .map((req) => {
            const name = t(`board.requirements.${req.code}`, { defaultValue: req.message });
            const numbers =
              req.needed !== undefined && req.actual !== undefined
                ? `: ${t('board.requirementNumbers', {
                    actual: number(req.actual, req.unit),
                    needed: number(req.needed, req.unit),
                  })}`
                : '';
            return { key: req.code, label: `${name}${numbers}`, to: fixHref(fixOf(req.code)) };
          }),
        ...offer.eligibility.reasons
          .filter((reason) => !requirementCodes.has(reason.code))
          .map((reason, index) => ({
            key: `${reason.code}-${index}`,
            label: reasonLabel(t, reason.code, reason.message),
            to: fixHref(fixOf(reason.code)),
          })),
      ];
  const fuelTo = fuel === null ? undefined : fixHref(fuelFix(fuel.state));
  const risk = destination?.risk;

  return (
    <div className="mrow-face">
      <div className="mrow-type">
        {tag !== undefined && <span className="mrow-tag">{tag}</span>}
        {origin !== undefined && info.giver != null && <FactionBadge factionId={offer.factionId} />}
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

      <div className="mrow-who">
        {/* the face of the sender; none for offers from before givers: the faction stands in */}
        <p className="mrow-giver">
          {info.giver != null ? (
            <GiverBadge {...giverBadgeOf(info.giver, i18n.language)} />
          ) : (
            <FactionBadge factionId={offer.factionId} />
          )}
        </p>
        <div className="mrow-head">
          <h2 className="mrow-title">{pickLocalized(info.title, i18n.language)}</h2>
          <p className="mrow-route">
            <span>{place(origin, offer.originId)}</span>
            <span className="mrow-arrow" aria-hidden="true">
              {' '}
              {t('board.arrow')}{' '}
            </span>
            <span>{place(destination, offer.destinationId)}</span>
            <span className="mrow-dist">
              {DOT}
              {t('distanceValue', { n: info.totalDistance })}
            </span>
          </p>
        </div>
      </div>

      <div className="mrow-meta">
        {risk !== undefined && <RiskPips level={RISK_LEVEL[risk]} label={t(`ui.risk.${risk}`)} />}
        <span className="mrow-fig">
          {info.estimate === null ? '—' : formatDuration(info.estimate.durationSeconds, t)}
        </span>
        {info.estimate !== null && burnsFuel && (
          <span className={`mrow-fig${fuel !== null && fuel.state !== 'ok' ? ' warn' : ''}`}>
            {t('board.fuelUses', { needed: Math.round(info.estimate.fuelNeeded) })}
          </span>
        )}
        <span className="mrow-kind">
          {kind.icon}
          {t(kind.labelKey)}
        </span>
      </div>

      {(blockers.length > 0 || (fuel !== null && fuel.state !== 'ok')) && (
        <div className="mrow-chips" aria-label={t('board.needsTitle')} role="group">
          {blockers.map((blocker) => (
            <BlockerChip
              key={blocker.key}
              label={blocker.label}
              {...(blocker.to !== undefined ? { to: blocker.to } : {})}
            />
          ))}
          {fuel !== null && fuel.state !== 'ok' && (
            <BlockerChip
              label={t(`board.fuel.chip.${fuel.state}`, { missing: fuel.missing })}
              className={`fuel-chip fuel-${fuel.state}`}
              testId="fuel-chip"
              state={fuel.state}
              {...(fuelTo !== undefined ? { to: fuelTo } : {})}
            />
          )}
        </div>
      )}

      <div className="mrow-pay">
        <b className="mrow-reward">{money(offer.reward)}</b>
        <div className="mrow-actions">{actions}</div>
      </div>
    </div>
  );
}
