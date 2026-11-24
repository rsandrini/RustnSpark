import type { ActiveMission, ShipResponse } from '../../api/generated';
import { conditionTone } from '../Gauge';

export type HudTone = 'ok' | 'warn' | 'bad';

export interface HudModel {
  fuel: { value: number; max: number; reserve?: number; tone: HudTone } | null;
  hull: { value: number; max: number; tone: HudTone } | null;
  cargo: { used: number; max: number } | null;
}

/**
 * What the HUD shows, from the ship and the accepted mission. Pure: no ship gives nothing, a ship
 * whose engines burn no fuel (or whose tank is zero) has no fuel gauge, and a hold of zero has no cargo gauge: no 0/0 bar. The hull is the ship
 * sheet's condition (percent, same bands as the sheet); the cargo is the hold's mission cargo over
 * the cargo space (no hold in the response reads as empty space of the sheet's size).
 */
export function hudModel(
  ship: ShipResponse | undefined,
  accepted: ActiveMission | undefined,
): HudModel {
  if (ship === undefined) return { fuel: null, hull: null, cargo: null };
  const { sheet } = ship;
  const needed = accepted?.info?.estimate?.fuelNeeded ?? 0;
  const reserve = needed > 0 ? Math.round(needed) : undefined;
  const value = Math.max(0, Math.round(ship.fuel));
  const max = Math.max(0, Math.round(sheet.fuelCap));
  const tone: HudTone =
    value <= 0 || (reserve !== undefined && value <= reserve)
      ? 'bad'
      : max > 0 && value < max / 4
        ? 'warn'
        : 'ok';
  const cargoMax = ship.hold ? ship.hold.capacity : Math.max(0, sheet.crg);
  const condition = Math.max(0, Math.min(100, Math.round(sheet.condition)));
  return {
    fuel:
      sheet.fuelUse > 0 && max > 0
        ? { value, max, ...(reserve === undefined ? {} : { reserve }), tone }
        : null,
    hull: { value: condition, max: 100, tone: conditionTone(condition) },
    cargo: cargoMax > 0 ? { used: ship.hold ? ship.hold.used : 0, max: cargoMax } : null,
  };
}
