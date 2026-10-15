/**
 * Turns one finished run into store rows: an experiment (one per CLI invocation, unless a name is
 * given), one `runs` row, its `levels` and its `missions`. The heavier event tables
 * (`actions`, `offers_seen`, `part_wear`, `trades`, `service`) land with the later phases.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Snapshot } from '../snapshot/types.js';
import type { RunResult } from '../bots/bot.js';
import { openStore, type Store } from './store.js';
import { SIM_DB_PATH } from '../paths.js';

/** What this build simplifies, stored with the experiment so a report can print it. */
export const SIM_ASSUMPTIONS = [
  'phase 2: fuel and repair are bought at real prices between missions (no free restore)',
  'phase 2: adrift ships pay the real rescue tow (flat rescue price + emergency ration)',
  'phase 2: rescue sells nothing — the ship keeps every installed part',
  'phase 2: unarmed ships (no esc>0 defense) only accept danger <= 5 offers',
  'phase 2: layout grid abstracted (connectivity assumed)',
  'phase 3: empty-board viability repair targets only dead fuel-holders (tank first)',
  'phase 4: runs are in-process and sequential (worker pool is a future option)',
].join('; ');

const SIM_VERSION = 'phase-4';

export function snapshotHashOf(snapshot: Snapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function gitShaOf(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export interface WriteRunOptions {
  readonly dbPath?: string;
  readonly experimentName?: string;
  readonly gitSha?: string;
  readonly argsJson?: string;
  readonly assumptions?: string;
}

export interface WrittenRun {
  readonly experimentId: number;
  readonly runId: number;
}

/** Appends one run (and its experiment header) to the SQLite store. */
export function writeRunResult(
  snapshot: Snapshot,
  result: RunResult,
  options: WriteRunOptions = {},
): WrittenRun {
  const store: Store = openStore(options.dbPath ?? SIM_DB_PATH);
  try {
    const experimentId = store.insertExperiment({
      name: options.experimentName ?? `run-seed-${result.seed}`,
      createdAt: new Date().toISOString(),
      gitSha: options.gitSha ?? gitShaOf(),
      argsJson: options.argsJson ?? JSON.stringify({ seed: result.seed, missions: result.totalMissions }),
      snapshotTakenAt: snapshot.takenAt,
      snapshotHash: snapshotHashOf(snapshot),
      editHash: '',
      editJson: '[]',
      simVersion: SIM_VERSION,
      assumptions: options.assumptions ?? SIM_ASSUMPTIONS,
    });
    const runId = insertRunInto(store, experimentId, result);
    return { experimentId, runId };
  } finally {
    store.close();
  }
}

/** Appends N runs under one experiment header — the matrix shares a header, not one per game. */
export function writeExperimentRuns(
  snapshot: Snapshot,
  results: readonly RunResult[],
  options: WriteRunOptions = {},
): { experimentId: number; runIds: number[] } {
  const first = results[0];
  if (first === undefined) throw new Error('writeExperimentRuns needs at least one run');
  const store: Store = openStore(options.dbPath ?? SIM_DB_PATH);
  try {
    const experimentId = store.insertExperiment({
      name: options.experimentName ?? 'experiment',
      createdAt: new Date().toISOString(),
      gitSha: options.gitSha ?? gitShaOf(),
      argsJson: options.argsJson ?? JSON.stringify({ runs: results.length }),
      snapshotTakenAt: snapshot.takenAt,
      snapshotHash: snapshotHashOf(snapshot),
      editHash: '',
      editJson: '[]',
      simVersion: SIM_VERSION,
      assumptions: options.assumptions ?? SIM_ASSUMPTIONS,
    });
    const runIds = results.map((result) => insertRunInto(store, experimentId, result));
    return { experimentId, runIds };
  } finally {
    store.close();
  }
}

function insertRunInto(store: Store, experimentId: number, result: RunResult): number {
  const totals = result.ledgerTotals;
  const runId = store.insertRun({
    experimentId,
    cell:
      `${result.temperament}|${result.playstyle}|${result.hoursPerDay}h` +
      (result.archetype === 'chem' ? '' : `|${result.archetype}`),
    temperament: result.temperament,
    playstyle: result.playstyle,
    hoursPerDay: result.hoursPerDay,
    seed: result.seed,
    finalLevel: result.finalLevel,
    stalled: result.stalled,
    stallReason: result.stallReason,
    totalSeconds: Math.round(result.totalSeconds),
    totalMissions: result.totalMissions,
    successRate: result.successRate,
    reward: Math.round(totals.reward),
    combat: Math.round(totals.combat),
    scavengeSale: Math.round(totals.scavengeSale),
    oreSale: Math.round(totals.oreSale),
    fuel: Math.round(totals.fuel),
    repair: Math.round(totals.repair),
    upgrade: Math.round(totals.upgrade),
    purchase: Math.round(totals.purchase),
    sale: Math.round(totals.sale),
  });
  store.insertLevels(
    runId,
    result.levels.map((level) => ({
      level: level.level,
      t: Math.round(level.t),
      day: level.day,
      missions: level.missions,
      wallet: level.wallet,
      shipValue: level.shipValue,
    })),
  );
  store.insertMissions(
    runId,
    result.missions.map((mission) => ({
      seq: mission.seq,
      offerId: mission.offerId,
      type: mission.type,
      templateId: mission.templateId,
      origin: mission.originId,
      destination: mission.destinationId,
      distance: mission.distance,
      maxDanger: mission.maxDanger,
      zone: mission.zone,
      rewardOffered: mission.rewardOffered,
      rewardPaid: mission.rewardPaid,
      status: mission.status,
      integrity: mission.integrity,
      fuelBurned: Math.round(mission.fuelBurned),
      wearPoints: mission.wearPoints,
      fights: mission.fights,
      wins: mission.wins,
      losses: mission.losses,
      durationSeconds: mission.durationSeconds,
      bridgeLevel: mission.bridgeLevel,
      shipTier: mission.shipTier,
      scrapFound: mission.scrapFound,
      partsFound: mission.partsFound,
    })),
  );
  return runId;
}
