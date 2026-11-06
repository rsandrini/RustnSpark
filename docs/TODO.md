# To do

The owner's backlog, by priority (P0 first). Items are written as the owner asked for them, with a
note on where the code lives so whoever picks one up can start quickly. Delete an item when it
ships (the commit has the history). Raise questions before starting anything marked *needs design*.

## Bugs to investigate (owner reports, 2026-11-05)

Fixed on `fix/sentry-and-owner-bugs` (2026-11-05), waiting for the owner to confirm on the live server:

- [x] **Mobility reads below 1 but the sheet does not update.** The sheet shows mobility on the display scale (x10), the message
  still said "below 1": the two disagreed. The message now says "below 10" (the limit on the sheet's own scale).
- [x] **A mission that ends while the ship is being assembled threw the unsaved layout away.** The flight watcher now stays put
  while the hangar has unsaved edits and shows "Your flight is over. Save your layout, then read the report." with a Report button.
- [x] **The part card stuck in front of the assembly.** A finger never "leaves" a block, so the hover card stayed. Touch no longer
  opens it, and hover cards are hidden on touch devices.
- [x] **Sentry REACT-3 / REACT-4** (`GET /v1/locations` transaction timeouts): counting offers no longer queues behind a board that
  another request is topping up (it counts what is there), and the top-up transaction has a longer timeout.
- [x] **Sentry REACT-2** (mission resolved twice, unique key on `MissionLog.missionId`): the second worker now skips instead of failing.
- [x] **Sentry REACT-1** (`/v1/health` 503): the failing dependency is now in the log and on the Sentry event. Probably the same slow
  database as REACT-3/4: check the Postgres latency on the server.

Still open:

- [ ] **The phone gets very hot while the game is open** (bug report from the pilot's phone, page `/ship`, pt-BR). The endless
  route/pulse animations are off on phones now; nothing is measured on a device yet. See `docs/design/mobile-performance.md` for the
  inventory and how to measure.
- [ ] The DSNs in the server's `.env.prod` are swapped (`SENTRY_DSN` must be the Node project, `SENTRY_WEB_DSN` the React project).

## To investigate (owner, 2026-11-06)

- [ ] **A long trip with no mission stops after a fight won?** The owner saw a ship sent on a long trip (a travel, not a mission)
  stop when it fought and won. Check if that is true, and where the ship ends up if it does (the stop place must be right).
  The owner's expectation: a trip should only stop when the ship is broken (adrift, dead bridge), not after a victory.
  Look at the leg/travel resolver and what a combat victory does to the remaining legs of a TRAVEL.

- [ ] **The transit screen disagrees with itself after a refresh** (owner, 2026-11-06). The UI showed the ship at one point of
  the trip with its timer. After a refresh the ship was much further back than where it had been shown, and the timer was
  longer than before. The small map then draws the ship in the wrong place, while the big map draws it right but its text is
  wrong: it says the ship is at the start point, not "travelling from X to Y". Check:
  - how the position and the remaining time are worked out on the client (server time offset, `serverNow()`, the leg and
    arrival times) and why a reload gives a different answer than the live view;
  - whether the live view was ahead of the server (a countdown running on the browser's clock, or the poll not keeping up)
    or the refreshed view is behind (position taken from the leg start instead of the elapsed time);
  - the small map (route map in the mission card and the transit page) against the big map, and the text of the big map's
    "where is my ship" line while the ship is in flight.

## Next (owner playtest, 2026-10-22)
- [ ] Upgrades (the upgrade tab, materials, costs): to be discussed with the owner after balance round 6 is playtested.
- [ ] Balance round 6b (applied 2026-10-27 in the defaults and the seed, no migration; the dev DB is reset to take it): wear 0.5/0.85 and hull_to_condition 0.15, Epic/Legendary pay x2.5/x3.25, Legendary parts x8. In the sim (r9/r14) the chem builds reach Legendary at ~150 h; Epic comes at ~70 h (target 90-130 h). Retest after the reset, then tune.

## Open

- [ ] Make the browser smoke a required CI job (remove `continue-on-error` in `.github/workflows/ci.yml`) after seven days of green
  runs counted from the first push with the 2026-10-27 e2e fix (owner decision 2026-10-17). The standing CI rules are in `docs/operations.md` section 9.
- [ ] Late game (parked): the fusion torch engine and the fusion reactor family above nuclear, and a
  pre-warning before a bridge is destroyed. Needs the early and mid economy to hold first.
- [ ] Sim (2026-10-27: aligned with the live game, `sim-replay` 40/40, wear and repair money recorded per part in `part_wear`):
  after the reset re-export the snapshot (`pnpm sim export`) and rerun the four builds on the new defaults. Open: the ion build
  (fixed kit: micro + small ion drives and a nuclear plant) still spends ~80% of its income on repair, 20% of it on the reactor,
  and its reactor wear (~900 points a run) is unexplained; Legendary stays out of reach for it.
- [ ] **Ship-structure damage** (owner idea, 2026-10-27, *needs design*): hull damage today spreads over every part alike, so a
  bridge or a reactor wears like a weapon and the dearest parts drive the repair bill (passive parts are ~30% of it, ~44% on
  ion). The idea: spread damage by the layers of the build, outer parts take more and inner ones (bridge, reactors) less, so the
  layout decides the ship's integrity. The resolver sees no positions, so the dispatch snapshot would carry an exposure per
  part; the sim has no layout model yet. The owner is thinking it over.


## Online mechanics (owner, 2026-10-26) - *needs design*

The game has no player-to-player layer yet. Raise questions before starting any of these; they touch the
board, missions, the worker and the web.

- [ ] **Presence, next phase:** the port shows a count of docked pilots (built 2026-11-02, online or not). Names come with the friends list; "online now" would need a last-seen signal.
- [ ] **Scheduled player races:** a race that starts at a fixed time; pilots apply and wait, then compete against each
  other (today a race is against generated rivals, `resolution/race`). Needs an apply window, a start job and a result.
- [ ] **Missions together:** invite other pilots to a convoy, a defense or a transport done together (shared reward,
  roles, what happens if one leaves or is lost).
- [ ] **Profile stats follow-ups** (built 2026-10-27, `docs/superpowers/plans/2026-10-27-profile-stats.md`): `flight.seconds` is
  never recorded (no accurate dispatch time is stored); `rescue.called` counts every call, so a pilot who presses "wait" twice
  counts twice; a hot stat that the
  ranking chooses may move out of the JSON bag into its own indexed column.
- [ ] **Ranking follow-ups** (built 2026-10-28, `docs/superpowers/plans/2026-10-28-global-ranking.md`): no reward for the weekly
  winners (it would need the week frozen at Monday 00:00 Brazil time and kept as history); boards are computed live on every request
  (cache them for a minute if they get heavy); ties go to the earlier-joined pilot. **Ship power and speed boards** (built
  2026-10-28): they rank a `ShipRating` snapshot (engine thrust and mobility) that the worker refreshes every
  `SHIP_RATING_INTERVAL_MS` (default 10 min, `jobs/ship-rating.scheduler.ts`); the manual load
  `docker compose exec -T api node dist/admin/cli/ship-rating.cli.js` still works.

## Beta close-out and v0.2 (owner, 2026-11-02)
- [ ] **Production setup check** (parked until deployment): bring the `prod` compose profile up on a clean machine and check
  secrets, TLS, backups, the first admin, and that `admin.debug_fast_ops` is off. Set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
  `RESEND_FROM_NAME` and `BUG_REPORT_TO_EMAIL` so tester bug reports (`POST /v1/feedback/bug`) reach the inbox.
- [ ] **CI and push:** nothing is pushed since `7955229`; run the browser smoke on an isolated stack, push, check every CI job.
- [ ] **Blocklist:** review and extend `admin.name_blocklist` (ship names) before the beta; review the `economy.ship_rename_price`.
- [ ] **Friends list**, then names in the port and in presence; the report flow (`/admin/reports`) is built.
- [ ] **Weekly ranking rewards** (see the ranking follow-ups above); an optional pilot list in the port (ship names only).
- [ ] **Scheduled player races** and **missions together** (above): v0.2.
- [ ] **Plasma** (branch `v0.2-plasma`): plasma engines as the end-game target, run by 2x2-4x4 plasma reactors with slow fuel,
  sold only in far, hard places; map expansion to go with it.
- [ ] Mission card: the distance has no unit; the guide's first-ship tour is still three steps (shorten if testers say so).
- [ ] Ranking: the "Fastest race" board per route stays (the pilot card lost its fastest-race line).

## Planned / follow-ups (owner, 2026-10-20)
- [ ] **Balance, round 5**: the game was too easy and money was quick to farm (owner, 2026-10-20). Sim check
  `docs/design/sim-report-2026-10-22.md`, plan `docs/design/balance-round-5-plan.md`. **Applied 2026-10-22** (reward at
  the top flatter, pirates above parity in zones 2-3, Epic parts x2 and Legendary x3 dearer; migration
  `20261022000000_balance_round_5`). Retest in the sim on the new numbers and tune; Rare must stay comfortable.
- Done 2026-10-20: every credit amount x10 (a fresh database is needed: the seed fills prices only when empty); the pad's
  way back pays a tenth (`missions.short_trip_reward_factor`).

