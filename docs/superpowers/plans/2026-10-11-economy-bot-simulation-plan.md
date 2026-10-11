# Economy bot simulation — implementation plan

> For the implementing agent: work **phase by phase**, in order. Each phase ends with passing tests,
> a working command, and a commit. Do not start a phase before the previous one is committed. Read
> the design first: `docs/superpowers/specs/2026-10-11-economy-bot-simulation-design.md` (the
> decisions in it are the owner's; do not change them without asking).

**Goal.** An in-process simulation where bots play the game from the start, many times, under
different settings, and report how much real time it takes to reach each rarity level and where
the money goes. It reads the live catalog/config/world once into a JSON snapshot and never touches
the database or the HTTP API while running.

**Tech.** TypeScript (ESM, Node 22, imports end in `.js`), run with `tsx`. Tests with Jest (`unit`
project). The simulation calls the game's real pure functions so it cannot drift from the game.

## House rules (from the repo owner)

- Code, comments and identifiers in English. No player-facing strings are needed here.
- **Never `git add -A` / `git commit -a`.** Other agents work in this repo at the same time; add
  only the files you created or changed, by path.
- Never merge into `develop`; stay on your branch. Do not edit the game's behaviour (`src/`) except
  for the explicit "export this function" changes listed below — the sim is read-only on the game.
- Don't re-seed or change the dev database. The sim only *reads* it, once, to build the snapshot.
- After touching `apps/api/src`, run `cd apps/api && npx tsc --noEmit -p . && pnpm test:unit`.
- Mind the lint rule `no-magic-numbers`: put numbers in named constants (the sim directory is
  linted like `src`; if the rule is not active there, still keep numbers named).

## Where things live

```
apps/api/sim/                      # new — the simulation (not part of the Nest build)
  store/                           # SQLite: schema.sql, writer, queries
  analysis/queries/                # canned analyses (.sql) + their tests
  snapshot/
    export-snapshot.ts             # DB -> JSON (the only file that touches Prisma)
    load-snapshot.ts               # JSON -> typed Snapshot
    types.ts
  core/
    rng.ts                         # seeded streams (wraps src/common/rng)
    clock.ts                       # simulated clock + day/hour budget
    ledger.ts                      # cash flow by category
    state.ts                       # PlayerState, ShipState, factories
    world.ts                       # board, travel, port facts (price factors)
  actions/
    mission.ts  fuel.ts  repair.ts  scavenge.ts  mining.ts  market.ts  upgrade.ts  travel.ts
  bots/
    temperament.ts                 # greedy | balanced | safe | random
    playstyle.ts                   # generalist | hauler | rescuer
    policy.ts                      # fuel / repair / scavenge / spending rules
    bot.ts                         # the decision loop
  experiment/
    runner.ts  report.ts  cells.ts
  cli.ts                           # `tsx apps/api/sim/cli.ts <command>`
  README.md
apps/api/test/unit/sim/            # unit tests, mirror the folders above
apps/api/sim-data/                 # generated snapshot + reports (git-ignored)
```

Prerequisite chores (do these first, in a single small commit):

1. Add `"sim"` to `include` in `apps/api/tsconfig.json`.
2. Add `apps/api/sim-data/` to `.gitignore`.
3. In `apps/api/src/economy/repair.service.ts` **export** `repairSecondsPerPoint` (it is private
   today). Nothing else changes.
4. Add npm scripts in `apps/api/package.json`: `"sim": "tsx sim/cli.ts"`.
5. Add `better-sqlite3` and `@types/better-sqlite3` as devDependencies of `apps/api` (`pnpm --filter ./apps/api add -D ...`) and check it loads on the host (Node 20).

The existing one-mission script `apps/api/scripts/economy-sim.ts` is a useful reference for how to
build a `DispatchSnapshot` and call `resolveMission(buildResolveInput(...))`; keep it, do not extend it.

## Real functions to reuse (paths under `apps/api/src`)

| Need | Function | File |
|---|---|---|
| Resolve a trip | `resolveMission`, `buildResolveInput(args)` | `resolution/mission/mission.resolver.ts`, `missions/resolution-input.ts` |
| Frozen ship for a trip | `DispatchSnapshot`, `pickCatalogStats(row)` | `missions/dispatch.service.ts`, `parts/parts.service.ts` |
| Generate board offers | `fillMission({seed, origin, world, rules, now})` + `isVariedEnough` | `missions/generator/template.filler.ts`, `missions/board-variety.ts` |
| Reward | `missionReward(row, tier, rules)` / `rewardBase` | `missions/mission.reward.ts`, `economy/reward.calculator.ts` |
| Mission requirements | `missionRequirementChecklist`, `checkMissionRequirements` | `missions/requirements.checker.ts` |
| Trip time | `missionDuration({totalDistance, mobility, durationK, timeScale, classCutoffs})` | `missions/duration.calculator.ts` |
| Fuel | `fuelUnits`, `refuelCost(units, isolation, relation, rules)` | `economy/fuel-cost.calculator.ts` |
| Repair | `repairCost(parts, tier, isolation, relation, rules)`, `locationFactor`, `repairSecondsPerPoint` (export it) | `economy/repair-cost.calculator.ts`, `economy/repair.service.ts` |
| Part prices | `buyPrice`, `sellPrice`, `partValue` (`PartPriceInput`) | `economy/price.calculator.ts` |
| Material prices | `sellMaterial` logic: fixed-price scrap sells for its `basePrice`; ore by `sellPrice` | `economy/pricing.service.ts` |
| Upgrade in place | `nextTierPartTypeOf`, `partUpgradeCost`, `upgradeNeeds`, `sizeFactor` | `economy/part-upgrade.calculator.ts`, `economy/upgrade-materials.ts` |
| Scavenge | `rollScavengeFinds(context, rules, rng)` (the roll happens inside `resolveMission` for a SCAVENGE mission; context from `scavenge-context.ts`) | `resolution/scavenge/scavenge.resolver.ts` |
| Ship sheet / tier | `deriveSheet`, `shipTier` | `ships/sheet.deriver.ts`, `ships/ship-tier.ts` |

Read the tests next to each function (`apps/api/test/unit/...`) for example inputs.

---

## Phase 0 — chores and the snapshot

**Goal.** A command that exports the live database into one JSON file, and a typed loader.

Tasks

1. Do the prerequisite chores above.
2. `snapshot/types.ts`: `Snapshot` = `{ takenAt, rules: GameRules, catalog: PartCatalogRow[],
   locations, routes, routeEnvironments, environments, templates, materials, dropTable }`.
   `rules` is built the same way `scripts/economy-sim.ts` does (defaults overlaid with the
   `GameConfig` rows: key `group.name` → `rules[group][name]`).
3. `snapshot/export-snapshot.ts`: the only file that imports Prisma. Writes
   `apps/api/sim-data/snapshot.json`. Run with
   `set -a; . ./.env; set +a; pnpm sim export`.
4. `snapshot/load-snapshot.ts`: reads the file, validates the shape (a small hand-written check),
   deep-freezes it. A `withEdits(snapshot, (draft) => ...)` helper returns a **copy** with edits
   (used later for what-if prices); the original is never mutated.
5. `cli.ts` with the `export` command.

Tests (`test/unit/sim/snapshot.spec.ts`): the loader rejects a file missing `rules`; `withEdits`
does not mutate the original; the rules overlay applies a DB value over the default.

Done when: `pnpm sim export` produces the file (about 220 parts, 12 locations); tests green;
committed.

## Phase 1 — state, clock, ledger and the mission loop

**Goal.** One simulated player flies missions with the real resolver, with a ledger and a clock.
No fuel/repair policy yet: the ship is refueled and repaired for free between missions (so the
loop itself can be tested). Money flows are recorded.

Tasks

1. `core/rng.ts`: a thin wrapper over `src/common/rng/rng.js` (`createRng(seed).child(label)`);
   every random choice in the sim takes a named child stream so runs are reproducible.
2. `core/clock.ts`: `Clock { now(): number (seconds); advance(seconds) }`, plus a play-time budget:
   `hoursPerDay` (default 2) and `humanPauseSeconds` (default 30). `calendarDays()` converts the
   total simulated seconds into days of play at that budget. **Seconds are the real durations**
   (no speed-up factor).
4. `core/ledger.ts`: `Ledger.record(category, amount)`; categories: `reward`, `combat`,
   `scavengeSale`, `oreSale`, `fuel`, `repair`, `upgrade`, `purchase`, `sale`. `totals()`.
5. `core/state.ts`: `PlayerState` (wallet, clock, ship, storage, materials, location, counters:
   `missionsDone`, `scavengesDone`, `miningDone`, `lastScavengeAt`, `log`) and `ShipState`
   (parts: `{ id, partType, condition }`, fuel). `starterPlayer(snapshot, faction)` builds the
   starting ship from the starter kit (see `prisma/seed-data/starter-kit.ts`: bridge, small
   chemical engine, small tank, small battery, 2 × cargo, hull; starter credits come from
   `rules.onboarding`, the starter parts' condition from `rules.parts.starter_condition`).
6. `core/world.ts`: builds the `FillerWorld` from the snapshot; `boardAt(state, locationId, epoch)`
   generates offers with `fillMission` honoring `isVariedEnough` exactly as
   `board.service.ts → topUp` does (4 offers, reseeds until varied). Port facts:
   `isolation`, `factionRelation` (player faction vs the location's faction via `faction.relations`).
7. `actions/mission.ts`: `takeMission(state, offer)`:
   - check requirements with `checkMissionRequirements` (needs the sheet from `deriveSheet` on the
     ship's current parts; condition matters);
   - the reward is `missionReward(offer, shipTier(parts), rules)` (finalized at accept, like the
     game);
   - build a `DispatchSnapshot` (layered: true, parts with `catalog: pickCatalogStats(row)`,
     `connected: true`, legs from the offer) and call `resolveMission(buildResolveInput(...))`;
   - apply the outcome: part conditions from `outcome.parts`, fuel from `outcome.fuel`, credits from
     `outcome.creditsDelta`, loot (materials) from `outcome.loot`, found parts/scrap from
     `scavenge_find` events (same persistence rules as `missions/resolve.service.ts`);
   - the clock advances by `missionDuration(...)` using the ship's mobility (`mobility` from
     `rawMobility`), not by a made-up number; the player's location becomes the destination.
   Return a small result record for the report (status, reward, duration, fuel burned, wear).

   How to fill the pieces correctly (read these before writing the code):
   - **Context.** Build the `ResolutionContext` with `contextFromLive(...)` from
     `missions/resolution-input.ts` (it maps an offer row to escort client, race competitors, mining
     material, scavenge context). See `missions/resolve.service.ts` (around line 127) for what it is
     fed: the offer's `cargo` and `encounterPolicy`, the employer faction's relations, the player's
     faction and the destination's isolation. Races, escorts and rescues work the same way — the
     offer row already carries their data.
   - **Accept and dispatch rules.** Mirror `missions/missions.service.ts` (accept) and
     `missions/dispatch.service.ts` (dispatch): requirements met, fuel enough for the trip
     (`fuelUnits`), the ship at the offer's origin and not busy, the reward finalized at accept.
   - **The ship must stay viable.** After any change to the parts call `deriveSheet`,
     `checkViability(sheet, parts, rules)` (`ships/viability.ts`: mobility ≥ 1, structure used within
     the bridge's budget, a working bridge/engine/tank...) and `allocatePower`
     (`resolution/power/power.ts`). A ship that is not viable cannot take missions. Parts of a higher
     rarity change structure cost, mass and energy, so this matters when upgrading. The layout grid
     itself is *not* simulated; connectivity is assumed fine.
   - **Offers over time.** A board offer lives 6–40 minutes (`expiresAt`); new ones are generated
     lazily with the epoch counter of the location (`missions/board.service.ts → topUp`). A new
     player gets the private start-safe offer first (`starter_guarantee_max_completed`). Model both,
     and let the bot wait (advance the clock) when nothing qualifies.
8. `bots/bot.ts` (first version): pick a random qualifying offer; if none, skip time forward until
   the board changes (offers live 6–40 minutes). Between missions the ship is restored for free.
9. `cli.ts` `run --seed N --missions 50` prints each mission and the totals.

Tests: clock budget and calendar-day conversion; ledger totals; `takeMission` refuses an unmet
requirement and charges nothing; the same seed produces the same run twice; a successful delivery
credits roughly `missionReward` times the integrity multiplier; the mission duration equals
`missionDuration`.

Done when: `pnpm sim run --seed 1 --missions 50` prints a plausible log; unit tests green; commit.

## Phase 2 — fuel, repair and where to do them

**Goal.** Fuel and repair cost real money and time, bought at the right ports. This is where the
"net profit per mission" becomes real.

Tasks

1. `actions/fuel.ts`: `refuel(state, locationId, units?)` pays `refuelCost(...)` for that port;
   `fuelPriceAt(state, locationId)` for comparing ports.
2. `actions/repair.ts`: `repairAll(state, locationId, targets)` pays `repairCost(...)` and advances
   the clock by `points × repairSecondsPerPoint(rules, zone)`; `repairPriceAt(...)`.
3. `actions/travel.ts`: a `TRAVEL` trip to another port with the real resolver (it burns fuel and
   wears the ship, pays nothing) so a bot can reach a cheaper port.
4. `bots/policy.ts`:
   - **Cheap vs expensive.** A port is *cheap* when its location factor is within 10% of the
     cheapest port the bot can reach with its current fuel; otherwise *expensive*. (Constant,
     named, owner-tunable later.)
   - **Fuel:** a full tank at a cheap stop; at an expensive one only the units needed for the
     next chosen mission (and only if that mission cannot be flown otherwise).
   - **Repair:** when the average condition is below 70% or any key part (engine, tank, hull,
     shield) is below 40%, repair at the cheapest reachable port; at an expensive port only when
     the ship cannot fly otherwise (an engine or tank near dead). Never after every mission.
5. The bot loop uses these instead of the free restore from phase 1.

Tests: refuel and repair debit the exact amounts of the real calculators; a bot does not repair a
healthy ship; it repairs below the thresholds; it prefers a cheap port when one is in reach; with
no fuel and only an expensive port it still buys fuel (the "no other way" rule).

Done when: `pnpm sim run --seed 1 --missions 100` shows non-zero fuel and repair spending and the
ledger sums to the wallet change; commit.

## Phase 3 — scavenging, mining, market, upgrades

**Goal.** The other income and the spending, so the ship can actually climb.

Tasks

1. `actions/scavenge.ts`: a SCAVENGE job (mode `ship`, with the cooldown and duration from
   `rules.scavenging`) built with the real context (`ScavengeContext` from the snapshot's drop
   table and the place) and resolved through `resolveMission`; found parts go to storage, scrap
   and ore to materials. `actions/mining.ts`: the independent mining job at a minable place (needs
   a mining rig; see `missions/mining-job.service.ts` for the preconditions and the cargo it uses).
2. `actions/market.ts`: `buy(state, partType, locationId)` with `buyPrice`; `sell(...)` with
   `sellPrice` (parts) and the material rule (scrap at its fixed price, ore via `sellPrice`).
   Assumption for v1: any catalog part is available at the normal price (no stock). State it in
   the report header.
3. `actions/upgrade.ts`: `upgradePart(state, partId)` with `nextTierPartTypeOf`, `partUpgradeCost`
   (using `economy.part_upgrade_price_multiplier[rarity]`) and `upgradeNeeds` for the materials,
   taking scrap from the least valuable first like `part-upgrade.service.ts`. Condition carries over.
4. `bots/policy.ts` additions:
   - **Scavenge** after at least 75% of missions when the cooldown allows (track the ratio over
     the last 20 missions); **mining** on at least 50% of missions where the ship has a rig and the
     place is minable (use the same template eligibility as `isMiningEligible`).
   - **Spending (an exact rule, so runs are comparable):**
     1. Keep a reserve: one full refuel plus the repair the bot expects to need (the average repair
        bill of its last 5 repairs; a constant until it has any).
     2. Find the installed part with the **lowest rarity** (ties: the cheapest to improve). That is
        the next target — a level is only reached when every part is at that rarity.
     3. For that slot compute three ways to get the next rarity and take the cheapest *net* one the
        wallet allows (the reserve stays untouched):
        a. fit a loose part (scavenged or bought earlier) of the target type and next rarity:
           cost 0, but the old part goes to storage (sell it later);
        b. buy the next-rarity part at the best reachable port: `buyPrice − sellPrice(old part)`;
        c. upgrade in place: `partUpgradeCost` plus the materials of `upgradeNeeds`, counting
           scrap/crystals/cores held as free and missing ones as not possible (don't buy materials).
     4. If nothing is affordable, do nothing and keep earning.
     Fitting a part must keep the ship viable (structure budget, power); if it breaks viability,
     skip it and try the next option.
   - **Selling:** sell what is not part of the target ship and not needed for the next upgrade
     (loose parts under a threshold of use, ore, surplus scrap beyond the upgrade needs).
5. **Ship level.** `shipLevel(ship)` = the lowest rarity among all installed parts, bridge included.
   The bot's target ship is the 12-part kit of the spec, grown toward the next rarity; extra parts
   (a second cargo hold, etc.) are allowed when a mission requirement needs them.
6. The run ends when the ship reaches level 5 (legendary), the playtime cap (default 400 hours) is
   hit, or no progress is possible (a stall detector: no level change and wallet not growing for
   200 missions; mark the run `stalled`).

Tests: scavenge adds parts/scrap exactly as the resolver rolled; mining needs a rig; buying debits
`buyPrice`; selling credits `sellPrice`; an upgrade charges money and takes the materials and
fails cleanly when short; `shipLevel` is the minimum rarity; the scavenge ratio policy keeps
≥ 75% over a long run (statistical, with a fixed seed); the spending policy never goes below the
reserve.

Done when: one run with the greedy bot reaches a higher level than it started (or stalls with a
clear message); the report shows scavenging, mining, sales and upgrades in the ledger; commit.

## Phase 4 — the bots and the experiment runner

**Goal.** The temperaments, playstyles and a runner that plays many games and compares them.

Tasks

1. `bots/temperament.ts`: `greedy` (highest reward per hour of trip, after estimated fuel cost),
   `balanced` (the median offer by reward among those below the top risk band), `safe` (lowest
   route danger, then zone, then reward), `random` (uniform among qualifying offers, seeded).
2. `bots/playstyle.ts`: `generalist` (every type), `hauler` (delivery, transport and race; never
   mining or rescue), `rescuer` (rescue and escort first, anything else only if none). A playstyle
   filters the offers; a temperament orders what is left. If the filter leaves nothing the bot may
   take any qualifying offer (log it as a `fallback`).
3. `experiment/cells.ts`: a *cell* = `{ temperament, playstyle, hoursPerDay, settingsName }`; the
   default matrix is 3 temperaments × 3 playstyles + `random` = 10 cells.
4. `experiment/runner.ts`: `runCell(snapshot, cell, runs, baseSeed)` plays N games (default 100),
   each seeded `baseSeed + i`, and collects per-run: real seconds to reach each level
   (`levelReachedAt[1..5]`), missions to each level, calendar days at `hoursPerDay`, ledger totals,
   success rate, time per action type, `stalled`. Use worker threads only if a cell takes more than
   a few minutes; correctness first.
5. `cli.ts`: `experiment --runs 100 --hours-per-day 2` prints the matrix and writes every run to the
   SQLite store (see "Data kept for future balancing"); it also prints the **total real (simulated)
   time played**. Build the store (`sim/store`) in this phase, but start writing `runs`, `levels`,
   `missions` from Phase 1 so no data is lost while the later phases are built.

Tests: each temperament picks the expected offer on a fixed board; each playstyle filters types
correctly and falls back; the runner is deterministic for a base seed; per-run records have all the
level timestamps in increasing order.

Done when: `pnpm sim experiment --runs 20` completes on the live snapshot and prints a table with
median / p10 / p90 of days to each level per cell; commit.

## Phase 5 — report, what-ifs and validation

**Goal.** Make the numbers useful to the owner and trustworthy.

Tasks

1. `experiment/report.ts`: for each cell, median/p10/p90 of days and missions per level; income and
   spending shares by category; the **spread** between the fastest and slowest playstyle (ratio of
   medians) and the Random-bot control ratio; a header listing the assumptions (no market stock,
   layout abstracted, any simplified mission type).
2. What-if runs: `experiment --edit <file.json>` applies a list of snapshot edits (e.g.
   `{"economy.reward_per_tier": 200}` or a reward multiplier table by bridge level) with
   `withEdits`, runs the same matrix, and prints the A/B difference against the unedited snapshot.
   The bridge-level scaling is **not** implemented in the game yet; model it in the sim as an
   optional `bridgeScaling` hook in `takeMission`, read from a JSON file of this shape:
   `{ "reward": [1,1,1,1,1], "cargo": [1,1,1,1,1], "firepower": [1,1,1,1,1], "mobility": [1,1,1,1,1] }`
   (five numbers each, one per bridge rarity from common to legendary). The hook multiplies the
   offer's reward and its numeric requirements (cargo needed, firepower needed for escorts, mobility
   needed for escorts/races/rescues) by the entry for the ship's bridge rarity. All ones is the
   baseline (today's game). This lets us tune the table before building it in the game.
3. Validation:
   - **Against real play.** Export a few real missions of the owner's player from the database
     (`MissionLog` rows: reward, fuel burned, wear per part) and replay the same ship and legs in
     the sim; the sim's fuel and wear per mission must be within 10% of the logs. Put the check in
     `test/validation`-style script (not in the unit suite) and record the result in the README.
   - **Sanity bots.** A bot that never spends stagnates; a bot with unlimited money upgrades at
     exactly the real upgrade costs.
4. `README.md` for the sim: how to export, run, read the report, add a cell or an edit.

Done when: the owner can run one command and get the matrix, the spread numbers and an A/B for a
config edit; validation numbers are in the README; commit.

---

## Data kept for future balancing — SQLite (required from Phase 1 on)

Everything the simulation does is stored in **one SQLite database**, `apps/api/sim-data/sim.db`
(git-ignored), shared by all experiments, so any two experiments can be compared with a plain SQL
join. The point of the store is the analysis listed below: design the tables so those questions are
a single query, and record the data they need *as typed columns*, not as JSON blobs.

**Library.** `better-sqlite3` as a devDependency of `apps/api` (the host runs Node 20, which has no
built-in SQLite). Open with `journal_mode = WAL`. SQLite has one writer: worker threads send their
rows to the main thread in batches, and the main thread inserts them inside transactions of ~10,000
rows. The schema lives in `sim/store/schema.sql`, with a `schema_version` table; a change to the
schema is a new numbered SQL file, never an edit of an old one.

### Tables

| Table | One row per | Main columns |
|---|---|---|
| `experiments` | experiment | `id`, `name`, `created_at`, `git_sha`, `args_json`, `snapshot_taken_at`, `snapshot_hash`, `edit_hash`, `edit_json`, `sim_version`, `assumptions` |
| `runs` | simulated player | `id`, `experiment_id`, `cell`, `temperament`, `playstyle`, `hours_per_day`, `seed`, `final_level`, `stalled`, `stall_reason`, `total_seconds`, `total_missions`, `success_rate`, and the ledger totals `reward`, `combat`, `scavenge_sale`, `ore_sale`, `fuel`, `repair`, `upgrade`, `purchase`, `sale` |
| `levels` | level reached | `run_id`, `level`, `t`, `day`, `missions`, `wallet`, `ship_value` |
| `actions` | every action | `run_id`, `seq`, `t`, `day`, `kind` (mission, fuel, repair, scavenge, mining, buy, sell, upgrade, travel, wait), `location_id`, `seconds`, `wallet_before`, `wallet_after`, `fuel_before`, `fuel_after`, `avg_condition`, `min_condition`, `ship_level`, `ship_value`, `reason` |
| `missions` | mission taken | `run_id`, `seq`, `offer_id`, `type`, `template_id`, `origin`, `destination`, `distance`, `max_danger`, `zone`, `reward_offered`, `reward_paid`, `status`, `integrity`, `fuel_burned`, `wear_points`, `fights`, `wins`, `losses`, `duration_s`, `bridge_level`, `ship_tier`, `scrap_found`, `parts_found` |
| `offers_seen` | offer on a board when the bot decided | `run_id`, `seq`, `offer_id`, `type`, `template_id`, `reward`, `distance`, `max_danger`, `qualified`, `blocked_by` (cargo, mobility, firepower, mining_rig, cabin), `chosen`, `rank` |
| `part_wear` | part per mission | `run_id`, `seq`, `part_type`, `part_class`, `rarity`, `loss` |
| `trades` | buy / sell / upgrade | `run_id`, `seq`, `kind`, `part_type`, `rarity`, `price`, `port_cheap`, `materials_json` |
| `service` | fuel or repair done | `run_id`, `seq`, `kind`, `location_id`, `units_or_points`, `price`, `port_cheap`, `forced` (no cheaper way) |

Indexes: `runs(experiment_id, cell)`, `actions(run_id, seq)`, `missions(run_id)`,
`missions(template_id)`, `missions(type, bridge_level)`, `offers_seen(run_id, seq)`,
`levels(run_id, level)`, `service(run_id, kind)`.

Views to ship in the schema (so analyses are short): `v_cashflow_by_level` (money in/out per run,
level and category), `v_mission_net` (a mission's reward minus its fuel and its share of the
repairs that followed), `v_time_by_kind` (seconds per action kind per run).

### Analyses the data must support (each one is a test query)

Write one canned query per item in `sim/analysis/queries/*.sql`, run through
`pnpm sim analyze <experiment> <name>`, and a unit test per query against a tiny fixture database.

1. **Pace.** Days / missions to each level per cell: median, p10, p90 (a window or a custom
   percentile function in JS, since SQLite has none).
2. **Net profit per mission** by level and by mission type (reward − fuel − repair share).
3. **Best work per hour:** reward per hour by type and template at each level; which templates are
   never worth taking.
4. **Where income comes from** per level: rewards vs scavenging vs ore vs sales; what share of the
   money pays for fuel, repairs and upgrades.
5. **Fuel and wear economics:** fuel cost vs reward by distance and zone; wear and repair cost by
   part class and rarity; which parts cost the most to keep.
6. **Risk:** failure and loss rate by zone, danger and level; how often the safe bot beats the greedy
   one in net per hour.
7. **Bottlenecks:** where runs stall (level, wallet, which material or requirement was missing);
   time waiting for scrap / crystals / cores; time with nothing qualifying on the board.
8. **Requirement blocking:** how often the best-paying offers were not taken because of cargo,
   mobility or firepower, by level (what the bridge-level scaling will push on).
9. **Time budget:** seconds by action kind (travel, repair, scavenging, waiting) per level.
10. **Style dominance:** the ratio between the fastest and slowest playstyle, and whether Random is
    close to the careful bots (a sign the economy is too generous).
11. **What-if comparison:** the same cell in two experiments, side by side (`compare A B` is a
    saved query joining `runs` on `cell` and `seed`).
12. **Upgrade path:** which route the spending rule took per slot (fit a loose part / buy / upgrade
    in place) and what each cost.

### Keeping size under control

`--keep-events all|sample|none` (default `sample`): `runs`, `levels`, `missions`, `trades` and
`service` are always written for every run (they are small); `actions`, `offers_seen` and
`part_wear` are written for every run only with `all`, and for the first 10 runs of each cell with
`sample`. Around 2,000 actions per game means ~2 million `actions` rows for 1,000 games (a few
hundred MB at worst); `VACUUM` and `pnpm sim prune <experiment>` (drops the event tables of an
experiment, keeps the summaries) are provided.

Commands (Phase 5): `pnpm sim sql "<query>"` (read-only, prints a table), `pnpm sim analyze <exp>
<name>`, `pnpm sim compare <expA> <expB>`, `pnpm sim export-csv <exp> <table>`, `pnpm sim list`.
Tests: the store round-trips a run (insert then read the same totals); the canned queries return
the expected numbers on a fixture database built by the test; the same seed and manifest reproduce
identical rows.

---

## Open points to confirm with the owner while implementing

- The *cheap port* tolerance (10%) and the repair thresholds (70% average, 40% key part).
- The playtime cap (400 hours) and the stall rule (200 missions).
- Which mission types, if any, start as simplified payouts (races and rescues), and the report must
  flag them.

## Definition of done for the whole plan

`pnpm sim export && pnpm sim experiment --runs 100` runs on the live snapshot in a reasonable time,
prints a table of days-to-level per temperament and playstyle, the spread between playstyles, the
Random control, the real simulated time played, and an A/B table for an edit file; the unit tests
for every phase pass; and the README explains all of it.
