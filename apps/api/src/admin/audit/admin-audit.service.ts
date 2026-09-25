import { Injectable } from '@nestjs/common';
import type { AdminAuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

// S11.1: every non-tuning admin write (support actions, flags, broadcast, maintenance)
// records one row here — actor, action, target, before/after, ip. Tuning writes are
// audited through TuningRevision (S3.7/S3.8) and never through this service.
//
// `record` takes an optional transaction client so callers can audit inside the same
// transaction as the mutation they are performing: a rolled-back write must not leave
// an audit row behind (and a committed write must not lose one).
export interface AdminAuditEntry {
  /** The admin's accountId — same actor vocabulary as TuningRevision.actor. */
  actor: string;
  /** Stable action code, e.g. 'SUPPORT_GRANT_CREDITS', 'FLAG_SET', 'BROADCAST_CREATE'. */
  action: string;
  /** What was acted on: playerId, flag key, notice id, ... */
  target?: string | null;
  /** State before the write; null/undefined when the write created the target. */
  before?: unknown;
  /** State after the write. */
  after?: unknown;
  /** Requesting admin's IP, when the caller has the HTTP request at hand. */
  ip?: string | null;
}

export interface AdminAuditListFilters {
  action?: string;
  target?: string;
  limit?: number;
  offset?: number;
}

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  // Nullable JSON column: Prisma only accepts JsonNull/DbNull sentinels (not plain null)
  // on typed input, and "no prior state" and "omitted" are the same fact — both NULL.
  if (value === undefined || value === null) return undefined;
  return value;
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AdminAuditEntry, tx?: Prisma.TransactionClient): Promise<AdminAuditLog> {
    const client = tx ?? this.prisma;
    return client.adminAuditLog.create({
      data: {
        actor: entry.actor,
        action: entry.action,
        target: entry.target ?? null,
        before: jsonValue(entry.before),
        after: jsonValue(entry.after),
        ip: entry.ip ?? null,
      },
    });
  }

  async list(filters: AdminAuditListFilters = {}): Promise<AdminAuditLog[]> {
    const where: Prisma.AdminAuditLogWhereInput = {};
    if (filters.action !== undefined) where.action = filters.action;
    if (filters.target !== undefined) where.target = filters.target;
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.prisma.adminAuditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit,
      skip: filters.offset ?? 0,
    });
  }
}
