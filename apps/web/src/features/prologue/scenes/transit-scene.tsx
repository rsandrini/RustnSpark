import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShipStage } from '../../../ui/ShipStage';
import type { SceneProps } from '../prologue-scenes';

/** A trip is shown for a few seconds only (the real ones take longer; the opening says so). */
const TRIP_SECONDS = 8;
const MS = 1000;

export function TransitScene({ onDone }: SceneProps) {
  const { t } = useTranslation();
  const [until] = useState(() => new Date(Date.now() + TRIP_SECONDS * MS).toISOString());
  return (
    <section className="prologue-scene prologue-transit" data-testid="transit-scene">
      <h1>{t('prologue.transit.title')}</h1>
      <ShipStage
        mode="flying"
        until={until}
        detail={t('prologue.transit.detail')}
        onElapsed={onDone}
      />
      <div className="actions">
        <button type="button" className="btn" onClick={onDone}>
          {t('prologue.next')}
        </button>
      </div>
    </section>
  );
}
