# To do - v0.2

Owner's list for v0.2 (2026-11-16). Delete an item when it ships. Every item here is *needs design*: plan before building.
Items 1, 2 and 6 lean on the multiplayer work (item 6), so that one comes first or alongside.

## 1. Clan bases (a new type of mission)

- [ ] A clan (a group of friends from the same faction) can claim and build bases.
- A base can be conquered from the pirates, then built up with parts bought at other ports.
- Once built, a base can support repair, store fuel, and so on. Needs a lot of planning yet (what a base offers, its upkeep,
  who may use it, what happens when pirates take it back).
- Depends on all the multiplayer functions (item 6), clans above all.

## 2. War

- [ ] Some places (or parts of the map) are at war with the pirates, and pilots can go there to fight them.
- Like Helldivers: the victories against the pirates add up to a global result. The faction with the most wins conquers the place
  and leads it from then on.
- Pirates attack in some zones and have to be fought off. This raises a lot of war missions for the pilots who want them.
- Open: how a victory is counted, how long a war lasts, what the winning faction gets, what happens to a place that is taken.

## 3. More than one ship

- [ ] A pilot can own several ships: one for racing, one for mining, one for transport, and so on.
- Limit not decided (the owner thinks 3 for now); needs thinking (price of the next hangar slot, upkeep, what moves between ships).
- The pilot can use several ships at the same time, each on its own quests.
- Today the code assumes one ship per pilot (`ships[0]` in the web, one active mission per player in the database), so this touches
  the missions, the hangar, the port and the rescue.

## 4. More than one quest per ship

- [ ] A big ship can take several tasks in one trip: cargo delivery plus cargo delivery, leaving the same port and delivering at
  the same place or at ports along the way. Taking several tasks at once is an option, not a rule.
- Open: how the cargo space is shared, how the route and the time are worked out, what happens when one task fails, how the
  rewards and the wear are split.

## 5. More RPG elements

- [ ] Add RPG elements. With everything from v0.1 and v0.2 in place, the way the NPCs deal with the players can improve too.

## 6. Finish the multiplayer

- [ ] The game must feel live to keep multiplayer working, a truly interactive experience:
  - friends list
  - clans
  - chat with the clan
  - chat with friends
  - trade between players
  - live market
  - live quests and races
  - war (item 2)
- All of this together is what makes the game feel alive; items 1 and 2 depend on it.

## Carried over from the old backlog (moved here 2026-11-23)

Items from `docs/TODO.md` that are not built yet. The ones that duplicated the list above were merged into it (friends list, scheduled
races, missions together, weekly rewards).

### 7. Online follow-ups (leaning on item 6)

- [ ] **Presence, next phase:** the port shows a count of docked pilots (built 2026-11-02, online or not). Names come with the friends
  list; "online now" would need a last-seen signal (none exists today). An optional pilot list in the port (ship names only).
- [ ] **Friends list**, then names in the port and in presence (the report flow, `/admin/reports`, is built).
- [ ] **Scheduled player races:** a race that starts at a fixed time; pilots apply and wait, then compete against each other (today a
  race is against generated rivals, `resolution/race`). Needs an apply window, a start job and a result.
- [ ] **Missions together:** invite other pilots to a convoy, a defense or a transport done together (shared reward, roles, what happens
  if one leaves or is lost).
- [ ] **Profile stats follow-ups** (`docs/superpowers/plans/2026-10-27-profile-stats.md`): `flight.seconds` is declared but never
  recorded (no accurate dispatch time is stored); `rescue.called` counts every call, so a pilot who presses "wait" twice counts twice; a
  hot stat that the ranking chooses may move out of the JSON bag into its own indexed column.
- [ ] **Ranking follow-ups** (`docs/superpowers/plans/2026-10-28-global-ranking.md`): no reward for the weekly winners (it would need the
  week frozen at Monday 00:00 Brazil time and kept as history); boards are computed live on every request (cache them for a minute if
  they get heavy); ties go to the earlier-joined pilot. The ship power and speed boards rank a `ShipRating` snapshot that the worker
  refreshes every `SHIP_RATING_INTERVAL_MS` (default 10 min, `jobs/ship-rating.scheduler.ts`); the manual load
  `docker compose exec -T api node dist/admin/cli/ship-rating.cli.js` still works.

### 8. Plasma (branch `v0.2-plasma`)

- [ ] Plasma engines as the end-game target, run by 2x2-4x4 plasma reactors with slow fuel, sold only in far, hard places; map expansion
  to go with it. The branch holds one WIP commit (plasma engine families, shop filter, sim plasma build); not merged.

### 9. Sim and balance tooling

- [ ] Sim four-build baseline rerun on the new defaults: the full `run-parallel.sh` baseline is too slow for a quick check; a chem-only
  smoke (`2 runs × 10 missions × 10 cells`) ran cleanly. Open: the ion build (fixed kit: micro + small ion drives and a nuclear plant)
  still spends ~80% of its income on repair, 20% of it on the reactor, and its reactor wear (~900 points a run) is unexplained;
  Legendary stays out of reach for it.
- [ ] Sim-replay scavenge drift: a handful of recent SCAVENGE rows show `status failed/success` and `wear >0/0` mismatches between the
  game and the sim wrapper (not related to the mining/first-repair changes).

### 10. CI and small items

- [ ] Make the browser smoke a required CI job (remove `continue-on-error` in `.github/workflows/ci.yml`) after seven days of green runs
  (owner decision 2026-10-17; the standing CI rules are in `docs/operations.md` section 9). Not ready: recent runs failed or were cancelled.
- [ ] The guide's first-ship tour is still three steps (shorten if testers say so).
