import { Injectable, Logger } from '@nestjs/common';
import type { DispatchJobData } from './dispatch.service.js';
// Constructor-injected services must be value imports: emitDecoratorMetadata cannot
// reference `import type` bindings, so the DI graph would see `Object`/`?` instead of
// the classes (Nest boot fails without this).
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { WalletService } from '../players/wallet.service.js';
import type { InstalledPart } from '../parts/part.types.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import type { EscapePreset } from '../resolution/encounter/escape.resolver.js';
import type { FactionRelation, Stance } from '../resolution/encounter/encounter-policy.js';
import type { EscortClient, LegRoute, PartSnapshot } from '../resolution/leg/leg.resolver.js';
import { resolveMission } from '../resolution/mission/mission.resolver.js';
import type { MissionInput, MissionSnapshot } from '../resolution/mission/mission.resolver.js';
import { shipTier } from '../ships/ship-tier.js';
import { PROVISIONAL_TIER } from './generator/template.filler.js';
import { EncounterService } from './encounters/encounter.service.js';
// S9.1: the event union is closed — every log is validated against the zod
// schema its version selects before it is written.
import { toJsonInput } from '../common/prisma-json.js';
import { MISSION_LOG_SCHEMA_VERSION } from '../reports/events/event.types.js';
import { parseMissionLogEvents } from '../reports/events/event.schema.js';

const OBJECT_CARRIED_TYPES: readonly string[] = ['DELIVERY', 'TRANSPORT', 'RESCUE'];
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

function relationOf(
  relations: unknown,
  factionId: string,
): { key: string; relation: FactionRelation } {
  let raw: unknown;
  if (typeof relations === 'object' && relations !== null && !Array.isArray(relations)) {
    raw = (relations as Record<string, unknown>)[factionId];
  }
  const normalized = typeof raw === 'string' ? raw.toLowerCase() : 'neutral';
  if (normalized === 'ally') return { key: 'ally', relation: 'ALLY' };
  if (normalized === 'hostile') return { key: 'hostile', relation: 'HOSTILE' };
  return { key: 'neutral', relation: 'NEUTRAL' };
}

function parseClient(raw: unknown): EscortClient | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate['shipId'] !== 'string' ||
    typeof candidate['maxHp'] !== 'number' ||
    typeof candidate['hp'] !== 'number'
  ) {
    return null;
  }
  return { shipId: candidate['shipId'], maxHp: candidate['maxHp'], hp: candidate['hp'] };
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

    const installed: InstalledPart[] = snapshot.parts.map((part) => ({
      instance: { id: part.id, partType: part.partType, condition: part.condition },
      catalog: part.catalog,
    }));
    const sheet = deriveSheet(installed, rules);
    const partSnaps: PartSnapshot[] = snapshot.parts.map((part) => ({
      id: part.id,
      partClass: part.catalog.partClass,
      providesEsc: part.catalog.esc > 0,
      condition: part.condition,
    }));
    const missionSnapshot: MissionSnapshot = {
      shipId: snapshot.shipId,
      parts: partSnaps,
      sheet,
      fuel: snapshot.fuel,
      hp: sheet.hp,
      esc: sheet.esc,
    };

    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: mission.playerId },
      select: { factionId: true },
    });
    const destination = await this.prisma.location.findUniqueOrThrow({
      where: { id: mission.destinationId },
      select: { isolation: true },
    });
    const cargo = (mission.cargo ?? {}) as Record<string, unknown>;
    const policy = (mission.template.encounterPolicy ?? {}) as Record<string, unknown>;
    const employer = relationOf(mission.faction.relations, player.factionId ?? '');

    const legs: readonly LegRoute[] = snapshot.legs;
    let mining: MissionInput['mining'];
    if (mission.type === 'MINING' && typeof cargo['materialId'] === 'string') {
      const material = await this.prisma.material.findUnique({
        where: { id: cargo['materialId'] },
        select: { rarity: true },
      });
      const lastLeg = legs[legs.length - 1];
      mining = {
        stop: {
          env: lastLeg?.env.id ?? 'open',
          materialId: cargo['materialId'],
          materialRarity: material?.rarity.toLowerCase() ?? 'common',
        },
        miner: { min: sheet.min, condition: sheet.condition },
      };
    }
    const contractedMining =
      cargo['contracted'] === true &&
      typeof cargo['materialId'] === 'string' &&
      typeof cargo['quantity'] === 'number'
        ? { materialId: cargo['materialId'], requiredQuantity: cargo['quantity'] }
        : undefined;

    // D29: accept finalizes the board reward from the accepting ship's tier; resolve
    // must rate the payout (and combat win credits, which scale with tier) from the
    // same tier. The dispatch snapshot carries each part's basePrice for this; older
    // job payloads without it fall back to PROVISIONAL_TIER (tier 1).
    const snapshotTier = shipTier(
      snapshot.parts.map((part) => ({ basePrice: part.catalog.basePrice ?? 0 })),
      rules,
    );
    const missionInput: MissionInput = {
      id: mission.id,
      type: mission.type,
      legs,
      tier: snapshot.parts.every((part) => typeof part.catalog.basePrice === 'number')
        ? snapshotTier
        : PROVISIONAL_TIER,
      isolation: destination.isolation,
      factionRelation: employer.key,
      relation: employer.relation,
      stance: snapshot.stance as Stance,
      preset: ((policy['preset'] as string | undefined) ?? 'CRUISE') as EscapePreset,
      missionOwner: (policy['missionOwner'] as 'player' | 'enemy' | null | undefined) ?? null,
      missionForcesFlee: policy['missionForcesFlee'] === true,
      objectCarried: OBJECT_CARRIED_TYPES.includes(mission.type),
      client: parseClient(cargo['client']),
      ...(mining ? { mining } : {}),
      ...(contractedMining ? { contractedMining } : {}),
    };

    const outcome = resolveMission({
      seed: mission.seed,
      snapshot: missionSnapshot,
      mission: missionInput,
      rules,
    });
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
          legs: toJsonInput({ legs: outcome.legs, events }),
        },
      });
      for (const part of outcome.parts) {
        await tx.partInstance.updateMany({
          where: { id: part.id },
          data: { condition: part.condition },
        });
      }
      await tx.ship.update({
        where: { id: snapshot.shipId },
        data: {
          fuel: Math.max(0, outcome.fuel),
          status: outcome.shipStatus === 'ADRIFT' ? 'ADRIFT' : 'IN_PORT',
          ...(finalStatus === 'DONE' ? { currentLocationId: mission.destinationId } : {}),
        },
      });
      for (const entry of outcome.loot) {
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
          payload: { missionId, outcome: outcome.status, integrity: outcome.integrity, balanceAfter },
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
