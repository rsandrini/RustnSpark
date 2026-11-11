import type { ActiveMission, MissionOffer, RequirementCheck } from '../../../api/generated';
import { previewOf, shipOf } from './sandbox-ship';
import {
  PLACE,
  RACE_FRIEND_LEGS,
  RACE_PILOT_LEGS,
  SANDBOX_WORLD,
  fuelNeededFor,
  jobsAt,
  routeOf,
  type JobSpec,
  type ModuleKind,
} from './sandbox-world';
import type { Sandbox, SandboxMission } from './sandbox-state';

const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const MS = 1000;
/** Mobility a race needs, and the friend's and the pilot's pace over the three legs (seconds each). */
const RACE_MIN_MOBILITY = 1;
const FRIEND_MOBILITY = 3.5;
const FRIEND_LEGS = RACE_FRIEND_LEGS;
const PILOT_LEGS = RACE_PILOT_LEGS;
const RACE_WINDOW = 3;

const TYPE_OF: Record<JobSpec['kind'], MissionOffer['type']> = {
  race: 'RACE',
  passengers: 'TRANSPORT',
  crates: 'DELIVERY',
  final: 'TRANSPORT',
};

/** Which kind of job the pilot's ship is built for: a passenger module, or a cargo hold (null = neither yet). */
export function moduleKindOf(sandbox: Sandbox): ModuleKind | null {
  const { catalogById } = sandbox.lookups();
  const installed = sandbox.state.layout.map((placement) =>
    catalogById.get(placement.partInstanceId),
  );
  if (installed.some((stats) => stats?.pressurized === true)) return 'passengers';
  if (installed.some((stats) => (stats?.crg ?? 0) > 0)) return 'crates';
  return null;
}

function requirementsOf(sandbox: Sandbox, job: JobSpec): RequirementCheck[] {
  const ship = shipOf(sandbox);
  const preview = previewOf(sandbox, sandbox.state.layout);
  const { catalogById } = sandbox.lookups();
  const installed = sandbox.state.layout.map((placement) =>
    catalogById.get(placement.partInstanceId),
  );
  const checks: RequirementCheck[] = [];
  for (const problem of preview.viability.problems) {
    checks.push({ code: problem.code, message: problem.message, met: false });
  }
  if (job.kind === 'race') {
    checks.push({
      code: 'SPEED',
      message: 'Too slow for this mission',
      met: ship.sheet.mob >= RACE_MIN_MOBILITY,
      needed: RACE_MIN_MOBILITY,
      actual: ship.sheet.mob,
      unit: 'mobility',
    });
  } else if (job.kind === 'crates') {
    checks.push({
      code: 'CARGO_MODULE',
      message: 'Needs a Cargo Module fitted on the ship',
      met: ship.sheet.crg >= job.cargoNeed,
      needed: job.cargoNeed,
      actual: ship.sheet.crg,
      unit: 'cargo',
    });
  } else {
    checks.push({
      code: 'PASSENGER_MODULE',
      message: 'Needs a Passenger Module fitted on the ship',
      met: installed.some((stats) => stats?.pressurized === true),
    });
  }
  return checks;
}

function raceInfoOf(sandbox: Sandbox, job: JobSpec): NonNullable<MissionOffer['info']['race']> {
  const friend = sandbox.config.friendName ?? 'Kite';
  const total = (legs: readonly number[]) => legs.reduce((sum, seconds) => sum + seconds, 0);
  return {
    rivals: [
      {
        name: friend,
        mobility: FRIEND_MOBILITY,
        level: 1,
        durationSeconds: total(FRIEND_LEGS),
        bestSeconds: total(FRIEND_LEGS),
        worstSeconds: total(FRIEND_LEGS),
      },
    ],
    you: {
      durationSeconds: total(PILOT_LEGS),
      bestSeconds: total(PILOT_LEGS),
      worstSeconds: total(PILOT_LEGS),
    },
    minMobility: RACE_MIN_MOBILITY,
    prizeShares: [1],
    projection: projectionOf(friend, job),
  };
}

/** The order after each leg: the pilot leads the first, the friend takes the lead on the second and wins the third. */
function projectionOf(
  friend: string,
  job: JobSpec,
): NonNullable<NonNullable<MissionOffer['info']['race']>['projection']> {
  if (job.kind !== 'race') return [];
  const rows = [];
  let you = 0;
  let them = 0;
  for (let leg = 0; leg < RACE_WINDOW; leg += 1) {
    you += PILOT_LEGS[leg] ?? 0;
    them += FRIEND_LEGS[leg] ?? 0;
    const standings = [
      {
        name: friend,
        you: false,
        legSeconds: FRIEND_LEGS[leg] ?? 0,
        totalSeconds: them,
        trouble: false,
      },
      {
        name: 'you',
        you: true,
        legSeconds: PILOT_LEGS[leg] ?? 0,
        totalSeconds: you,
        trouble: false,
      },
    ].sort((a, b) => a.totalSeconds - b.totalSeconds);
    rows.push({ standings });
  }
  return rows;
}

