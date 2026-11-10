import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShipStage } from '../../../ui/ShipStage';
import { formatDuration } from '../../../ui/duration';
import { scaleSpeed, useDisplay } from '../../../ui/display';
import './race-scene.css';

export interface RaceSceneProps {
  legSeconds: readonly number[];
  prize: number;
  onDone: () => void;
}

const FRIEND_MOBILITY = 3.5;
const PLAYER_MOBILITY = 3;
const RIVAL_MOBILITY = 2.5;

export function RaceScene({ legSeconds, prize, onDone }: RaceSceneProps) {
  const { t, i18n } = useTranslation();
  const display = useDisplay();
  const [legIndex, setLegIndex] = useState(0);
  const [finished, setFinished] = useState(false);

  const totalSeconds = useMemo(() => legSeconds.reduce((sum, sec) => sum + sec, 0), [legSeconds]);
  const elapsedSeconds = useMemo(
    () => legSeconds.slice(0, legIndex).reduce((sum, sec) => sum + sec, 0),
    [legIndex, legSeconds],
  );
  const currentLegSeconds = legSeconds[legIndex] ?? 0;

  useEffect(() => {
    if (finished || legIndex >= legSeconds.length) return undefined;
    const id = window.setTimeout(() => {
      if (legIndex + 1 >= legSeconds.length) {
        setFinished(true);
      } else {
        setLegIndex((index) => index + 1);
      }
    }, currentLegSeconds * 1000);
    return () => window.clearTimeout(id);
  }, [finished, legIndex, legSeconds, currentLegSeconds]);

  const skip = () => {
    if (finished) return;
    if (legIndex + 1 >= legSeconds.length) {
      setFinished(true);
    } else {
      setLegIndex((index) => index + 1);
    }
  };

  const money = (value: number) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`;
  const speed = (raw: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
      scaleSpeed(raw, display),
    );

  // The race is scripted: the friend is fastest, the player is second, one rival trails behind.
  const friendTime = totalSeconds * 0.85;
  const playerTime = totalSeconds * 0.95;
  const rivalTime = totalSeconds * 1.05;

  const expectedRows = [
    {
      key: 'friend',
      name: t('prologue.race.friendName'),
      mobility: FRIEND_MOBILITY,
      time: friendTime,
      you: false,
    },
    {
      key: 'player',
      name: t('prologue.race.you'),
      mobility: PLAYER_MOBILITY,
      time: playerTime,
      you: true,
    },
    {
      key: 'rival',
      name: t('prologue.race.rivalName'),
      mobility: RIVAL_MOBILITY,
      time: rivalTime,
      you: false,
    },
  ].sort((a, b) => a.time - b.time);

  const resultRows = [
    { key: 'friend', name: t('prologue.race.friendName'), you: false },
    { key: 'player', name: t('prologue.race.you'), you: true },
  ];

  const until = useMemo(() => {
    const now = Date.now();
    const remaining = (totalSeconds - elapsedSeconds) * 1000;
    return new Date(now + remaining).toISOString();
  }, [totalSeconds, elapsedSeconds]);

  if (finished) {
    return (
      <main className="app prologue-scene race-scene race-result">
        <h1>{t('prologue.race.result.title')}</h1>
        <table className="mcard-race" data-testid="race-result">
          <thead>
            <tr>
              <th>{t('board.race.pilot')}</th>
              <th>{t('prologue.race.result.place')}</th>
            </tr>
          </thead>
          <tbody>
            {resultRows.map((row, index) => (
              <tr
                key={row.key}
                data-testid="race-standing-row"
                className={row.you ? 'race-you' : undefined}
              >
                <td>
                  {t('board.race.rank', { place: index + 1 })} {row.name}
                </td>
                <td>{t('prologue.race.result.place', { place: index + 1 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="race-prize" data-testid="race-prize">
          <b>{money(prize)}</b>
        </p>
        <div className="actions">
          <button type="button" className="btn primary" data-testid="race-continue" onClick={onDone}>
            {t('prologue.race.result.continue')}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="app prologue-scene race-scene">
      <h1>{t('prologue.race.title')}</h1>
      <p className="sub" data-testid="race-leg-count">
        {t('prologue.race.leg', { current: legIndex + 1, total: legSeconds.length })}
      </p>

      <section className="mcard-race" aria-label={t('board.race.title')} data-testid="race-table">
        <b>{t('board.race.title')}</b>
        <table>
          <thead>
            <tr>
              <th>{t('board.race.pilot')}</th>
              <th>{t('board.race.speed')}</th>
              <th title={t('board.race.expectedHint')}>{t('board.race.expected')}</th>
            </tr>
          </thead>
          <tbody>
            {expectedRows.map((row, index) => (
              <tr key={row.key} className={row.you ? 'race-you' : undefined}>
                <td>
                  {t('board.race.rank', { place: index + 1 })} {row.name}
                </td>
                <td>{speed(row.mobility)}</td>
                <td>{formatDuration(row.time, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="race-stage">
        <ShipStage
          mode="flying"
          until={until}
          detail={t('prologue.race.leg', { current: legIndex + 1, total: legSeconds.length })}
        />
      </div>

      <div className="actions">
        <button type="button" className="btn" data-testid="race-skip" onClick={skip}>
          {t('prologue.race.skip')}
        </button>
      </div>
    </main>
  );
}
