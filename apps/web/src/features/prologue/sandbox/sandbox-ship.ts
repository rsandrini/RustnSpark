import type {
  ShipProfile,
  EnginePreview,
  PartCatalogStats,
  Placement,
  PreviewResponse,
  ShipResponse,
} from '../../../api/generated';
import { ApiError } from '../../../api/client';
import { computePortMarks } from '../../hangar/connectors';
import { directionViolations, isOutsideYard, placementIssue } from '../../hangar/hangar.geometry';
import { SANDBOX_FORMAT_ID, SANDBOX_FORMATS } from './sandbox-fixtures';
import { connectedPartIds, sheetOf } from './sandbox-geometry';
import { SHIP_ID, SHIP_NAME, type Sandbox } from './sandbox-state';

/** The prologue ship is fixed: a small passenger hauler, so it always reads as a Transport. */
const SANDBOX_PROFILE: ShipProfile = {
  cargo: 0.1,
  passengers: 0.5,
  firepower: 0,
  defense: 0.05,
  mobility: 0.1,
  range: 0.1,
  mining: 0,
};

const ONE_ROUTE_COVERED = { covered: 1, total: 1 } as const;

/** The yard's parts keyed by instance id, with the catalog stats the geometry reads. */
function viewOf(sandbox: Sandbox, layout: readonly Placement[]) {
  const { catalogById, connectorsById } = sandbox.lookups();
  const connected = connectedPartIds(layout, catalogById, connectorsById);
  const disconnected = layout
    .map((placement) => placement.partInstanceId)
    .filter((id) => !connected.has(id));
  const counted = layout
    .filter((placement) => connected.has(placement.partInstanceId))
    .map((placement) => catalogById.get(placement.partInstanceId))
    .filter((stats): stats is PartCatalogStats => stats !== undefined);
  const wear = new Map(sandbox.state.parts.map((entry) => [entry.id, entry.part.condition ?? 100]));
  const conditions = layout
    .filter((placement) => connected.has(placement.partInstanceId))
    .map((placement) => wear.get(placement.partInstanceId) ?? 100);
  return { catalogById, connectorsById, disconnected, counted, conditions };
}

const YARD_CELLS = new Set(SANDBOX_FORMATS[0]?.cells.map(([x, y]) => `${x},${y}`));

/** The placements as the server stores them: a part with a cell outside the yard is flagged `outside` (it is parked). */
export function flaggedLayout(sandbox: Sandbox, layout: readonly Placement[]): Placement[] {
  const { catalogById } = sandbox.lookups();
  return layout.map((placement) => {
    const stats = catalogById.get(placement.partInstanceId);
    const outside =
      stats !== undefined &&
      isOutsideYard(stats, placement.gx, placement.gy, placement.rot, YARD_CELLS);
    const { outside: _drop, ...rest } = placement;
    return outside ? { ...rest, outside: true } : rest;
  });
}

export function previewOf(
  sandbox: Sandbox,
  candidate: readonly Placement[],
  /** Parts the pilot does not own yet, counted as if installed (the market's "what would it add" question). */
  extra: readonly PartCatalogStats[] = [],
): PreviewResponse {
  const layout = flaggedLayout(sandbox, candidate);
  const onShip = layout.filter((placement) => placement.outside !== true);
  const outsideIds = new Set(
    layout
      .filter((placement) => placement.outside === true)
      .map((placement) => placement.partInstanceId),
  );
  const { catalogById, connectorsById, disconnected, counted, conditions } = viewOf(
    sandbox,
    onShip,
  );
  const sheet = sheetOf([...counted, ...extra], sandbox.state.fuel, [
    ...conditions,
    ...extra.map(() => 100),
  ]);
  const problems: PreviewResponse['viability']['problems'] = [];
  if (!counted.some((stats) => stats.partClass === 'BRIDGE')) {
    problems.push({ code: 'NO_BRIDGE', message: 'Ship has no bridge installed.' });
  }
  if (!counted.some((stats) => stats.partClass === 'ENGINE')) {
    problems.push({ code: 'NO_ENGINE', message: 'Ship has no engine installed.' });
  }
  if (disconnected.length > 0) {
    problems.push({
      code: 'PART_DISCONNECTED',
      message: `${disconnected.length} installed part(s) are not connected to the bridge: fix their connectors or remove them.`,
    });
  }
  if (outsideIds.size > 0) {
    problems.push({
      code: 'PART_OUTSIDE',
      message: `${outsideIds.size} part(s) are outside the ship: move them inside or remove them.`,
    });
  }
  const wrong = new Set(
    computePortMarks(onShip, catalogById, connectorsById)
      .filter((mark) => mark.state === 'incorrect')
      .map((mark) => mark.partInstanceId),
  );
  if (wrong.size > 0) {
    problems.push({
      code: 'PORT_INCORRECT',
      message: `${wrong.size} installed part(s) have a connector against one that does not fit: move or rotate them.`,
    });
  }
  const warnings: PreviewResponse['viability']['warnings'] = [];
  for (const violation of directionViolations(onShip, catalogById)) {
    warnings.push({
      code: violation.kind === 'exhaust' ? 'EXHAUST_BLOCKED' : 'FACING_BLOCKED',
      message: 'A part is in the way of an engine or weapon.',
    });
  }
  return {
    sheet,
    shipClass: 'TRANSPORT',
    profile: SANDBOX_PROFILE,
    profileModifier: null,
    viability: { viable: problems.length === 0, problems, warnings },
    layout,
    omittedPartInstanceIds: [],
    disconnectedPartIds: disconnected,
    routeCoverage: sheet.fuelUse > 0 ? ONE_ROUTE_COVERED : null,
  };
}

