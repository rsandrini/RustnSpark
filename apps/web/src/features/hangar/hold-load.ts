/** The delivery terms the active mission carries (`info.cargo`). */
export interface CargoTerms {
  mode: 'min' | 'fixed' | 'open';
  need: number;
}

/**
 * Cargo units a mission puts aboard. The ship response only reports the hold at rest (its
 * `missionCargo` is 0), and the active mission does not carry the dispatched load, so this mirrors the
 * server's `cargoLoadFor`: min loads nothing, fixed loads `need` capped at the hold, open fills the hold.
 */
export function missionLoadUnits(terms: CargoTerms | null | undefined, capacity: number): number {
  if (terms === null || terms === undefined) return 0;
  switch (terms.mode) {
    case 'min':
      return 0;
    case 'fixed':
      return Math.min(terms.need, capacity);
    case 'open':
      return capacity;
  }
}
