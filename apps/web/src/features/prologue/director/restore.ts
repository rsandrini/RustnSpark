import { PROLOGUE_ENGINE, PROLOGUE_HULL_UPGRADED } from '../prologue-fixtures';
import {
  fuelNeededFor,
  jobsAt,
  modulePrice,
  modulesFor,
  UPGRADE_SCRAP,
  type ModuleKind,
} from '../sandbox/sandbox-world';
import { previewOf, tankSpace } from '../sandbox/sandbox-ship';
import type { Sandbox } from '../sandbox/sandbox-state';
import { OPENING_STEPS, type StepId } from './steps';

const at = (step: StepId) => OPENING_STEPS.indexOf(step);

/** Flies a job from start to finish at once (the pilot has already done this in an earlier visit). */
function fly(sandbox: Sandbox, job: ReturnType<typeof jobsAt>[number]): void {
  sandbox.accept(job);
  const fuelUse = previewOf(sandbox, sandbox.state.layout).sheet.fuelUse;
  sandbox.dispatch(fuelNeededFor(job.routes, fuelUse));
  sandbox.settle(true);
}

function jobOf(sandbox: Sandbox, slot: 0 | 1 | 2 | 3, kind: ModuleKind | null) {
  const wanted = slot === 1 ? (kind ?? 'passengers') : null;
  const jobs = jobsAt(slot, sandbox.state.locationId, kind);
  return jobs.find((job) => wanted === null || job.kind === wanted) ?? jobs[0] ?? null;
}

/**
 * Builds the world as it stands at the START of `step`, on a fresh sandbox (the pilot closed the tab and came back): the
 * parts fitted, the jobs already flown, the money and fuel they left. The jobs are replayed through the sandbox's own
 * methods, so the credits always add up the way the story's script says. `kind` is the job type the pilot chose when
 * they bought the module (it decides the module and the second stop's jobs).
 */
export function restoreSandbox(sandbox: Sandbox, step: StepId, kind: ModuleKind | null): void {
  const index = at(step);
  const chosen: ModuleKind = kind ?? 'passengers';

  // the engine taken from the friend (every step after the gift has it), and fitted once the pilot got past fitting it
  if (index > at('gift')) sandbox.giveEngine();
  if (index > at('fit-engine')) {
    sandbox.saveLayout([...sandbox.state.layout, PROLOGUE_ENGINE.target]);
  }
  // the race flown (and, for the step that is in it, taken but not flown)
  if (index >= at('race')) {
    const race = jobOf(sandbox, 0, null);
    if (race !== null && index > at('race')) fly(sandbox, race);
    else if (race !== null) sandbox.accept(race);
  }
  // refuelled at the first stop
  if (index > at('stop-port')) {
    const { space } = tankSpace(sandbox);
    sandbox.refuel(space, sandbox.config.refuelCost);
  }
  // the kind of job chosen, the module bought, then fitted
  if (index >= at('buy-module')) sandbox.choose(chosen);
  if (index > at('buy-module')) {
    const bought = modulesFor(chosen).map((part) => ({
      part,
      id: sandbox.buy(part, modulePrice(part, sandbox.config.moduleCost)),
    }));
    if (index > at('fit-module')) {
      sandbox.saveLayout([
        ...sandbox.state.layout,
        ...bought.map(({ part, id }) => ({ ...part.target, partInstanceId: id })),
      ]);
    }
  }
  // the first job flown
  if (index >= at('job-report')) {
    const job = jobOf(sandbox, 1, chosen);
    if (job !== null) fly(sandbox, job);
  }
  // the worn parts repaired at the port (after the first job, before the hull upgrade)
  if (index > at('repair')) {
    const worn = sandbox.wornParts();
    if (worn.length > 0) {
      sandbox.repair(
        worn.map((part) => ({ partInstanceId: part.id, toCondition: 100 })),
        sandbox.config.repairCost,
      );
    }
  }
  // the hull upgraded (the friend's advice), once the first job is flown
  if (index >= at('upgrade')) sandbox.giveScrap(UPGRADE_SCRAP);
  if (index > at('upgrade')) {
    sandbox.upgradeHull(PROLOGUE_HULL_UPGRADED, sandbox.config.upgradeCost, UPGRADE_SCRAP);
  }
  // the second job flown
  if (index > at('stop-two')) {
    const job = jobOf(sandbox, 2, chosen);
    if (job !== null) fly(sandbox, job);
  }
  // the final run taken (final-run), or flown and lost (the loss and the rescue)
  if (index >= at('final-run')) {
    const job = jobOf(sandbox, 3, chosen);
    if (job !== null && index >= at('loss')) fly(sandbox, job);
    else if (job !== null) sandbox.accept(job);
  }
}
