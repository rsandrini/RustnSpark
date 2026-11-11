import type { ApiInterceptor, InterceptedRequest } from '../../../api/client';
import { ApiError } from '../../../api/client';
import type {
  EnginePreview,
  PartCatalogStats,
  Placement,
  PreviewResponse,
  ShipResponse,
} from '../../../api/generated';
import { computePortMarks } from '../../hangar/connectors';
import { directionViolations, isOutsideYard, placementIssue } from '../../hangar/hangar.geometry';
import {
  PROLOGUE_BRIDGE,
  PROLOGUE_CARGO,
  PROLOGUE_ENGINE,
  PROLOGUE_HULL,
  PROLOGUE_PLACES,
  PROLOGUE_TANK,
  PROLOGUE_WORLD,
} from '../prologue-fixtures';
import {
  SANDBOX_DIALOGUE,
  SANDBOX_DISPLAY,
  SANDBOX_FACTIONS,
  SANDBOX_FORMAT_ID,
  SANDBOX_FORMATS,
  SANDBOX_MATERIALS,
  SANDBOX_NOTICES,
  SANDBOX_STATS,
  SANDBOX_TUTORIAL_PROGRESS,
  catalogListOf,
  descriptionOf,
  inventoryItemOf,
} from './sandbox-fixtures';
import { connectedPartIds, sheetOf } from './sandbox-geometry';
import { SHIP_ID, SHIP_NAME, type Sandbox } from './sandbox-state';

const CATALOG_PARTS = [
  PROLOGUE_BRIDGE,
  PROLOGUE_TANK,
  PROLOGUE_HULL,
  PROLOGUE_ENGINE,
  PROLOGUE_CARGO,
] as const;

const NOT_FOUND = 404;
const BAD_REQUEST = 400;
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
  return { catalogById, connectorsById, disconnected, counted };
}

const YARD_CELLS = new Set(SANDBOX_FORMATS[0]?.cells.map(([x, y]) => `${x},${y}`));

