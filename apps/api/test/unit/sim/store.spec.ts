import { describe, expect, it, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openStore, SCHEMA_VERSION } from '../../../sim/store/store.js';
import { writeRunResult, snapshotHashOf } from '../../../sim/store/writer.js';
import { playRun } from '../../../sim/bots/bot.js';
import { fixtureSnapshot } from './fixture.js';

const snapshot = fixtureSnapshot();
const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sim-store-'));
  tempDirs.push(dir);
  return join(dir, 'sim.db');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('sim store', () => {
  it('round-trips a run: experiment, run, levels and missions', () => {
    const dbPath = tempDbPath();
    const result = playRun({ snapshot, seed: 2, missions: 4 });
    const written = writeRunResult(snapshot, result, {
      dbPath,
      experimentName: 'unit-test',
      gitSha: 'test-sha',
    });
    expect(written.experimentId).toBe(1);
    expect(written.runId).toBe(1);

    const db = new Database(dbPath, { readonly: true });
    const run = db
      .prepare('SELECT seed, total_missions, reward, final_level FROM runs WHERE id = 1')
      .get() as {
      seed: number;
      total_missions: number;
      reward: number;
      final_level: number;
    };
    db.close();
    expect(run.seed).toBe(2);
    expect(run.total_missions).toBe(4);
    expect(run.reward).toBe(result.ledgerTotals.reward);
    expect(run.final_level).toBe(result.finalLevel);

    const check = openStore(dbPath);
    const levelCount = (
      check.db.prepare('SELECT COUNT(*) AS n FROM levels').get() as { n: number }
    ).n;
    const missionCount = (
      check.db.prepare('SELECT COUNT(*) AS n FROM missions').get() as { n: number }
    ).n;
    const version = (check.db.prepare('SELECT version FROM schema_version').get() as {
      version: number;
    }).version;
    check.close();
    expect(version).toBe(SCHEMA_VERSION);
    expect(levelCount).toBe(result.levels.length);
    expect(missionCount).toBe(4);
  });

  it('hashes the snapshot stably', () => {
    expect(snapshotHashOf(snapshot)).toBe(snapshotHashOf(fixtureSnapshot()));
    expect(snapshotHashOf(snapshot)).toHaveLength(64);
  });
});
