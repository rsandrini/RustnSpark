# To do

The owner's backlog, by priority (P0 first). Items are written as the owner asked for them, with a
note on where the code lives so whoever picks one up can start quickly. Delete an item when it
ships (the commit has the history). Raise questions before starting anything marked *needs design*.

## Bugs to investigate (owner reports, 2026-11-05)

Raised from play and from the in-game bug report. Not looked at yet: reproduce first, then fix.

- [ ] **The phone gets very hot while the game is open** (bug report from the pilot's phone, page `/ship`, pt-BR). Measure what the
  game costs on a phone (CPU, battery, memory) and find the cause: the ship yard svg and its animations, polling (`/missions/active`,
  tutorial progress, dialogue, ship preview), the take-off and wallet animations, re-renders. Compare with the tab in the background.
- [ ] **Mobility reads below 1 but the ship sheet does not update** after swapping or removing parts, even after saving the layout.
  Check that the sheet is refetched and re-derived after `assemble`, and what the preview shows against the saved ship.
- [ ] **A mission that ends while the ship is being assembled redirects the pilot to the report and the unsaved layout changes are
  lost.** The flight watcher (`features/transit/flight-watcher.tsx`) navigates to `/report/:id` from any screen. Do not throw
  away an unsaved edit (ask first, or keep the draft and offer the report as a link).
- [ ] **The part popup on the ship stays fixed in front of the assembly** (maybe already fixed by moving every popup to the page
  body, and the pilot saw a cached build). Verify on a phone after a hard reload.

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

