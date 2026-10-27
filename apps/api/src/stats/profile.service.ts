import { Injectable, NotFoundException } from '@nestjs/common';
import type { MyStatsResponse, PublicProfileResponse } from '@rustandspark/contract';
import { GameConfigService } from '../config/game-config.service.js';
import { pickCatalogStats } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { deriveShipClass } from '../ships/ship-class.js';
import { callsignOf } from './callsign.js';
import { PlayerStatsService } from './player-stats.service.js';
import type { StatTotals } from './stat-keys.js';
import { publicView } from './visibility.js';

/** Missions that ended well over everything that ended; null until one has ended. */
export function successRateOf(totals: StatTotals): number | null {
  const success = totals['missions.success'] ?? 0;
  const ended = success + (totals['missions.failed'] ?? 0) + (totals['missions.aborted'] ?? 0);
  return ended === 0 ? null : success / ended;
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly stats: PlayerStatsService,
  ) {}

  /** Everything recorded for the pilot, private numbers included. */
  async mine(playerId: string): Promise<MyStatsResponse> {
    const read = await this.stats.read(playerId);
    return {
      totals: read.totals,
      records: read.records,
      firstMissionAt: read.firstMissionAt?.toISOString() ?? null,
      lastActiveAt: read.lastActiveAt?.toISOString() ?? null,
    };
  }

  /** The public card: only the keys marked public, and the ship's title but never its parts. */
  async publicCard(name: string): Promise<PublicProfileResponse> {
    const player = await this.prisma.player.findUnique({ where: { name } });
    if (player === null) throw new NotFoundException({ error: 'PLAYER_NOT_FOUND' });
    const read = await this.stats.read(player.id);
    const view = publicView(read.totals, read.records);
    return {
      name: player.name,
      factionId: player.factionId,
      joinedAt: player.createdAt.toISOString(),
      ship: await this.shipCard(player),
      totals: view.totals,
      records: view.records,
      successRate: successRateOf(read.totals),
    };
  }

  private async shipCard(player: {
    id: string;
    name: string;
    factionId: string | null;
  }): Promise<PublicProfileResponse['ship']> {
    const ship = await this.prisma.ship.findFirst({
      where: { ownerPlayerId: player.id },
      orderBy: { id: 'asc' },
    });
    if (ship === null) return null;
    const rows = await this.prisma.partInstance.findMany({
      where: { ownerPlayerId: player.id, shipId: ship.id, location: 'INSTALLED' },
      include: { partCatalog: true },
    });
    const installed = rows.map((row) => ({
      instance: row,
      catalog: pickCatalogStats(row.partCatalog),
    }));
    const bridge = installed.find((part) => part.catalog.partClass === 'BRIDGE');
    if (bridge === undefined) return null;
    return {
      title: callsignOf({
        factionId: player.factionId,
        playerName: player.name,
        playerId: player.id,
      }),
      shipClass: deriveShipClass(installed, this.config.snapshot().rules),
      bridgeRarity: bridge.instance.partCatalog.rarity,
    };
  }
}
