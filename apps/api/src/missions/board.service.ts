import { Injectable } from '@nestjs/common';
import type { MissionInstance, Prisma } from '@prisma/client';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { missionSeed } from './generator/mission.generator.js';
import { fillMission, MissionGenerationError } from './generator/template.filler.js';
import { missionReward } from './mission.reward.js';

// Two-int advisory-lock namespace for board top-ups (class | hashtext(locationId)),
// so board locks can never collide with future advisory users in other domains.
const BOARD_LOCK_CLASS = 6200;

export type BoardMission = MissionInstance & { readonly rewardEstimate: number };

async function loadWorld(tx: Prisma.TransactionClient) {
  const [locations, routes, routeEnvironments, environments, templates, materials] =
    await Promise.all([
      tx.location.findMany(),
      tx.route.findMany(),
      tx.routeEnvironment.findMany(),
      tx.environment.findMany(),
      tx.missionTemplate.findMany({ where: { active: true } }),
      tx.material.findMany({ where: { active: true } }),
    ]);
  return { locations, routes, routeEnvironments, environments, templates, materials };
}

@Injectable()
export class BoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
  ) {}

  /**
   * Board read with lazy top-up (S6.2): the whole read runs inside one transaction
   * holding pg_advisory_xact_lock(location), so concurrent readers serialize, never
   * duplicate, and always see a board with at least `board_min_per_location` live
   * offers. Expired offers flip to EXPIRED (no penalty — nobody had accepted them)
   * and are replaced; the epoch in each new seed is the location's lifetime row
   * count, so regenerated content rotates instead of repeating.
   */
  async getBoard(locationId: string, viewerTier: number): Promise<BoardMission[]> {
    const { rules, version } = this.config.snapshot();
    const now = new Date();
    const boardMin = rules.missions.board_min_per_location;

    return this.prisma.$transaction(async (tx) => {
      // ::text cast: pg_advisory_xact_lock returns void, which Prisma's deserializer
      // rejects on $queryRaw (the lock still taken before the cast is applied).
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(${BOARD_LOCK_CLASS}::int4, hashtext(${locationId}::text))::text
      `;

      await tx.missionInstance.updateMany({
        where: {
          originId: locationId,
          status: { in: ['AVAILABLE', 'HELD'] },
          expiresAt: { lte: now },
        },
        data: { status: 'EXPIRED', playerId: null },
      });

      let available = await tx.missionInstance.count({
        where: { originId: locationId, status: 'AVAILABLE', expiresAt: { gt: now } },
      });

      if (available < boardMin) {
        const location = await tx.location.findUnique({ where: { id: locationId } });
        if (location !== null) {
          const world = await loadWorld(tx);
          let epoch = await tx.missionInstance.count({ where: { originId: locationId } });
          while (available < boardMin) {
            const seed = missionSeed({ locationId, epoch, configVersion: version });
            try {
              const draft = fillMission({ seed, origin: location, world, rules, now });
              await tx.missionInstance.create({ data: draft });
            } catch (error) {
              // S3.4 guarantees every seeded location can serve a template; if the data
              // was edited into a corner, serve the (possibly thin) board instead of 500ing.
              if (error instanceof MissionGenerationError) break;
              throw error;
            }
            available += 1;
            epoch += 1;
          }
        }
      }

      const rows = await tx.missionInstance.findMany({
        where: { originId: locationId, status: 'AVAILABLE', expiresAt: { gt: now } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map((row) => ({
        ...row,
        rewardEstimate: missionReward(row, viewerTier, rules),
      }));
    });
  }
}