/** A job as an offer on the board: eligibility and the estimate follow the ship as it is now. */
export function offerOf(sandbox: Sandbox, job: JobSpec): MissionOffer {
  const ship = shipOf(sandbox);
  const checks = requirementsOf(sandbox, job);
  const reasons = checks
    .filter((check) => !check.met)
    .map(({ code, message }) => ({ code, message }));
  const routes = job.routes.map((id) => routeOf(id));
  const totalDistance = routes.reduce((sum, route) => sum + (route?.distance ?? 0), 0);
  const peakDanger = routes.reduce((peak, route) => Math.max(peak, route?.danger ?? 0), 0);
  const seconds = job.routes.reduce((sum, id) => sum + (routeOf(id)?.seconds ?? 0), 0);
  const taken = sandbox.state.mission?.job.id === job.id;
  const status: MissionOffer['status'] = taken
    ? sandbox.state.mission?.status === 'IN_TRANSIT'
      ? 'IN_TRANSIT'
      : 'ACCEPTED'
    : 'AVAILABLE';
  const reward = sandbox.rewardOf(job);
  return {
    id: job.id,
    templateId: `sandbox-${job.kind}`,
    type: TYPE_OF[job.kind],
    factionId: 'free',
    originId: job.origin,
    destinationId: job.destination,
    legs: job.routes.map((routeId) => ({
      routeId,
      distance: routeOf(routeId)?.distance ?? 0,
      danger: routeOf(routeId)?.danger ?? 0,
    })),
    cargo: {},
    reward,
    expiresAt: FAR_FUTURE,
    status,
    playerId: taken ? sandbox.config.profile.id : null,
    privatePlayerId: null,
    shipId: taken ? 'prologue-ship' : null,
    acceptedAt: taken ? new Date(sandbox.state.mission?.acceptedAt ?? 0).toISOString() : null,
    arrivalAt:
      taken && sandbox.state.mission?.arrivalAt != null
        ? new Date(sandbox.state.mission.arrivalAt).toISOString()
        : null,
    deadlineAt: null,
    seed: job.id,
    version: 1,
    rewardEstimate: reward,
    eligibility: { eligible: reasons.length === 0, reasons },
    info: {
      title: job.title,
      description: job.brief,
      giver: null,
      legCount: job.routes.length,
      totalDistance,
      peakDanger,
      peakZone: peakDanger > 0 ? 1 : 0,
      estimate: {
        durationSeconds: seconds,
        fuelNeeded: fuelNeededFor(job.routes, ship.sheet.fuelUse),
      },
      material: null,
      mining: null,
      requirements: checks,
      cargo: job.kind === 'crates' ? { mode: 'fixed', need: job.cargoNeed, unitPay: 0 } : null,
      race: job.kind === 'race' ? raceInfoOf(sandbox, job) : null,
    },
  };
}

/** The jobs on the board where the ship is docked. */
export function boardOf(sandbox: Sandbox): MissionOffer[] {
  const state = sandbox.state;
  if (state.shipLost || state.mission?.status === 'IN_TRANSIT') return [];
  const jobs = jobsAt(
    Math.min(state.slot, 3) as 0 | 1 | 2 | 3,
    state.locationId,
    moduleKindOf(sandbox),
  );
  return jobs.map((job) => offerOf(sandbox, job));
}

/** The job the pilot has taken, as the active-mission list shows it (with the leg windows once it has left). */
export function activeOf(sandbox: Sandbox, mission: SandboxMission): ActiveMission {
  const offer = offerOf(sandbox, mission.job);
  let cursor = mission.startedAt ?? 0;
  const legWindows =
    mission.startedAt === null
      ? []
      : mission.job.routes.map((routeId, legIndex) => {
          const from = cursor;
          cursor += (mission.legSeconds[legIndex] ?? 0) * MS;
          return {
            legIndex,
            routeId,
            from: new Date(from).toISOString(),
            to: new Date(cursor).toISOString(),
          };
        });
  const { info, ...rest } = offer;
  return {
    ...rest,
    status: mission.status,
    playerId: sandbox.config.profile.id,
    shipId: 'prologue-ship',
    acceptedAt: new Date(mission.acceptedAt).toISOString(),
    arrivalAt: mission.arrivalAt === null ? null : new Date(mission.arrivalAt).toISOString(),
    legWindows,
    brief: { title: mission.job.title, description: mission.job.brief },
    giver: null,
    info,
  };
}

export { PLACE, SANDBOX_WORLD };
