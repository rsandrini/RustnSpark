/**
 * `pnpm sim run --seed N --missions M`: play one game with the Phase 1 bot and print the log, the
 * totals and where the run was stored (unless `--no-store`).
 */
import { playRun, type RunResult } from './bots/bot.js';
import { calendarDays, DEFAULT_BUDGET } from './core/clock.js';
import { boolFlag, intFlag, parseFlags, stringFlag } from './flags.js';
import { SNAPSHOT_PATH } from './paths.js';
import { loadSnapshot } from './snapshot/load-snapshot.js';
import { writeRunResult } from './store/writer.js';

const LEDGER_COLUMNS = [
  'reward',
  'combat',
  'scavengeSale',
  'oreSale',
  'fuel',
  'repair',
  'upgrade',
  'purchase',
  'sale',
] as const;

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function padRight(value: string, width: number): string {
  return value.padEnd(width);
}

function printMission(result: RunResult, index: number): void {
  const mission = result.missions[index];
  if (mission === undefined) return;
  const wallet = mission.wallet;
  process.stdout.write(
    `#${pad(mission.seq, 3)} ${padRight(mission.type, 10)} ${padRight(mission.originId, 8)} -> ` +
      `${padRight(mission.destinationId, 8)} dist ${pad(mission.distance, 5)} ` +
      `offered ${pad(mission.rewardOffered, 5)} paid ${pad(mission.rewardPaid, 5)} ` +
      `${padRight(mission.status, 15)} ${pad(mission.durationSeconds, 6)}s ` +
      `fuel ${pad(mission.fuelBurned, 4)} wear ${pad(mission.wearPoints, 3)} ` +
      `wallet ${pad(wallet, 6)}\n`,
  );
}

function printTotals(result: RunResult): void {
  const days = calendarDays(result.totalSeconds, {
    hoursPerDay: result.hoursPerDay,
    humanPauseSeconds: DEFAULT_BUDGET.humanPauseSeconds,
  });
  const pct = Math.round(result.successRate * 100);
  process.stdout.write('—\n');
  process.stdout.write(
    `missions ${result.totalMissions}  success ${pct}%  days ${days.toFixed(1)}  ` +
      `seconds ${Math.round(result.totalSeconds)}  final level ${result.finalLevel}  ` +
      `faction ${result.factionId}\n`,
  );
  const totals = result.ledgerTotals;
  const parts = LEDGER_COLUMNS.map(
    (category) => `${category} ${Math.round(totals[category])}`,
  ).join('  ');
  process.stdout.write(`ledger: ${parts}\n`);
  if (result.stalled) {
    process.stdout.write(`STALLED: ${result.stallReason ?? 'unknown'}\n`);
  }
  const events = result.log.filter(
    (line) =>
      line.includes('rescued') ||
      line.includes('stranded') ||
      line.includes('hopped') ||
      line.includes('refuelled') ||
      line.includes('towed'),
  );
  for (const event of events) {
    process.stdout.write(`  ${event}\n`);
  }
}

export function runCommand(args: readonly string[]): Promise<void> {
  const flags = parseFlags(args);
  const seed = intFlag(flags, 'seed', 1);
  const missions = intFlag(flags, 'missions', 50);
  const faction = stringFlag(flags, 'faction', '');
  const noStore = boolFlag(flags, 'no-store');

  const snapshot = loadSnapshot(SNAPSHOT_PATH);
  const result = playRun({
    snapshot,
    seed,
    missions,
    ...(faction === '' ? {} : { factionId: faction }),
  });

  for (let index = 0; index < result.missions.length; index += 1) {
    printMission(result, index);
  }
  printTotals(result);

  if (!noStore) {
    const written = writeRunResult(snapshot, result, {
      argsJson: JSON.stringify({ seed, missions, faction: faction === '' ? null : faction }),
    });
    process.stdout.write(
      `stored: sim-data/sim.db experiment ${written.experimentId} run ${written.runId}\n`,
    );
  }
  return Promise.resolve();
}
