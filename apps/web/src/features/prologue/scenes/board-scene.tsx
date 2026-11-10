import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MissionOffer } from '../../../api/generated';
import { MissionCard } from '../../board/mission-card';
import { PROLOGUE_WORLD } from '../prologue-fixtures';
import type { GuideId } from '../prologue-script';
import { GuideLines } from './guide-lines';

/** The starter ship's tank and engine, as the card's fuel block reads them (a chemical engine burns fuel). */
const TANK_CAP = 300;
const ENGINE_FUEL_USE = 7;
const START_FUEL_SHARE = 0.25;

export interface BoardSceneProps {
  offers: readonly MissionOffer[];
  /** The pilot pressed Dispatch on this offer. */
  onDispatch: (offer: MissionOffer) => void;
  /** The tank starts a quarter full: Dispatch waits for the refuel, which the pilot pays for. */
  refuel?: { cost: number; credits: number; paid: boolean; onPay: () => void };
  guide?: { who: GuideId; lines: readonly string[] };
}

/** The real mission card (with its map) for each offer, and nothing else on the board: only Dispatch works. */
export function BoardScene({ offers, onDispatch, refuel, guide }: BoardSceneProps) {
  const { t } = useTranslation();
  const refuelled = refuel === undefined || refuel.paid;
  const affordable = refuel === undefined || refuel.credits >= refuel.cost;
  const [chosen, setChosen] = useState<string | null>(null);
  const [guideRead, setGuideRead] = useState(false);
  const fuelHave = refuelled ? TANK_CAP : TANK_CAP * START_FUEL_SHARE;
  const world = PROLOGUE_WORLD;
  const place = (id: string) => world.locations.find((location) => location.id === id);

  return (
    <section className="prologue-scene prologue-board" data-testid="board-scene">
      {refuel !== undefined && (
        <div className="panel prologue-refuel">
          <button
            type="button"
            className="btn primary"
            disabled={refuelled || !affordable}
            onClick={refuel.onPay}
          >
            {refuelled
              ? t('prologue.board.refuelled')
              : t('prologue.board.refuel', { cost: refuel.cost })}
          </button>
          {!refuelled && (
            <span className="sub">
              {affordable ? t('prologue.board.refuelFirst') : t('prologue.board.notEnough')}
            </span>
          )}
        </div>
      )}
      {offers.length > 1 && <p className="sub">{t('prologue.board.chooseOne')}</p>}
      <div className="prologue-offers">
        {offers.map((offer) => (
          <MissionCard
            key={offer.id}
            offer={offer}
            origin={place(offer.originId)}
            destination={place(offer.destinationId)}
            world={world}
            fuelHave={fuelHave}
            fuelCap={TANK_CAP}
            fuelUse={ENGINE_FUEL_USE}
            mine={false}
            foldDetails={false}
            actions={
              <button
                type="button"
                className="btn primary"
                disabled={!refuelled || chosen !== null}
                onClick={() => {
                  setChosen(offer.id);
                  onDispatch(offer);
                }}
              >
                {t('prologue.board.dispatch')}
              </button>
            }
          />
        ))}
      </div>
      {guide !== undefined && !guideRead && (
        <GuideLines guide={guide.who} lines={guide.lines} onDone={() => setGuideRead(true)} />
      )}
    </section>
  );
}
