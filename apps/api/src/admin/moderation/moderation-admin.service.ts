import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { callsignOf } from '../../stats/callsign.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';
import { SupportService, type SupportContext } from '../inspector/support.service.js';
import type { ReviewAction } from './dto/review-report.dto.js';

export type ReportStatusFilter = 'OPEN' | 'DISMISSED' | 'ACTIONED' | 'ALL';

const LIST_LIMIT = 100;
const PILOT_NAME_SUFFIX_BYTES = 3;

export interface ReportRow {
  id: string;
  subject: string;
  reason: string;
  note: string | null;
  reportedText: string;
  status: string;
  createdAt: string;
  reporter: { id: string; name: string };
  target: { id: string; name: string; shipName: string | null; banned: boolean };
  /** All reports ever filed against this pilot, this one included. */
  reportsAgainstTarget: number;
  review: {
    by: string;
    at: string;
    outcome: string | null;
    note: string | null;
  } | null;
}

/** An admin works through the name reports pilots filed: read them, then dismiss or act. */
@Injectable()
export class ModerationAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly support: SupportService,
  ) {}

  async list(status: ReportStatusFilter): Promise<ReportRow[]> {
    const rows = await this.prisma.nameReport.findMany({
      where: status === 'ALL' ? {} : { status },
      orderBy: { createdAt: status === 'OPEN' ? 'asc' : 'desc' },
      take: LIST_LIMIT,
      include: {
        reporter: { select: { id: true, name: true } },
        target: {
          select: {
            id: true,
            name: true,
            account: { select: { status: true } },
            ships: { select: { name: true }, orderBy: { id: 'asc' }, take: 1 },
          },
        },
      },
    });
    const targetIds = [...new Set(rows.map((row) => row.targetId))];
    const counts = await this.prisma.nameReport.groupBy({
      by: ['targetId'],
      where: { targetId: { in: targetIds } },
      _count: { _all: true },
    });
    const countOf = new Map(counts.map((entry) => [entry.targetId, entry._count._all]));
    return rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      reason: row.reason,
      note: row.note,
      reportedText: row.reportedText,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      reporter: row.reporter,
      target: {
        id: row.target.id,
        name: row.target.name,
        shipName: row.target.ships[0]?.name ?? null,
        banned: row.target.account.status !== 'ACTIVE',
      },
      reportsAgainstTarget: countOf.get(row.targetId) ?? 1,
      review:
        row.reviewedBy === null || row.reviewedAt === null
          ? null
          : {
              by: row.reviewedBy,
              at: row.reviewedAt.toISOString(),
              outcome: row.outcome,
              note: row.reviewNote,
            },
    }));
  }

  /**
   * Decide a report. DISMISS closes it; the other actions change what was reported (or ban the account) and close
   * every open report on the same pilot and subject with the same outcome. Every decision leaves an audit row.
   */
  async review(
    reportId: string,
    action: ReviewAction,
    note: string | undefined,
    context: Omit<SupportContext, 'reason'>,
  ): Promise<{ id: string; status: string; outcome: ReviewAction }> {
    const report = await this.prisma.nameReport.findUnique({ where: { id: reportId } });
    if (report === null) throw new NotFoundException('report not found');
    if (report.status !== 'OPEN') throw new ConflictException({ error: 'REPORT_ALREADY_REVIEWED' });
    const reviewNote = note?.trim() ? note.trim() : null;
    const reason = reviewNote ?? `name report ${action}`;

    if (action === 'BAN') {
      await this.support.ban(report.targetId, { ...context, reason });
    } else if (action === 'RESET_SHIP_NAME') {
      await this.resetShipName(report.targetId, { ...context, reason });
    } else if (action === 'RESET_PILOT_NAME') {
      await this.resetPilotName(report.targetId, { ...context, reason });
    }

    const status = action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED';
    // The same offence reported by several pilots is settled once.
    const closed = await this.prisma.nameReport.updateMany({
      where: {
        status: 'OPEN',
        targetId: report.targetId,
        ...(action === 'BAN' ? {} : { subject: report.subject }),
        ...(action === 'DISMISS' ? { id: report.id } : {}),
      },
      data: {
        status,
        reviewedBy: context.actor,
        reviewedAt: new Date(),
        outcome: action,
        reviewNote,
      },
    });
    await this.audit.record({
      actor: context.actor,
      action: 'NAME_REPORT_REVIEW',
      target: report.targetId,
      before: { reportId, subject: report.subject, reportedText: report.reportedText },
      after: { outcome: action, closedReports: closed.count, reason },
      ip: context.ip ?? null,
    });
    return { id: report.id, status, outcome: action };
  }

  /** Back to the generated callsign (faction tag, pilot name, a word). */
  private async resetShipName(targetId: string, context: SupportContext): Promise<void> {
    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: targetId },
      select: { id: true, name: true, factionId: true },
    });
    const ship = await this.prisma.ship.findFirst({
      where: { ownerPlayerId: targetId },
      orderBy: { id: 'asc' },
    });
    if (ship === null) throw new ConflictException({ error: 'NO_SHIP_TO_REPORT' });
    const name = callsignOf({
      factionId: player.factionId,
      playerName: player.name,
      playerId: player.id,
    });
    await this.prisma.ship.update({ where: { id: ship.id }, data: { name } });
    await this.audit.record({
      actor: context.actor,
      action: 'SUPPORT_RESET_SHIP_NAME',
      target: targetId,
      before: { name: ship.name },
      after: { name, reason: context.reason },
      ip: context.ip ?? null,
    });
  }

  /** A neutral, unique pilot name: `Pilot-` and six hex characters. */
  private async resetPilotName(targetId: string, context: SupportContext): Promise<void> {
    const before = await this.prisma.player.findUniqueOrThrow({
      where: { id: targetId },
      select: { name: true },
    });
    const name = await this.freshPilotName();
    await this.prisma.player.update({ where: { id: targetId }, data: { name } });
    await this.audit.record({
      actor: context.actor,
      action: 'SUPPORT_RESET_PILOT_NAME',
      target: targetId,
      before: { name: before.name },
      after: { name, reason: context.reason },
      ip: context.ip ?? null,
    });
  }

  private async freshPilotName(): Promise<string> {
    const name = `Pilot-${randomBytes(PILOT_NAME_SUFFIX_BYTES).toString('hex')}`;
    const taken = await this.prisma.player.findUnique({ where: { name }, select: { id: true } });
    return taken === null ? name : this.freshPilotName();
  }
}
