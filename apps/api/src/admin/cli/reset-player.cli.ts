import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AccountRole } from '@prisma/client';
import { parseArgs } from 'node:util';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SupportService } from '../inspector/support.service.js';

// A local, one-off equivalent of the S11.4 support screen's "reset" action (POST
// /v1/admin/inspector/:playerId/reset) plus an optional promotion to ADMIN — for the owner to
// wipe their own live state (ship, parts, active missions, wallet) back to a fresh onboarded run
// without hand-rolling the deletion order in psql. History (PlayerEvent, MissionLog,
// AdminAuditLog) is kept; SupportService.reset is the single source of truth for what "reset"
// means, so this stays correct as that action evolves.
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      admin: { type: 'boolean', default: false },
      reason: { type: 'string', default: 'owner debug reset (CLI)' },
    },
    allowPositionals: false,
  });
  if (!values.email) {
    throw new Error('--email is required');
  }
  const email = values.email.toLowerCase();

  // The full app (not a trimmed module) because SupportService pulls in the wallet, onboarding
  // and config services it needs — bootstrapping it standalone would just re-list them here.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const prisma = app.get(PrismaService);
    const support = app.get(SupportService);

    const account = await prisma.account.findUnique({
      where: { email },
      include: { player: true },
    });
    if (!account) {
      throw new Error(`no account for ${email}`);
    }
    if (!account.player) {
      throw new Error(`${email} has not onboarded (no Player row) — nothing to reset`);
    }

    if (values.admin && account.role !== AccountRole.ADMIN) {
      await prisma.account.update({ where: { id: account.id }, data: { role: AccountRole.ADMIN } });
    }

    const result = await support.reset(account.player.id, {
      actor: account.id,
      reason: values.reason,
    });
    console.log(JSON.stringify({ accountId: account.id, playerId: account.player.id, ...result }));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
