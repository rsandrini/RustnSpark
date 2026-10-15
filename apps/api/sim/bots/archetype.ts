/**
 * Which build the pilot grows toward. The temperament and playstyle decide what to fly; the
 * archetype decides what the ship becomes between flights:
 *   `chem`        — the historical target kit, no preference (the legacy control);
 *   `chem-shield` — the chemical ship, but a battery and a shield come first;
 *   `ion-shield`  — swap the chemical engine for an ion drive (no fuel), then battery + shield.
 */
export type Archetype = 'chem' | 'chem-shield' | 'ion-shield';

/** An unknown archetype string is the legacy kit — the run's historical default. */
export function archetypeOf(raw: string): Archetype {
  switch (raw) {
    case 'chem-shield':
    case 'ion-shield':
      return raw;
    default:
      return 'chem';
  }
}

/** Family bases bought before anything else, in order, for this archetype. */
export function priorityBasesOf(archetype: Archetype): readonly string[] {
  switch (archetype) {
    case 'chem':
      return [];
    case 'chem-shield':
      return ['battery_small', 'shield_basic'];
    case 'ion-shield':
      return ['reactor_solar', 'engine_ion_micro', 'battery_small', 'shield_basic'];
  }
}

/** Whether the chemical engine/tank families are part of the target (they are not for ion). */
export function usesChemEngine(archetype: Archetype): boolean {
  return archetype !== 'ion-shield';
}
