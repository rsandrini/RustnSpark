import { Injectable } from '@nestjs/common';
import type { MissionInstance, MissionType, Prisma } from '@prisma/client';
import type { GameRules } from '../config/game-config.types.js';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createRng } from '../common/rng/rng.js';
import { giverShapeOf, offersAnyOf, pickGiver, type GiverShape } from './generator/giver.picker.js';
import { missionSeed } from './generator/mission.generator.js';
import { boardSize, maxOffersOfOneType } from './board-size.js';
import {
  eligibleTypesAt,
  fillMission,
  MissionGenerationError,
  reachByType,
  referenceSeconds,
  type MissionDraft,
} from './generator/template.filler.js';
import { boardTarget, lengthBounds, nextSlot, type BoardSlot } from './board-composition.js';
import { missionReward } from './mission.reward.js';
import {
  ANYTHING_GOES,
  SAME_JOB_ONLY,
  STRICT,
  isVariedEnough,
  type OfferShape,
  type Strictness,
} from './board-variety.js';

// Two-int advisory-lock namespace for board top-ups (class | hashtext(locationId)),
// so board locks can never collide with future advisory users in other domains.
const BOARD_LOCK_CLASS = 6200;
// Advisory-lock class for creating a player's private starter offer (D43), keyed per (player, location).
const STARTER_LOCK_CLASS = 6201;
// A slow database must not turn a page load into an error: wait longer than Prisma's 5 s default.
const TOP_UP_MAX_WAIT_MS = 10_000;
const TOP_UP_TIMEOUT_MS = 20_000;
// Seeds tried before giving up on finding a mission this player's ship can take.
const STARTER_ATTEMPTS = 12;
// Reseeds tried to make a new board offer differ from the live ones: the first half under both
// variety rules, the second half only under the "same type and destination" rule, then anything.
const STRICT_ATTEMPTS = 12;
const VARIETY_ATTEMPTS = 24;

/** A trip's length at the reference ship, from the stored legs (a rescue's legs already go out and back). */
function legsSeconds(legs: unknown, rules: GameRules): number {
  const total = Array.isArray(legs)
    ? legs.reduce<number>((sum, leg) => {
        const distance = (leg as { distance?: unknown } | null)?.distance;
        return sum + (typeof distance === 'number' ? distance : 0);
      }, 0)
    : 0;
  return referenceSeconds(total, rules);
}

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
      // Scrap (fixed-price materials) is a find, never something a mining offer asks you to dig.
      tx.material.findMany({ where: { active: true, fixedPrice: false } }),
    ]);
  return { locations, routes, routeEnvironments, environments, templates, materials };
}

