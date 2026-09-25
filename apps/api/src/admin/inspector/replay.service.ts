import { Injectable, NotFoundException } from '@nestjs/common';
import { resolveMission, type MissionOutcome } from '../../resolution/mission/mission.resolver.js';
import type { DispatchSnapshot } from '../../missions/dispatch.service.js';
import {
  buildResolveInput,
  contextFromLive,
  type ResolutionContext,
} from '../../missions/resolution-input.js';
import { GameConfigService } from '../../config/game-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface ReplayableLog {
  readonly rulesHash: string;
  readonly shipSnapshot: unknown;
  readonly missionId: string;
  /** MissionLog.legs jsonb: `{ legs, events, context? }` — `context` exists on logs written since D19b. */
  readonly legs?: unknown;
}

// Corrupt jsonb must 404 like the e2e's malformed-snapshot case, but the runtime check
// must not narrow a typed readonly array to any[] (Array.isArray's any[] guard would),
// so the validation lives in a helper that returns the declared type.
function requireArray<T>(value: T, what: string): T {
  if (!Array.isArray(value)) {
    throw new NotFoundException(`stored dispatch snapshot is missing or malformed (${what})`);
  }
  return value;
}

function storedContext(legs: unknown): ResolutionContext | null {
  if (typeof legs !== 'object' || legs === null) return null;
  const context = (legs as { context?: unknown }).context;
  if (typeof context !== 'object' || context === null) return null;
  const candidate = context as Partial<ResolutionContext>;
  return typeof candidate.isolation === 'number' && typeof candidate.factionRelation === 'string'
    ? (candidate as ResolutionContext)
    : null;
}

// S11.4 / S7.6 (D19): re-run a stored MissionLog from its embedded dispatch snapshot +
// resolution context + seed + rulesHash via ConfigService.byHash — never the live config,
// catalog or map. The input is built by the SAME function the worker used
// (missions/resolution-input), so the two cannot drift. Logs written before the context was
// stored fall back to the live world for those few facts (best effort, and reported as such by a
// mismatch, never papered over): the report it renders comes out of the *recomputed* events.
@Injectable()
export class ReplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
  ) {}

  async replay(log: ReplayableLog): Promise<MissionOutcome> {
    const rules = await this.config.byHash(log.rulesHash);
    const snapshot = log.shipSnapshot as DispatchSnapshot | null;
    if (snapshot === null) {
      throw new NotFoundException('stored dispatch snapshot is missing or malformed');
    }
    requireArray(snapshot.parts, 'parts');
    requireArray(snapshot.legs, 'legs');

    const mission = await this.prisma.missionInstance.findUniqueOrThrow({
      where: { id: log.missionId },
      include: { template: true, faction: true },
    });
    if (mission.playerId === null) {
      throw new NotFoundException('mission has no owning player to replay for');
    }
    const context = storedContext(log.legs) ?? (await this.liveContext(mission));

    return resolveMission(
      buildResolveInput({
        missionId: mission.id,
        missionType: mission.type,
        seed: mission.seed,
        snapshot,
        context,
        rules,
      }),
    );
  }

  private async liveContext(
    mission: NonNullable<Awaited<ReturnType<ReplayService['findMission']>>>,
  ): Promise<ResolutionContext> {
    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: mission.playerId! },
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
    return contextFromLive({
      type: mission.type,
      cargo: mission.cargo,
      encounterPolicy: mission.template.encounterPolicy,
      employerRelations: mission.faction.relations,
      playerFactionId: player.factionId,
      destinationIsolation: destination.isolation,
      materialRarity,
    });
  }

  private findMission(id: string) {
    return this.prisma.missionInstance.findUniqueOrThrow({
      where: { id },
      include: { template: true, faction: true },
    });
  }
}
