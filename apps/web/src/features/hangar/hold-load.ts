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

/** What the flight chip and the hold's usage line count: the mission's cargo units, or a dig's ore space. */
export type HoldFigure =
  { kind: 'cargo'; used: number; capacity: number } | { kind: 'ore'; space: number };

/**
 * A mining run keeps its ore in a separate in-flight ore space (the server's `floor(crg * space_factor)`,
 * sent on the offer as `info.mining.spaceUnits`); every other mission counts the cargo it loads. Null
 * when a mining run has no ore space figure (no rig).
 */
export function holdFigureOf(
  mission: {
    type: string;
    info?: { cargo?: CargoTerms | null; mining?: { spaceUnits: number } | null } | undefined;
  },
  capacity: number,
): HoldFigure | null {
  if (mission.type === 'MINING') {
    const space = mission.info?.mining?.spaceUnits;
    return space === undefined ? null : { kind: 'ore', space };
  }
  return { kind: 'cargo', used: missionLoadUnits(mission.info?.cargo, capacity), capacity };
}