/** The placements as the server stores them: a part with a cell outside the yard is flagged `outside` (it is parked). */
function flaggedLayout(sandbox: Sandbox, layout: readonly Placement[]): Placement[] {
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

function previewOf(sandbox: Sandbox, candidate: readonly Placement[]): PreviewResponse {
  const layout = flaggedLayout(sandbox, candidate);
  const onShip = layout.filter((placement) => placement.outside !== true);
  const outsideIds = new Set(
    layout
      .filter((placement) => placement.outside === true)
      .map((placement) => placement.partInstanceId),
  );
  const { catalogById, connectorsById, disconnected, counted } = viewOf(sandbox, onShip);
  const sheet = sheetOf(counted, sandbox.state.fuel);
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
  return {
    id: SHIP_ID,
    ownerPlayerId: sandbox.config.profile.id,
    name: SHIP_NAME,
    fuel: state.fuel,
    status: 'IN_PORT',
    currentLocationId: PROLOGUE_PLACES.home,
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
    yard: { cells: SANDBOX_FORMATS[0]?.cells.map(([x, y]) => [x, y] as [number, number]) ?? [] },
    disconnectedPartIds: preview.disconnectedPartIds,
    routeCoverage: preview.routeCoverage,
    activity: { kind: 'idle', until: null, missionId: null, repairUntil: null },
  };
}

function enginePreviewOf(sandbox: Sandbox, chem: number, ion: number): EnginePreview {
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

type Params = Record<string, string>;
type Handler = (context: { sandbox: Sandbox; params: Params; body: unknown }) => unknown;

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly names: readonly string[];
  readonly handler: Handler;
}

/** `/v1/ships/:id/assemble` becomes a pattern that captures `id`. */
function route(method: string, template: string, handler: Handler): Route {
  const names: string[] = [];
  const source = template.replace(/:[A-Za-z]+/g, (token) => {
    names.push(token.slice(1));
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${source}$`), names, handler };
}

const layoutOf = (body: unknown): Placement[] => {
  const layout = (body as { layout?: Placement[] } | null)?.layout;
  if (!Array.isArray(layout)) throw new ApiError(BAD_REQUEST, 'layout is required', 'BAD_REQUEST');
  return layout;
};

/**
 * What the server refuses on a save: parts on top of each other, or the bridge outside the yard. Any other part may
 * be parked outside (it is flagged and keeps the ship on the ground); a wrong connection is only reported.
 */
function assertSavable(sandbox: Sandbox, layout: readonly Placement[]): void {
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

const ROUTES: readonly Route[] = [
  route('GET', '/v1/players/me', ({ sandbox }) => ({
    id: sandbox.config.profile.id,
    name: sandbox.config.profile.name,
    credits: sandbox.state.credits,
    locale: sandbox.config.profile.locale,
    role: sandbox.config.profile.role,
    factionId: null,
    // the opening is the guide: the checklist card stays out of the way
    tutorialDone: true,
    prologueOutcome: null,
    ...(sandbox.config.profile.publicId === undefined
      ? {}
      : { publicId: sandbox.config.profile.publicId }),
    isGuest: false,
  })),
  route('GET', '/v1/players/me/stats', () => SANDBOX_STATS),
  route('GET', '/v1/players/me/tutorial-progress', () => SANDBOX_TUTORIAL_PROGRESS),
  route('GET', '/v1/players/me/dialogue', () => SANDBOX_DIALOGUE),
  route('GET', '/v1/players/me/mentor', () => null),
  route('GET', '/v1/factions', () => SANDBOX_FACTIONS),
  route('GET', '/v1/display', () => SANDBOX_DISPLAY),
  route('GET', '/v1/places/art', () => ({ places: {} })),
  route('GET', '/v1/system/notices', () => SANDBOX_NOTICES),
  route('GET', '/v1/materials', () => SANDBOX_MATERIALS),
  route('GET', '/v1/ship-formats', () => SANDBOX_FORMATS),
  route('GET', '/v1/locations', () => PROLOGUE_WORLD),
  route('GET', '/v1/parts/catalog', () => catalogListOf(CATALOG_PARTS)),
  route('GET', '/v1/catalog/parts/:partType', ({ params }) => {
    const part = CATALOG_PARTS.find((entry) => entry.catalog.partType === params.partType);
    if (part === undefined) throw new ApiError(NOT_FOUND, 'part not found', 'NOT_FOUND');
    return {
      id: part.catalog.partType,
      kind: 'part',
      displayName: part.name,
      description: descriptionOf(part),
      category: part.catalog.partClass,
      rarity: part.rarity,
    };
  }),
  route('GET', '/v1/ships', ({ sandbox }) => [shipOf(sandbox)]),
  route('GET', '/v1/ships/:id', ({ sandbox }) => shipOf(sandbox)),
  route('GET', '/v1/ships/:id/escort', () => ({
    state: 'unavailable',
    reasons: ['NOT_STUCK'],
    destinationId: null,
    durationSeconds: null,
    arrivesAt: null,
    nextAvailableAt: null,
  })),
  route('GET', '/v1/inventory', ({ sandbox }) =>
    sandbox.state.parts.map((entry) => inventoryItemOf(entry, SHIP_ID)),
  ),
  route('POST', '/v1/ships/:id/preview', ({ sandbox, body }) => previewOf(sandbox, layoutOf(body))),
  route('POST', '/v1/ships/:id/assemble', ({ sandbox, body }) => {
    const layout = layoutOf(body);
    assertSavable(sandbox, layout);
    sandbox.saveLayout(flaggedLayout(sandbox, layout));
    return shipOf(sandbox);
  }),
  route('POST', '/v1/ships/:id/energy-mode', ({ sandbox }) => shipOf(sandbox)),
  route('POST', '/v1/ships/:id/engine-levels', ({ sandbox }) => shipOf(sandbox)),
  route('POST', '/v1/ships/:id/engine-preview', ({ sandbox, body }) => {
    const levels = (body ?? {}) as { chem?: number; ion?: number };
    return enginePreviewOf(sandbox, levels.chem ?? 1, levels.ion ?? 1);
  }),
];

function matchRoute(request: InterceptedRequest): { route: Route; params: Params } | null {
  const path = request.path.split('?')[0] ?? request.path;
  for (const candidate of ROUTES) {
    if (candidate.method !== request.method) continue;
    const match = candidate.pattern.exec(path);
    if (match === null) continue;
    const params: Params = {};
    candidate.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] ?? '');
    });
    return { route: candidate, params };
  }
  return null;
}

/**
 * The fake server of the opening: it answers the calls the game's real screens make, from the sandbox. A call it does
 * not know goes to the network (so the auth and the final onboarding calls keep working).
 */
export function sandboxInterceptor(sandbox: Sandbox): ApiInterceptor {
  return async (request) => {
    const found = matchRoute(request);
    if (found === null) return { handled: false };
    const value = await found.route.handler({
      sandbox,
      params: found.params,
      body: request.body,
    });
    return { handled: true, value };
  };
}
