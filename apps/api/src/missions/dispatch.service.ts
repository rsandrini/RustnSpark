import {
  applyEngineLevels,
  clampLevels,
  type EngineLevels,
} from '../resolution/engine/engine.js';
import { fuelUnits } from '../economy/fuel-cost.calculator.js';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { MissionInstance } from '@prisma/client';
import { MissionProducer } from '../jobs/producers/mission.producer.js';
import { GameConfigService } from '../config/game-config.service.js';
import type { ConnectorLayout } from '../parts/connectors.js';
import type { Placement } from '../parts/part.types.js';
import { pickCatalogStats, PartsService } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyConnectivity } from '../ships/connectivity.js';
import { withDirectionProblems } from '../ships/direction.js';
import { connectedPartIds } from '../ships/geometry.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import { loadHold, withHoldProblem } from '../ships/hold.js';
import { cargoLoadFor, cargoTermsOf } from './cargo-mode.js';
import { checkViability } from '../ships/viability.js';
import { flightShip, type AppliedPenalty } from '../ships/penalties.js';
import { jobDelayMs } from '../config/debug-timing.js';
import { missionDuration, type DurationClass } from './duration.calculator.js';
import { missionStatusAfter } from './mission.state-machine.js';

export interface DispatchLeg {
  readonly routeId: string;
  readonly distance: number;
  readonly danger: number;
  readonly zone: number;
  readonly env: { readonly id: string; readonly level: number; readonly fuelMult: number };
}

// D19: the snapshot frozen at dispatch time is what resolution (S7.3) and replay (S7.6)
// read — every part's catalog stats and every leg's route/environment values, never the
// live tables. Carried in the job payload; a lost payload is rebuilt by the reconciler.
export interface DispatchSnapshot {
  readonly shipId: string;
  readonly fuel: number;
  readonly currentLocationId: string;
  readonly stance: string;
  readonly energyMode: string;
  readonly parts: ReadonlyArray<{
    readonly id: string;
    readonly partType: string;
    readonly condition: number;
    readonly catalog: ReturnType<typeof pickCatalogStats>;
    /** Connectors v0.1: whether this part had a compatible connector chain back to the bridge
        at dispatch time. Carried through for Connectors v0.2 (mid-mission disconnection,
        separate future spec) — not consumed by anything yet except being present in the
        stored snapshot. */
    readonly connected: boolean;
  }>;
  readonly legs: readonly DispatchLeg[];
  /** Loose parts when the ship left port: the only parts a pirate can take (frozen, D19). */
  readonly storage?: ReadonlyArray<{ readonly id: string; readonly partType: string }>;
  /** Flight warnings the ship left port with (blocked engines/weapons, a cruise power shortfall):
      the parts above are already weakened by them, this is what the report says about it. */
  readonly penalties?: readonly AppliedPenalty[];
  /** A scavenging job started by a ship that was not flight-ready: it finds less. */
  readonly handicapped?: boolean;
  /** A scavenging job done on foot, without the ship: no encounters, no wear, no fuel. */
  readonly onFoot?: boolean;
  /** The levels the engines ran at (engine tuning on the bridge). */
  readonly engine?: EngineLevels;
  /** What a delivery loaded (fixed or open cargo): the units aboard and the terms they are paid on. */
  readonly cargo?: {
    readonly mode: 'fixed' | 'open';
    readonly units: number;
    readonly need: number;
    readonly unitPay: number;
  };
  /** Resolved with the layered damage model (shield → armor → hull → parts). Older runs lack it. */
  readonly layered?: boolean;
}

export interface DispatchJobData {
  readonly missionId: string;
  readonly arrivalAt: string;
  readonly snapshot: DispatchSnapshot;
}

export interface DispatchResponse {
  readonly missionId: string;
  readonly arrivalAt: Date;
  readonly serverTime: Date;
  readonly durationSeconds?: number;
  readonly durationClass?: DurationClass;
}

