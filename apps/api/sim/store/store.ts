/**
 * The SQLite store: one file (`sim-data/sim.db`) shared by every experiment, opened in WAL mode,
 * schema applied from the versioned SQL files. `better-sqlite3` is synchronous and single-writer,
 * which is exactly the sim's model — one main thread, batches of rows, transactions.
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Version of `schema.sql` this build writes; `ensureSchema` applies any older file's upgrades. */
export const SCHEMA_VERSION = 1;

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));

export interface ExperimentRow {
  readonly name: string;
  readonly createdAt: string;
  readonly gitSha: string;
  readonly argsJson: string;
  readonly snapshotTakenAt: string;
  readonly snapshotHash: string;
  readonly editHash: string;
  readonly editJson: string;
  readonly simVersion: string;
  readonly assumptions: string;
}

export interface RunRow {
  readonly experimentId: number;
  readonly cell: string;
  readonly temperament: string;
  readonly playstyle: string;
  readonly hoursPerDay: number;
  readonly seed: number;
  readonly finalLevel: number;
  readonly stalled: boolean;
  readonly stallReason: string | null;
  readonly totalSeconds: number;
  readonly totalMissions: number;
  readonly successRate: number;
  readonly reward: number;
  readonly combat: number;
  readonly scavengeSale: number;
  readonly oreSale: number;
  readonly fuel: number;
  readonly repair: number;
  readonly upgrade: number;
  readonly purchase: number;
  readonly sale: number;
}

export interface LevelRow {
  readonly level: number;
  readonly t: number;
  readonly day: number;
  readonly missions: number;
  readonly wallet: number;
  readonly shipValue: number;
}

export interface MissionRow {
  readonly seq: number;
  readonly offerId: string;
  readonly type: string;
  readonly templateId: string;
  readonly origin: string;
  readonly destination: string;
  readonly distance: number;
  readonly maxDanger: number;
  readonly zone: number;
  readonly rewardOffered: number;
  readonly rewardPaid: number;
  readonly status: string;
  readonly integrity: number;
  readonly fuelBurned: number;
  readonly wearPoints: number;
  readonly fights: number;
  readonly wins: number;
  readonly losses: number;
  readonly durationSeconds: number;
  readonly bridgeLevel: number;
  readonly shipTier: number;
  readonly scrapFound: number;
  readonly partsFound: number;
}

export interface Store {
  readonly db: Database.Database;
  insertExperiment(row: ExperimentRow): number;
  insertRun(row: RunRow): number;
  insertLevels(runId: number, rows: readonly LevelRow[]): void;
  insertMissions(runId: number, rows: readonly MissionRow[]): void;
  close(): void;
}

function currentVersion(db: Database.Database): number {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
    .get() as { name: string } | undefined;
  if (table === undefined) return 0;
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}

/** Creates the schema when the file is new; refuses a database newer than this build. */
export function ensureSchema(db: Database.Database): void {
  const version = currentVersion(db);
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `sim.db schema is v${version}, this build only knows v${SCHEMA_VERSION} — update the sim`,
    );
  }
  if (version === SCHEMA_VERSION) return;
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  db.prepare('DELETE FROM schema_version').run();
  db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
}

