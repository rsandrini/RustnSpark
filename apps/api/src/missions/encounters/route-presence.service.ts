import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface PresenceOverlap {
  readonly otherMissionId: string;
  readonly routeId: string;
  readonly legIndex: number;
  readonly otherLegIndex: number;
}

// D1: presence rows are written inside the dispatch transaction for the whole leg
// timeline, so by the time either mission resolves every overlapping pair is already
// registered. The && predicate answers from the GiST index (S7.1 EXPLAIN test).
@Injectable()
export class RoutePresenceService {
  constructor(private readonly prisma: PrismaService) {}

  async findOverlaps(missionId: string, tx?: Prisma.TransactionClient): Promise<PresenceOverlap[]> {
    const db = tx ?? this.prisma;
    return db.$queryRaw<PresenceOverlap[]>`
      SELECT
        o."missionId" AS "otherMissionId",
        o."routeId" AS "routeId",
        m."legIndex" AS "legIndex",
        o."legIndex" AS "otherLegIndex"
      FROM "RoutePresence" m
      JOIN "RoutePresence" o
        ON o."routeId" = m."routeId"
       AND o."missionId" <> m."missionId"
       AND o."window" && m."window"
      WHERE m."missionId" = ${missionId}
      ORDER BY o."missionId", o."legIndex"
    `;
  }
}
