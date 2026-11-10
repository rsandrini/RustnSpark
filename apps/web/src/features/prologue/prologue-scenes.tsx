import { useState, type ComponentType } from 'react';
import {
  PROLOGUE_CARGO,
  PROLOGUE_ENGINE,
  PROLOGUE_SHIP_START,
  PROLOGUE_SHIP_WITH_ENGINE,
  type ProloguePart,
  type PrologueShip,
} from './prologue-fixtures';
import { usePrologueData } from './prologue-data';
import { creditsAt } from './prologue-script';
import type { StepId } from './prologue-state';
import { BoardScene } from './scenes/board-scene';
import { FightScene } from './scenes/fight-scene';
import { FitScene } from './scenes/fit-scene';
import { GiftScene } from './scenes/gift-scene';
import { GuideLines } from './scenes/guide-lines';
import { LossPopup } from './scenes/loss-popup';
import { RaceScene } from './scenes/race-scene';
import { RescueScene } from './scenes/rescue-scene';
import { TransitScene } from './scenes/transit-scene';

/** What every scene of the opening receives: a way to say "this step is done". */
export interface SceneProps {
  readonly onDone: () => void;
}

/** The race has three legs of different lengths, in seconds (the owner's numbers). */
export const RACE_LEG_SECONDS = [15, 20, 30] as const;

/** Fitting a part: the guide says how, the real yard checks it, and a line follows when it is in. */
function FitStep({
  ship,
  part,
  introLines,
  doneLine,
  onDone,
}: {
  ship: PrologueShip;
  part: ProloguePart;
  introLines: readonly string[];
  doneLine: string;
  onDone: () => void;
}) {
  const [fitted, setFitted] = useState(false);
  const [introSeen, setIntroSeen] = useState(false);
  return (
    <>
      <FitScene ship={ship} part={part} onFitted={() => setFitted(true)} />
      {fitted ? (
        <GuideLines guide="friend" lines={[doneLine]} onDone={onDone} />
      ) : (
        !introSeen && (
          <GuideLines guide="friend" lines={introLines} onDone={() => setIntroSeen(true)} />
        )
      )}
    </>
  );
}

function FitEngine({ onDone }: SceneProps) {
  return (
    <FitStep
      ship={PROLOGUE_SHIP_START}
      part={PROLOGUE_ENGINE}
      introLines={['prologue.script.fitEngine.l1']}
      doneLine="prologue.script.fitEngine.done"
      onDone={onDone}
    />
  );
}

function FitCargo({ onDone }: SceneProps) {
  return (
    <FitStep
      ship={PROLOGUE_SHIP_WITH_ENGINE}
      part={PROLOGUE_CARGO}
      introLines={['prologue.script.fitCargo.l1']}
      doneLine="prologue.script.fitCargo.done"
      onDone={onDone}
    />
  );
}

function RaceBoard({ onDone }: SceneProps) {
  const { offers } = usePrologueData();
  return (
    <BoardScene
      offers={[offers.race]}
      onDispatch={onDone}
      guide={{ who: 'friend', lines: ['prologue.script.raceBoard.l1'] }}
    />
  );
}

function Race({ onDone }: SceneProps) {
  const { payouts } = usePrologueData();
  return <RaceScene legSeconds={RACE_LEG_SECONDS} prize={payouts[0] ?? 0} onDone={onDone} />;
}

function StopOne({ onDone }: SceneProps) {
  const { offers, payouts, refuelCost, refuelled, payRefuel } = usePrologueData();
  return (
    <BoardScene
      offers={offers.firstStop}
      onDispatch={onDone}
      refuel={{
        cost: refuelCost,
        credits: creditsAt('stop-one', payouts),
        paid: refuelled,
        onPay: payRefuel,
      }}
      guide={{ who: 'friend', lines: ['prologue.script.stopOne.l1'] }}
    />
  );
}

function StopTwo({ onDone }: SceneProps) {
  const { offers } = usePrologueData();
  return (
    <BoardScene
      offers={offers.secondStop}
      onDispatch={onDone}
      guide={{ who: 'friend', lines: ['prologue.script.stopTwo.l1'] }}
    />
  );
}

function FinalBoard({ onDone }: SceneProps) {
  const { offers } = usePrologueData();
  return (
    <BoardScene
      offers={[offers.finalRun]}
      onDispatch={onDone}
      guide={{ who: 'friend', lines: ['prologue.script.finalBoard.l1'] }}
    />
  );
}

function Loss({ onDone }: SceneProps) {
  return <LossPopup onContinue={onDone} />;
}

/** The scene shown for each step of the opening. */
export const PROLOGUE_SCENES: Record<StepId, ComponentType<SceneProps>> = {
  gift: GiftScene,
  'fit-engine': FitEngine,
  'race-board': RaceBoard,
  race: Race,
  'stop-one': StopOne,
  'offer-run-1': TransitScene,
  'fit-cargo': FitCargo,
  'stop-two': StopTwo,
  'offer-run-2': TransitScene,
  'final-board': FinalBoard,
  'final-run': FightScene,
  loss: Loss,
  rescue: RescueScene,
};
