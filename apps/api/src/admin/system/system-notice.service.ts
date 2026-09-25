import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, SystemNotice } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';

export interface NoticeMessage {
  en: string;
  'pt-BR': string;
}

export interface NoticeWriteContext {
  actor: string;
  ip?: string | null;
}

// S11.2: broadcast notices. Creation and dismissal are non-tuning admin writes, so both
// go through AdminAuditLog (S11.1) inside the same transaction as the row change.
@Injectable()
export class SystemNoticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  /** Player-facing view: active notices, newest first. */
  async listActive(): Promise<SystemNotice[]> {
    return this.prisma.systemNotice.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Admin view: everything, newest first. */
  async list(): Promise<SystemNotice[]> {
    return this.prisma.systemNotice.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(message: NoticeMessage, context: NoticeWriteContext): Promise<SystemNotice> {
    return this.prisma.$transaction(async (tx) => {
      const notice = await tx.systemNotice.create({
        data: { message: message as unknown as Prisma.InputJsonValue, createdBy: context.actor },
      });
      await this.audit.record(
        {
          actor: context.actor,
          action: 'BROADCAST_CREATE',
          target: notice.id,
          before: null,
          after: { message, active: true },
          ip: context.ip ?? null,
        },
        tx,
      );
      return notice;
    });
  }

  async dismiss(id: string, context: NoticeWriteContext): Promise<SystemNotice> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.systemNotice.findUnique({ where: { id } });
      if (existing === null) throw new NotFoundException('notice not found');
      // Already dismissed: no state change, so no second audit row.
      if (!existing.active) return existing;

      const notice = await tx.systemNotice.update({
        where: { id },
        data: { active: false, dismissedAt: new Date() },
      });
      await this.audit.record(
        {
          actor: context.actor,
          action: 'BROADCAST_DISMISS',
          target: id,
          before: { active: true },
          after: { active: false },
          ip: context.ip ?? null,
        },
        tx,
      );
      return notice;
    });
  }
}
