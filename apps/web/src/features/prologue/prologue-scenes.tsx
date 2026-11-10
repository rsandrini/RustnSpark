import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import type { StepId } from './prologue-state';

/** What every scene of the opening receives: a way to say "this step is done". */
export interface SceneProps {
  readonly onDone: () => void;
}

/** A step whose scene is not built yet (the opening is put together task by task). */
function PendingScene({ onDone }: SceneProps) {
  const { t } = useTranslation();
  return (
    <section className="panel prologue-pending">
      <p className="muted">{t('prologue.pending')}</p>
      <button type="button" className="btn primary" onClick={onDone}>
        {t('prologue.next')}
      </button>
    </section>
  );
}

/** The scene shown for each step. Later tasks replace the pending ones with the real scenes. */
export const PROLOGUE_SCENES: Record<StepId, ComponentType<SceneProps>> = {
  gift: PendingScene,
  'fit-engine': PendingScene,
  'race-board': PendingScene,
  race: PendingScene,
  'stop-one': PendingScene,
  'offer-run-1': PendingScene,
  'fit-cargo': PendingScene,
  'stop-two': PendingScene,
  'offer-run-2': PendingScene,
  'final-board': PendingScene,
  'final-run': PendingScene,
  loss: PendingScene,
  rescue: PendingScene,
};
