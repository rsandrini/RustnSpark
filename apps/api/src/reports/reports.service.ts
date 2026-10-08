import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Locale } from '../common/locale/locale.js';
import { localizeDisplayName } from '../common/locale/localize.js';
import { resolveRequestLocale } from '../common/locale/request-locale.js';
import { OwnershipResolverRegistry } from '../common/guards/ownership-resolver.registry.js';
import { bilingual } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { renderReport, type ViewResult } from './report.render.js';
import { type ReportLegRef, type ReportLog, VIEW_NAMES, type ViewName } from './report.types.js';
import {
  parseMissionLogEvents,
  UnsupportedMissionLogSchemaError,
  type ParsedMissionEvent,
} from './events/event.schema.js';
import { computeReportStats, type ReportStats } from './report.stats.js';
import { type EntityNames } from './templates/template.engine.js';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

export interface ReportListItem {
  readonly missionId: string;
  readonly outcome: string;
  readonly credits: number;
  readonly legs: number;
  readonly createdAt: string;
  /** Owner: "almost impossible to know in the mission history log where I had a combat" — any
      combat-category event (win/loss/draw/escort-absorbed/escaped/PvP), so the history list can
      flag it without the client fetching every full report. */
  readonly hadCombat: boolean;
}

export interface ReportListResponse {
  readonly items: readonly ReportListItem[];
  readonly nextCursor?: string;
}

export type ReportResponse = {
  readonly locale: Locale;
  /** Mission outcome, so the report screen needs no second call to label itself. */
  readonly outcome: string;
  /** The run in numbers, for the debrief header (same on every view). */
  readonly stats: ReportStats;
  /** What the mission was, when its row still exists. */
  readonly mission?: ReportMission;
} & ViewResult;

export interface ReportMission {
  readonly type: string;
  readonly originId: string;
  readonly destinationId: string;
  readonly title: { readonly en: string; readonly 'pt-BR': string };
  readonly reward: number;
  /** The routes the trip follows, in order (for the map): one per leg. */
  readonly routeIds: readonly string[];
}

/** The route of each stored leg (a leg without one is skipped). */
function routeIdsOf(legs: unknown): string[] {
  if (!Array.isArray(legs)) return [];
  return (legs as Array<{ routeId?: unknown }>).flatMap((leg) =>
    typeof leg?.routeId === 'string' ? [leg.routeId] : [],
  );
}

interface StoredLogJson {
  readonly legs?: unknown;
  readonly events?: unknown;
}

// Exported for the S11.4 inspector: same (createdAt, id) descending cursor format for
// the admin PlayerEvent timeline as for the player's own report history.
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: createdAt.toISOString(), id }), 'utf8').toString(
    'base64url',
  );
}

// Dispatch snapshot (D19) → instance id → catalog type; exported so the admin replay
// (S11.4) builds the same ReportLog.partTypeById the player path builds.
export function partTypesOf(snapshot: unknown): Record<string, string> {
  const record = snapshot as { parts?: unknown; storage?: unknown } | null;
  const parts = [
    ...(Array.isArray(record?.parts) ? (record.parts as unknown[]) : []),
    // Storage parts too: the report names what a pirate took from the hold.
    ...(Array.isArray(record?.storage) ? (record.storage as unknown[]) : []),
  ];
  if (parts.length === 0) return {};
  const out: Record<string, string> = {};
  for (const entry of parts) {
    const candidate = entry as { id?: unknown; partType?: unknown };
    if (typeof candidate.id === 'string' && typeof candidate.partType === 'string') {
      out[candidate.id] = candidate.partType;
    }
  }
  return out;
}

interface SnapshotPartEntry {
  readonly id?: unknown;
  readonly partType?: unknown;
  readonly condition?: unknown;
  readonly catalog?: { readonly partClass?: unknown; readonly esc?: unknown };
}

