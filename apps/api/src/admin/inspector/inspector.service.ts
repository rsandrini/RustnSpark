import { Injectable, NotFoundException } from '@nestjs/common';
import type { ReportLog } from '../../reports/report.types.js';
import {
  ReportsService,
  decodeCursor,
  encodeCursor,
  hasShieldOf,
  partsBeforeOf,
  partTypesOf,
  parseLimit,
} from '../../reports/reports.service.js';
import { parseMissionLogEvents } from '../../reports/events/event.schema.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ReplayService } from './replay.service.js';

interface StoredLogJson {
  readonly legs?: unknown;
  readonly events?: unknown;
}

// Structural equality for replayed vs stored events. Both sides are plain JSON (the
// stored side went through jsonb, the replayed side is the engine's own output — the
// S7.6 e2e proves jsonb round-trips them to deep-equal values), so a plain recursive
// walk is exact; keys are compared as sets, order-insensitively.
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => deepEqual(entry, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && deepEqual(aRecord[key], bRecord[key]));
}

@Injectable()
export class InspectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly replay: ReplayService,
    private readonly reports: ReportsService,
  ) {}

  // Screen D entry point: find a player by name or account email (S11.5 list view).
  async list(query?: string): Promise<{
    items: Array<{
      id: string;
      name: string;
      credits: number;
      factionId: string | null;
      accountEmail: string;
      accountStatus: string;
    }>;
  }> {
    const trimmed = query?.trim() ?? '';
    const players = await this.prisma.player.findMany({
      where:
        trimmed === ''
          ? {}
          : {
              OR: [
                { name: { contains: trimmed, mode: 'insensitive' } },
                { account: { is: { email: { contains: trimmed, mode: 'insensitive' } } } },
              ],
            },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { account: { select: { email: true, status: true } } },
    });
    return {
      items: players.map((player) => ({
        id: player.id,
        name: player.name,
        credits: player.credits,
        factionId: player.factionId,
        accountEmail: player.account.email,
        accountStatus: player.account.status,
      })),
    };
  }

  // The full sheet (GDD §17 D "ficha completa"): account, wallet, fleet, cargo and any
  // mission still holding the one-active slot — everything a support decision needs
  // before touching an action.
  async sheet(playerId: string): Promise<Record<string, unknown>> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { account: true },
    });
    if (player === null) throw new NotFoundException('player not found');
    const [ships, materials, activeMissions] = await Promise.all([
      this.prisma.ship.findMany({
        where: { ownerPlayerId: playerId },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          status: true,
          stance: true,
          fuel: true,
          currentLocationId: true,
        },
      }),
      this.prisma.playerMaterial.findMany({
        where: { playerId },
        orderBy: { materialId: 'asc' },
        select: { materialId: true, quantity: true },
      }),
      this.prisma.missionInstance.findMany({
        where: { playerId, status: { in: ['ACCEPTED', 'IN_TRANSIT', 'RESOLVING'] } },
        orderBy: { acceptedAt: 'asc' },
        select: {
          id: true,
          type: true,
          status: true,
          originId: true,
          destinationId: true,
          acceptedAt: true,
        },
      }),
    ]);
    return {
      account: {
        id: player.account.id,
        email: player.account.email,
        role: player.account.role,
        status: player.account.status,
        createdAt: player.account.createdAt.toISOString(),
      },
      player: {
        id: player.id,
        name: player.name,
        credits: player.credits,
        locale: player.locale,
        factionId: player.factionId,
        debugFastOps: player.debugFastOps,
        createdAt: player.createdAt.toISOString(),
      },
      ships,
      materials,
      activeMissions: activeMissions.map((mission) => ({
        ...mission,
        acceptedAt: mission.acceptedAt?.toISOString() ?? null,
      })),
    };
  }

  // PlayerEvent timeline, newest first, (at, id) descending cursor — the exact format
  // ReportsService uses for report history, so the frontend paginates both the same way.
  async timeline(
    playerId: string,
    limitRaw?: string,
    cursorRaw?: string,
  ): Promise<{
    items: Array<{
      id: string;
      at: string;
      type: string;
      creditsDelta: number | null;
      payload: unknown;
    }>;
    nextCursor?: string;
  }> {
    const limit = parseLimit(limitRaw);
    const cursor = cursorRaw !== undefined ? decodeCursor(cursorRaw) : undefined;
    const rows = await this.prisma.playerEvent.findMany({
      where: {
        playerId,
        ...(cursor !== undefined
          ? {
              OR: [{ at: { lt: cursor.at } }, { at: { equals: cursor.at }, id: { lt: cursor.id } }],
            }
          : {}),
      },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: { id: true, at: true, type: true, creditsDelta: true, payload: true },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        type: row.type,
        creditsDelta: row.creditsDelta,
        payload: row.payload,
      })),
      ...(hasMore && last !== undefined ? { nextCursor: encodeCursor(last.at, last.id) } : {}),
    };
  }

  // S11.4 acceptance: report replay using the stored rulesHash and embedded snapshot.
  // The rendered report comes out of the *recomputed* events; `matchesStored` tells the
  // admin whether the engine still reproduces the stored outcome (D19 determinism,
  // live-checked against today's code, always against the frozen rules of that run).
  async replayReport(
    playerId: string,
    missionId: string,
    view?: string,
    explicitLocale?: string,
  ): Promise<Record<string, unknown>> {
    const log = await this.prisma.missionLog.findUnique({ where: { missionId } });
    if (log === null || log.playerId !== playerId) {
      throw new NotFoundException({ error: 'REPORT_NOT_FOUND' });
    }
    const stored = (log.legs ?? {}) as StoredLogJson;
    const storedEvents = parseMissionLogEvents(log.schemaVersion, stored.events);

    const recomputed = await this.replay.replay(log);
    const replayedEvents = parseMissionLogEvents(2, recomputed.events);
    const balanceAfter = await this.balanceAfter(playerId, missionId);
    // Stored legs are full MissionOutcome legs; the report contract only exposes
    // (index, status) refs, so compare exactly those — same projection the renderer uses.
    const storedLegRefs = (
      Array.isArray(stored.legs)
        ? (stored.legs as Array<{ index?: unknown; status?: unknown }>)
        : []
    ).map((leg) => ({ index: leg.index, status: leg.status }));
    const matchesStored =
      recomputed.status === log.outcome &&
      deepEqual(replayedEvents, storedEvents) &&
      deepEqual(
        recomputed.legs.map((leg) => ({ index: leg.index, status: leg.status })),
        storedLegRefs,
      );

    const reportLog: ReportLog = {
      missionId,
      seed: log.seed,
      schemaVersion: log.schemaVersion,
      outcome: recomputed.status,
      events: replayedEvents,
      legs: recomputed.legs.map((leg) => ({ index: leg.index, status: leg.status })),
      partTypeById: partTypesOf(log.shipSnapshot),
      hasShield: hasShieldOf(log.shipSnapshot),
      partsBefore: partsBeforeOf(log.shipSnapshot),
      credits: recomputed.creditsDelta,
      ...(balanceAfter !== undefined ? { balanceAfter } : {}),
    };

    return {
      missionId,
      rulesHash: log.rulesHash,
      stored: { outcome: log.outcome, events: storedEvents.length },
      replay: {
        outcome: recomputed.status,
        creditsDelta: recomputed.creditsDelta,
        events: replayedEvents,
      },
      matchesStored,
      report: await this.reports.render(reportLog, playerId, view, explicitLocale),
    };
  }

  // D37: the summary view labels the balance the run closed on (same payload the player
  // path reads; one JSON path lookup, newest mission.resolved wins).
  private async balanceAfter(playerId: string, missionId: string): Promise<number | undefined> {
    const rows = await this.prisma.playerEvent.findMany({
      where: {
        playerId,
        type: 'mission.resolved',
        payload: { path: ['missionId'], equals: missionId },
      },
      orderBy: { at: 'desc' },
      take: 1,
      select: { payload: true },
    });
    const payload = rows[0]?.payload;
    if (typeof payload !== 'object' || payload === null) return undefined;
    const value = (payload as { balanceAfter?: unknown }).balanceAfter;
    return typeof value === 'number' ? value : undefined;
  }
}
