import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { MissionInstance } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
// Constructor-injected services must be value imports: emitDecoratorMetadata cannot
// reference `import type` bindings, so the worker's DI graph would see `Object`/`?`
// instead of the classes (JobsModule boot fails without this).
import { PrismaService } from '../../prisma/prisma.service.js';
import { PartsService } from '../../parts/parts.service.js';
import { MissionResolveService } from '../../missions/resolve.service.js';
import { rebuildDispatchData } from '../../missions/dispatch.service.js';
import type { DispatchJobData } from '../../missions/dispatch.service.js';
import { MISSION_QUEUE_NAME, RECONCILE_QUEUE_NAME } from '../queues.js';

// Cap per category per tick: keeps one reconcile job bounded; the next interval picks up
// the remainder. Matches the "bounded" wording of resolve-on-read without a config knob.
const RECONCILE_BATCH = 25;

type LeaveToWorkerState = 'delayed' | 'waiting' | 'active' | 'prioritized' | 'waiting-children';
const LEAVE_TO_WORKER_STATES: readonly string[] = [
  'delayed',
  'waiting',
  'active',
  'prioritized',
  'waiting-children',
];

function isLeaveToWorkerState(state: string): state is LeaveToWorkerState {
  return LEAVE_TO_WORKER_STATES.includes(state);
}

export interface ReconcileTickResult {
  readonly drained: number;
  readonly resolved: number;
}

// S7.4 reconciliation tick (plan line 443):
// 1. drain the mission queue's failed set (the dead-letter path): ghost/DONE/FAILED
//    missions just drop the job; a still-open mission is resolved after the job goes;
// 2. past-due IN_TRANSIT whose job is missing/failed/completed → resolve (lost-job,
//    kill-worker, enqueue-failure, and server-down-at-arrivalAt scenarios);
// 3. stuck RESOLVING with no live job → REQUEUE back to IN_TRANSIT, then resolve.
// Jobs still waiting/delayed/active are left to the mission worker — it owns them.
@Processor(RECONCILE_QUEUE_NAME)
@Injectable()
export class ReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconcileProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(MISSION_QUEUE_NAME) private readonly missions: Queue<DispatchJobData>,
    private readonly resolveService: MissionResolveService,
    private readonly parts: PartsService,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<ReconcileTickResult> {
    let drained = 0;
    let resolved = 0;

    drained += await this.drainFailedSet();
    resolved += await this.resolvePastDue();
    resolved += await this.requeueStuck();

    if (drained > 0 || resolved > 0) {
      this.logger.log(
        `reconcile tick ${job.id ?? 'inline'}: drained ${drained}, resolved ${resolved}`,
      );
    }
    return { drained, resolved };
  }

  private async drainFailedSet(): Promise<number> {
    const failed = await this.missions.getFailed(0, RECONCILE_BATCH - 1);
    let drained = 0;
    for (const job of failed) {
      const missionId = job.data.missionId;
      const mission = missionId
        ? await this.prisma.missionInstance.findUnique({ where: { id: missionId } })
        : null;
      const finished = !mission || mission.status === 'DONE' || mission.status === 'FAILED';
      await job.remove().catch(() => undefined);
      drained += 1;
      if (finished) continue;
      try {
        await this.reconcileMission(mission);
      } catch (error) {
        this.logger.warn(
          `reconcile of mission ${mission.id} after dead-letter drain failed: ${String(error)}`,
        );
      }
    }
    return drained;
  }

  private async resolvePastDue(): Promise<number> {
    const due = await this.prisma.missionInstance.findMany({
      where: { status: 'IN_TRANSIT', arrivalAt: { lte: new Date() } },
      take: RECONCILE_BATCH,
      orderBy: { arrivalAt: 'asc' },
    });
    let resolved = 0;
    for (const mission of due) {
      if (await this.jobStillOwnedByWorker(mission.id)) continue;
      try {
        await this.reconcileMission(mission);
        resolved += 1;
      } catch (error) {
        this.logger.warn(`reconcile of past-due mission ${mission.id} failed: ${String(error)}`);
      }
    }
    return resolved;
  }

  private async requeueStuck(): Promise<number> {
    const stuck = await this.prisma.missionInstance.findMany({
      where: { status: 'RESOLVING' },
      take: RECONCILE_BATCH,
      orderBy: { id: 'asc' },
    });
    let resolved = 0;
    for (const mission of stuck) {
      if (await this.jobStillOwnedByWorker(mission.id)) continue;
      const job = await this.missions.getJob(mission.id);
      await job?.remove().catch(() => undefined);
      // S7.3 acceptance / S7.4: a claim with no live worker returns to IN_TRANSIT first,
      // so the state machine sees a legal RESOLVE rather than a stuck RESOLVING row.
      const requeue = await this.prisma.missionInstance.updateMany({
        where: { id: mission.id, status: 'RESOLVING' },
        data: { status: 'IN_TRANSIT' },
      });
      if (requeue.count === 0) continue;
      try {
        await this.reconcileMission(mission);
        resolved += 1;
      } catch (error) {
        this.logger.warn(`requeue+resolve of mission ${mission.id} failed: ${String(error)}`);
      }
    }
    return resolved;
  }

  // True when a job for this mission still exists and is one the mission worker owns —
  // only missing/failed/completed jobs are the reconciler's to touch.
  private async jobStillOwnedByWorker(missionId: string): Promise<boolean> {
    const job = await this.missions.getJob(missionId);
    if (!job) return false;
    const state = await job.getState();
    if (state === 'failed' || state === 'completed') {
      await job.remove().catch(() => undefined);
      return false;
    }
    return isLeaveToWorkerState(state);
  }

  private async reconcileMission(mission: MissionInstance): Promise<unknown> {
    const job = await this.missions.getJob(mission.id);
    const data = job?.data ?? (await rebuildDispatchData(this.prisma, this.parts, mission));
    await job?.remove().catch(() => undefined);
    return this.resolveService.resolve(data);
  }
}