function installedPartsOf(snapshot: unknown): SnapshotPartEntry[] {
  const record = snapshot as { parts?: unknown } | null;
  return Array.isArray(record?.parts) ? (record.parts as SnapshotPartEntry[]) : [];
}

/** Every installed part's condition at dispatch — the Details tab's "before" column. */
export function partsBeforeOf(
  snapshot: unknown,
): readonly { id: string; partType: string; condition: number }[] {
  const out: { id: string; partType: string; condition: number }[] = [];
  for (const entry of installedPartsOf(snapshot)) {
    if (
      typeof entry.id === 'string' &&
      typeof entry.partType === 'string' &&
      typeof entry.condition === 'number'
    ) {
      out.push({ id: entry.id, partType: entry.partType, condition: entry.condition });
    }
  }
  return out;
}

/**
 * True when the dispatched ship had a shield: a DEFENSE part whose catalog ESC is > 0 — the same
 * test `failureCategory('DEFENSE', providesEsc)` uses to decide choke-criticality. Armor plates
 * (DEFENSE without ESC) do not count.
 */
export function hasShieldOf(snapshot: unknown): boolean {
  return installedPartsOf(snapshot).some(
    (entry) =>
      entry.catalog?.partClass === 'DEFENSE' &&
      typeof entry.catalog.esc === 'number' &&
      entry.catalog.esc > 0,
  );
}

function readBalanceAfter(payload: unknown): number | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as { balanceAfter?: unknown }).balanceAfter;
  return typeof value === 'number' ? value : undefined;
}

