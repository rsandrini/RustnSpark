import { Injectable } from '@nestjs/common';
import type { MissionInstance, MissionType, Prisma } from '@prisma/client';
import type { GameRules } from '../config/game-config.types.js';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { missionSeed } from './generator/mission.generator.js';
import {
  fillMission,
  MissionGenerationError,
  type MissionDraft,
} from './generator/template.filler.js';
import { missionReward } from './mission.reward.js';

// Two-int advisory-lock namespace for board top-ups (class | hashtext(locationId)),
// so board locks can never collide with future advisory users in other domains.
const BOARD_LOCK_CLASS = 6200;
// Advisory-lock class for creating a player's private starter offer (D43), keyed per (player, location).
const STARTER_LOCK_CLASS = 6201;
// Seeds tried before giving up on finding a mission this player's ship can take.
const STARTER_ATTEMPTS = 12;

export type BoardMission = MissionInstance & { readonly rewardEstimate: number };

type World = Awaited<ReturnType<typeof loadWorld>>;

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

// The world tables are read-only for a top-up, so a multi-location top-up (the map's
// mission counts) loads them once per transaction instead of once per location.
function lazyWorld(tx: Prisma.TransactionClient): () => Promise<World> {
  let cached: Promise<World> | undefined;
  return () => (cached ??= loadWorld(tx));
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
  async getBoard(
    locationId: string,
    viewerTier: number,
    viewerId?: string,
  ): Promise<BoardMission[]> {
    const { rules, version } = this.config.snapshot();
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, locationId);
      await this.topUp(tx, locationId, now, rules, version, lazyWorld(tx));

      const rows = await tx.missionInstance.findMany({
        where: {
          originId: locationId,
          status: 'AVAILABLE',
          expiresAt: { gt: now },
          // Shared offers, plus the viewer's own private start-safe mission (D43) — never
          // anyone else's.
          OR: [
            { privatePlayerId: null },
            ...(viewerId === undefined ? [] : [{ privatePlayerId: viewerId }]),
          ],
        },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map((row) => ({
        ...row,
        rewardEstimate: missionReward(row, viewerTier, rules),
      }));
    });
  }

  /**
   * Live offer counts for a batch of locations, in one transaction (S10.5): same
   * flip/top-up semantics as getBoard, so a count equals what the board would serve.
   * Locks are taken in sorted id order — a fixed order can never deadlock against
   * another batch, and single-location getBoard waits on the same lock it holds.
   */
  async countOffers(locationIds: readonly string[]): Promise<Map<string, number>> {
    const { rules, version } = this.config.snapshot();
    const now = new Date();
    const counts = new Map<string, number>();
    const boardMin = rules.missions.board_min_per_location;

    // Steady state (every board already full) is a single read: no advisory locks, no
    // writes. This runs on every map/port/board load, so it must not serialize the
    // whole world behind 12 locks or generate anything when there is nothing to do.
    const live = await this.prisma.missionInstance.groupBy({
      by: ['originId'],
      where: {
        originId: { in: [...locationIds] },
        status: 'AVAILABLE',
        expiresAt: { gt: now },
        // Private starter missions (D43) are not part of the shared board the map counts.
        privatePlayerId: null,
      },
      _count: { _all: true },
    });
    const liveByLocation = new Map(live.map((row) => [row.originId, row._count._all]));
    const needsTopUp: string[] = [];
    for (const locationId of new Set(locationIds)) {
      const count = liveByLocation.get(locationId) ?? 0;
      if (count >= boardMin) counts.set(locationId, count);
      else needsTopUp.push(locationId);
    }
    if (needsTopUp.length === 0) return counts;
    const sorted = needsTopUp.sort();

    return this.prisma.$transaction(async (tx) => {
      for (const locationId of sorted) {
        await this.lock(tx, locationId);
      }
      const world = lazyWorld(tx);
      for (const locationId of sorted) {
        counts.set(locationId, await this.topUp(tx, locationId, now, rules, version, world));
      }
      return counts;
    });
  }

  /**
   * D43: creates a private start-safe mission for `playerId` at `locationId`, if the player has
   * none live there already. Generation reuses the normal filler restricted to the starter
   * constraint (DELIVERY on routes inside the safe zones); `isTakeable` is the caller's check
   * that THIS player's real ship can accept the drafted mission, and only a takeable draft is
   * saved, so the guarantee is "a mission you can accept", not merely "an easy mission".
   * Returns whether an offer was created. Serialized per (player, location) so two concurrent
   * board reads cannot create two.
   */
  async createStarterOffer(input: {
    readonly playerId: string;
    readonly locationId: string;
    readonly types: readonly MissionType[];
    readonly isTakeable: (draft: MissionDraft) => boolean;
  }): Promise<boolean> {
    const { rules } = this.config.snapshot();
    const now = new Date();
    const { playerId, locationId } = input;

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(${STARTER_LOCK_CLASS}::int4, hashtext(${`${playerId}:${locationId}`}::text))::text
      `;
      const live = await tx.missionInstance.count({
        where: {
          privatePlayerId: playerId,
          originId: locationId,
          status: { in: ['AVAILABLE', 'HELD'] },
          expiresAt: { gt: now },
        },
      });
      if (live > 0) return false;

      const origin = await tx.location.findUnique({ where: { id: locationId } });
      if (origin === null) return false;
      const world = await loadWorld(tx);
      // How many private offers this player has had here: each new seed differs from the last.
      const previous = await tx.missionInstance.count({
        where: { privatePlayerId: playerId, originId: locationId },
      });

      for (let attempt = 0; attempt < STARTER_ATTEMPTS; attempt += 1) {
        let draft: MissionDraft;
        try {
          draft = fillMission({
            seed: `starter|${playerId}|${locationId}|${previous + attempt}`,
            origin,
            world,
            rules,
            now,
            starter: { types: input.types, maxZone: rules.missions.starter_max_zone },
          });
        } catch (error) {
          if (error instanceof MissionGenerationError) return false;
          throw error;
        }
        if (input.isTakeable(draft)) {
          await tx.missionInstance.create({ data: { ...draft, privatePlayerId: playerId } });
          return true;
        }
      }
      return false;
    });
  }

  private async lock(tx: Prisma.TransactionClient, locationId: string): Promise<void> {
    // ::text cast: pg_advisory_xact_lock returns void, which Prisma's deserializer
    // rejects on $queryRaw (the lock still taken before the cast is applied).
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(${BOARD_LOCK_CLASS}::int4, hashtext(${locationId}::text))::text
    `;
  }

  // Flip expired offers, then generate until the location has board_min live rows.
  // Returns the resulting live count (possibly short if generation ran out of
  // servable templates — see the MissionGenerationError branch).
  private async topUp(
    tx: Prisma.TransactionClient,
    locationId: string,
    now: Date,
    rules: GameRules,
    configVersion: number,
    world: () => Promise<World>,
  ): Promise<number> {
    const boardMin = rules.missions.board_min_per_location;

    await tx.missionInstance.updateMany({
      where: {
        originId: locationId,
        status: { in: ['AVAILABLE', 'HELD'] },
        expiresAt: { lte: now },
      },
      data: { status: 'EXPIRED', playerId: null },
    });

    let available = await tx.missionInstance.count({
      where: {
        originId: locationId,
        status: 'AVAILABLE',
        expiresAt: { gt: now },
        privatePlayerId: null,
      },
    });
    if (available >= boardMin) return available;

    const location = await tx.location.findUnique({ where: { id: locationId } });
    if (location === null) return available;

    const worldTables = await world();
    let epoch = await tx.missionInstance.count({ where: { originId: locationId } });
    while (available < boardMin) {
      const seed = missionSeed({ locationId, epoch, configVersion });
      try {
        const draft = fillMission({ seed, origin: location, world: worldTables, rules, now });
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
    return available;
  }
}
