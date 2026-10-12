/**
 * The owner-facing numbers (plan Phase 5.1): per cell, how fast each level came and where the
 * money went; between cells, the spread from fastest to slowest and the Random-control ratio.
 * Everything is a median or a nearest-rank percentile over the cell's runs.
 */
import type { RunSummary } from './runner.js';
import { daysToLevelSpread, percentile, type LevelSpread } from './runner.js';

const LEVELS = [2, 3, 4, 5] as const;

const INCOME_KEYS = ['reward', 'combat', 'scavengeSale', 'oreSale', 'sale'] as const;
const SPEND_KEYS = ['fuel', 'repair', 'rescue', 'upgrade', 'purchase'] as const;

export interface CellReport {
  readonly name: string;
  readonly summaries: readonly RunSummary[];
  /** False for the Random control — the spread compares the deliberate pilots only. */
  readonly deliberate: boolean;
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function padRight(value: string, width: number): string {
  return value.padEnd(width);
}

function daysCell(spread: LevelSpread | undefined): string {
  if (spread === undefined || spread.reached === 0) return padRight('-', 18);
  return padRight(
    `${spread.reached}x p10 ${spread.daysP10.toFixed(1)} med ${spread.daysMedian.toFixed(1)} ` +
      `p90 ${spread.daysP90.toFixed(1)}`,
    18,
  );
}

function missionsCell(summaries: readonly RunSummary[], level: number): string {
  const values = summaries
    .map((summary) => summary.missionsToLevel[level - 1])
    .filter((value): value is number => value !== null && value !== undefined);
  if (values.length === 0) return '-';
  return `${percentile(values, 0.5)}`;
}

/** Per-cell line: level 2..5 (days spread and median missions), success and stall counts. */
function printCellDetail(cell: CellReport): void {
  const spreads = daysToLevelSpread(cell.summaries, LEVELS);
  const stalled = cell.summaries.filter((summary) => summary.stalled).length;
  const success =
    cell.summaries.reduce((sum, summary) => sum + summary.successRate, 0) /
    cell.summaries.length;
  process.stdout.write(
    `${cell.name}  runs ${cell.summaries.length}  success ${Math.round(success * 100)}%  ` +
      `stalled ${stalled}\n`,
  );
  for (const level of LEVELS) {
    const spread = spreads.find((entry) => entry.level === level);
    process.stdout.write(
      `  L${level}  days ${daysCell(spread)}  missions-med ${pad(missionsCell(cell.summaries, level), 6)}\n`,
    );
  }
}

/** Income and spending totals across the cell's runs, with each category's share. */
function printLedgerShares(cell: CellReport): void {
  const totals: Record<string, number> = {};
  for (const summary of cell.summaries) {
    for (const key of [...INCOME_KEYS, ...SPEND_KEYS]) {
      totals[key] = (totals[key] ?? 0) + (summary.ledgerTotals[key] ?? 0);
    }
  }
  // Categories carry their sign in the value (spending is negative); shares divide by the
  // absolute mass so a negative combat line reads as a share, not as n/a.
  const share = (value: number, base: number): string =>
    base <= 0 ? 'n/a' : `${Math.round((Math.abs(value) / base) * 100)}%`;
  const incomeBase = INCOME_KEYS.reduce((sum, key) => sum + Math.abs(totals[key] ?? 0), 0);
  const spendBase = SPEND_KEYS.reduce((sum, key) => sum + Math.abs(totals[key] ?? 0), 0);
  const income = INCOME_KEYS.reduce((sum, key) => sum + (totals[key] ?? 0), 0);
  const spend = SPEND_KEYS.reduce((sum, key) => sum + (totals[key] ?? 0), 0);
  const incomeLine = INCOME_KEYS.map(
    (key) => `${key} ${share(totals[key] ?? 0, incomeBase)}`,
  ).join('  ');
  const spendLine = SPEND_KEYS.map(
    (key) => `${key} ${share(totals[key] ?? 0, spendBase)}`,
  ).join('  ');
  process.stdout.write(`  income ${Math.round(income)}: ${incomeLine}\n`);
  process.stdout.write(`  spend  ${Math.round(spend)}: ${spendLine}\n`);
}

/** Median days to `level`, or null when the cell never got there. */
function medianDaysTo(cell: CellReport, level: number): number | null {
  const values = cell.summaries
    .map((summary) => summary.daysToLevel[level - 1])
    .filter((value): value is number => value !== null && value !== undefined);
  if (values.length === 0) return null;
  return percentile(values, 0.5);
}

/** Fastest vs slowest deliberate cell per level, plus how far the Random control lags. */
function printSpread(cells: readonly CellReport[]): void {
  const deliberate = cells.filter((cell) => cell.deliberate);
  const control = cells.find((cell) => !cell.deliberate);
  for (const level of LEVELS) {
    let fastest: { cell: CellReport; days: number } | null = null;
    let slowest: { cell: CellReport; days: number } | null = null;
    for (const cell of deliberate) {
      const days = medianDaysTo(cell, level);
      if (days === null) continue;
      if (fastest === null || days < fastest.days) fastest = { cell, days };
      if (slowest === null || days > slowest.days) slowest = { cell, days };
    }
    if (fastest === null || slowest === null) {
      process.stdout.write(`  L${level}: no deliberate cell reached it\n`);
      continue;
    }
    const ratio = fastest.days <= 0 ? 0 : slowest.days / fastest.days;
    const controlDays = control === undefined ? null : medianDaysTo(control, level);
    const controlLine =
      controlDays === null
        ? '  random control: never'
        : `  random/control ${controlDays <= fastest.days ? '=' : (controlDays / fastest.days).toFixed(2) + 'x'}`;
    process.stdout.write(
      `  L${level}: fastest ${fastest.cell.name} ${fastest.days.toFixed(1)}d  ` +
        `slowest ${slowest.cell.name} ${slowest.days.toFixed(1)}d  ` +
        `spread ${ratio.toFixed(2)}x${controlLine}\n`,
    );
  }
}

/** The full report: assumptions, per-cell detail, per-cell ledger shares, cell spread. */
export function printReport(
  cells: readonly CellReport[],
  assumptions: string,
): void {
  process.stdout.write('\n=== report ===\n');
  process.stdout.write(`assumptions: ${assumptions}\n\n`);
  for (const cell of cells) {
    printCellDetail(cell);
    printLedgerShares(cell);
    process.stdout.write('\n');
  }
  process.stdout.write('--- spread (deliberate cells) ---\n');
  printSpread(cells);
}