interface ResolvedEvent {
  readonly creditsDelta: number | null;
  readonly payload: unknown;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OwnershipResolverRegistry,
  ) {}

  async list(playerId: string, limitRaw?: string, cursorRaw?: string): Promise<ReportListResponse> {
    const limit = parseLimit(limitRaw);
    const cursor = cursorRaw !== undefined ? decodeCursor(cursorRaw) : undefined;
    const rows = await this.prisma.missionLog.findMany({
      where: {
        playerId,
        ...(cursor !== undefined
          ? {
              OR: [
                { createdAt: { lt: cursor.at } },
                { createdAt: { equals: cursor.at }, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        missionId: true,
        outcome: true,
        legs: true,
        schemaVersion: true,
        createdAt: true,
      },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    // One query for the whole page (was one per row).
    const resolvedByMission = await this.resolvedEvents(
      playerId,
      page.map((row) => row.missionId),
    );
    const items = page.map((row) => {
      const stored = (row.legs ?? {}) as StoredLogJson;
      const resolved = resolvedByMission.get(row.missionId);
      // "Fails loudly" (S9.1) is the single-report path's rule, not the list's: one row whose
      // schemaVersion this build can't read must never break the whole history, so this parse
      // is lenient here on purpose (credits still has the wallet event as its real source either
      // way; hadCombat has no such fallback, so an unreadable row just reads as no combat).
      const events = this.parseStoredEventsLeniently(row.missionId, row.schemaVersion, stored.events);
      const credits = resolved?.creditsDelta ?? sumStoredCredits(events);
      return {
        missionId: row.missionId,
        outcome: row.outcome,
        credits,
        legs: Array.isArray(stored.legs) ? stored.legs.length : 0,
        createdAt: row.createdAt.toISOString(),
        hadCombat: events.some((event) => event.category === 'combat'),
      };
    });
    const last = page[page.length - 1];
    return {
      items,
      ...(hasMore && last !== undefined
        ? { nextCursor: encodeCursor(last.createdAt, last.id) }
        : {}),
    };
  }

  async report(
    playerId: string,
    missionId: string,
    viewRaw?: string,
    explicitLocale?: string,
  ): Promise<ReportResponse> {
    // Same id, wrong owner → 404 (not 403): a report id must never confirm
    // another player's mission exists (S9.3 resolves ownership through the
    // registry directly; OwnershipGuard's 403 semantics are for owned-resource
    // routes where the caller may hold a legitimate resource of that kind).
    const owner = await this.registry.resolve('mission')(missionId);
    if (owner === null || owner.ownerPlayerId !== playerId) {
      throw new NotFoundException({ error: 'REPORT_NOT_FOUND' });
    }
    const log = await this.loadReportLog(missionId);
    if (log === null) throw new NotFoundException({ error: 'REPORT_NOT_FOUND' });
    return this.render(log, playerId, viewRaw, explicitLocale);
  }

  // The single (log, view, locale) → response path (S9.3), public so the S11.4 admin
  // replay renders its recomputed ReportLog through exactly the code the player path
  // uses: same view validation, same locale resolution, same EntityNames, same renderer.
  async render(
    log: ReportLog,
    playerId: string,
    viewRaw?: string,
    explicitLocale?: string,
  ): Promise<ReportResponse> {
    const view = viewRaw ?? 'summary';
    if (!(VIEW_NAMES as readonly string[]).includes(view)) {
      throw new BadRequestException({ error: 'UNKNOWN_VIEW' });
    }
    const locale = await this.localeFor(playerId, explicitLocale);
    const names = await this.entityNames(locale, log.partTypeById);
    const result = renderReport(log, locale, view as ViewName, names);
    const mission = await this.prisma.missionInstance.findUnique({
      where: { id: log.missionId },
      select: {
        type: true,
        originId: true,
        destinationId: true,
        reward: true,
        legs: true,
        template: { select: { displayName: true } },
      },
    });
    return {
      locale,
      outcome: log.outcome,
      stats: computeReportStats(log, names),
      ...(mission === null
        ? {}
        : {
            mission: {
              type: mission.type,
              originId: mission.originId,
              destinationId: mission.destinationId,
              reward: mission.reward,
              routeIds: routeIdsOf(mission.legs),
              title: bilingual(mission.template.displayName),
            },
          }),
      ...result,
    };
  }

  private async loadReportLog(missionId: string): Promise<ReportLog | null> {
    const log = await this.prisma.missionLog.findUnique({ where: { missionId } });
    if (log === null) return null;
    const stored = (log.legs ?? {}) as StoredLogJson;
    const events = this.parseStoredEvents(missionId, log.schemaVersion, stored.events);
    const rawLegs = stored.legs;
    const legs: ReportLegRef[] = Array.isArray(rawLegs)
      ? rawLegs.map((entry) => entry as { index: number; status: string })
      : [];
    const resolved = (await this.resolvedEvents(log.playerId, [missionId])).get(missionId);
    const balanceAfter = readBalanceAfter(resolved?.payload);
    return {
      missionId,
      seed: log.seed,
      schemaVersion: log.schemaVersion,
      outcome: log.outcome,
      events,
      legs,
      partTypeById: partTypesOf(log.shipSnapshot),
      hasShield: hasShieldOf(log.shipSnapshot),
      partsBefore: partsBeforeOf(log.shipSnapshot),
      credits: resolved?.creditsDelta ?? sumStoredCredits(events),
      ...(balanceAfter !== undefined ? { balanceAfter } : {}),
    };
  }

  // The list: one row whose schemaVersion this build can't read must never break the whole
  // history (an existing, tested guarantee) — empty events for that one row, not a 500. Logs
  // the same way parseStoredEvents does, just doesn't re-throw.
  private parseStoredEventsLeniently(
    missionId: string,
    schemaVersion: number,
    raw: unknown,
  ): ParsedMissionEvent[] {
    try {
      return parseMissionLogEvents(schemaVersion, raw);
    } catch (error) {
      if (error instanceof UnsupportedMissionLogSchemaError) {
        this.logger.error(`mission ${missionId}: ${error.message}`);
        return [];
      }
      throw error;
    }
  }

  // An unreadable log must fail loudly (S9.1): rendering "no events" for an unknown
  // schemaVersion would look like an empty mission instead of the deploy/data bug it is.
  private parseStoredEvents(
    missionId: string,
    schemaVersion: number,
    raw: unknown,
  ): ParsedMissionEvent[] {
    try {
      return parseMissionLogEvents(schemaVersion, raw);
    } catch (error) {
      if (error instanceof UnsupportedMissionLogSchemaError) {
        this.logger.error(`mission ${missionId}: ${error.message}`);
        throw new InternalServerErrorException({ error: 'REPORT_SCHEMA_UNSUPPORTED' });
      }
      throw error;
    }
  }

  // The `mission.resolved` event of each mission, in one query. Prisma's JSON filter has
  // no `in`, so the page's ids become an OR of path-equals; the (playerId, at) index
  // narrows the scan to this player's events first.
  private async resolvedEvents(
    playerId: string,
    missionIds: readonly string[],
  ): Promise<Map<string, ResolvedEvent>> {
    const byMission = new Map<string, ResolvedEvent>();
    if (missionIds.length === 0) return byMission;
    const rows = await this.prisma.playerEvent.findMany({
      where: {
        playerId,
        type: 'mission.resolved',
        OR: missionIds.map((missionId) => ({
          payload: { path: ['missionId'], equals: missionId },
        })),
      },
      orderBy: { at: 'desc' },
      select: { creditsDelta: true, payload: true },
    });
    for (const row of rows) {
      const missionId = (row.payload as { missionId?: unknown } | null)?.missionId;
      // Newest first: keep the latest event per mission.
      if (typeof missionId === 'string' && !byMission.has(missionId)) {
        byMission.set(missionId, { creditsDelta: row.creditsDelta, payload: row.payload });
      }
    }
    return byMission;
  }

  private async localeFor(playerId: string, explicit: string | undefined): Promise<Locale> {
    const saved =
      explicit === undefined
        ? (
            await this.prisma.player.findUnique({
              where: { id: playerId },
              select: { locale: true },
            })
          )?.locale
        : undefined;
    return resolveRequestLocale(explicit, saved);
  }

  private async entityNames(
    locale: Locale,
    partTypeById: Readonly<Record<string, string>>,
  ): Promise<EntityNames> {
    const [parts, materials] = await Promise.all([
      this.prisma.partCatalog.findMany({ select: { partType: true, displayName: true } }),
      this.prisma.material.findMany({ select: { id: true, displayName: true } }),
    ]);
    const catalogByType = new Map(parts.map((row) => [row.partType, row]));
    return {
      // Events name parts by instance id: the dispatch snapshot says which catalog type each
      // instance was, and the live catalog (D38) supplies the localized name.
      parts: Object.fromEntries(
        Object.entries(partTypeById).map(([instanceId, partType]) => {
          const row = catalogByType.get(partType);
          const name =
            row === undefined
              ? partType
              : localizeDisplayName(row.displayName as Record<string, unknown>, locale);
          return [instanceId, { partType, name }];
        }),
      ),
      materials: Object.fromEntries(
        materials.map((row) => [
          row.id,
          localizeDisplayName(row.displayName as Record<string, unknown>, locale),
        ]),
      ),
      partTypes: Object.fromEntries(
        parts.map((row) => [
          row.partType,
          localizeDisplayName(row.displayName as Record<string, unknown>, locale),
        ]),
      ),
    };
  }
}

export function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIST_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIST_LIMIT) {
    throw new BadRequestException({ error: 'INVALID_LIMIT' });
  }
  return value;
}

export function decodeCursor(raw: string): { at: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      at?: unknown;
      id?: unknown;
    };
    const at = typeof parsed.at === 'string' ? new Date(parsed.at) : null;
    if (at === null || Number.isNaN(at.getTime()) || typeof parsed.id !== 'string') {
      throw new Error('bad cursor');
    }
    return { at, id: parsed.id };
  } catch {
    throw new BadRequestException({ error: 'INVALID_CURSOR' });
  }
}

function sumStoredCredits(events: readonly ParsedMissionEvent[]): number {
  return Math.round(events.reduce((sum, event) => sum + event.effects.credits, 0));
}
