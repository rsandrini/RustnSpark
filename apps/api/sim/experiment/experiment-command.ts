/**
 * `pnpm sim experiment --runs N --missions M --seed S`: play the default 10-cell matrix (three
 * temperaments × three playstyles, plus the random generalist control) on the same snapshot and
 * seeds, print one table, and store every run under a single experiment header.
 *
 * Correctness first: runs are in-process and sequential — a worker pool is a future option, so
 * `--runs` is scaled for wall time, not throughput.
 */
import { calendarDays, DEFAULT_BUDGET } from '../core/clock.js';
import { cellName, defaultMatrix, type ExperimentCell } from './cells.js';
import {
  daysToLevelSpread,
  runCell,
  summarizeRun,
  type RunSummary,
} from './runner.js';
import { boolFlag, intFlag, parseFlags, stringFlag } from '../flags.js';
import { SNAPSHOT_PATH } from '../paths.js';
import { loadSnapshot } from '../snapshot/load-snapshot.js';
import { writeExperimentRuns } from '../store/writer.js';
import type { RunResult } from '../bots/bot.js';

const LEVELS = [2, 3, 4, 5] as const;

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function padRight(value: string, width: number): string {
  return value.padEnd(width);
}

/** `10@12.3d` — reached count and median days; `-` when nobody got there. */
function levelCell(summaries: readonly RunSummary[], level: number): string {
  const [spread] = daysToLevelSpread(summaries, [level]);
  if (spread === undefined || spread.reached === 0) return '-';
  return `${spread.reached}@${spread.daysMedian.toFixed(1)}d`;
}

function printCell(
  cell: ExperimentCell,
  summaries: readonly RunSummary[],
  results: readonly RunResult[],
): void {
  const stalled = summaries.filter((summary) => summary.stalled).length;
  const success =
    summaries.reduce((sum, summary) => sum + summary.successRate, 0) / summaries.length;
  const totalDays = results.reduce(
    (sum, result) =>
      sum + calendarDays(result.totalSeconds, {
        hoursPerDay: cell.hoursPerDay,
        humanPauseSeconds: DEFAULT_BUDGET.humanPauseSeconds,
      }),
    0,
  );
  const cells = LEVELS.map((level) => pad(levelCell(summaries, level), 9)).join(' ');
  process.stdout.write(
    `${padRight(cellName(cell), 26)} ${cells} ${pad(stalled, 7)} ` +
      `${pad(`${Math.round(success * 100)}%`, 8)} ${pad(`${totalDays.toFixed(0)}d`, 8)}\n`,
  );
}

export function experimentCommand(args: readonly string[]): Promise<void> {
  const flags = parseFlags(args);
  const runs = intFlag(flags, 'runs', 100);
  const missions = intFlag(flags, 'missions', 300);
  const baseSeed = intFlag(flags, 'seed', 1);
  const hoursPerDay = intFlag(flags, 'hours-per-day', DEFAULT_BUDGET.hoursPerDay);
  const name = stringFlag(flags, 'name', 'experiment');
  const noStore = boolFlag(flags, 'no-store');

  const snapshot = loadSnapshot(SNAPSHOT_PATH);
  const matrix = defaultMatrix(hoursPerDay);
  const allResults: RunResult[] = [];

  process.stdout.write(
    `matrix: ${matrix.length} cells x ${runs} runs x ${missions} missions ` +
      `(seeds ${baseSeed}..${baseSeed + runs - 1})\n`,
  );
  process.stdout.write(
    `${padRight('cell', 26)} ${LEVELS.map((level) => pad(`L${level} reached@median`, 9)).join(' ')} ` +
      `${pad('stalled', 7)} ${pad('success', 8)} ${pad('time', 8)}\n`,
  );

  for (const cell of matrix) {
    const cellResult = runCell(snapshot, cell, runs, baseSeed, missions);
    const summaries = cellResult.results.map((result) =>
      summarizeRun(result, {
        hoursPerDay: cell.hoursPerDay,
        humanPauseSeconds: DEFAULT_BUDGET.humanPauseSeconds,
      }),
    );
    printCell(cell, summaries, cellResult.results);
    allResults.push(...cellResult.results);
  }

  if (!noStore) {
    const written = writeExperimentRuns(snapshot, allResults, {
      experimentName: name,
      argsJson: JSON.stringify({
        runs,
        missions,
        seed: baseSeed,
        hoursPerDay,
        cells: matrix.length,
      }),
    });
    process.stdout.write(
      `stored: sim-data/sim.db experiment ${written.experimentId} ` +
        `(${written.runIds.length} runs)\n`,
    );
  }
  return Promise.resolve();
}
