import { fuelUnits } from '../economy/fuel-cost.calculator.js';
import { floatSpotOf, type FloatSpot } from '../ships/floating.js';
import { Injectable, Logger } from '@nestjs/common';
import type { DispatchJobData } from './dispatch.service.js';
// Constructor-injected services must be value imports: emitDecoratorMetadata cannot
// reference `import type` bindings, so the DI graph would see `Object`/`?` instead of
// the classes (Nest boot fails without this).
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { loadScavengeContext } from './scavenge-context.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { WalletService } from '../players/wallet.service.js';
import { resolveMission } from '../resolution/mission/mission.resolver.js';
import { isDead } from '../parts/condition.js';
import { buildResolveInput, contextFromLive } from './resolution-input.js';
import { EncounterService } from './encounters/encounter.service.js';
// S9.1: the event union is closed — every log is validated against the zod
// schema its version selects before it is written.
import { toJsonInput } from '../common/prisma-json.js';
import { rollConnectorsForPartType } from '../parts/roll-connectors-for-part-type.js';
import { MISSION_LOG_SCHEMA_VERSION } from '../reports/events/event.types.js';
import { parseMissionLogEvents } from '../reports/events/event.schema.js';

const NO_MISSION_LOG = '';
// Hash preview length for the resolve log line — not a balance value (missions/ lint scope).
const RULES_HASH_PREVIEW_LENGTH = 8;

export interface ResolveJobResult {
  readonly missionId: string;
  readonly status: 'DONE' | 'FAILED';
  readonly skipped: boolean;
  readonly rulesHash: string;
  readonly credited: number;
}

// Shared resolve step (plan S7.3, D19/D33) extracted in S7.4 so the worker processor,
// the reconciler, and resolve-on-read all run the exact same pipeline:
// - claims the mission with a conditional IN_TRANSIT → RESOLVING update BEFORE the work
//   transaction (a crash in between leaves it RESOLVING on purpose — the S7.4 reconciler
//   returns such missions to IN_TRANSIT via REQUEUE for a retry);
// - resolves with ConfigService.snapshot() taken at resolution time and stores that hash
//   in MissionLog, so in-flight tuning (D33) applies and the run stays replayable (D19);
// - writes log + ship + parts + wallet/PlayerEvent + loot + final status in ONE transaction,
//   with MissionLog.missionId's unique constraint as the hard double-effect guard;
// - a mission already DONE/FAILED short-circuits as skipped (idempotent double invocation).
@Injectable()
export class MissionResolveService {
  private readonly logger = new Logger(MissionResolveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly wallet: WalletService,
    private readonly events: PlayerEventService,
    private readonly encounters: EncounterService,
  ) {}

