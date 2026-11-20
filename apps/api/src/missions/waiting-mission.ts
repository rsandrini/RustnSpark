import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';

/** A mission under way (flying or being resolved): nothing else may run beside it. An accepted one is only waiting. */
export const IN_PROGRESS_STATUSES = ['IN_TRANSIT', 'RESOLVING'] as const;

/** The generic templates of the jobs a pilot starts at a port (they are not offers from the board). */
export const JOB_TEMPLATE_IDS: readonly string[] = ['scavenge_generic', 'mining_job_generic'];

/**
 * A search or a mining job can run while a board mission is accepted and waiting to start, but it must be over
 * before that mission's start-before time (or its offer window) runs out: the mission stays where it is, waiting.
 * Throws `JOB_PAST_START_DEADLINE` when the job would end too late; nothing else is checked here.
 */
export async function assertJobFitsWaitingMission(
  prisma: PrismaService,
  playerId: string,
  endsAt: Date,
): Promise<void> {
  const waiting = await prisma.missionInstance.findFirst({
    where: { playerId, status: 'ACCEPTED', templateId: { notIn: [...JOB_TEMPLATE_IDS] } },
    select: { deadlineAt: true, expiresAt: true },
  });
  if (waiting === null) return;
  const limits = [waiting.deadlineAt, waiting.expiresAt]
    .filter((moment): moment is Date => moment !== null)
    .map((moment) => moment.getTime());
  if (limits.length > 0 && endsAt.getTime() > Math.min(...limits)) {
    throw new ConflictException({ error: 'JOB_PAST_START_DEADLINE' });
  }
}