/** The ship as the screens read it: the layout, the sheet of the connected parts, the fuel. */
export function shipOf(sandbox: Sandbox): ShipResponse {
  const state = sandbox.state;
  const preview = previewOf(sandbox, state.layout);
  const mission = state.mission;
  const flying = mission?.status === 'IN_TRANSIT';
  return {
    id: SHIP_ID,
    ownerPlayerId: sandbox.config.profile.id,
    name: SHIP_NAME,
    fuel: state.fuel,
    status: flying ? 'ON_MISSION' : 'IN_PORT',
    currentLocationId: state.locationId,
    stance: 'NEUTRAL',
    energyMode: 'FULL',
    engineLevels: { chem: 1, ion: 1 },
    formatId: SANDBOX_FORMAT_ID,
    formatChangeRequired: false,
    float: null,
    rescue: null,
    layout: [...state.layout],
    sheet: preview.sheet,
    shipClass: 'TRANSPORT',
    profile: SANDBOX_PROFILE,
    profileModifier: null,
    yard: { cells: SANDBOX_FORMATS[0]?.cells.map(([x, y]) => [x, y] as [number, number]) ?? [] },
    disconnectedPartIds: preview.disconnectedPartIds,
    routeCoverage: preview.routeCoverage,
    activity: flying
      ? {
          kind: 'flying',
          until: mission.arrivalAt === null ? null : new Date(mission.arrivalAt).toISOString(),
          missionId: mission.id,
          repairUntil: null,
        }
      : { kind: 'idle', until: null, missionId: null, repairUntil: null },
  };
}

export function enginePreviewOf(sandbox: Sandbox, chem: number, ion: number): EnginePreview {
  const sheet = shipOf(sandbox).sheet;
  return {
    levels: { chem, ion },
    ranges: { chem: [0.5, 1.5], ion: [0.5, 2.5] },
    groups: sheet.pot > 0 ? ['chem'] : [],
    thrust: { chem: sheet.pot * chem, ion: 0 },
    baselineThrust: { chem: sheet.pot, ion: 0 },
    mobility: sheet.mob * chem,
    fuelUse: sheet.fuelUse * chem,
    baseline: { mobility: sheet.mob, fuelUse: sheet.fuelUse },
    power: { supply: 10, demand: 7, spare: 3 },
    wearPerLeg: { chem: 0, ion: 0, battery: 0 },
    cleanChance: 1,
  };
}

/**
 * What the server refuses on a save: parts on top of each other, or the bridge outside the yard. Any other part may
 * be parked outside (it is flagged and keeps the ship on the ground); a wrong connection is only reported.
 */
export function assertSavable(sandbox: Sandbox, layout: readonly Placement[]): void {
  const { catalogById } = sandbox.lookups();
  const problems: Array<{ code: string; message: string }> = [];
  for (const placement of layout) {
    const others = layout.filter((other) => other.partInstanceId !== placement.partInstanceId);
    const issue = placementIssue(
      others,
      catalogById,
      placement.partInstanceId,
      placement.gx,
      placement.gy,
      placement.rot,
      YARD_CELLS,
    );
    if (issue === 'overlap') problems.push({ code: 'OVERLAP', message: 'Parts overlap.' });
    if (issue === 'bounds')
      problems.push({ code: 'OUT_OF_BOUNDS', message: 'Part is outside the grid.' });
  }
  if (problems.length > 0) {
    throw new ApiError(409, 'The layout is not valid.', 'INVALID_LAYOUT', {
      statusCode: 409,
      message: { error: 'INVALID_LAYOUT', problems },
    });
  }
}

/** The tank's size (the connected tanks) and how much of it is empty. */
export function tankSpace(sandbox: Sandbox): { cap: number; space: number } {
  const cap = shipOf(sandbox).sheet.fuelCap;
  return { cap, space: Math.max(0, cap - sandbox.state.fuel) };
}
