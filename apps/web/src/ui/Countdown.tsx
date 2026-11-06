import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { serverNow, syncServerTime } from '../api/client';

export interface CountdownProps {
  /** ISO timestamp of the deadline (server-produced: expiresAt, arrivalAt…). */
  until: string;
  /**
   * Server clock reference from the same payload (dispatch's `serverTime`). Captured
   * once per value so the countdown runs on the API's clock, not the browser's
   * (S10.3; design ux §6). Without it, the Date-header offset tracked by the client
   * is used.
   */
  serverTime?: string;
  /** Fired once when the deadline passes — callers refetch; the client never assumes
   * the mission itself is over (S10.7). */
  onElapsed?: () => void;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function Countdown({ until, serverTime, onElapsed }: CountdownProps) {
  const { t } = useTranslation();
  const target = useMemo(() => Date.parse(until), [until]);
  // One clock for every countdown and for the trip bar and map: the server clock the client keeps.
  // A precise `serverTime` from the caller refreshes that clock instead of making a private offset.
  useMemo(() => {
    if (serverTime !== undefined) syncServerTime(serverTime);
  }, [serverTime]);

  const [remaining, setRemaining] = useState(() => target - serverNow());
  const firedRef = useRef(false);
  const elapsedRef = useRef(onElapsed);
  useEffect(() => {
    elapsedRef.current = onElapsed;
  });

  useEffect(() => {
    firedRef.current = false;
    const tick = () => {
      const left = target - serverNow();
      setRemaining(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        elapsedRef.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const text = hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;

  return (
    <span className="mono" role="timer" aria-label={t('ui.countdown.label')}>
      {remaining <= 0 ? t('ui.countdown.expired') : text}
    </span>
  );
}
