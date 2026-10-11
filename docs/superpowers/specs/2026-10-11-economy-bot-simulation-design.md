# Economy bot simulation — design

Status: draft for review (2026-10-11). Nothing is built yet.

## Why

The bridge-level scaling of missions (reward and requirements by bridge rarity) cannot be tuned by
reasoning on one mission. What matters is how long a whole run takes to climb the rarities, with
fuel, repairs, scavenged parts and market purchases all in play. Today there is no way to measure
that. A one-mission snapshot (`apps/api/scripts/economy-sim.ts`) showed the net profit of a mission
is only ~95–535 credits against upgrade costs in the thousands, so the climb is far slower than
intended — but it assumed a repair after every mission and no other income, so it cannot be used
to calibrate.

**Goal.** A repeatable, in-process simulation: bots play the game from the start many times, under
different settings, and report how much game time it takes to reach each level and where the money
goes. The owner uses it to calibrate prices, rewards and the bridge scaling before changing them.

**Not a goal.** Finding the single best way to play; a bot that plays through the HTTP API (a later
smoke test); matching a human's moment-to-moment decisions.

## Decisions taken (owner, 2026-10-11)

- Approach: **in-process simulation** (no server, no database at run time).
- Fuel: refuel strategically — a full tank at cheap stops, expensive fuel only when there is no
  other way.
- Repair: strategically — at cheap ports, expensive ones only when there is no other way. Not after
  every mission.
- Scavenging on at least **75%** of missions; independent mining on at least **50%** where possible.
- Spend money smartly; sell what is not needed.
- Time: the simulation clock uses the **real** durations (what a player would wait); the run itself
  is instant. The report states the total real time used.
- A level is **reached when every installed part (bridge included) is at that rarity or better.**
- Target pace is unknown: the first runs are exploratory, to give the owner a baseline.

## What is reused (so the sim cannot drift from the game)

All pure functions, called as they are: `resolveMission` and `buildResolveInput`, `fillMission` and
the board's variety rules (`board-variety.ts`), `rewardBase` / `missionReward`, `repairCost` and
`repairSecondsPerPoint`, `fuelUnits` / `refuelCost`, `locationFactor`, `buyPrice` / `sellPrice` /
`partValue`, `rollScavengeFinds`, the upgrade costs and materials (`part-upgrade.calculator`,
`upgrade-materials`), `missionDuration`, `shipTier`, `deriveSheet`, `applyConnectivity`, and the
mission requirement checker.

The catalog, the config and the world (locations, routes, environments, templates, materials) are
read **once** from the live database into a JSON snapshot file, so a run is repeatable and
experiments can edit the snapshot (what-if prices) without touching the database.

## State of one simulated player

Wallet; the clock (seconds); a ship (installed parts with condition, layout abstracted to the kit:
connectivity is assumed intact); loose parts in storage; materials (ores, scrap, crystals, cores);
the current location; mission counters (for the 75% / 50% rules and for reports).

## The loop (one "action" at a time)

1. **Decide** what to do next (policy below).
2. **Act**, using the real functions; advance the clock by the real duration.
3. **Record** the cash flow by category (reward, combat spoils, scavenge sales, ore sales, fuel,
   repair, upgrade, purchase, sale).

Actions: take a mission (travel, race, rescue, escort, delivery, transport — whichever the ship's
requirements allow), start a scavenging job, start an independent mining job, repair, refuel, buy a
part, upgrade a part, sell a part or material, move to another port (a `TRAVEL` trip).

## Policies