/** The active quest givers of a faction, as the generator sees them. */
async function loadGivers(
  tx: Prisma.TransactionClient,
  factionId: string,
): Promise<readonly GiverShape[]> {
  const rows = await tx.questGiver.findMany({ where: { factionId, active: true } });
  return rows.map(giverShapeOf);
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
    viewerBridgeRarity?: string,
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
        rewardEstimate: missionReward(row, viewerTier, rules, viewerBridgeRarity),
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
    // Each board has the size of its place (main ports hold more than small stops).
    const places = await this.prisma.location.findMany({
      where: { id: { in: [...locationIds] } },
      select: { id: true, type: true, detail: true },
    });
    const sizeOf = new Map(places.map((place) => [place.id, boardSize(place, rules)]));

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
      if (count >= (sizeOf.get(locationId) ?? rules.missions.board_min_per_location)) {
        counts.set(locationId, count);
      } else needsTopUp.push(locationId);
    }
    if (needsTopUp.length === 0) return counts;
    const sorted = needsTopUp.sort();

    return this.prisma.$transaction(
      async (tx) => {
        const world = lazyWorld(tx);
        for (const locationId of sorted) {
          // A busy board is already being topped up by another request: count it as it
          // stands instead of queueing behind it (this read runs on every page load).
          if (!(await this.tryLock(tx, locationId))) {
            counts.set(locationId, liveByLocation.get(locationId) ?? 0);
            continue;
          }
          counts.set(locationId, await this.topUp(tx, locationId, now, rules, version, world));
        }
        return counts;
      },
      { maxWait: TOP_UP_MAX_WAIT_MS, timeout: TOP_UP_TIMEOUT_MS },
    );
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
    /** The pilot's very first mission (nothing completed yet): it goes to the test pad next to the home port. */
    readonly firstMission?: boolean;
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
      const givers = await loadGivers(tx, origin.factionId);
      // How many private offers this player has had here: each new seed differs from the last.
      const previous = await tx.missionInstance.count({
        where: { privatePlayerId: playerId, originId: locationId },
      });

      for (let attempt = 0; attempt < STARTER_ATTEMPTS; attempt += 1) {
        let draft: MissionDraft;
        const seed = `starter|${playerId}|${locationId}|${previous + attempt}`;
        // The first flight is the faction mentor's; later starter offers are an ordinary giver's.
        const giver =
          input.firstMission === true
            ? givers.find((entry) => entry.role === 'MENTOR')
            : pickGiver({
                givers,
                locationId,
                liveGiverIds: [],
                boardSize: 1,
                eligibleTypes: new Set(input.types),
                rng: createRng(seed).child('giver'),
              });
        try {
          draft = fillMission({
            seed,
            ...(giver === undefined ? {} : { giver }),
            origin,
            world,
            rules,
            now,
            starter: {
              types: input.types,
              maxZone: rules.missions.starter_max_zone,
              maxDistance: rules.missions.starter_max_distance,
              ...(input.firstMission === true ? { firstMission: true } : {}),
            },
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

  /** Takes the board lock if nobody holds it; false when another request does. */
  private async tryLock(tx: Prisma.TransactionClient, locationId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${BOARD_LOCK_CLASS}::int4, hashtext(${locationId}::text)) AS locked
    `;
    return rows[0]?.locked === true;
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
    const place = await tx.location.findUnique({
      where: { id: locationId },
      select: { type: true, detail: true },
    });
    const baseSize =
      place === null ? rules.missions.board_min_per_location : boardSize(place, rules);

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
    if (available >= baseSize) return available;

    const location = await tx.location.findUnique({ where: { id: locationId } });
    if (location === null) return available;

    const worldTables = await world();
    // What this place can post, measured once per top-up. A test pad keeps its one offer and today's path.
    const planned = location.type !== 'test_pad';
    const reach = planned ? reachByType(location, worldTables, rules) : new Map();
    const boardMin = planned ? boardTarget(baseSize, reach, rules) : baseSize;
    const bounds = planned ? lengthBounds(reach, rules) : null;
    // `baseSize` is checked first (cheap, before the world loads); `boardMin` only exceeds it when the required
    // types plus the extras floor outnumber the base size. The floor holds at refill time: a board at base size
    // that lost its extra offer shows none until it next drops below its base size.
    if (available >= boardMin) return available;
    let epoch = await tx.missionInstance.count({ where: { originId: locationId } });
    // A board of four identical offers is not a board: a new offer must differ from the live ones
    // (see board-variety.ts). A few reseeds are tried; if the world is too small to differ, the
    // rules loosen rather than leaving the board short.
    const liveRows = await tx.missionInstance.findMany({
      where: {
        originId: locationId,
        status: 'AVAILABLE',
        expiresAt: { gt: now },
        privatePlayerId: null,
      },
      select: { type: true, destinationId: true, cargo: true, legs: true, giverId: true },
    });
    const live: (OfferShape & { type: MissionType; seconds: number })[] = liveRows.map((row) => ({
      type: row.type,
      destinationId: row.destinationId,
      cargo: row.cargo,
      seconds: legsSeconds(row.legs, rules),
    }));
    const maxSameType = maxOffersOfOneType(boardMin, rules);
    const eligibleTypes = eligibleTypesAt(location, worldTables);
    const givers = await loadGivers(tx, location.factionId);
    const liveGiverIds: (string | null)[] = liveRows.map((row) => row.giverId);
    const seconds = (draft: MissionDraft): number => legsSeconds(draft.legs, rules);
    while (available < boardMin) {
      try {
        let draft: MissionDraft | undefined;
        let draftSeconds = 0;
        let attempt = 0;
        for (;;) {
          // A seed this place already used (a rejected attempt of an earlier top-up burned some epochs) would
          // repeat an old offer: move on to the next epoch instead.
          let seed = missionSeed({ locationId, epoch, configVersion });
          while ((await tx.missionInstance.count({ where: { originId: locationId, seed } })) > 0) {
            epoch += 1;
            seed = missionSeed({ locationId, epoch, configVersion });
          }
          const avoidTypes = new Set(
            [...eligibleTypes].filter(
              (type) => live.filter((offer) => offer.type === type).length >= maxSameType,
            ),
          );
          // The planner says what the board still lacks: a type, a race, a short or a long offer.
          const wanted = planned ? nextSlot({ reach, live, capped: avoidTypes, rules }) : {};
          // Every type the slot asks for is at its cap: the slot is dropped, the board still fills to its size
          // with whatever the filler can post (it ignores the caps when nothing else is eligible).
          const slot: BoardSlot =
            wanted.types !== undefined && [...wanted.types].every((t) => avoidTypes.has(t))
              ? {}
              : wanted;
          let giver = pickGiver({
            givers,
            locationId,
            liveGiverIds,
            boardSize: boardMin,
            eligibleTypes,
            ...(slot.types === undefined ? {} : { wantTypes: slot.types }),
            avoidTypes,
            rng: createRng(seed).child('giver'),
          });
          // The slot's type and length come before the giver's tastes: no giver rather than the wrong offer.
          if (giver !== undefined && slot.types !== undefined && !offersAnyOf(giver, slot.types)) {
            giver = undefined;
          }
          const lengthTarget =
            bounds === null || slot.length === undefined
              ? undefined
              : slot.length === 'short'
                ? { maxSeconds: bounds.shortMax }
                : { minSeconds: bounds.longMin };
          draft = fillMission({
            seed,
            ...(giver === undefined ? {} : { giver }),
            avoidTypes,
            origin: location,
            world: worldTables,
            rules,
            now,
            ...(slot.types === undefined ? {} : { preferTypes: slot.types }),
            ...(lengthTarget === undefined ? {} : { lengthTarget }),
          });
          const strictness: Strictness =
            attempt < STRICT_ATTEMPTS
              ? STRICT
              : attempt < VARIETY_ATTEMPTS
                ? SAME_JOB_ONLY
                : ANYTHING_GOES;
          // The filler already prefers a template with a destination at the wanted length; this only backstops the
          // case where no template of the pool has one: reseed a few times, then take what comes.
          draftSeconds = seconds(draft);
          const lengthOk =
            lengthTarget === undefined ||
            attempt >= STRICT_ATTEMPTS ||
            (draftSeconds <= (lengthTarget.maxSeconds ?? Number.POSITIVE_INFINITY) &&
              draftSeconds >= (lengthTarget.minSeconds ?? 0));
          if (lengthOk && isVariedEnough(draft, live, maxSameType, strictness)) break;
          attempt += 1;
          epoch += 1;
        }
        live.push({
          type: draft.type,
          destinationId: draft.destinationId,
          cargo: draft.cargo,
          seconds: draftSeconds,
        });
        liveGiverIds.push(draft.giverId ?? null);
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
