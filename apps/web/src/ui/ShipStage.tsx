import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Countdown } from './Countdown';
import { placeArtUrl } from './PlaceArt';

export type StageMode = 'idle' | 'flying' | 'scavenging' | 'repairing';

export interface ShipStageProps {
  mode: StageMode;
  /** The place the ship is docked at: its wide art is the backdrop while parked or repairing. */
  placeId?: string;
  /** When the current activity ends (arrival, repair completion): shown as a countdown. */
  until?: string | null;
  size?: 'hero' | 'compact';
  /** Extra line under the scene (what exactly is going on). */
  detail?: string;
  /** The place's display name, shown as a small label over the scene itself while parked (owner
      request — Board's own place banner was dropped as a duplicate of this). */
  placeName?: string;
  /** Called when the countdown reaches zero (the caller refetches what changed). */
  onElapsed?: () => void;
}

const DRONES = [
  { radius: 74, seconds: 6, delay: 0 },
  { radius: 96, seconds: 9, delay: -3 },
  { radius: 60, seconds: 7.5, delay: -5 },
];
const SPARKS = [
  { x: 42, y: 46, delay: 0 },
  { x: 58, y: 54, delay: 0.4 },
  { x: 50, y: 40, delay: 0.9 },
  { x: 64, y: 44, delay: 1.3 },
  { x: 36, y: 55, delay: 1.7 },
];
const DEBRIS = [
  { top: 14, size: 18, seconds: 7, delay: 0 },
  { top: 68, size: 26, seconds: 11, delay: -4 },
  { top: 40, size: 12, seconds: 6, delay: -2 },
  { top: 82, size: 16, seconds: 9, delay: -6 },
  { top: 26, size: 22, seconds: 13, delay: -8 },
  { top: 56, size: 10, seconds: 5, delay: -1 },
];

// The ship, always on screen and always doing what the server says it is doing. Flying: stars stream
// past. Scavenging: stars plus wreckage drifting by. Parked (or repairing): the ship rests against the
// wide picture of the place it is docked at; while repairing, drones circle the hull and sparks fly.
// Pure decoration: hidden from assistive technology, still under `prefers-reduced-motion`; the
// caption beside it says the same thing in words.
export function ShipStage({
  mode,
  placeId,
  until,
  size = 'hero',
  detail,
  placeName,
  onElapsed,
}: ShipStageProps) {
  const { t } = useTranslation();
  // Scavenging works the field right where the ship already is (GDD/W8) — it never travels
  // anywhere, so the scene should stay parked at the current place (backdrop, place-name
  // overlay, no star-streaming), same as idle/repairing. Only flying actually goes anywhere.
  const moving = mode === 'flying';
  const parked = !moving;
  const style =
    parked && placeId !== undefined
      ? {
          backgroundImage: `linear-gradient(rgba(5,7,11,0.35), rgba(5,7,11,0.55)), url(${placeArtUrl(placeId, 'wide')}), url(${placeArtUrl('_default', 'wide')})`,
        }
      : undefined;

  return (
    <div className="ship-stage-wrap">
      <div
        className={`transit-scene stage-${size} mode-${mode}${moving ? ' moving' : ''}${parked ? ' parked' : ''}`}
        data-testid="transit-scene"
        aria-hidden="true"
        style={style}
      >
        <div className="stars stars-far" />
        <div className="stars stars-mid" />
        <div className="stars stars-near" />
        {parked && placeName !== undefined && (
          <span className="stage-place-label">{placeName}</span>
        )}
        {mode === 'scavenging' &&
          DEBRIS.map((piece, index) => (
            <span
              key={index}
              className="debris"
              style={{
                top: `${piece.top}%`,
                width: piece.size,
                height: piece.size,
                animationDuration: `${piece.seconds}s`,
                animationDelay: `${piece.delay}s`,
              }}
            />
          ))}
        <div className="scene-ship">
          <svg viewBox="0 0 120 60" width="160" height="80">
            <path className="ship-flame" d="M14,30 L-6,22 L2,30 L-6,38 Z" />
            <path className="ship-hull" d="M118,30 L84,10 L30,14 L14,24 L14,36 L30,46 L84,50 Z" />
            <path className="ship-wing" d="M64,14 L40,-2 L30,14 Z M64,46 L40,62 L30,46 Z" />
            <path className="ship-cockpit" d="M104,30 L86,20 L78,30 L86,40 Z" />
            <rect className="ship-engine" x="8" y="24" width="10" height="12" rx="2" />
          </svg>
          {mode === 'repairing' && (
            <>
              {DRONES.map((drone, index) => (
                <span
                  key={index}
                  className="drone"
                  style={
                    {
                      '--r': `${drone.radius}px`,
                      animationDuration: `${drone.seconds}s`,
                      animationDelay: `${drone.delay}s`,
                    } as CSSProperties
                  }
                >
                  <span className="drone-body" />
                  <span className="drone-beam" />
                </span>
              ))}
              {SPARKS.map((spark, index) => (
                <span
                  key={index}
                  className="stage-spark"
                  style={{
                    left: `${spark.x}%`,
                    top: `${spark.y}%`,
                    animationDelay: `${spark.delay}s`,
                  }}
                />
              ))}
            </>
          )}
        </div>
      </div>
      {/* Docked has no countdown and nothing left to say that the scene (parked ship) and the
          place-name overlay on it don't already — owner request: no text below the animation
          for that case. Still in the DOM (sr-only), not gone, for the same reason as elsewhere:
          screen readers and the tests that already cover every mode's wording. */}
      <p
        className={`stage-caption${mode === 'idle' ? ' sr-only' : ''}`}
        data-testid="stage-caption"
      >
        <b>{t(`stage.mode.${mode}`)}</b>
        {until !== undefined && until !== null && (
          <>
            {' '}
            <Countdown until={until} onElapsed={onElapsed} />
          </>
        )}
        {detail !== undefined && <span className="sub"> {detail}</span>}
      </p>
    </div>
  );
}
