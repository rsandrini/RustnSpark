import type { SceneProps } from '../prologue-scenes';
import { GuideLines } from './guide-lines';

const RESCUE_LINES = ['prologue.script.rescue.l1', 'prologue.script.rescue.l2'] as const;

/** After the loss: a rescuer, quietly. When the lines end the opening is over and the harbour office takes over. */
export function RescueScene({ onDone }: SceneProps) {
  return (
    <section className="prologue-scene prologue-rescue" data-testid="rescue-scene">
      <GuideLines guide="rescuer" lines={RESCUE_LINES} onDone={onDone} />
    </section>
  );
}