// Exported in S7.4: the reconciler rebuilds a DispatchJobData when the delayed job (and
// therefore its frozen snapshot) is gone, parsing mission.legs with the same validation
// dispatch used at enqueue time.
export function parseDispatchLegs(legs: unknown): DispatchLeg[] {
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new ConflictException({ error: 'MISSION_MALFORMED' });
  }
  return legs.map((leg) => {
    const candidate = leg as Partial<DispatchLeg>;
    if (
      typeof candidate.routeId !== 'string' ||
      candidate.routeId.length === 0 ||
      typeof candidate.distance !== 'number'
    ) {
      throw new ConflictException({ error: 'MISSION_MALFORMED' });
    }
    return {
      routeId: candidate.routeId,
      distance: candidate.distance,
      danger: candidate.danger ?? 0,
      zone: candidate.zone ?? 0,
      env: candidate.env ?? { id: 'none', level: 1, fuelMult: 1 },
    };
  });
}

// S7.4: reconstruct the job payload from live rows when the original job was lost. Ship
// fuel/stance/location are unchanged mid-flight (in-transit lock, S7.7), installed parts
// still match the dispatch snapshot, and legs come from mission.legs — enough for
// MissionResolveService to run the same pipeline the worker would have.
export async function rebuildDispatchData(
  prisma: PrismaService,
  parts: PartsService,
  mission: MissionInstance,
): Promise<DispatchJobData> {
  if (!mission.shipId || !mission.playerId) {
    throw new Error(`mission ${mission.id} has no ship/player — cannot rebuild dispatch data`);
  }
  if (!mission.arrivalAt) {
    throw new Error(`mission ${mission.id} is ${mission.status} without arrivalAt`);
  }
  const ship = await prisma.ship.findUniqueOrThrow({ where: { id: mission.shipId } });
  const rows = await parts.findPlayerParts(mission.playerId);
  const installedRows = rows.filter(
    (part) => part.location === 'INSTALLED' && part.shipId === ship.id,
  );
  const installed = installedRows.map((part) => ({
    instance: part,
    catalog: pickCatalogStats(part.partCatalog),
  }));
  const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
  const connectorsByInstance = new Map(
    installedRows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
  );
  const connectedIds = connectedPartIds(
    (ship.layout as unknown as Placement[]) ?? [],
    catalogForConnectivity,
    connectorsByInstance,
  );
  const installedConnected = applyConnectivity(installed, connectedIds);
  const legs = parseDispatchLegs(mission.legs);
  return {
    missionId: mission.id,
    arrivalAt: mission.arrivalAt.toISOString(),
    snapshot: {
      shipId: ship.id,
      fuel: ship.fuel,
      currentLocationId: ship.currentLocationId,
      stance: ship.stance,
      energyMode: ship.energyMode,
      parts: installedConnected.map((part) => ({
        id: part.instance.id,
        partType: part.instance.partType,
        condition: part.instance.condition,
        catalog: part.catalog,
        connected: connectedIds.has(part.instance.id),
      })),
      legs,
      storage: rows
        .filter((part) => part.location === 'INVENTORY')
        .map((part) => ({ id: part.id, partType: part.partType })),
      ...(loadedCargoOf(mission) !== undefined ? { cargo: loadedCargoOf(mission) } : {}),
    },
  };
}

/** The cargo a delivery loaded at dispatch, as kept on the mission row. */
function loadedCargoOf(mission: MissionInstance): DispatchSnapshot['cargo'] | undefined {
  const load = (mission.cargo as { load?: DispatchSnapshot['cargo'] } | null)?.load;
  return load !== undefined && typeof load.units === 'number' ? load : undefined;
}

const MS_PER_SECOND = 1000;

