import type { Prisma } from '@prisma/client';

/** One part of a repair plan as it is stored on the job. */
export interface StoredTarget {
  readonly partInstanceId: string;
  readonly fromCondition: number;
  readonly toCondition: number;
}

export function parseTargets(raw: unknown): StoredTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate['partInstanceId'] !== 'string' ||
      typeof candidate['fromCondition'] !== 'number' ||
      typeof candidate['toCondition'] !== 'number'
    ) {
      return [];
    }
    return [
      {
        partInstanceId: candidate['partInstanceId'],
        fromCondition: candidate['fromCondition'],
        toCondition: candidate['toCondition'],
      },
    ];
  });
}

/**
 * The parts a pilot has paid to repair that the workshop has not finished yet. Such a part may still be moved
 * (taken off the ship, fitted again) but not sold or discarded: its price would climb with the work and the
 * repair already paid for would be wasted.
 */
export async function partsUnderRepair(
  db: Pick<Prisma.TransactionClient, 'repairJob'>,
  playerId: string,
): Promise<Set<string>> {
  const jobs = await db.repairJob.findMany({
    where: { playerId, status: 'PENDING' },
    select: { targets: true },
  });
  return new Set(jobs.flatMap((job) => parseTargets(job.targets).map((t) => t.partInstanceId)));
}
