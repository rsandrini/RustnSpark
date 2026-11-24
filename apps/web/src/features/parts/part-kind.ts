import type { PartCatalogStats } from '../../api/generated';

export type PartKind =
  | 'bridge'
  | 'engine'
  | 'tank'
  | 'battery'
  | 'reactor'
  | 'weapon'
  | 'shield'
  | 'armor'
  | 'hull'
  | 'cargo'
  | 'cabin'
  | 'sensor'
  | 'life'
  | 'mining'
  | 'other';

export const PART_KIND_ORDER: readonly PartKind[] = [
  'bridge',
  'engine',
  'tank',
  'battery',
  'reactor',
  'weapon',
  'shield',
  'armor',
  'hull',
  'cargo',
  'cabin',
  'sensor',
  'life',
  'mining',
  'other',
];

// The family code (`partType`) carries a rarity suffix after the base name, so match by prefix.
const TYPE_PREFIXES: ReadonlyArray<readonly [string, PartKind]> = [
  ['engine_', 'engine'],
  ['tank_', 'tank'],
  ['battery_', 'battery'],
  ['reactor_', 'reactor'],
  ['weapon_', 'weapon'],
  ['shield_', 'shield'],
  ['armor_', 'armor'],
  ['hull', 'hull'],
  ['cargo', 'cargo'],
  ['passenger_cabin', 'cabin'],
  ['sensor_', 'sensor'],
  ['life_support', 'life'],
  ['mining_', 'mining'],
  ['bridge', 'bridge'],
];

const CLASS_KIND: Record<string, PartKind> = {
  ENGINE: 'engine',
  TANK: 'tank',
  BATTERY: 'battery',
  REACTOR: 'reactor',
  WEAPON: 'weapon',
  DEFENSE: 'armor',
  CARGO: 'cargo',
  SENSOR: 'sensor',
  BRIDGE: 'bridge',
  UTILITY: 'other',
};

/** The one kind of part a catalog entry is: type prefix first, then the flags, then the class. */
export function partKindOf(
  catalog: Pick<PartCatalogStats, 'partClass' | 'partType'> & {
    pressurized?: boolean;
    lifeSupport?: boolean;
  },
): PartKind {
  const type = catalog.partType ?? '';
  for (const [prefix, kind] of TYPE_PREFIXES) {
    if (type.startsWith(prefix)) return kind;
  }
  if (catalog.pressurized) return 'cabin';
  if (catalog.lifeSupport) return 'life';
  return CLASS_KIND[catalog.partClass] ?? 'other';
}

export function kindLabelKey(kind: PartKind): string {
  return `hangar.partKinds.${kind}`;
}
