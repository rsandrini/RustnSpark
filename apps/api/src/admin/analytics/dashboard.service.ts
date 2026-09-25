import { Injectable } from '@nestjs/common';
import { GameConfigService } from '../../config/game-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { shipTier } from '../../ships/ship-tier.js';
import {
  SWEEP_WINRATE_BASELINE,
  summarizeCombat,
  summarizeOutcomes,
  tierHistogram,
  type CombatSummary,
  type MissionOutcomeCounts,
  type TierHistogram,
} from './analytics.helpers.js';
import type { AnalyticsWindow } from './window.js';

export interface DashboardSummary {
  readonly players: { readonly new: number; readonly active: number };
  readonly missions: MissionOutcomeCounts;
  readonly combat: CombatSummary & { readonly baseline: number };
  readonly tiers: TierHistogram;
}

// Screen A data (GDD §17): active/new players, mission success rate, real winrate vs the
// 55% sweep baseline, tier distribution. Every query is bounded by the request window and
// answered from the S11.3 indexes (migration 0021).
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
  ) {}

  async summary(window: AnalyticsWindow): Promise<DashboardSummary> {
    const range = { gte: window.from, lte: window.to };
    const [newPlayers, activePlayers, logs, ships] = await Promise.all([
      this.prisma.player.count({ where: { createdAt: range } }),
      this.prisma.playerEvent.groupBy({ by: ['playerId'], where: { at: range } }),
      this.prisma.missionLog.findMany({
        where: { createdAt: range },
        select: { outcome: true, legs: true },
      }),
      this.prisma.ship.findMany({
        select: {
          parts: {
            where: { location: 'INSTALLED' },
            select: { partCatalog: { select: { basePrice: true } } },
          },
        },
      }),
    ]);
    const rules = this.config.snapshot().rules;
    const tiers = ships.map((ship) =>
      shipTier(
        ship.parts.map((part) => ({ basePrice: part.partCatalog.basePrice })),
        rules,
      ),
    );
    return {
      players: { new: newPlayers, active: activePlayers.length },
      missions: summarizeOutcomes(logs.map((log) => log.outcome)),
      combat: { ...summarizeCombat(logs.map((log) => log.legs)), baseline: SWEEP_WINRATE_BASELINE },
      tiers: tierHistogram(tiers),
    };
  }
}
