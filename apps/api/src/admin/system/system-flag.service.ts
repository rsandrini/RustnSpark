import { Injectable } from '@nestjs/common';
import type { SystemFlag } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';

// Reserved flag keys with a runtime consumer (S11.2): every flag is readable by key, but
// only these change server behaviour today — the maintenance guard and registration.
export const MAINTENANCE_FLAG_KEY = 'maintenance';
export const REGISTER_OPEN_FLAG_KEY = 'register.open';

export interface FlagWriteContext {
  actor: string;
  ip?: string | null;
  /** Audit action code; defaults to FLAG_SET (the maintenance toggle uses the same path). */
  action?: string;
}

@Injectable()
export class SystemFlagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  // Read path deliberately has no cache: the row IS the state, which is what makes a
  // write effective without a restart (S11.2 acceptance). Mutations are the only hot
  // caller (MaintenanceGuard), so this is one indexed point lookup per player intent.
  async isEnabled(key: string, fallback: boolean): Promise<boolean> {
    const row = await this.prisma.systemFlag.findUnique({ where: { key } });
    return row === null ? fallback : row.value;
  }

  async list(): Promise<SystemFlag[]> {
    return this.prisma.systemFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async setFlag(key: string, value: boolean, context: FlagWriteContext): Promise<SystemFlag> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.systemFlag.findUnique({ where: { key } });
      const flag = await tx.systemFlag.upsert({
        where: { key },
        create: { key, value, updatedBy: context.actor },
        update: { value, updatedBy: context.actor },
      });
      // Audited in the same transaction: a rolled-back toggle must not leave a row behind.
      await this.audit.record(
        {
          actor: context.actor,
          action: context.action ?? 'FLAG_SET',
          target: key,
          before: existing === null ? null : existing.value,
          after: value,
          ip: context.ip ?? null,
        },
        tx,
      );
      return flag;
    });
  }
}
