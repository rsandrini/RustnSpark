import { Injectable, NotFoundException } from '@nestjs/common';
import {
  resolveMission,
  type MissionInput,
  type MissionOutcome,
  type MissionSnapshot,
} from '../../resolution/mission/mission.resolver.js';
import type { EscapePreset } from '../../resolution/encounter/escape.resolver.js';
import type { FactionRelation, Stance } from '../../resolution/encounter/encounter-policy.js';
import type { EscortClient, LegRoute, PartSnapshot } from '../../resolution/leg/leg.resolver.js';
import { PROVISIONAL_TIER } from '../../missions/generator/template.filler.js';
import type { DispatchSnapshot } from '../../missions/dispatch.service.js';
import type { InstalledPart } from '../../parts/part.types.js';
import { deriveSheet } from '../../ships/sheet.deriver.js';
import { GameConfigService } from '../../config/game-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// Mission types that carry a protected object (escort client, rescue mob, cargo) —
// part of the MissionInput contract of resolveMission.
export const OBJECT_CARRIED_TYPES: readonly string[] = ['DELIVERY', 'TRANSPORT', 'RESCUE'];

export function relationOf(
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

export function parseClient(raw: unknown): EscortClient | null {
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

export interface ReplayableLog {
  readonly rulesHash: string;
  readonly shipSnapshot: unknown;
  readonly missionId: string;
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

// S11.4 / S7.6 (D19): re-run a stored MissionLog from its embedded dispatch snapshot +
// seed + rulesHash via ConfigService.byHash — never the live config, catalog or map.
// The S7.6 e2e and the admin inspector replay endpoint share this single implementation;
// the report it renders comes out of the *recomputed* events, so a mismatch between
// replay and storage is visible instead of papered over.
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
    const parts = requireArray(snapshot.parts, 'parts');
    const routes = requireArray(snapshot.legs, 'legs');

    const installed: InstalledPart[] = parts.map((part) => ({
      instance: { id: part.id, partType: part.partType, condition: part.condition },
      catalog: part.catalog,
    }));
    const sheet = deriveSheet(installed, rules);
    const partSnaps: PartSnapshot[] = parts.map((part) => ({
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

    const mission = await this.prisma.missionInstance.findUniqueOrThrow({
      where: { id: log.missionId },
      include: { template: true, faction: true },
    });
    if (mission.playerId === null) {
      throw new NotFoundException('mission has no owning player to replay for');
    }
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

    const legs: readonly LegRoute[] = routes;
    const missionInput: MissionInput = {
      id: mission.id,
      type: mission.type,
      legs,
      tier: PROVISIONAL_TIER,
      isolation: destination.isolation,
      factionRelation: employer.key,
      relation: employer.relation,
      stance: snapshot.stance as Stance,
      preset: ((policy['preset'] as string | undefined) ?? 'CRUISE') as EscapePreset,
      missionOwner: (policy['missionOwner'] as 'player' | 'enemy' | null | undefined) ?? null,
      missionForcesFlee: policy['missionForcesFlee'] === true,
      objectCarried: OBJECT_CARRIED_TYPES.includes(mission.type),
      client: parseClient(cargo['client']),
    };

    return resolveMission({
      seed: mission.seed,
      snapshot: missionSnapshot,
      mission: missionInput,
      rules,
    });
  }
}
