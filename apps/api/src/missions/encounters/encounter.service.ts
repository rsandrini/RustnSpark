import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type MissionInstance } from '@prisma/client';
import type { DispatchSnapshot } from '../dispatch.service.js';
import { GameConfigService } from '../../config/game-config.service.js';
import { missionEvent, type MissionEvent } from '../../resolution/events/mission-event.js';
import { decidePolicy, type FactionRelation } from '../../resolution/encounter/encounter-policy.js';
import { pvpAllowed } from '../../resolution/encounter/encounter-chance.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PartsService } from '../../parts/parts.service.js';
import { rebuildDispatchData, type DispatchLeg } from '../dispatch.service.js';
import { RoutePresenceService } from './route-presence.service.js';

export interface EncounterPairResult {
  readonly missionAId: string;
  readonly missionBId: string;
  readonly routeId: string;
  readonly legIndex: number;
  readonly zone: number;
  readonly relation: FactionRelation;
  readonly decision: 'IGNORE' | 'FLEE' | 'ATTACK';
  readonly attackerShipId: string;
  readonly defenderShipId: string;
  readonly attackerPlayerId: string;
  readonly defenderPlayerId: string;
  readonly usesDispatchSnapshot: boolean;
}

// Order the two mission seeds lexicographically so the pair seed is stable
// across runs (mission UUIDs are random; only the seeds are fixed in tests).
function pairSeed(seedA: string, seedB: string): string {
  return seedA < seedB ? `${seedA}|${seedB}` : `${seedB}|${seedA}`;
}

function parseLegs(raw: unknown): DispatchLeg[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((leg) => {
    const candidate = leg as Partial<DispatchLeg>;
    return {
      routeId: candidate.routeId ?? '',
      distance: candidate.distance ?? 0,
      danger: candidate.danger ?? 0,
      zone: candidate.zone ?? 0,
      env: candidate.env ?? { id: 'none', level: 1, fuelMult: 1 },
    };
  });
}

function zoneForLeg(mission: MissionInstance, legIndex: number): number {
  const legs = parseLegs(mission.legs);
  return legs[legIndex]?.zone ?? 0;
}

function relationBetween(
  relationsA: unknown,
  factionA: string | null,
  factionB: string | null,
): FactionRelation {
  if (factionA && factionA === factionB) return 'ALLY';
  if (!factionA || !factionB) return 'NEUTRAL';
  let raw: unknown;
  if (typeof relationsA === 'object' && relationsA !== null && !Array.isArray(relationsA)) {
    raw = (relationsA as Record<string, unknown>)[factionB];
  }
  const normalized = typeof raw === 'string' ? raw.toLowerCase() : 'neutral';
  if (normalized === 'ally') return 'ALLY';
  if (normalized === 'hostile') return 'HOSTILE';
  return 'NEUTRAL';
}

// D1: encounters resolve when either overlapping mission resolves; the first
// writer inserts the ordered (A < B) Encounter row, the second reuses it so
// both MissionLogs carry the same event and the result is permutation-stable.
@Injectable()
export class EncounterService {
  private readonly logger = new Logger(EncounterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly parts: PartsService,
    private readonly presence: RoutePresenceService,
  ) {}

