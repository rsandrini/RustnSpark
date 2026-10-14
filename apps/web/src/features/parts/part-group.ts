// A finer grouping of the shop's part classes, for display only: one class (Defense, Engine,
// Weapon) holds several kinds a pilot looks for separately. The class itself, which the game
// rules key on, is untouched; this only names the kind from the part type's family.
const GROUPS: ReadonlyArray<{ cls: string; prefix: RegExp; group: string }> = [
  { cls: 'DEFENSE', prefix: /^hull/, group: 'HULL' },
  { cls: 'DEFENSE', prefix: /^armor/, group: 'ARMOR' },
  { cls: 'DEFENSE', prefix: /^shield/, group: 'SHIELD' },
  { cls: 'ENGINE', prefix: /^engine_chem/, group: 'ENGINE_CHEM' },
  { cls: 'ENGINE', prefix: /^engine_ion/, group: 'ENGINE_ION' },
  { cls: 'WEAPON', prefix: /^weapon_ballistic/, group: 'WEAPON_BALLISTIC' },
  { cls: 'WEAPON', prefix: /^weapon_laser/, group: 'WEAPON_LASER' },
  { cls: 'WEAPON', prefix: /^weapon_missile/, group: 'WEAPON_MISSILE' },
];

/** The shop group of a part: its family's kind where the class is split, else the class. */
export function partGroupOf(partType: string, partClass: string): string {
  const match = GROUPS.find((entry) => entry.cls === partClass && entry.prefix.test(partType));
  return match?.group ?? partClass;
}

/** Whether a part belongs to a chosen filter, which is a group or a whole class. */
export function matchesPartGroup(
  partType: string,
  partClass: string,
  selected: string | null,
): boolean {
  if (selected === null) return true;
  return selected === partClass || selected === partGroupOf(partType, partClass);
}

/** The class a group belongs to (a class is its own group), to keep chips in class order. */
export function classOfGroup(group: string): string {
  return GROUPS.find((entry) => entry.group === group)?.cls ?? group;
}