  async resolve(data: DispatchJobData): Promise<ResolveJobResult> {
    const { missionId, snapshot } = data;

    const claim = await this.prisma.missionInstance.updateMany({
      where: { id: missionId, status: 'IN_TRANSIT' },
      data: { status: 'RESOLVING' },
    });

    const mission = await this.prisma.missionInstance.findUnique({
      where: { id: missionId },
      include: { template: true, faction: true },
    });
    if (!mission) {
      throw new Error(`mission ${missionId} not found — not resolvable`);
    }
    if (claim.count === 0) {
      if (mission.status === 'DONE' || mission.status === 'FAILED') {
        return {
          missionId,
          status: mission.status,
          skipped: true,
          rulesHash: NO_MISSION_LOG,
          credited: 0,
        };
      }
      if (mission.status !== 'RESOLVING') {
        throw new Error(
          `mission ${missionId} is ${mission.status} — not resolvable (claim requires IN_TRANSIT)`,
        );
      }
      // Stuck or concurrent RESOLVING: proceed anyway; the MissionLog unique key is the
      // hard guard that only one invocation can commit its effects.
    }
    if (!mission.playerId || mission.shipId !== snapshot.shipId) {
      throw new Error(`mission ${missionId} ship/player claims do not match the dispatch snapshot`);
    }
    if (snapshot.legs.length === 0) {
      throw new Error(`mission ${missionId} dispatch snapshot carries no legs — not resolvable`);
    }

    const { hash, rules } = this.config.snapshot();

    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: mission.playerId },
      select: { factionId: true },
    });
    const destination = await this.prisma.location.findUniqueOrThrow({
      where: { id: mission.destinationId },
      select: { isolation: true },
    });
    const cargo = (mission.cargo ?? {}) as Record<string, unknown>;
    let materialRarity: string | undefined;
    if (mission.type === 'MINING' && typeof cargo['materialId'] === 'string') {
      const material = await this.prisma.material.findUnique({
        where: { id: cargo['materialId'] },
        select: { rarity: true },
      });
      materialRarity = material?.rarity.toLowerCase();
    }
    // Everything the engine reads from the live world is captured here and stored in the log
    // (D19): the admin replay must see this run's values, not whatever the map says later.
    const context = contextFromLive({
      type: mission.type,
      cargo: mission.cargo,
      encounterPolicy: mission.template.encounterPolicy,
      employerRelations: mission.faction.relations,
      playerFactionId: player.factionId,
      destinationIsolation: destination.isolation,
      materialRarity,
      reward: mission.reward,
      scavenge:
        mission.type === 'SCAVENGE'
          ? {
              ...(await loadScavengeContext(this.prisma, mission.destinationId)),
              ...(snapshot.handicapped === true ? { handicapped: true } : {}),
              ...(snapshot.onFoot === true ? { onFoot: true } : {}),
            }
          : null,
    });
    const outcome = resolveMission(
      buildResolveInput({
        missionId: mission.id,
        missionType: mission.type,
        seed: mission.seed,
        snapshot,
        context,
        rules,
      }),
    );
    const finalStatus: 'DONE' | 'FAILED' =
      outcome.status === 'success' || outcome.status === 'partial_failure' ? 'DONE' : 'FAILED';
    const credited = Math.round(outcome.creditsDelta);

    await this.prisma.$transaction(async (tx) => {
      // S7.5: detect PvP overlaps against RoutePresence and write at most one
      // Encounter row per (A, B, route, leg); both logs receive the same event.
      const encounterEvents = await this.encounters.collectForResolve(mission, snapshot, tx);
      // S9.1: validate the full event stream against the closed union before
      // anything is persisted — an emission that drifted from the schema fails
      // the resolve (loudly) instead of storing a log no report can read.
      const events = parseMissionLogEvents(MISSION_LOG_SCHEMA_VERSION, [
        ...outcome.events,
        ...encounterEvents,
      ]);
      await tx.missionLog.create({
        data: {
          missionId,
          playerId: mission.playerId!,
          seed: mission.seed,
          rulesHash: hash,
          outcome: outcome.status,
          // S9.0 / D36: enriched events (cascade, failure consequence, fuelLost)
          // bump the log schema to 2; v1 rows keep their stored version untouched.
          schemaVersion: MISSION_LOG_SCHEMA_VERSION,
          shipSnapshot: toJsonInput(snapshot),
          // `events` above is the zod-validated stream; legs are the resolver's own output.
          legs: toJsonInput({ legs: outcome.legs, events, context }),
        },
      });
      // What the pirates took from storage (chosen by the seeded engine and frozen in the log):
      // the parts leave the player's inventory in the same transaction as everything else.
      const stolenIds = outcome.events.flatMap((event) => event.stolen ?? []);
      if (stolenIds.length > 0) {
        const taken = await tx.partInstance.findMany({
          where: { id: { in: stolenIds }, ownerPlayerId: mission.playerId!, location: 'INVENTORY' },
          select: { id: true, partType: true },
        });
        if (taken.length > 0) {
          await tx.partInstance.deleteMany({ where: { id: { in: taken.map((part) => part.id) } } });
          await this.events.record(
            {
              playerId: mission.playerId!,
              type: 'pirate.theft',
              payload: { missionId, partTypes: taken.map((part) => part.partType) },
            },
            tx,
          );
        }
      }
      // A scavenging job's finds land in the inventory in the same transaction as the log: used
      // parts as new part instances, scrap as fixed-price materials.
      for (const event of outcome.events) {
        const found = event.found;
        if (event.type !== 'scavenge_find' || found === undefined) continue;
        if (found.kind === 'part') {
          await tx.partInstance.create({
            data: {
              partType: found.partType,
              ownerPlayerId: mission.playerId!,
              condition: found.condition,
              location: 'INVENTORY',
              connectors: toJsonInput(await rollConnectorsForPartType(tx, found.partType)),
            },
          });
        } else {
          const materialId = `scrap_${found.partType}`;
          const exists = await tx.material.findUnique({
            where: { id: materialId },
            select: { id: true },
          });
          if (exists !== null) {
            await tx.playerMaterial.upsert({
              where: { playerId_materialId: { playerId: mission.playerId!, materialId } },
              create: { playerId: mission.playerId!, materialId, quantity: 1 },
              update: { quantity: { increment: 1 } },
            });
          }
        }
      }
      const finalCondition = new Map(outcome.parts.map((part) => [part.id, part.condition]));
      const fuelCapAfter = snapshot.parts
        .filter((part) => part.connected)
        .filter((part) => !isDead(Math.round(finalCondition.get(part.id) ?? part.condition), rules))
        .reduce((sum, part) => sum + part.catalog.fuelCap, 0);
      for (const part of outcome.parts) {
        await tx.partInstance.updateMany({
          where: { id: part.id },
          // Whole numbers only: the screen shows whole percent, and a stored 79.6 shown as 80 made
          // "no change" repairs cost money. The log's events are integers already.
          data: { condition: Math.round(part.condition) },
        });
      }
      // A ship that ran dry floats where it stopped: on the route of the leg it could not finish,
      // as far along as the fuel it still had would carry it.
      let floatSpot: FloatSpot | null = null;
      if (outcome.shipStatus === 'ADRIFT') {
        const dry = outcome.events.find((event) => event.type === 'fuel_exhausted');
        const routeIds = snapshot.legs.map((leg) => leg.routeId ?? '');
        if (dry !== undefined && routeIds.every((id) => id !== '')) {
          const routes = await tx.route.findMany({ where: { id: { in: routeIds } } });
          const leg = snapshot.legs[dry.leg];
          floatSpot =
            leg === undefined
              ? null
              : floatSpotOf({
                  legIndex: dry.leg,
                  fuelLeft: dry.magnitude,
                  legBurn: fuelUnits({
                    fuelUse: snapshot.parts.reduce((sum, part) => sum + part.catalog.fuelUse, 0),
                    distance: leg.distance,
                    envFuelMult: leg.env.fuelMult,
                  }),
                  originId: mission.originId,
                  routeIds,
                  routes: new Map(routes.map((route) => [route.id, route])),
                });
        }
      }
      await tx.ship.update({
        where: { id: snapshot.shipId },
        data: {
          // A tank that ended the run dead (or one that is simply gone) takes its fuel with it.
          fuel: Math.min(Math.max(0, outcome.fuel), fuelCapAfter),
          status: outcome.shipStatus === 'ADRIFT' ? 'ADRIFT' : 'IN_PORT',
          ...(finalStatus === 'DONE' ? { currentLocationId: mission.destinationId } : {}),
          floatRouteId: floatSpot?.routeId ?? null,
          floatFromId: floatSpot?.fromId ?? null,
          floatProgress: floatSpot?.progress ?? null,
          rescueAt: null,
        },
      });
      // A ship left adrift loses the mission for sure: what it dug up or picked on the way is lost with it.
      for (const entry of outcome.shipStatus === 'ADRIFT' ? [] : outcome.loot) {
        if (entry.quantity <= 0) continue;
        await tx.playerMaterial.upsert({
          where: {
            playerId_materialId: { playerId: mission.playerId!, materialId: entry.materialId },
          },
          create: {
            playerId: mission.playerId!,
            materialId: entry.materialId,
            quantity: entry.quantity,
          },
          update: { quantity: { increment: entry.quantity } },
        });
      }
      // Debit as well as credit: combat_loss_penalty makes creditsDelta negative on a
      // failed mission, and the old `credited > 0` guard silently dropped that wallet
      // movement while PlayerEvent still recorded the negative delta. Negative balances
      // are legal here (GDD §14: only missions pay the debt back; market blocks spend).
      if (credited > 0) {
        await this.wallet.credit(mission.playerId!, credited, `mission:${missionId}:payout`, tx);
      } else if (credited < 0) {
        await this.wallet.debitAllowingNegative(
          mission.playerId!,
          -credited,
          `mission:${missionId}:payout`,
          tx,
        );
      }
      // D37: the summary view renders the balance after the mission. Read it in the
      // same transaction, after the payout movement, so it is exactly the balance
      // this event closes on — the current balance drifts as soon as any later
      // spend happens, which would break "identical log → identical text".
      const { credits: balanceAfter } = await tx.player.findUniqueOrThrow({
        where: { id: mission.playerId! },
        select: { credits: true },
      });
      await this.events.record(
        {
          playerId: mission.playerId!,
          type: 'mission.resolved',
          creditsDelta: credited,
          payload: {
            missionId,
            outcome: outcome.status,
            integrity: outcome.integrity,
            balanceAfter,
          },
        },
        tx,
      );
      await tx.missionInstance.update({ where: { id: missionId }, data: { status: finalStatus } });
    });

    this.logger.log(
      `resolved mission ${missionId} → ${finalStatus} (rules ${hash.slice(0, RULES_HASH_PREVIEW_LENGTH)})`,
    );
    return {
      missionId,
      status: finalStatus,
      skipped: false,
      rulesHash: hash,
      credited,
    };
  }
}
