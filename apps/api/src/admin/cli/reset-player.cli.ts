import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AccountRole } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
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
//
// --hard goes further, back to right after registration (faction unpicked, no ship, no history):
// SupportService.reset deliberately never does this (a live support tool must never erase a real
// player's faction or history), so this is a separate, owner-only path that only this CLI takes.
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      admin: { type: 'boolean', default: false },
      hard: { type: 'boolean', default: false },
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
      await prisma.account.update({
        where: { id: account.id },
        data: { role: AccountRole.ADMIN },
      });
    }

    const result = values.hard
      ? await hardReset(prisma, account.id, account.player.id)
      : await app
          .get(SupportService)
          .reset(account.player.id, { actor: account.id, reason: values.reason });
    console.log(JSON.stringify({ accountId: account.id, playerId: account.player.id, ...result }));
  } finally {
    await app.close();
  }
}

/**
 * Back to exactly what registration leaves behind: the Player row survives (its id, name,
 * locale — an active session's JWT still resolves), everything under it is gone, and
 * factionId/credits go back to their pre-onboarding zero/null so onboarding runs again as if
 * for the first time (faction reselected, a brand new starter kit and ship).
 */
async function hardReset(
  prisma: PrismaClient,
  accountId: string,
  playerId: string,
): Promise<Record<string, unknown>> {
  return prisma.$transaction(async (tx) => {
    const ships = await tx.ship.findMany({
      where: { ownerPlayerId: playerId },
      select: { id: true },
    });
    const shipIds = ships.map((ship) => ship.id);
    const missions = await tx.missionInstance.findMany({
      where: { OR: [{ playerId }, { privatePlayerId: playerId }, { shipId: { in: shipIds } }] },
      select: { id: true },
    });
    const missionIds = missions.map((mission) => mission.id);

    const before = {
      ships: shipIds.length,
      missions: missionIds.length,
      parts: await tx.partInstance.count({ where: { ownerPlayerId: playerId } }),
    };

    await tx.encounter.deleteMany({
      where: { OR: [{ missionAId: { in: missionIds } }, { missionBId: { in: missionIds } }] },
    });
    await tx.routePresence.deleteMany({
      where: { OR: [{ missionId: { in: missionIds } }, { shipId: { in: shipIds } }] },
    });
    await tx.missionLog.deleteMany({ where: { playerId } });
    await tx.missionInstance.deleteMany({ where: { id: { in: missionIds } } });
    await tx.repairJob.deleteMany({ where: { playerId } });
    await tx.partInstance.deleteMany({ where: { ownerPlayerId: playerId } });
    await tx.ship.deleteMany({ where: { ownerPlayerId: playerId } });
    await tx.playerMaterial.deleteMany({ where: { playerId } });
    await tx.scavengeCounter.deleteMany({ where: { playerId } });
    await tx.idempotencyKey.deleteMany({ where: { playerId } });
    await tx.playerEvent.deleteMany({ where: { playerId } });
    await tx.refreshToken.deleteMany({ where: { accountId } });
    await tx.player.update({ where: { id: playerId }, data: { factionId: null, credits: 0 } });

    return {
      action: 'HARD_RESET',
      target: playerId,
      before,
      after: { factionId: null, credits: 0 },
    };
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
