import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MissionOffer, WorldLocation, WorldResponse } from '../../api/generated';
import { useNow } from '../../ui/useNow';
import { ContractFace } from './contract-face';
import { fuelStatus } from './fuel-status';
import { MissionCard } from './mission-card';
import { RouteMap, pathOfLegs } from '../../ui/RouteMap';

const CHEVRON = '▸';

export interface MissionRowProps {
  offer: MissionOffer;
  origin: WorldLocation | undefined;
  destination: WorldLocation | undefined;
  fuelHave?: number;
  fuelCap?: number;
  fuelUse?: number;
  world?: WorldResponse;
  mine: boolean;
  /** Accept / Hold / Release (or "Go to ship" on the pinned row), shown in the pay column. */
  actions: ReactNode;
  /** The mission already taken: pinned row with this tag, no eligibility verdict. */
  tag?: string;
  taken?: boolean;
  engineLevels?: { chem: number; ion: number };
}

/** One offer as a line to scan: what, where, what it asks, what it costs, what it pays. The whole
    card sits behind "Details", so every fact and test id the card carries is still in the page. */
export function MissionRow({
  offer,
  origin,
  destination,
  fuelHave,
  fuelCap,
  fuelUse,
  world,
  mine,
  actions,
  tag,
  taken = false,
  engineLevels,
}: MissionRowProps) {
  const { t } = useTranslation();
  const { info } = offer;
  const expired = Date.parse(offer.expiresAt) <= useNow(true);
  const blocked = !taken && !offer.eligibility.eligible;
  const burnsFuel = fuelUse === undefined || fuelUse > 0;

  const fuel =
    info.estimate !== null &&
    burnsFuel &&
    fuelHave !== undefined &&
    fuelCap !== undefined &&
    fuelCap > 0
      ? fuelStatus(fuelHave, info.estimate.fuelNeeded, fuelCap)
      : null;
  // the card's edge says whether the offer can be taken: green, yellow (needs fuel) or red (blocked)
  const state = taken
    ? 'taken'
    : blocked || fuel?.state === 'tank'
      ? 'blocked'
      : fuel?.state === 'short'
        ? 'short'
        : 'ok';
  const [open, setOpen] = useState(false);

  return (
    <li
      className={`mrow type-${offer.type.toLowerCase()} state-${state}${tag !== undefined ? ' pinned' : ''}`}
      data-testid={tag !== undefined ? 'board-active-mission' : undefined}
    >
      <div className="mrow-main">
        <div className="mrow-body">
          <ContractFace
            offer={offer}
            origin={origin}
            destination={destination}
            taken={taken}
            fuel={fuel}
            burnsFuel={burnsFuel}
            expired={expired}
            tag={tag}
            actions={actions}
          />

          <div className="mrow-foot">
            <button
              type="button"
              className="mrow-toggle"
              aria-expanded={open}
              onClick={() => setOpen((was) => !was)}
            >
              <span className="mrow-chev" aria-hidden="true">
                {CHEVRON}
              </span>
              {t('board.details')}
            </button>
          </div>
        </div>
        {/* the route fills the right column of the card, top to bottom */}
        <div className="mrow-map">
          <RouteMap path={pathOfLegs(offer.legs, world, offer.originId)} world={world} />
        </div>
      </div>

      {/* in the opening the map and the numbers are shown at once: that is what the pilot weighs */}
      <div className={`mrow-details${open ? ' open' : ''}`}>
        <MissionCard
          offer={offer}
          origin={origin}
          destination={destination}
          mine={mine}
          actions={null}
          foldDetails={false}
          hideMap
          taken={taken}
          {...(fuelHave !== undefined ? { fuelHave } : {})}
          {...(fuelCap !== undefined ? { fuelCap } : {})}
          {...(fuelUse !== undefined ? { fuelUse } : {})}
          {...(world !== undefined ? { world } : {})}
          {...(engineLevels !== undefined ? { engineLevels } : {})}
        />
      </div>
    </li>
  );
}
