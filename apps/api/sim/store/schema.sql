-- Simulation store schema, version 1.
-- One file per version, never an edit of an old one: a change ships as schema-2.sql, and
-- `ensureSchema` applies the missing versions in order. Tables are typed columns on purpose —
-- the analyses in the plan are plain SQL joins, not JSON spelunking.

CREATE TABLE schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE experiments (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  git_sha       TEXT NOT NULL,
  args_json     TEXT NOT NULL,
  snapshot_taken_at TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  edit_hash     TEXT NOT NULL,
  edit_json     TEXT NOT NULL,
  sim_version   TEXT NOT NULL,
  assumptions   TEXT NOT NULL
);

CREATE TABLE runs (
  id             INTEGER PRIMARY KEY,
  experiment_id  INTEGER NOT NULL REFERENCES experiments(id),
  cell           TEXT NOT NULL,
  temperament    TEXT NOT NULL,
  playstyle      TEXT NOT NULL,
  hours_per_day  REAL NOT NULL,
  seed           INTEGER NOT NULL,
  final_level    INTEGER NOT NULL,
  stalled        INTEGER NOT NULL,
  stall_reason   TEXT,
  total_seconds  INTEGER NOT NULL,
  total_missions INTEGER NOT NULL,
  success_rate   REAL NOT NULL,
  reward         INTEGER NOT NULL,
  combat         INTEGER NOT NULL,
  scavenge_sale  INTEGER NOT NULL,
  ore_sale       INTEGER NOT NULL,
  fuel           INTEGER NOT NULL,
  repair         INTEGER NOT NULL,
  upgrade        INTEGER NOT NULL,
  purchase       INTEGER NOT NULL,
  sale           INTEGER NOT NULL
);

CREATE TABLE levels (
  id         INTEGER PRIMARY KEY,
  run_id     INTEGER NOT NULL REFERENCES runs(id),
  level      INTEGER NOT NULL,
  t          INTEGER NOT NULL,
  day        REAL NOT NULL,
  missions   INTEGER NOT NULL,
  wallet     INTEGER NOT NULL,
  ship_value INTEGER NOT NULL
);

CREATE TABLE missions (
  id             INTEGER PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES runs(id),
  seq            INTEGER NOT NULL,
  offer_id       TEXT NOT NULL,
  type           TEXT NOT NULL,
  template_id    TEXT NOT NULL,
  origin         TEXT NOT NULL,
  destination    TEXT NOT NULL,
  distance       INTEGER NOT NULL,
  max_danger     INTEGER NOT NULL,
  zone           INTEGER NOT NULL,
  reward_offered INTEGER NOT NULL,
  reward_paid    INTEGER NOT NULL,
  status         TEXT NOT NULL,
  integrity      INTEGER NOT NULL,
  fuel_burned    INTEGER NOT NULL,
  wear_points    INTEGER NOT NULL,
  fights         INTEGER NOT NULL,
  wins           INTEGER NOT NULL,
  losses         INTEGER NOT NULL,
  duration_s     INTEGER NOT NULL,
  bridge_level   INTEGER NOT NULL,
  ship_tier      INTEGER NOT NULL,
  scrap_found    INTEGER NOT NULL,
  parts_found    INTEGER NOT NULL
);

CREATE TABLE actions (
  id             INTEGER PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES runs(id),
  seq            INTEGER NOT NULL,
  t              INTEGER NOT NULL,
  day            REAL NOT NULL,
  kind           TEXT NOT NULL,
  location_id    TEXT NOT NULL,
  seconds        INTEGER NOT NULL,
  wallet_before  INTEGER NOT NULL,
  wallet_after   INTEGER NOT NULL,
  fuel_before    REAL NOT NULL,
  fuel_after     REAL NOT NULL,
  avg_condition  REAL NOT NULL,
  min_condition  REAL NOT NULL,
  ship_level     INTEGER NOT NULL,
  ship_value     INTEGER NOT NULL,
  reason         TEXT
);

CREATE TABLE offers_seen (
  id          INTEGER PRIMARY KEY,
  run_id      INTEGER NOT NULL REFERENCES runs(id),
  seq         INTEGER NOT NULL,
  offer_id    TEXT NOT NULL,
  type        TEXT NOT NULL,
  template_id TEXT NOT NULL,
  reward      INTEGER NOT NULL,
  distance    INTEGER NOT NULL,
  max_danger  INTEGER NOT NULL,
  qualified   INTEGER NOT NULL,
  blocked_by  TEXT,
  chosen      INTEGER NOT NULL,
  rank        INTEGER NOT NULL
);

CREATE TABLE part_wear (
  id         INTEGER PRIMARY KEY,
  run_id     INTEGER NOT NULL REFERENCES runs(id),
  seq        INTEGER NOT NULL,
  part_type  TEXT NOT NULL,
  part_class TEXT NOT NULL,
  rarity     TEXT NOT NULL,
  loss       INTEGER NOT NULL
);

CREATE TABLE trades (
  id            INTEGER PRIMARY KEY,
  run_id        INTEGER NOT NULL REFERENCES runs(id),
  seq           INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  part_type     TEXT NOT NULL,
  rarity        TEXT NOT NULL,
  price         INTEGER NOT NULL,
  port_cheap    INTEGER NOT NULL,
  materials_json TEXT NOT NULL
);

CREATE TABLE service (
  id             INTEGER PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES runs(id),
  seq            INTEGER NOT NULL,
  kind           TEXT NOT NULL,
  location_id    TEXT NOT NULL,
  units_or_points REAL NOT NULL,
  price          INTEGER NOT NULL,
  port_cheap     INTEGER NOT NULL,
  forced         INTEGER NOT NULL
);

CREATE INDEX runs_experiment_cell ON runs(experiment_id, cell);
CREATE INDEX actions_run_seq ON actions(run_id, seq);
CREATE INDEX missions_run ON missions(run_id);
CREATE INDEX missions_template ON missions(template_id);
CREATE INDEX missions_type_bridge ON missions(type, bridge_level);
CREATE INDEX offers_seen_run_seq ON offers_seen(run_id, seq);
CREATE INDEX levels_run_level ON levels(run_id, level);
CREATE INDEX service_run_kind ON service(run_id, kind);

-- Money in/out per run, level and category (wallet deltas of every recorded action).
CREATE VIEW v_cashflow_by_level AS
  SELECT run_id, ship_level AS level, kind AS category,
         SUM(wallet_after - wallet_before) AS amount
  FROM actions
  GROUP BY run_id, ship_level, kind;

-- A mission's net: its payout minus the fuel and repair services stamped with its sequence.
CREATE VIEW v_mission_net AS
  SELECT m.run_id, m.seq, m.type, m.reward_paid AS reward,
         COALESCE(f.fuel, 0) AS fuel,
         COALESCE(r.repair, 0) AS repair,
         m.reward_paid - COALESCE(f.fuel, 0) - COALESCE(r.repair, 0) AS net
  FROM missions m
  LEFT JOIN (
    SELECT run_id, seq, SUM(price) AS fuel FROM service WHERE kind = 'fuel' GROUP BY run_id, seq
  ) f ON f.run_id = m.run_id AND f.seq = m.seq
  LEFT JOIN (
    SELECT run_id, seq, SUM(price) AS repair FROM service WHERE kind = 'repair' GROUP BY run_id, seq
  ) r ON r.run_id = m.run_id AND r.seq = m.seq;

-- Seconds spent per action kind per run.
CREATE VIEW v_time_by_kind AS
  SELECT run_id, kind, SUM(seconds) AS seconds
  FROM actions
  GROUP BY run_id, kind;
