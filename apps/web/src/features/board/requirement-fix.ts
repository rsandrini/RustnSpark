// Where each mission blocker is fixed: a store tab on the ship screen, the Port refuel tab, the
// ship screen itself, or nowhere (the blocker has no single fix). The strings are the real part
// classes the store filters on (`hangar.partClasses`): a cabin is a CARGO part, while life support
// and mining rigs are UTILITY parts.
import type { FuelState } from './fuel-status';

export type FixTarget =
  { kind: 'store'; partClass: string } | { kind: 'refuel' } | { kind: 'ship' } | { kind: 'none' };

const STORE_CLASS: Record<string, string> = {
  CARGO_TYPE: 'CARGO',
  PRESSURIZED_LIFE_SUPPORT: 'CARGO',
  PASSENGER_SEATS: 'CARGO',
  LIFE_SUPPORT_CAPACITY: 'UTILITY',
  WEAPONS: 'WEAPON',
  ESCORT_STRENGTH: 'WEAPON',
  MIN_MOBILITY: 'ENGINE',
  SPEED: 'ENGINE',
  RACE_SPEED: 'ENGINE',
  MINER: 'UTILITY',
  FUEL_CAPACITY: 'TANK',
};

// Layout and viability faults (apps/api/src/ships/viability.ts) that are fixed on the ship screen.
const SHIP_CODES = new Set([
  'NO_BRIDGE',
  'NO_ENGINE',
  'MOB_TOO_LOW',
  'NO_FUEL_CAPACITY',
  'STRUCTURE_EXCEEDED',
  'ENERGY_CRUISE_NEGATIVE',
  'BATTERY_OUTPUT_INSUFFICIENT',
  'BATTERY_CHARGE_INSUFFICIENT',
  'SHIELD_ENERGY_LOW',
  'PART_DISCONNECTED',
  'PORT_INCORRECT',
  'PART_OUTSIDE',
  'HOLD_OVER_CAPACITY',
  'NO_CARGO_HOLD',
  'HOLD_PARTS_OVER',
  'EXHAUST_BLOCKED',
  'FACING_BLOCKED',
  'FACING_CONNECTOR',
  // the part is owned: what is missing is power
  'LIFE_SUPPORT_UNPOWERED',
]);

// The life-support module is a UTILITY part: when there is none, the store is where it comes from.
const LIFE_SUPPORT_CODES = new Set(['NO_LIFE_SUPPORT']);

/** What fixes a blocker code (a mission requirement or a ship viability fault). */
export function fixOf(code: string): FixTarget {
  const partClass = STORE_CLASS[code];
  if (partClass !== undefined) return { kind: 'store', partClass };
  if (LIFE_SUPPORT_CODES.has(code)) return { kind: 'store', partClass: 'UTILITY' };
  if (SHIP_CODES.has(code)) return { kind: 'ship' };
  return { kind: 'none' };
}

/** What fixes a trip's fuel: top up when short, a bigger tank when the trip exceeds the tank. */
export function fuelFix(state: FuelState): FixTarget {
  if (state === 'short') return { kind: 'refuel' };
  if (state === 'tank') return { kind: 'store', partClass: 'TANK' };
  return { kind: 'none' };
}

export function fixHref(target: FixTarget): string | undefined {
  switch (target.kind) {
    case 'store':
      return `/ship?store=${encodeURIComponent(target.partClass)}`;
    case 'refuel':
      return '/port?tab=refuel';
    case 'ship':
      return '/ship';
    case 'none':
      return undefined;
  }
}
