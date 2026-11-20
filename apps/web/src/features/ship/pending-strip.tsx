import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Countdown } from '../../ui/Countdown';
import { pickLocalized } from '../../i18n/localized';
import { useActiveMissions } from '../transit/use-active-mission';
import { serverNow } from '../../api/client';
import type { ActiveMission } from '../../api/generated';

/** The mission the pilot accepted and has not started yet (a search or a mining job is not one). */
export function waitingMissionOf(missions: readonly ActiveMission[] | undefined) {
  return missions?.find((entry) => entry.status === 'ACCEPTED' && entry.isJob !== true);
}

/** The search or the mining job under way, if any. */
export function runningJobOf(missions: readonly ActiveMission[] | undefined) {
  return missions?.find(
    (entry) =>
      entry.isJob === true && (entry.status === 'IN_TRANSIT' || entry.status === 'RESOLVING'),
  );
}

/**
 * Whether a job of `seconds` (starting now) would be over before the waiting mission must start (its start-before
 * time, or its offer window). True when no mission is waiting.
 */
export function jobFitsWaitingMission(
  missions: readonly ActiveMission[] | undefined,
  seconds: number,
): boolean {
  const waiting = waitingMissionOf(missions);
  if (waiting === undefined) return true;
  const limits = [waiting.deadlineAt, waiting.expiresAt]
    .filter((moment): moment is string => typeof moment === 'string')
    .map((moment) => Date.parse(moment));
  return limits.length === 0 || serverNow() + seconds * 1000 <= Math.min(...limits);
}

/**
 * What is going on beside each other: the mission waiting to start and the search or mining job under way. Shown on the
 * screens where the pilot picks things to do, so a waiting mission is never lost behind a job.
 */
export function PendingStrip() {
  const { t, i18n } = useTranslation();
  const active = useActiveMissions();
  const waiting = waitingMissionOf(active.data);
  const job = runningJobOf(active.data);
  if (waiting === undefined && job === undefined) return null;
  return (
    <section className="pending-strip" data-testid="pending-strip">
      {waiting !== undefined && (
        <p className="pending-line" data-testid="pending-waiting">
          <b>
            {t('pending.waiting', { title: pickLocalized(waiting.brief.title, i18n.language) })}
          </b>{' '}
          {waiting.deadlineAt !== null && waiting.deadlineAt !== undefined && (
            <>
              {t('pending.startBefore')} <Countdown until={waiting.deadlineAt} />
            </>
          )}{' '}
          <Link to="/ship">{t('pending.open')}</Link>
        </p>
      )}
      {job !== undefined && job.arrivalAt !== null && job.arrivalAt !== undefined && (
        <p className="pending-line" data-testid="pending-job">
          <b>{t(job.type === 'MINING' ? 'pending.mining' : 'pending.searching')}</b>{' '}
          <Countdown until={job.arrivalAt} />
          {waiting !== undefined && <span className="sub"> {t('pending.missionWaits')}</span>}
        </p>
      )}
    </section>
  );
}
