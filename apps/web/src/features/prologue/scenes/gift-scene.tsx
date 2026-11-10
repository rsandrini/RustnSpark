import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { pickLocalized } from '../../../i18n/localized';
import { ShipYard } from '../../hangar/ship-yard';
import { PROLOGUE_SHIP_START } from '../prologue-fixtures';
import type { SceneProps } from '../prologue-scenes';
import { GuideLines } from './guide-lines';

const GIFT_LINES = ['prologue.script.gift.l1', 'prologue.script.gift.l2'] as const;

/** The first thing the pilot sees: their ship, with no engine, and the friend saying what the game is for. */
export function GiftScene({ onDone }: SceneProps) {
  const { i18n } = useTranslation();
  const ship = PROLOGUE_SHIP_START;
  const names = useMemo(
    () =>
      new Map(
        [...ship.nameById.entries()].map(([id, text]) => [id, pickLocalized(text, i18n.language)]),
      ),
    [ship.nameById, i18n.language],
  );
  return (
    <section className="prologue-scene prologue-gift" data-testid="gift-scene">
      <ShipYard
        cells={ship.cells}
        layout={ship.layout}
        catalogById={ship.catalogById}
        connectorsById={ship.connectorsById}
        nameById={names}
        selectedId={null}
        draggingId={null}
        onSelect={() => {}}
        onCellClick={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        editable={false}
      />
      <GuideLines guide="friend" lines={GIFT_LINES} onDone={onDone} />
    </section>
  );
}
