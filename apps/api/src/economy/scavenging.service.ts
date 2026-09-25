import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Location } from '@prisma/client';
import { Clock } from '../common/clock/clock.js';
import { GameConfigService } from '../config/game-config.service.js';
import { localize } from '../common/i18n/localize.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { stableUnit } from './deterministic.js';

export const SCAVENGE_EVENT = 'scavenge';

const MS_PER_SECOND = 1000;
// DropTable rows are seeded with ids like `scavenging_common`; the stable handle
// is the `source` column (schema-dados §12: fonte = scavenging | npc_* | quest).
const DROP_TABLE_SOURCE = 'scavenging';
const DEFAULT_DROP_CHANCE = 0;
// Seed's DropTable rows are COMMON/UNCOMMON/RARE; if a tier ever has no active
// catalog part the attempt simply yields nothing rather than crashing the roll.
const FALLBACK_RARITY = 'COMMON';

export type FieldType = 'common' | 'mission' | 'pirate';

export interface ScavengePart {
  readonly partInstanceId: string;
  readonly partType: string;
  /** Localized catalog name, so the client never has to show the raw part code. */
  readonly displayName: { readonly en: string; readonly 'pt-BR': string };
  readonly condition: number;
}

export interface ScavengeResponse {
  readonly locationId: string;
  readonly attempt: number;
  readonly fieldType: FieldType;
  readonly dropped: boolean;
  readonly part: ScavengePart | null;
  readonly cooldownSeconds: number;
}

export interface DropTier {
  readonly tier: string;
  readonly chance: number;
}

export interface CatalogEntry {
  readonly partType: string;
  readonly rarity: string;
  readonly displayName?: unknown;
}

export interface ScavengeRollInput {
  readonly seed: string;
  readonly playerId: string;
  readonly locationId: string;
  readonly attempt: number;
  readonly fieldType: FieldType;
  readonly chance: Readonly<Record<string, number>>;
  readonly qualityMin: number;
  readonly qualityMax: number;
  readonly tiers: readonly DropTier[];
  readonly catalog: readonly CatalogEntry[];
}

export interface ScavengeOutcome {
  readonly dropped: boolean;
  readonly partType?: string;
  readonly condition?: number;
}

/**
 * S8.5 field type (plan line 481 / GDD §14): a debris field under pirate
 * control is the 75% tier; every other location is a common (solo) field at
 * 25%. The 55% "mission field" tier belongs to scavenging missions, which
 * v0.1 has no SCAVENGING MissionType for — it stays reserved in config
 * (pinned by unit tests) until that mission lands.
 */
export function fieldTypeOf(location: Pick<Location, 'type' | 'factionId'>): FieldType {
  if (location.type === 'scrap_field' && location.factionId === 'pirates') {
    return 'pirate';
  }
  return 'common';
}

/**
 * Pure, seed-deterministic drop resolution (GDD §14): roll the field's drop
 * chance; on a hit pick a rarity tier from the seeded DropTable (cumulative
 * chances in stored order), pick a part from that rarity's active catalog
 * pool, and roll damaged quality between quality_min and quality_max. Same
 * world seed + player + location + attempt always yields the same loot — no
 * Math.random anywhere.
 */
export function scavengeOutcome(input: ScavengeRollInput): ScavengeOutcome {
  const keys = `${input.seed}:${input.playerId}:${input.locationId}:${input.attempt}`;
  const chance = input.chance[input.fieldType] ?? DEFAULT_DROP_CHANCE;
  if (stableUnit(`${keys}:drop`) >= chance) {
    return { dropped: false };
  }

  const tierRoll = stableUnit(`${keys}:tier`);
  let picked = input.tiers.at(-1)?.tier;
  let cumulative = 0;
  for (const entry of input.tiers) {
    cumulative += entry.chance;
    if (tierRoll < cumulative) {
      picked = entry.tier;
      break;
    }
  }

  let pool = input.catalog.filter((entry) => entry.rarity === picked);
  if (pool.length === 0) {
    pool = input.catalog.filter((entry) => entry.rarity === FALLBACK_RARITY);
  }
  if (pool.length === 0) {
    return { dropped: false };
  }

  const partIndex = Math.min(pool.length - 1, Math.floor(stableUnit(`${keys}:part`) * pool.length));
  const span = input.qualityMax - input.qualityMin;
  const condition = Math.round(input.qualityMin + stableUnit(`${keys}:quality`) * span);
  return { dropped: true, partType: pool[partIndex]!.partType, condition };
}

/**
 * S8.5: free scavenging action — ship must be at the location (and not on a
 * mission); one attempt per player per location per scavenging.cooldown_seconds
 * (D28, anti-farming); loot lands directly in the player's inventory. Free —
 * allowed on a negative balance (GDD §14). Review items 8–9: the per-location
 * attempt counter and cooldown stamp live in their own ScavengeCounter row (one
 * upsert instead of scanning the player's whole event history), elapsed time is
 * read through the injected Clock, and the transaction takes the Ship lock first
 * (canonical Ship → Player order) so a dispatch landing after the pre-read is
 * caught under the lock.
 */