export function openStore(path: string): Store {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);

  const insertExperimentStmt = db.prepare(`
    INSERT INTO experiments (
      name, created_at, git_sha, args_json, snapshot_taken_at, snapshot_hash,
      edit_hash, edit_json, sim_version, assumptions
    ) VALUES (
      @name, @created_at, @git_sha, @args_json, @snapshot_taken_at, @snapshot_hash,
      @edit_hash, @edit_json, @sim_version, @assumptions
    )
  `);
  const insertRunStmt = db.prepare(`
    INSERT INTO runs (
      experiment_id, cell, temperament, playstyle, hours_per_day, seed, final_level,
      stalled, stall_reason, total_seconds, total_missions, success_rate,
      reward, combat, scavenge_sale, ore_sale, fuel, repair, upgrade, purchase, sale
    ) VALUES (
      @experiment_id, @cell, @temperament, @playstyle, @hours_per_day, @seed, @final_level,
      @stalled, @stall_reason, @total_seconds, @total_missions, @success_rate,
      @reward, @combat, @scavenge_sale, @ore_sale, @fuel, @repair, @upgrade, @purchase, @sale
    )
  `);
  const insertLevelStmt = db.prepare(`
    INSERT INTO levels (run_id, level, t, day, missions, wallet, ship_value)
    VALUES (@run_id, @level, @t, @day, @missions, @wallet, @ship_value)
  `);
  const insertMissionStmt = db.prepare(`
    INSERT INTO missions (
      run_id, seq, offer_id, type, template_id, origin, destination, distance,
      max_danger, zone, reward_offered, reward_paid, status, integrity, fuel_burned,
      wear_points, fights, wins, losses, duration_s, bridge_level, ship_tier,
      scrap_found, parts_found
    ) VALUES (
      @run_id, @seq, @offer_id, @type, @template_id, @origin, @destination, @distance,
      @max_danger, @zone, @reward_offered, @reward_paid, @status, @integrity, @fuel_burned,
      @wear_points, @fights, @wins, @losses, @duration_s, @bridge_level, @ship_tier,
      @scrap_found, @parts_found
    )
  `);

  return {
    db,
    insertExperiment(row: ExperimentRow): number {
      const info = insertExperimentStmt.run({
        name: row.name,
        created_at: row.createdAt,
        git_sha: row.gitSha,
        args_json: row.argsJson,
        snapshot_taken_at: row.snapshotTakenAt,
        snapshot_hash: row.snapshotHash,
        edit_hash: row.editHash,
        edit_json: row.editJson,
        sim_version: row.simVersion,
        assumptions: row.assumptions,
      });
      return Number(info.lastInsertRowid);
    },
    insertRun(row: RunRow): number {
      const info = insertRunStmt.run({
        experiment_id: row.experimentId,
        cell: row.cell,
        temperament: row.temperament,
        playstyle: row.playstyle,
        hours_per_day: row.hoursPerDay,
        seed: row.seed,
        final_level: row.finalLevel,
        stalled: row.stalled ? 1 : 0,
        stall_reason: row.stallReason,
        total_seconds: row.totalSeconds,
        total_missions: row.totalMissions,
        success_rate: row.successRate,
        reward: row.reward,
        combat: row.combat,
        scavenge_sale: row.scavengeSale,
        ore_sale: row.oreSale,
        fuel: row.fuel,
        repair: row.repair,
        upgrade: row.upgrade,
        purchase: row.purchase,
        sale: row.sale,
      });
      return Number(info.lastInsertRowid);
    },
    insertLevels(runId: number, rows: readonly LevelRow[]): void {
      const insertAll = db.transaction((entries: readonly LevelRow[]) => {
        for (const entry of entries) {
          insertLevelStmt.run({
            run_id: runId,
            level: entry.level,
            t: entry.t,
            day: entry.day,
            missions: entry.missions,
            wallet: entry.wallet,
            ship_value: entry.shipValue,
          });
        }
      });
      insertAll(rows);
    },
    insertMissions(runId: number, rows: readonly MissionRow[]): void {
      const insertAll = db.transaction((entries: readonly MissionRow[]) => {
        for (const entry of entries) {
          insertMissionStmt.run({
            run_id: runId,
            seq: entry.seq,
            offer_id: entry.offerId,
            type: entry.type,
            template_id: entry.templateId,
            origin: entry.origin,
            destination: entry.destination,
            distance: entry.distance,
            max_danger: entry.maxDanger,
            zone: entry.zone,
            reward_offered: entry.rewardOffered,
            reward_paid: entry.rewardPaid,
            status: entry.status,
            integrity: entry.integrity,
            fuel_burned: entry.fuelBurned,
            wear_points: entry.wearPoints,
            fights: entry.fights,
            wins: entry.wins,
            losses: entry.losses,
            duration_s: entry.durationSeconds,
            bridge_level: entry.bridgeLevel,
            ship_tier: entry.shipTier,
            scrap_found: entry.scrapFound,
            parts_found: entry.partsFound,
          });
        }
      });
      insertAll(rows);
    },
    close(): void {
      db.close();
    },
  };
}
