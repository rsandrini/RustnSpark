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
import { pickCatalogStats, PartsService } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import { checkViability } from '../ships/viability.js';
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
  readonly parts: ReadonlyArray<{
    readonly id: string;
    readonly partType: string;
    readonly condition: number;
    readonly catalog: ReturnType<typeof pickCatalogStats>;
  }>;
  readonly legs: readonly DispatchLeg[];
  /** Loose parts when the ship left port: the only parts a pirate can take (frozen, D19). */
  readonly storage?: ReadonlyArray<{ readonly id: string; readonly partType: string }>;
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
  const legs = parseDispatchLegs(mission.legs);
  return {
    missionId: mission.id,
    arrivalAt: mission.arrivalAt.toISOString(),
    snapshot: {
      shipId: ship.id,
      fuel: ship.fuel,
      currentLocationId: ship.currentLocationId,
      stance: ship.stance,
      parts: installedRows.map((part) => ({
        id: part.id,
        partType: part.partType,
        condition: part.condition,
        catalog: pickCatalogStats(part.partCatalog),
      })),
      legs,
      storage: rows
        .filter((part) => part.location === 'INVENTORY')
        .map((part) => ({ id: part.id, partType: part.partType })),
    },
  };
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

  async dispatch(shipId: string, missionId: string, playerId: string): Promise<DispatchResponse> {
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
      const sheet = deriveSheet(installed, rules);
      const viability = checkViability(sheet, installed, rules);
      if (!viability.viable) {
        throw new BadRequestException({ error: 'SHIP_NOT_VIABLE', problems: viability.problems });
      }
      // GDD §7 balance 3: a chemical engine needs fuel aboard; ion ships skip this.
      if (sheet.fuelUse > 0 && ship.fuel <= 0) {
        throw new ConflictException({ error: 'FUEL_EMPTY' });
      }

      const legs = parseDispatchLegs(mission.legs);
      const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
      const { durationSeconds, durationClass } = missionDuration({
        totalDistance,
        mobility: sheet.mob,
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
        parts: installed.map((part) => ({
          id: part.instance.id,
          partType: part.instance.partType,
          condition: part.instance.condition,
          catalog: part.catalog,
        })),
        legs,
        storage: rows
          .filter((part) => part.location === 'INVENTORY')
          .map((part) => ({ id: part.id, partType: part.partType })),
      };

      const missionUpdate = await tx.missionInstance.updateMany({
        where: { id: mission.id, status: 'ACCEPTED', playerId, shipId },
        data: { status: 'IN_TRANSIT', arrivalAt },
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
        jobDelayMs(arrivalAt.getTime() - serverTime.getTime(), rules),
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
