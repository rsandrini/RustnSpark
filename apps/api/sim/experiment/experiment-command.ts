/**
 * `pnpm sim experiment --runs N --missions M --seed S [--edit file.json]`: play the default
 * 10-cell matrix (three temperaments × three playstyles, plus the random generalist control) on
 * the same snapshot and seeds, print the table, the full report (days-to-level spread, ledger
 * shares, cell spread) and store every run under one experiment header.
 *
 * `--edit` is the what-if: a JSON file of dotted rule keys and/or a bridge-scaling table. The
 * matrix then runs twice — base and edited — and the report shows both.
 *
 * Correctness first: runs are in-process and sequential — a worker pool is a future option, so
 * `--runs` is scaled for wall time, not throughput.
 */
import { readFileSync } from 'node:fs';
import { calendarDays, DEFAULT_BUDGET } from '../core/clock.js';
import { cellName, defaultMatrix, type ExperimentCell } from './cells.js';
import { daysToLevelSpread, percentile, runCell, summarizeRun, type RunSummary } from './runner.js';
import { printReport, type CellReport } from './report.js';
import { parseScaling, NO_SCALING, type BridgeScaling } from './scaling.js';
import { boolFlag, intFlag, parseFlags, stringFlag } from '../flags.js';
import { SNAPSHOT_PATH } from '../paths.js';
import { loadSnapshot, setRule, withEdits } from '../snapshot/load-snapshot.js';
import type { Json, Snapshot } from '../snapshot/types.js';
import { SIM_ASSUMPTIONS, writeExperimentRuns } from '../store/writer.js';
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
      sum +
      calendarDays(result.totalSeconds, {
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

interface EditFile {
  readonly rules?: Record<string, Json>;
  readonly bridgeScaling?: unknown;
}

function parseEditFile(path: string): EditFile {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`edit file ${path} must be a JSON object`);
  }
  return parsed;
}

interface MatrixRun {
  readonly reports: readonly CellReport[];
  readonly results: readonly RunResult[];
}

/** Plays the matrix, printing one table row per cell as it finishes. */
function playMatrix(
  snapshot: Snapshot,
  matrix: readonly ExperimentCell[],
  runs: number,
  baseSeed: number,
  missions: number,
  scaling: BridgeScaling,
): MatrixRun {
  const reports: CellReport[] = [];
  const results: RunResult[] = [];
  process.stdout.write(
    `${padRight('cell', 26)} ${LEVELS.map((level) => pad(`L${level} reached@median`, 9)).join(' ')} ` +
      `${pad('stalled', 7)} ${pad('success', 8)} ${pad('time', 8)}\n`,
  );
  for (const cell of matrix) {
    const cellResult = runCell(snapshot, cell, runs, baseSeed, missions, scaling);
    const summaries = cellResult.results.map((result) =>
      summarizeRun(result, {
        hoursPerDay: cell.hoursPerDay,
        humanPauseSeconds: DEFAULT_BUDGET.humanPauseSeconds,
      }),
    );
    printCell(cell, summaries, cellResult.results);
    results.push(...cellResult.results);
    reports.push({
      name: cellName(cell),
      summaries,
      deliberate: cell.temperament !== 'random',
    });
  }
  return { reports, results };
}

/** Median days to each level per cell — the A/B delta, base then edited. */
function printAb(base: readonly CellReport[], edited: readonly CellReport[]): void {
  process.stdout.write('\n--- A/B: median days to level (base -> edit) ---\n');
  for (const [index, baseCell] of base.entries()) {
    const editedCell = edited[index];
    if (editedCell === undefined) continue;
    const line = LEVELS.map((level) => {
      const before = baseCell.summaries
        .map((summary) => summary.daysToLevel[level - 1])
        .filter((value): value is number => value !== null && value !== undefined);
      const after = editedCell.summaries
        .map((summary) => summary.daysToLevel[level - 1])
        .filter((value): value is number => value !== null && value !== undefined);
      const med = (values: readonly number[]): string =>
        values.length === 0 ? '-' : percentile(values, 0.5).toFixed(1);
      return `L${level} ${med(before)}->${med(after)}`;
    }).join('  ');
    process.stdout.write(`${padRight(baseCell.name, 26)} ${line}\n`);
  }
}

export function experimentCommand(args: readonly string[]): Promise<void> {
  const flags = parseFlags(args);
  const runs = intFlag(flags, 'runs', 100);
  const missions = intFlag(flags, 'missions', 300);
  const baseSeed = intFlag(flags, 'seed', 1);
  const hoursPerDay = intFlag(flags, 'hours-per-day', DEFAULT_BUDGET.hoursPerDay);
  const name = stringFlag(flags, 'name', 'experiment');
  const editPath = stringFlag(flags, 'edit', '');
  const noStore = boolFlag(flags, 'no-store');

  const baseSnapshot = loadSnapshot(SNAPSHOT_PATH);
  // `--playstyle generalist` keeps one playstyle (and the random control): a quarter of the
  // matrix, for a quick look. Default: the whole matrix.
  const onlyPlaystyle = stringFlag(flags, 'playstyle', '');
  const matrix = defaultMatrix(hoursPerDay).filter(
    (cell) => onlyPlaystyle === '' || cell.playstyle === onlyPlaystyle,
  );
  process.stdout.write(
    `matrix: ${matrix.length} cells x ${runs} runs x ${missions} missions ` +
      `(seeds ${baseSeed}..${baseSeed + runs - 1})\n`,
  );

  const edit = editPath === '' ? null : parseEditFile(editPath);
  const scaling = edit === null ? NO_SCALING : parseScaling(edit.bridgeScaling);

  const baseRun = playMatrix(baseSnapshot, matrix, runs, baseSeed, missions, NO_SCALING);
  printReport(baseRun.reports, SIM_ASSUMPTIONS);

  let editedRun: MatrixRun | null = null;
  if (edit !== null) {
    const rules = edit.rules ?? {};
    const editedSnapshot = withEdits(baseSnapshot, (draft) => {
      for (const [key, value] of Object.entries(rules)) {
        setRule(draft, key, value);
      }
    });
    process.stdout.write(
      `\n=== edited matrix (rules ${JSON.stringify(rules)}, ` +
        `bridgeScaling ${JSON.stringify(scaling)}) ===\n`,
    );
    editedRun = playMatrix(editedSnapshot, matrix, runs, baseSeed, missions, scaling);
    printReport(
      editedRun.reports,
      `${SIM_ASSUMPTIONS}; what-if: ${JSON.stringify({ rules, bridgeScaling: scaling })}`,
    );
    printAb(baseRun.reports, editedRun.reports);
  }

  if (!noStore) {
    const argsJson = JSON.stringify({
      runs,
      missions,
      seed: baseSeed,
      hoursPerDay,
      cells: matrix.length,
      ...(edit === null ? {} : { edit: editPath }),
    });
    const written = writeExperimentRuns(baseSnapshot, baseRun.results, {
      experimentName: name,
      argsJson,
    });
    process.stdout.write(
      `stored: sim-data/sim.db experiment ${written.experimentId} ` +
        `(${written.runIds.length} runs)\n`,
    );
    if (editedRun !== null) {
      const editedWritten = writeExperimentRuns(baseSnapshot, editedRun.results, {
        experimentName: `${name}-edit`,
        argsJson,
      });
      process.stdout.write(
        `stored: sim-data/sim.db experiment ${editedWritten.experimentId} ` +
          `(${editedWritten.runIds.length} runs, edited)\n`,
      );
    }
  }
  return Promise.resolve();
}
