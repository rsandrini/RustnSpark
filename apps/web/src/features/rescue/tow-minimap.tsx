import { useTranslation } from 'react-i18next';
import type { ShipResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { useWorld } from '../ship/use-world';

const PAD = 90;
const MIN_SPAN = 260;

/**
 * A small picture of where the floating ship is and where the rescue would tow it: the sector's routes and places in
 * the background, the ship on its route, and a dashed line to the base. The full map is one link away.
 */
export function TowMiniMap({ ship }: { ship: ShipResponse }) {
  const { t, i18n } = useTranslation();
  const world = useWorld().data;
  const float = ship.float;
  const base = world?.locations.find((place) => place.id === ship.rescue?.baseId);
  const from = world?.locations.find((place) => place.id === float?.fromId);
  const to = world?.locations.find((place) => place.id === float?.toId);
  if (
    world === undefined ||
    float == null ||
    base === undefined ||
    from === undefined ||
    to === undefined
  ) {
    return null;
  }
  const spot = {
    x: from.x + (to.x - from.x) * float.progress,
    y: from.y + (to.y - from.y) * float.progress,
  };
  const minX = Math.min(spot.x, base.x);
  const maxX = Math.max(spot.x, base.x);
  const minY = Math.min(spot.y, base.y);
  const maxY = Math.max(spot.y, base.y);
  const spanX = Math.max(MIN_SPAN, maxX - minX + 2 * PAD);
  const spanY = Math.max(MIN_SPAN * 0.55, maxY - minY + 2 * PAD);
  const box = {
    x: (minX + maxX) / 2 - spanX / 2,
    y: (minY + maxY) / 2 - spanY / 2,
    w: spanX,
    h: spanY,
  };
  const byId = new Map(world.locations.map((place) => [place.id, place]));
  const near = world.locations.filter(
    (place) =>
      place.x >= box.x && place.x <= box.x + box.w && place.y >= box.y && place.y <= box.y + box.h,
  );
  const unit = box.w / 520;
  const nameOf = (place: { displayName: Parameters<typeof pickLocalized>[0] }) =>
    pickLocalized(place.displayName, i18n.language);
  return (
    <svg
      className="floatpop-minimap"
      data-testid="tow-minimap"
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      role="img"
      aria-label={t('rescue.popup.mapAlt', { base: nameOf(base) })}
    >
      {world.routes.map((route) => {
        const a = byId.get(route.nodeAId);
        const b = byId.get(route.nodeBId);
        if (a === undefined || b === undefined) return null;
        return <line key={route.id} className="mm-route" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
      })}
      {near.map((place) => (
        <circle key={place.id} className="mm-place" cx={place.x} cy={place.y} r={4 * unit} />
      ))}
      <line
        className="mm-tow"
        x1={spot.x}
        y1={spot.y}
        x2={base.x}
        y2={base.y}
        strokeWidth={2 * unit}
      />
      <circle className="mm-base" cx={base.x} cy={base.y} r={9 * unit} />
      <text
        className="mm-label mm-base-label"
        x={base.x}
        y={base.y - 14 * unit}
        fontSize={12 * unit}
      >
        {t('rescue.popup.mapBase', { base: nameOf(base) })}
      </text>
      <circle className="mm-ship-halo" cx={spot.x} cy={spot.y} r={11 * unit} />
      <circle className="mm-ship" cx={spot.x} cy={spot.y} r={5 * unit} />
      <text
        className="mm-label mm-ship-label"
        x={spot.x}
        y={spot.y + 24 * unit}
        fontSize={12 * unit}
      >
        {t('rescue.popup.mapShip')}
      </text>
    </svg>
  );
}