**Mission choice (the bot's temperament).** Three bots to compare, plus a control:
- *Greedy*: the most valuable mission it qualifies for (reward per hour of play).
- *Balanced*: middle of the board by reward, avoiding the top risk band.
- *Safe*: the least dangerous mission it qualifies for (lowest route danger and zone), even if it
  pays less.
- *Random*: a uniformly random qualifying mission. A control: if Random progresses about as fast as
  the careful bots the economy is too generous; if it is hopeless the scaling is too punishing.

**Playstyle (the type of work).** Players differ more in *what* they do than in how risky they are,
so a second axis picks the mission types the bot is willing to take:
- *Generalist*: everything its ship qualifies for.
- *Hauler*: delivery, transport and races only — never mining and never rescue.
- *Rescuer*: rescue and escort first, anything else only when nothing of those exists.

The experiment matrix is `temperament (3) × playstyle (3)` plus Random, 100 runs each, so the
question "what is the best way to play" turns into a measurable one: **the spread between the
fastest and the slowest style**. A healthy balance keeps every reasonable style inside a band (the
owner picks it after the first results) and shows no style that is far ahead of the rest.

**Time budget.** A bot plays `H` hours of game time per day (default 2, a parameter), so the report
also converts to calendar days. An action costs a small human pause (default 30 s).

**Fuel.** At any port, the bot compares what a full tank costs here against the cheapest port in
reach (location factor = isolation × faction relation). It fills up fully at cheap ports; it buys
at expensive ones only when the next mission cannot be completed otherwise.

**Repair.** Repairs when the ship's average condition is below 70% or a key part (engine, tank,
hull, shield) is below 40%, at the cheapest reachable port; at an expensive port only when it
cannot fly otherwise. It does not repair after every mission.

**Scavenge and mining.** Scavenges after at least 75% of missions (when the cooldown allows) and
runs an independent mining job on at least 50% of the missions where its ship has a mining rig and
the place can be mined. Found parts go to storage; ore and scrap are sold or kept for upgrades.

**Spending.** The bot keeps a reserve for fuel and repairs, then buys the improvement with the best
gain per credit among: a higher-rarity part from the market, upgrading a part in place (money plus
scrap / crystals / cores), or fitting a scavenged part. It sells parts and materials it does not
need (anything not part of the target ship or the next upgrade).

**Target ship.** The 12-part kit used by the snapshot script (bridge, two engines, tank, battery,
two cargo holds, hull, weapon, shield, radar, reactor), grown by the bot toward the next rarity.
The level of a ship is the **lowest rarity among its parts**.

## Requirements are part of the game

The bot only takes missions its ship qualifies for (cargo, firepower, mobility, mining rig...), so
when the bridge-level scaling raises those requirements, the bot is forced to upgrade the ship
before it can take the better-paying work — which is exactly what the owner wants to measure.

## Outputs

Per run: game time, calendar days at `H` hours per day, and mission count to reach each level;
income and spending by category; success rate; the time spent per action type.
Per experiment cell (100 runs): median and the 10th / 90th percentile of each of the above.
Across cells: the spread between playstyles, and the A/B difference between two settings. The
report is a table in the terminal, and everything the bots did (runs, missions, every action, trades,
repairs, fuel, the offers they saw) is stored in a SQLite database shared by all experiments, so later
analysis and A/B comparisons are plain SQL. It also prints the real time
the simulated players spent.

## Checks before trusting it

- **Against the owner's own play.** Replay a handful of the owner's real missions (reward, fuel,
  wear) through the sim and compare.
- **Determinism.** Same seed and snapshot give the same run.
- **Sanity runs.** A bot that only does missions with no spending stagnates; a bot with unlimited
  money upgrades at the expected cost.

## Build order

1. Snapshot loader, state, clock and the mission loop with the real resolver. Cash-flow ledger.
2. Fuel, repair and the venue choice (cheap vs expensive ports).
3. Scavenging, independent mining, market and in-place upgrades; spending and selling policies.
4. The bots (temperaments and playstyles, Random) and the experiment runner.
5. Report, A/B comparisons and the validation against real play.

Each phase ends with unit tests for its pieces and a working run that prints a result.

## Risks and open points

- **Market stock and price drift** exist in the game; v1 assumes a part is always available at the
  catalog price times the location and mood factors, and the report says so.
- **Races and rescues** are the most complex mission types (finishing place, a stranded ship).
  They are in the matrix from phase 4; if their resolution is hard to drive in-process they start
  as simplified payouts, flagged in the report.
- **The ship's grid is abstracted**: parts carry their stats and conditions but the layout and
  connector checks are assumed fine. Layout problems are not a balance question.
- **The target pace is unknown**: the first runs only produce a baseline. The owner picks the
  targets after seeing it, and the multipliers are tuned against it.