@Injectable()
export class ScavengingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly events: PlayerEventService,
    private readonly clock: Clock,
  ) {}

  async scavenge(locationId: string, playerId: string): Promise<ScavengeResponse> {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      throw new NotFoundException('location not found');
    }

    const ship = await this.prisma.ship.findFirst({
      where: { ownerPlayerId: playerId, currentLocationId: locationId },
      select: { id: true, status: true },
    });
    if (!ship) {
      throw new ConflictException({ error: 'SHIP_NOT_AT_LOCATION' });
    }
    if (ship.status === 'ON_MISSION') {
      throw new ConflictException({ error: 'SHIP_ON_MISSION' });
    }

    const rules = this.config.snapshot().rules;
    const fieldType = fieldTypeOf(location);
    const [tiers, catalog] = await Promise.all([this.dropTiers(), this.activeCatalog()]);

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Canonical order — Ship first (dispatch/repair/rescue all take it before any
      // wallet or world row), then Player. The status is re-read under the lock: a
      // dispatch that lands between the pre-check and this tx still sees ON_MISSION.
      await tx.$queryRaw`SELECT id FROM "Ship" WHERE id = ${ship.id} FOR UPDATE`;
      const locked = await tx.ship.findUniqueOrThrow({
        where: { id: ship.id },
        select: { status: true },
      });
      if (locked.status === 'ON_MISSION') {
        throw new ConflictException({ error: 'SHIP_ON_MISSION' });
      }
      await tx.$queryRaw`SELECT id FROM "Player" WHERE id = ${playerId} FOR UPDATE`;

      const now = this.clock.now();
      const counter = await tx.scavengeCounter.upsert({
        where: { playerId_locationId: { playerId, locationId } },
        create: { playerId, locationId, attemptCount: 0 },
        update: {},
      });
      const cooldownSeconds = rules.scavenging.cooldown_seconds;
      if (counter.attemptCount > 0 && counter.lastAttemptAt !== null && cooldownSeconds > 0) {
        const elapsed = Math.floor(
          (now.getTime() - counter.lastAttemptAt.getTime()) / MS_PER_SECOND,
        );
        const retryAfterSeconds = cooldownSeconds - elapsed;
        if (retryAfterSeconds > 0) {
          throw new ConflictException({ error: 'SCAVENGE_COOL_DOWN', retryAfterSeconds });
        }
      }

      const attempt = counter.attemptCount;
      const result = scavengeOutcome({
        seed: rules.world.seed,
        playerId,
        locationId,
        attempt,
        fieldType,
        chance: rules.scavenging.chance,
        qualityMin: rules.scavenging.quality_min,
        qualityMax: rules.scavenging.quality_max,
        tiers,
        catalog,
      });

      let part: ScavengePart | null = null;
      if (result.dropped && result.partType !== undefined && result.condition !== undefined) {
        const created = await tx.partInstance.create({
          data: {
            partType: result.partType,
            ownerPlayerId: playerId,
            condition: result.condition,
            location: 'INVENTORY',
          },
        });
        const entry = catalog.find((candidate) => candidate.partType === created.partType);
        part = {
          partInstanceId: created.id,
          partType: created.partType,
          displayName: {
            en: localize(entry?.displayName, 'en'),
            'pt-BR': localize(entry?.displayName, 'pt-BR'),
          },
          condition: created.condition,
        };
      }

      await this.events.record(
        {
          playerId,
          type: SCAVENGE_EVENT,
          payload: {
            locationId,
            attempt,
            fieldType,
            dropped: result.dropped,
            partType: result.partType ?? null,
            condition: result.condition ?? null,
          },
        },
        tx,
      );
      await tx.scavengeCounter.update({
        where: { playerId_locationId: { playerId, locationId } },
        data: { attemptCount: attempt + 1, lastAttemptAt: now },
      });
      return { attempt, dropped: result.dropped, part };
    });

    return {
      locationId,
      attempt: outcome.attempt,
      fieldType,
      dropped: outcome.dropped,
      part: outcome.part,
      cooldownSeconds: rules.scavenging.cooldown_seconds,
    };
  }

  private async dropTiers(): Promise<DropTier[]> {
    const table = await this.prisma.dropTable.findFirst({
      where: { source: DROP_TABLE_SOURCE },
      orderBy: { id: 'asc' },
    });
    if (!table) return [];
    const tiers = table.tiers as unknown;
    if (!Array.isArray(tiers)) return [];
    return tiers.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate['tier'] !== 'string' || typeof candidate['chance'] !== 'number') {
        return [];
      }
      return [{ tier: candidate['tier'], chance: candidate['chance'] }];
    });
  }

  private async activeCatalog(): Promise<CatalogEntry[]> {
    const rows = await this.prisma.partCatalog.findMany({
      where: { active: true },
      orderBy: { partType: 'asc' },
      select: { partType: true, rarity: true, displayName: true },
    });
    return rows;
  }
}