function arrivalOf(mission: MissionInstance): Date {
  if (!mission.arrivalAt) {
    throw new Error(`mission ${mission.id} is ${mission.status} without arrivalAt`);
  }
  return mission.arrivalAt;
}

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly parts: PartsService,
    private readonly producer: MissionProducer,
  ) {}

  async dispatch(
    shipId: string,
    missionId: string,
    playerId: string,
    options: { onFoot?: boolean } = {},
  ): Promise<DispatchResponse> {
    const probe = await this.prisma.missionInstance.findUnique({ where: { id: missionId } });
    if (!probe) {
      throw new NotFoundException('mission not found');
    }
    // Unclaimed offers (playerId null) fall through to the state gate, which answers
    // MISSION_NOT_ACCEPTED; a mission claimed by someone else stays a 404.
    if (probe.playerId !== null && probe.playerId !== playerId) {
      throw new NotFoundException('mission not found');
    }
    if (probe.status === 'IN_TRANSIT' && probe.shipId === shipId && probe.playerId === playerId) {
      return { missionId, arrivalAt: arrivalOf(probe), serverTime: new Date() };
    }

    const { rules } = this.config.snapshot();
    const serverTime = new Date();
    // Read once, outside the transaction: a plain per-account flag, not part of the ship/mission
    // state the lock below protects.
    const debugFastOps =
      (
        await this.prisma.player.findUnique({
          where: { id: playerId },
          select: { debugFastOps: true },
        })
      )?.debugFastOps ?? false;

    const outcome = await this.prisma.$transaction(async (tx) => {
      const mission = await tx.missionInstance.findUnique({ where: { id: missionId } });
      if (!mission || (mission.playerId !== null && mission.playerId !== playerId)) {
        throw new NotFoundException('mission not found');
      }
      if (
        mission.status === 'IN_TRANSIT' &&
        mission.shipId === shipId &&
        mission.playerId === playerId
      ) {
        return { kind: 'replay', mission } as const;
      }
      if (missionStatusAfter(mission.status, 'DISPATCH') === null) {
        throw new ConflictException({ error: 'MISSION_NOT_ACCEPTED' });
      }
      if (mission.shipId !== shipId) {
        throw new ConflictException({ error: 'SHIP_MISMATCH' });
      }

      // Lock the Ship row before status/repair/location checks so a concurrent
      // repair.start or sell serializes on the same lock (review R-S7.7).
      await tx.$queryRaw`SELECT id FROM "Ship" WHERE id = ${shipId} FOR UPDATE`;
      const ship = await tx.ship.findUnique({ where: { id: shipId } });
      if (!ship || ship.ownerPlayerId !== playerId) {
        throw new NotFoundException('ship not found');
      }
      if (ship.status !== 'IN_PORT') {
        throw new ConflictException({ error: 'SHIP_NOT_IN_PORT' });
      }
      // S8.4: an in-flight repair holds the ship in port — dispatch waits for completion.
      const repairing = await tx.repairJob.findFirst({
        where: { shipId: ship.id, status: 'PENDING' },
        select: { id: true },
      });
      if (repairing) {
        throw new ConflictException({ error: 'SHIP_REPAIRING' });
      }
      if (ship.currentLocationId !== mission.originId) {
        throw new ConflictException({ error: 'SHIP_NOT_AT_ORIGIN' });
      }

      const rows = await this.parts.findPlayerParts(playerId, tx);
      const installedRows = rows.filter(
        (part) => part.location === 'INSTALLED' && part.shipId === ship.id,
      );
      const installed = installedRows.map((part) => ({
        instance: part,
        catalog: pickCatalogStats(part.partCatalog),
      }));
      const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
      const connectorsByInstance = new Map(
        installedRows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
      );
      const connectedIds = connectedPartIds(
        (ship.layout as unknown as Placement[]) ?? [],
        catalogForConnectivity,
        connectorsByInstance,
      );
      const installedConnected = applyConnectivity(installed, connectedIds);
      const sheet = deriveSheet(installedConnected, rules);
      // Part direction rules apply to every dispatch that flies the ship — except a scavenging job,
      // which is manual work at the current place: the ship never travels, so nothing points anywhere.
      const flightViability = checkViability(sheet, installedConnected, rules);
      // The spare parts travel with the ship: they must fit the bridge's slots; the mission's cargo, the cargo space.
      // What a delivery loads (a fixed load, or all the room an open one has): it takes cargo space.
      const template = await tx.missionTemplate.findUnique({
        where: { id: mission.templateId },
        select: { requirements: true },
      });
      const terms = cargoTermsOf(mission.type, template?.requirements, rules);
      const load = terms === null ? null : cargoLoadFor(terms, sheet.crg);
      const hold = await loadHold(
        tx,
        playerId,
        rules.ship.spare_part_slots,
        sheet.crg,
        load?.units ?? 0,
      );
      const viability =
        mission.type === 'SCAVENGE'
          ? flightViability
          : withHoldProblem(
              withDirectionProblems(
                flightViability,
                (ship.layout as unknown as Placement[]) ?? [],
                catalogForConnectivity,
                connectorsByInstance,
              ),
              hold,
            );
      // Scavenging is manual work at the place: any ship (even one that cannot fly) can do it, it
      // only finds less when the ship is not flight-ready.
      const onFoot = mission.type === 'SCAVENGE' && options.onFoot === true;
      const handicapped =
        mission.type === 'SCAVENGE' &&
        !onFoot &&
        (!viability.viable || viability.warnings.length > 0);
      if (!viability.viable && mission.type !== 'SCAVENGE') {
        throw new BadRequestException({ error: 'SHIP_NOT_VIABLE', problems: viability.problems });
      }
      // Warnings do not ground the ship, they weaken it: the flight is resolved from the parts as
      // they would actually perform (a scavenging job never flies, so nothing is weakened).
      const flight =
        mission.type === 'SCAVENGE'
          ? { parts: installedConnected, sheet, penalties: [] as AppliedPenalty[] }
          : flightShip(
              installedConnected,
              (ship.layout as unknown as Placement[]) ?? [],
              catalogForConnectivity,
              connectorsByInstance,
              rules,
            );
      // Engine tuning (set on the bridge): the chemical and ion engines run at their chosen levels,
      // so thrust, fuel burn and power already reflect them for time, fuel and the whole flight.
      const engineLevels =
        mission.type === 'SCAVENGE'
          ? undefined
          : clampLevels({ chem: ship.chemLevel, ion: ship.ionLevel }, rules);
      if (engineLevels !== undefined) {
        flight.parts = applyEngineLevels(flight.parts, engineLevels, rules);
        flight.sheet = deriveSheet(flight.parts, rules);
      }
      // GDD §7 balance 3: a chemical engine needs fuel aboard; ion ships skip this.
      if (mission.type !== 'SCAVENGE' && sheet.fuelUse > 0 && ship.fuel <= 0) {
        throw new ConflictException({ error: 'FUEL_EMPTY' });
      }

      const legs = parseDispatchLegs(mission.legs);
      // The burn per leg is fixed by distance, terrain and the engines, and nothing refuels the
      // ship on the way: a route that needs more fuel than is aboard ends adrift every time, so
      // it never leaves port (a pump failing on the way can only make the burn worse).
      const fuelNeeded = legs.reduce(
        (sum, leg) =>
          sum +
          fuelUnits({
            fuelUse: flight.sheet.fuelUse,
            distance: leg.distance,
            envFuelMult: leg.env.fuelMult,
          }),
        0,
      );
      if (fuelNeeded > ship.fuel) {
        throw new ConflictException({
          error: 'FUEL_INSUFFICIENT',
          needed: Math.ceil(fuelNeeded),
          have: Math.floor(ship.fuel),
        });
      }
      const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
      const { durationSeconds, durationClass } = missionDuration({
        totalDistance,
        mobility: flight.sheet.mob,
        durationK: rules.missions.duration_k,
        timeScale: rules.missions.time_scale,
        classCutoffs: rules.missions.duration_class_cutoffs,
      });
      const arrivalAt = new Date(serverTime.getTime() + durationSeconds * MS_PER_SECOND);

      const snapshot: DispatchSnapshot = {
        shipId: ship.id,
        fuel: ship.fuel,
        currentLocationId: ship.currentLocationId,
        stance: ship.stance,
        energyMode: ship.energyMode,
        parts: flight.parts.map((part) => ({
          id: part.instance.id,
          partType: part.instance.partType,
          condition: part.instance.condition,
          catalog: part.catalog,
          connected: connectedIds.has(part.instance.id),
        })),
        legs,
        storage: rows
          .filter((part) => part.location === 'INVENTORY')
          .map((part) => ({ id: part.id, partType: part.partType })),
        ...(flight.penalties.length > 0 ? { penalties: flight.penalties } : {}),
        ...(handicapped ? { handicapped: true } : {}),
        ...(onFoot ? { onFoot: true } : {}),
        ...(engineLevels !== undefined ? { engine: engineLevels } : {}),
        ...(terms !== null && load !== null && terms.mode !== 'min'
          ? { cargo: { mode: terms.mode, units: load.units, need: terms.need, unitPay: terms.unitPay } }
          : {}),
        layered: true,
      };

      const missionUpdate = await tx.missionInstance.updateMany({
        where: { id: mission.id, status: 'ACCEPTED', playerId, shipId },
        data: {
          status: 'IN_TRANSIT',
          arrivalAt,
          // what the delivery loaded, kept on the row so a rebuilt job pays the same
          ...(snapshot.cargo !== undefined
            ? { cargo: { ...((mission.cargo as object) ?? {}), load: snapshot.cargo } }
            : {}),
        },
      });
      if (missionUpdate.count === 0) {
        throw new ConflictException({ error: 'MISSION_NOT_ACCEPTED' });
      }

      const shipUpdate = await tx.ship.updateMany({
        where: { id: ship.id, status: 'IN_PORT' },
        data: { status: 'ON_MISSION' },
      });
      if (shipUpdate.count === 0) {
        throw new ConflictException({ error: 'SHIP_NOT_IN_PORT' });
      }

      // Presence windows split [serverTime, arrivalAt] pro-rata by leg distance.
      let covered = 0;
      for (let index = 0; index < legs.length; index += 1) {
        const leg = legs[index]!;
        const from = new Date(
          serverTime.getTime() + (durationSeconds * covered * MS_PER_SECOND) / totalDistance,
        );
        covered += leg.distance;
        const to = new Date(
          serverTime.getTime() + (durationSeconds * covered * MS_PER_SECOND) / totalDistance,
        );
        await tx.$executeRaw`
          INSERT INTO "RoutePresence" ("id", "missionId", "shipId", "routeId", "legIndex", "window")
          VALUES (
            ${randomUUID()}, ${mission.id}, ${ship.id}, ${leg.routeId}, ${index},
            tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)
          )
        `;
      }

      const finalMission = await tx.missionInstance.findUniqueOrThrow({
        where: { id: mission.id },
      });
      return {
        kind: 'dispatched',
        mission: finalMission,
        durationSeconds,
        durationClass,
        snapshot,
      } as const;
    });

    if (outcome.kind === 'replay') {
      return { missionId, arrivalAt: arrivalOf(outcome.mission), serverTime: new Date() };
    }

    const arrivalAt = arrivalOf(outcome.mission);
    try {
      const data: DispatchJobData = {
        missionId,
        arrivalAt: arrivalAt.toISOString(),
        snapshot: outcome.snapshot,
      };
      await this.producer.enqueueResolve(
        data,
        jobDelayMs(arrivalAt.getTime() - serverTime.getTime(), rules, debugFastOps),
      );
    } catch (error) {
      // Enqueue runs after commit by design: the mission is already reconcilable state,
      // so a Redis blip must not fail the dispatch (S7.2 acceptance, plan line 435).
      this.logger.warn(
        `enqueue of mission ${missionId} failed; reconciler will resolve it: ${String(error)}`,
      );
    }

    return {
      missionId,
      arrivalAt,
      serverTime,
      durationSeconds: outcome.durationSeconds,
      durationClass: outcome.durationClass,
    };
  }
}
