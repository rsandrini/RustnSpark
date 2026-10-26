# The economy simulation

A seeded, deterministic pilot bot played against the real game: the same mission resolver, the
same prices, the same fuel and repair costs the live server runs. No HTTP, no shortcuts — the
only world it knows is the snapshot `pnpm sim export` writes.

```
set -a; . ../../.env; set +a   # DATABASE_URL for export and the replay check
pnpm sim export                # live database -> sim-data/snapshot.json
pnpm sim run --seed 1 --missions 50
pnpm sim experiment --runs 20  # the 10-cell matrix + report (the plan's done-when)
```

## One game

`pnpm sim run --seed N --missions M [--temperament T --playstyle P --faction F --no-store]`

Prints every mission, the ledger totals and the end reason. `SIM_DEBUG=1` adds the stderr probes
(`[plan]`, `[ground]`, `[fit]`, `[hop2buy]`, `[stall]`, `[final]`).

## The experiment

`pnpm sim experiment --runs N --missions M --seed S [--edit file.json --name TAG --no-store]`

Plays the default 10-cell matrix — greedy / balanced / safe × generalist / hauler / rescuer,
plus the random-generalist control — on the same seeds, in-process and sequential (a worker
pool is a future option; scale `--runs` for wall time). It prints three things:

1. **The table** — one row per cell: how many runs reached level 2..5 and the median days
   there, stall counts, success rate, total simulated days.
2. **The report** — per cell, the p10/median/p90 of days AND missions to each level, the
   income and spending shares by ledger category, and the spread section: for each level the
   fastest and slowest deliberate cell (ratio of medians) and how far the random control
   lags. The header lists the assumptions every number carries.
3. **The A/B** (only with `--edit`) — the same matrix on the edited snapshot, then
   base→edit median days per cell.

Everything is stored in `sim-data/sim.db` (one `experiments` row per invocation, one `runs`
row per game, plus `levels` and `missions`). Query it with any sqlite client; the schema
lives in `sim/store/schema.sql`.

## What-ifs (`--edit`)

An edit file is JSON with any of:

```json
{
  "rules": { "economy.start_credits": 500 },
  "bridgeScaling": {
    "reward":    [1, 1, 2, 2, 3],
    "cargo":     [1, 1, 1, 1, 1],
    "firepower": [1, 1, 1, 1, 1],
    "mobility":  [1, 1, 1, 1, 1]
  }
}
```

`rules` patches the live game's config by its dotted key (the same merge the Admin does).
`bridgeScaling` is a sim-only model of a feature the game does not have yet: five numbers per
axis, one per ship bridge rarity (common..legendary). The hook multiplies the accept-time
reward and the numeric requirements (cargo/firepower/mobility) by the entry for the ship's
bridge rarity. All ones is today's game — tune the table here before building it in the game.

## Adding a cell

A cell is one way of playing: `{ temperament, playstyle, hoursPerDay, settingsName }` in
`sim/experiment/cells.ts`. `defaultMatrix` is the 10-cell default; temperament behaviour lives
in `sim/bots/temperament.ts`, playstyle filters in `sim/bots/playstyle.ts`. Tests:
`test/unit/sim/{temperament,playstyle,experiment,scaling}.spec.ts`.

## Validation — against real play

Two scripts (not the unit suite — they need the live database):

```
set -a; . ../../.env; set +a
npx tsx test/validation/sim-replay.ts --limit 40   # replay the owner's real missions
npx tsx test/validation/sanity-bots.ts             # never-spends stagnates; rich pays real prices
```

Recorded 2026-10-12 (snapshot 2026-10-12T19:40Z, owner's last 40 MissionLog rows):

- **40/40 missions match**: the sim's `takeMission` and the game's frozen replay agree on the
  outcome status for every row; fuel burned is exact on every row; wear is within 10% (5-point
  absolute floor for near-zero pairs), worst observed 8.3%.
- The replay feeds the sim the log's own ship, hold (pirates raid it!), legs, cargo, template
  policy, faction and reward — anything less changes the resolver's path.
- Sanity bots: a bot that never spends stays at level 1, books no market money, and never goes
  below its start wallet; a run that levels up pays for it out of the real upgrade costs, and
  the wallet reconciles with the ledger exactly.

Re-recorded 2026-10-26 (snapshot 2026-10-26T18:54Z, last 40 MissionLog rows, rules hashes from
four tuning states): **40/40 match** (status exact, fuel and wear within 10%). Two things the
replay needed that the bot does not use: the sim plays each row under the rules *that row* was
played under (tuning drifts between a log row and today's snapshot), and `takeMission` takes an
`engine` option (the pilot's chem / ion levels; the bot always flies at 1). Sanity bots all pass.

Kept in line with the live game on 2026-10-26: a ship search burns `scavenging.ship_fuel` units
(was 0); the board is sized by the place (`board_min_by_detail`), caps one type at half the board,
asks for the types it lacks and is posted by the faction's quest givers (the snapshot now carries
`questGivers` and each place's `detail`; an older snapshot still loads and gets a board without
givers). Re-export the snapshot after any migration.

## Assumptions every number carries

Stored with each experiment in the store; the report prints them. Currently: fuel and repair
at real prices; rescue pays the real tow and sells nothing; unarmed ships only take danger ≤5;
layout grid abstracted (connectivity assumed); empty-board viability repair targets dead
fuel-holders first; experiment runs are in-process. The market keeps real shelf stock — the
board and the prices are the live ones, per listing id.

## Fast experiments

- `sim/run-parallel.sh <name> <edit.json> [flags]` plays the edited matrix with one process per build
  (chem, chem-shield, ion-shield, hybrid) at once; `--skip-base` is implied, the base is a stored
  experiment. A 4-build, 8-run, 50-mission test takes about 2.5 minutes (it used to take 25+).
- `sim/compare.py "label=<name LIKE pattern>" ...` prints level days, wallet at each level, repair and
  fuel share for stored experiments (e.g. `"base=chain-base-%-edit" "new=early-v1-%-edit"`).
- `sim/edits/*.json` are the rule edits the balance rounds tried; `none.json` is the no-op edit used to
  store a baseline with the parallel runner.
