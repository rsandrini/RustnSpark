// Where each mission blocker is fixed: a store tab on the ship screen, the Port refuel tab, the
// ship screen itself, or nowhere (the blocker has no single fix). The strings are the real part
// classes the store filters on (`hangar.partClasses`): a cabin is a CARGO part, while life support
// and mining rigs are UTILITY parts.
export type FixTarget =
  { kind: 'store'; partClass: string } | { kind: 'refuel' } | { kind: 'ship' } | { kind: 'none' };

const STORE_CLASS: Record<string, string> = {
  CARGO_TYPE: 'CARGO',
  PRESSURIZED_LIFE_SUPPORT: 'CARGO',
  WEAPONS: 'WEAPON',
  MIN_MOBILITY: 'ENGINE',
  SPEED: 'ENGINE',
  RACE_SPEED: 'ENGINE',
  MINER: 'UTILITY',
  FUEL_CAPACITY: 'TANK',
};

const SHIP_CODES = new Set([
  'NO_BRIDGE',
  'NO_ENGINE',
  'MOB_TOO_LOW',
  'NO_FUEL_CAPACITY',
  'NO_LIFE_SUPPORT',
  'STRUCTURE_EXCEEDED',
  'OUT_OF_BOUNDS',
  'OVERLAP',
  'DISCONNECTED',
  'INVALID_LAYOUT',
]);

/**
 * What fixes a blocker. The cabin-and-life-support requirement names both parts: when the message
 * names only life support the chip targets that module (UTILITY), otherwise the cabin (CARGO).
 */
export function fixOf(code: string, message?: string): FixTarget {
  if (code === 'FUEL_SHORT' || code === 'fuel-short') return { kind: 'refuel' };
  if (
    code === 'PRESSURIZED_LIFE_SUPPORT' &&
    message !== undefined &&
    /life support/i.test(message) &&
    !/cabin/i.test(message)
  ) {
    return { kind: 'store', partClass: 'UTILITY' };
  }
  const partClass = STORE_CLASS[code];
  if (partClass !== undefined) return { kind: 'store', partClass };
  if (SHIP_CODES.has(code)) return { kind: 'ship' };
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
