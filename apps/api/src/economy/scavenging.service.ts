import { Injectable, NotFoundException } from '@nestjs/common';
import type { Location } from '@prisma/client';
import { Clock } from '../common/clock/clock.js';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const MS_PER_SECOND = 1000;
const DEFAULT_DROP_CHANCE = 0;

export type FieldType = 'common' | 'mission' | 'pirate';

/** What the pilot needs to know before sending the ship: the odds, the wait and the time it takes. */
export interface ScavengeInfo {
  readonly locationId: string;
  readonly fieldType: FieldType;
  /** Chance (0..1) of each EXTRA find beyond the guaranteed first one, at this kind of place. */
  readonly dropChance: number;
  /** The place's zone: the higher, the rarer and the better the finds (and the more pirates). */
  readonly zone: number;
  /** Scrap places give some finds as scrap (fixed price) instead of parts. */
  readonly scrapPlace: boolean;
  /** How long a job takes (mission time). */
  readonly durationSeconds: number;
  readonly cooldownSeconds: number;
  /** Seconds until the next job may start here; 0 when ready. */
  readonly retryAfterSeconds: number;
  readonly attempts: number;
  /** Condition range (percent) of a found part at THIS place (zone bonus included). */
  readonly qualityMin: number;
  readonly qualityMax: number;
}

const SCRAP_PLACE_TYPES: ReadonlySet<string> = new Set(['scrap_field', 'dead_zone', 'relay']);
const MAX_CONDITION = 95;

/**
 * Field type (GDD §14): a debris field under pirate control is the generous kind; every other
 * place is a common (solo) field. (The "mission field" tier stays reserved in config.)
 */
export function fieldTypeOf(location: Pick<Location, 'type' | 'factionId'>): FieldType {
  if (location.type === 'scrap_field' && location.factionId === 'pirates') {
    return 'pirate';
  }
  return 'common';
}

@Injectable()
export class ScavengingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly clock: Clock,
  ) {}

  async info(locationId: string, playerId: string): Promise<ScavengeInfo> {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      throw new NotFoundException('location not found');
    }
    const rules = this.config.snapshot().rules;
    const fieldType = fieldTypeOf(location);
    const counter = await this.prisma.scavengeCounter.findUnique({
      where: { playerId_locationId: { playerId, locationId } },
    });
    const cooldownSeconds = rules.scavenging.cooldown_seconds;
    let retryAfterSeconds = 0;
    if (counter !== null && counter.attemptCount > 0 && counter.lastAttemptAt !== null) {
      const elapsed = Math.floor(
        (this.clock.now().getTime() - counter.lastAttemptAt.getTime()) / MS_PER_SECOND,
      );
      retryAfterSeconds = Math.max(0, cooldownSeconds - elapsed);
    }
    const bonus = location.zone * rules.scavenging.zone_quality_bonus;
    const qualityMin = Math.min(MAX_CONDITION, rules.scavenging.quality_min + bonus);
    return {
      locationId,
      fieldType,
      dropChance: rules.scavenging.chance[fieldType] ?? DEFAULT_DROP_CHANCE,
      zone: location.zone,
      scrapPlace: SCRAP_PLACE_TYPES.has(location.type),
      durationSeconds: rules.scavenging.duration_seconds,
      cooldownSeconds,
      retryAfterSeconds,
      attempts: counter?.attemptCount ?? 0,
      qualityMin,
      qualityMax: Math.min(
        MAX_CONDITION,
        Math.max(qualityMin, rules.scavenging.quality_max + bonus),
      ),
    };
  }
}
