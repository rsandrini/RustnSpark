import { useTranslation } from 'react-i18next';

export interface TransitSceneProps {
  /** Stars stream past and the engine burns while the ship is flying; still while it waits to depart. */
  moving: boolean;
}

// Pure decoration: three layers of stars sliding past at different speeds (parallax) and a ship
// hovering a little in the middle of the screen. It carries no information, so it is hidden from
// assistive technology, and the CSS stops every animation for people who asked for reduced motion.
export function TransitScene({ moving }: TransitSceneProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`transit-scene${moving ? ' moving' : ''}`}
      data-testid="transit-scene"
      aria-hidden="true"
      title={t('transit.scene.alt')}
    >
      <div className="stars stars-far" />
      <div className="stars stars-mid" />
      <div className="stars stars-near" />
      <div className="scene-ship">
        <svg viewBox="0 0 120 60" width="160" height="80">
          <path className="ship-flame" d="M14,30 L-6,22 L2,30 L-6,38 Z" />
          <path className="ship-hull" d="M118,30 L84,10 L30,14 L14,24 L14,36 L30,46 L84,50 Z" />
          <path className="ship-wing" d="M64,14 L40,-2 L30,14 Z M64,46 L40,62 L30,46 Z" />
          <path className="ship-cockpit" d="M104,30 L86,20 L78,30 L86,40 Z" />
          <rect className="ship-engine" x="8" y="24" width="10" height="12" rx="2" />
        </svg>
      </div>
    </div>
  );
}
