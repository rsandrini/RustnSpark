# Profile stats: record everything per pilot (design)

Status: draft for the owner's approval. First of the online features (order: profile stats, global ranking,
presence at the port, scheduled races, missions together).

## Why

The game keeps no per-pilot totals. `MissionLog` holds every run's events, but a profile, a ranking and any future
event ("most distance this week") need numbers that are cheap to read and that exist from the first flight.
The dev DB is reset, so nothing is backfilled: **record the maximum from day one**, keep it cheap to write, decide
later what to show.

## Goals

- One lifetime counter set per pilot, written in the same transaction as the action it counts (no drift).
- A daily slice of the same counters, so weekly or event windows can be computed later without new recording.
- Records ("bests") that a plain counter cannot give: fastest race, biggest payout, longest run, richest wallet.
- A public card and a private view of the same data, split by a fixed visibility list in code.
- Counters only; the ranking, presence and races build on top later.

## Non-goals

- No backfill of old missions (owner: the DB is reset).
- No ranking, no leaderboard endpoint, no presence in this step.
- No new Admin editor: the stats are facts, not tunables (the tuning policy does not apply).
- The public card never shows the ship itself, its parts or its layout.

## What is recorded

Keys are stable strings in one list (`player-stats.keys.ts`), grouped. Each is an integer total unless noted.

**Flying:** missions started, missions by outcome (success, failed, aborted, ship lost), distance traveled, legs
flown, flight time (seconds), fuel burned, fuel lost to leaks, rescues called, times adrift.

**Combat:** fights won / lost / escaped / drawn, pirate fights, player-versus-player fights, damage taken (total and
split shield, armor, hull), damage dealt, parts lost to pirates, cargo lost.

**Wear:** travel wear points, part failures, parts destroyed, ships destroyed.

**Races:** entered, won, podiums, best place (record), fastest race time (record).

**Scavenging and mining:** scavenge runs (ship and on foot), parts found, scrap found, mining runs, ore mined.

**Money, in and out:** credits earned from missions, from selling parts, from other sources; credits spent on parts,
refuel, repair, upgrades, bridge resize, rescue, other. Plus counts: parts bought, parts sold, repairs, refuels.

**Records (max or min, with the mission id where it applies):** biggest payout, longest single run (distance), highest
wallet ever, best race place, fastest race time, most damage taken in one run.

**Milestones:** first mission at, joined at, last active at (a timestamp, not a counter).

## Design

### Storage

- `PlayerStats` (one row per player): `playerId` PK, `totals Json` (key -> number), `records Json` (key ->
  `{value, at, missionId?}`), `firstMissionAt`, `lastActiveAt`. A JSON bag is deliberate: new keys need no migration, and
  the key list in code is the schema. Reads for the ranking later can index a generated column or move a hot key
  to its own column when it is chosen.
- `PlayerStatsDaily` (`playerId`, `day` date, `totals Json`): the same counters for that UTC day. Primary key
  `(playerId, day)`.
- One new migration; no data move (reset DB).

### Writing

`PlayerStatsService.add(playerId, delta, tx)`, with `delta` a typed `Partial<Record<StatKey, number>>`, and
`PlayerStatsService.best(playerId, key, value, tx, meta?)` for records. Both take the caller's transaction and issue one
`INSERT ... ON CONFLICT DO UPDATE` using JSONB merge that adds per key (a single statement, safe under concurrency),
for the lifetime row and the daily row. A key outside the list is a compile error.

Hook points (all already inside a transaction):

| What | Where | Source of the numbers |
|---|---|---|
| Money in and out | `WalletService` credit / debit (`players/wallet.service.ts`) | a `category` is added next to the existing `reason` string; the wallet maps category to the earned/spent keys |
| Mission run: distance, legs, fights, damage, wear, failures, loot, races | `missions/resolve.service.ts` after the outcome | `report.stats` (`reports/report.stats.ts`) already sums these from the events; reuse it, do not re-derive |
| Fuel burned | the same resolve step | needs the per-leg fuel in the stored events; **verify** whether `leg_travel` carries it, else add `fuelBurned` to the event (same place as `fuelLost`) |
| Damage dealt | the combat events | add to the fight-closing event if absent (it is counted for damage taken only) |
| Refuel, repair, market buy/sell, upgrade, resize, rescue | `economy/*.service.ts` (the places that call `events.record`) | amounts already known there |
| Scavenge and mining finds | `resolve.service.ts` (found parts, scrap), `mining-job.service.ts` | the events they already write |
| Wallet peak, last active | wallet credit, and any authenticated request is **not** used (too chatty): last active is touched on mission start/resolve and on login |

`PlayerEvent` stays as the audit trail; stats are the fast read model, not a replacement.

### Reading and privacy

- `GET /v1/players/me/stats`: everything, private view.
- `GET /v1/players/:name/profile`: the public card only.
- Visibility is one table in code (`PUBLIC_STATS`), so adding a key is a one-line, reviewed decision.
- **Public:** pilot name, faction, ship title and rarity, joined at, missions flown, success rate, distance, fights won,
  races entered / won, best race place, fastest race time, scavenge runs.
- **Private:** wallet and all money keys, repair and fuel spending, damage taken and dealt, part failures, pirate
  theft, rescues, every record not listed as public.
- **Ship title:** class, bridge rarity and a placeholder callsign. No parts, no layout, no picture.
- The public card is always public for now (owner decision).

### Web

- A profile page with the public card (any pilot) and, for yourself, the private tabs. Bilingual (en + pt-BR), no
  hard-coded strings, mobile first (320 px).
- No ranking UI yet.

## Constraints

- Counters are written inside the action's transaction; a failed action writes nothing.
- Resolution stays deterministic: stats are a read model of the result, never an input to it.
- Idempotent resolve: the claim that already guards `MissionLog` (unique `missionId`) also guards the stats write, so
  a retry cannot count a mission twice.
- Cost: two upserts per action, one of them per mission. Acceptable; revisit only if the soak test shows lock contention
  on a hot player row (a single pilot's own actions are serial, so contention is unlikely).

## Tests

- Unit: the key list, the delta merge, the visibility table (a key is never public by accident: a test lists the public
  keys explicitly).
- Integration: a resolved mission writes its stats once (retry safe); a purchase, a repair and a refuel move the
  right money keys; a failed purchase writes nothing.
- Contract + web: the profile endpoint shape, the card renders both languages, the private view hides for others.
- Smoke: one flight, then the profile shows the mission and the distance.

## Left to the builder

Exact key names, the JSONB upsert SQL, which controller module hosts the endpoints, and the page layout.

## Decisions (owner, 2026-10-27)

1. **Daily slice: yes.** Store as much as possible; the DB is reset, so no migration care and no backfill.
2. **Public card: always public** for now (no off switch). Drop the per-pilot switch from "Reading and privacy".
3. **Ship title:** ships have no name today, only a class and a rarity. The card shows the class and the bridge
   rarity, plus a placeholder callsign built from the faction, the pilot name and a word from a short list
   (`TAG-Name-Word`, kept short, e.g. `LUN-Rafael-Wren`). Real ship names come later and replace the callsign.

Implementation plan: `docs/superpowers/plans/2026-10-27-profile-stats.md`.