  async collectForResolve(
    mission: MissionInstance,
    snapshot: DispatchSnapshot,
    tx: Prisma.TransactionClient,
  ): Promise<MissionEvent[]> {
    if (!mission.playerId || !mission.shipId) return [];
    const overlaps = await this.presence.findOverlaps(mission.id, tx);
    if (overlaps.length === 0) return [];

    const events: MissionEvent[] = [];
    const seenPairs = new Set<string>();
    for (const overlap of overlaps) {
      const other = await tx.missionInstance.findUnique({
        where: { id: overlap.otherMissionId },
      });
      if (!other || !other.playerId || !other.shipId) continue;
      if (other.playerId === mission.playerId) continue;

      const missionAId = mission.id < other.id ? mission.id : other.id;
      const missionBId = mission.id < other.id ? other.id : mission.id;
      const pairKey = `${missionAId}|${missionBId}|${overlap.routeId}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      // Zone comes from mission A's legs so either resolve order reads the same value.
      const zoneLegIndex = missionAId === mission.id ? overlap.legIndex : overlap.otherLegIndex;
      const zone = zoneForLeg(missionAId === mission.id ? mission : other, zoneLegIndex);
      if (!pvpAllowed(zone)) continue;

      const [missionA, missionB] = missionAId === mission.id ? [mission, other] : [other, mission];

      const encounter = await this.findOrCreate(
        { missionA, missionB, routeId: overlap.routeId, legIndex: zoneLegIndex, zone },
        tx,
      );
      if (!encounter) continue;

      events.push(
        missionEvent({
          leg: zoneLegIndex,
          category: 'combat',
          type: 'pvp_encounter',
          actors: {
            playerShipId: mission.shipId,
            opponentShipId: other.shipId,
          },
          magnitude: 1,
        }),
      );
    }
    return events;
  }

  private async findOrCreate(
    input: {
      missionA: MissionInstance;
      missionB: MissionInstance;
      routeId: string;
      legIndex: number;
      zone: number;
    },
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string } | null> {
    const { missionA, missionB, routeId, legIndex, zone } = input;
    const where = {
      missionAId_missionBId_routeId_legIndex: {
        missionAId: missionA.id,
        missionBId: missionB.id,
        routeId,
        legIndex,
      },
    };
    const existing = await tx.encounter.findUnique({ where, select: { id: true } });
    if (existing) return existing;

    const result = await this.computeResult(missionA, missionB, routeId, legIndex, zone);
    // INSERT … ON CONFLICT DO NOTHING (createMany skipDuplicates): a unique-violation
    // aborts the PG transaction, so the old create-then-catch-retry could never re-read
    // in the same tx — only job-level retries recovered. ON CONFLICT lets both resolvers
    // race safely; the loser's insert no-ops and both re-read the winner's row.
    try {
      await tx.encounter.createMany({
        data: [
          {
            missionAId: missionA.id,
            missionBId: missionB.id,
            routeId,
            legIndex,
            seed: pairSeed(missionA.seed, missionB.seed),
            result: result as unknown as Prisma.InputJsonValue,
          },
        ],
        skipDuplicates: true,
      });
      return await tx.encounter.findUnique({ where, select: { id: true } });
    } catch (error) {
      this.logger.warn(
        `encounter insert failed for ${missionA.id}/${missionB.id}: ${String(error)}`,
      );
      return null;
    }
  }

  private async computeResult(
    missionA: MissionInstance,
    missionB: MissionInstance,
    routeId: string,
    legIndex: number,
    zone: number,
  ): Promise<EncounterPairResult> {
    const players = await this.prisma.player.findMany({
      where: { id: { in: [missionA.playerId!, missionB.playerId!] } },
      select: { id: true, factionId: true },
    });
    const factions = new Map(players.map((p) => [p.id, p.factionId]));
    const factionA = factions.get(missionA.playerId!) ?? null;
    const factionB = factions.get(missionB.playerId!) ?? null;
    const rowA = await this.prisma.faction.findUnique({
      where: { id: factionA ?? '' },
      select: { relations: true },
    });
    const relation = relationBetween(rowA?.relations, factionA, factionB);

    const { rules } = this.config.snapshot();
    const decision = decidePolicy(
      {
        relation,
        mission: null,
        missionForcesFlee: false,
        huntTargetMatch: false,
        stance: null,
        selfRating: 0,
        enemyRating: 0,
      },
      rules.stance,
    );

    // Defender is mission B; rebuild from frozen mid-flight rows (dispatch snapshot
    // semantics) so the defender need not be online or resolve first (S7.5).
    let defenderShipId: string;
    let usesDispatchSnapshot: boolean;
    try {
      const rebuilt = await rebuildDispatchData(this.prisma, this.parts, missionB);
      defenderShipId = rebuilt.snapshot.shipId;
      usesDispatchSnapshot = true;
    } catch {
      defenderShipId = missionB.shipId!;
      usesDispatchSnapshot = false;
    }

    return {
      missionAId: missionA.id,
      missionBId: missionB.id,
      routeId,
      legIndex,
      zone,
      relation,
      decision,
      attackerShipId: missionA.shipId!,
      defenderShipId,
      attackerPlayerId: missionA.playerId!,
      defenderPlayerId: missionB.playerId!,
      usesDispatchSnapshot,
    };
  }
}
