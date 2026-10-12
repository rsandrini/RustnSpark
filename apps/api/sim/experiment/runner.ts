/**
 * Plays one cell: N games on the same snapshot, seeds `baseSeed + i` (plan Phase 4.4). Every
 * run records when it reached each level (simulated seconds and missions), its ledger and its
 * end state; the cell summary turns those into the median / p10 / p90 the report prints.
 * Correctness first: runs are in-process and sequential.
 */
import { playRun, type RunResult } from '../bots/bot.js';
import type { Snapshot } from '../snapshot/types.js';
import {
  calendarDays,
  DEFAULT_HUMAN_PAUSE_SECONDS,
  type PlayTimeBudget,
} from '../core/clock.js';
import type { ExperimentCell } from './cells.js';
import type { BridgeScaling } from './scaling.js';

/** One game's worth of what the matrix compares. */
export interface RunSummary {
  readonly seed: number;
  readonly finalLevel: number;
  readonly stalled: boolean;
  readonly stallReason: string | null;
  readonly totalSeconds: number;
  readonly totalMissions: number;
  readonly successRate: number;
  readonly days: number;
  readonly ledgerTotals: RunResult['ledgerTotals'];
  /** Simulated seconds at which level L was first held (index 0 = level 1); null = never. */
  readonly levelReachedAt: readonly (number | null)[];
  /** Missions flown when level L was first held; null = never. */
  readonly missionsToLevel: readonly (number | null)[];
  /** Calendar days of play (at the cell's hours-per-day) when level L was first held. */
  readonly daysToLevel: readonly (number | null)[];
  readonly actionSeconds: Readonly<Record<string, number>>;
}

export interface CellResult {
  readonly cell: ExperimentCell;
  readonly results: readonly RunResult[];
}

const MAX_SHIP_LEVEL = 5;

/** The first time each level appears in the run's level trail. */
function levelTrail(result: RunResult): {
  reachedAt: (number | null)[];
  missions: (number | null)[];
  days: (number | null)[];
} {
  const reachedAt: (number | null)[] = Array.from({ length: MAX_SHIP_LEVEL }, () => null);
  const missions: (number | null)[] = Array.from({ length: MAX_SHIP_LEVEL }, () => null);
  const days: (number | null)[] = Array.from({ length: MAX_SHIP_LEVEL }, () => null);
  for (const record of result.levels) {
    const index = record.level - 1;
    if (index < 0 || index >= MAX_SHIP_LEVEL) continue;
    if (reachedAt[index] === null) {
      reachedAt[index] = record.t;
      missions[index] = record.missions;
      days[index] = record.day;
    }
  }
  return { reachedAt, missions, days };
}

export function summarizeRun(result: RunResult, budget: PlayTimeBudget): RunSummary {
  const { reachedAt, missions, days } = levelTrail(result);
  return {
    seed: result.seed,
    finalLevel: result.finalLevel,
    stalled: result.stalled,
    stallReason: result.stallReason,
    totalSeconds: result.totalSeconds,
    totalMissions: result.totalMissions,
    successRate: result.successRate,
    days: calendarDays(result.totalSeconds, budget),
    ledgerTotals: result.ledgerTotals,
    levelReachedAt: reachedAt,
    missionsToLevel: missions,
    daysToLevel: days,
    actionSeconds: result.actionSeconds,
  };
}

/** Plays `runs` games for one cell: seed `baseSeed + i` for game i. */
export function runCell(
  snapshot: Snapshot,
  cell: ExperimentCell,
  runs: number,
  baseSeed: number,
  missions: number,
  bridgeScaling?: BridgeScaling,
): CellResult {
  const budget: PlayTimeBudget = {
    hoursPerDay: cell.hoursPerDay,
    humanPauseSeconds: DEFAULT_HUMAN_PAUSE_SECONDS,
  };
  const results: RunResult[] = [];
  for (let index = 0; index < runs; index += 1) {
    results.push(
      playRun({
        snapshot,
        seed: baseSeed + index,
        missions,
        budget,
        temperament: cell.temperament,
        playstyle: cell.playstyle,
        ...(bridgeScaling === undefined ? {} : { bridgeScaling }),
      }),
    );
  }
  return { cell, results };
}

/** Nearest-rank percentile on an unsorted sample (p in [0, 1]); empty → NaN by design. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? Number.NaN;
}

export interface LevelSpread {
  readonly level: number;
  readonly reached: number;
  readonly daysMedian: number;
  readonly daysP10: number;
  readonly daysP90: number;
}

/** Days-to-level per cell: how long the cell's pilots took to first hold level 2..5. */
export function daysToLevelSpread(
  summaries: readonly RunSummary[],
  levels: readonly number[] = [2, 3, 4, 5],
): readonly LevelSpread[] {
  return levels.map((level) => {
    const days = summaries
      .map((summary) => summary.daysToLevel[level - 1])
      .filter((value): value is number => value !== null && value !== undefined);
    return {
      level,
      reached: days.length,
      daysMedian: percentile(days, 0.5),
      daysP10: percentile(days, 0.1),
      daysP90: percentile(days, 0.9),
    };
  });
}
