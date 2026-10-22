# To do

The owner's backlog, by priority (P0 first). Items are written as the owner asked for them, with a
note on where the code lives so whoever picks one up can start quickly. Delete an item when it
ships (the commit has the history). Raise questions before starting anything marked *needs design*.

## P1 — CI/CD

- [ ] **Keep the CI/CD green.** Every push to `develop` must end with the aggregate `CI` job
  green: quality, unit, web, integration (`test:cov` with the coverage thresholds and the Prisma
  migration diff), compose-check, docker-lifecycle, security and oracle-fixtures-fresh. State on
  2026-10-18: green on the head (`cac994f`), all jobs including the browser smoke. *Standing rules:* (1) the **browser smoke does not
  gate the aggregate** (`continue-on-error`), so a red smoke is a real regression that goes
  unnoticed (the far fields broke the map count and the race board for eight commits): read it on
  every run, and promote it to required once it has stayed green for a week (the last 30 runs are all green, since 2026-10-16; **flip `continue-on-error` on or after 2026-10-24 if it is still green**, owner decision 2026-10-17) (see the comment in
  `.github/workflows/ci.yml`); (2) rapid pushes cancel each other (`cancel-in-progress`), so confirm
  one full run on the head before calling anything done; (3) a CI-only failure is reproduced with a
  full local `test:cov` (cross-suite state), after checking for a stray jest process; the soak
  test prints the rejection reasons when it fails; (4) never edit `baselines.json` by hand
  (regenerate it with `tools/oracle/gen_fixtures.py`).

## Next (owner playtest, 2026-10-22)
- [ ] **Dialogue: slow to appear and wrong moments.** The RPG chat is liked, but: the owner built the ship, followed
  Getting started to the Port for fuel and then to the Missions board, and only there did the guildmaster speak about
  fuel. The scene about the first flight (`first_flight`, trigger `ship_built`, `apps/api/src/dialogue/triggers.ts`)
  should open as soon as the ship is built (on the Ship screen, pointing at the Port tab / Refuel), not later. After the
  fuel step it stopped showing altogether while Getting started kept ticking. Look at: the delays in
  `apps/web/src/features/dialogue/dialogue-host.tsx` (1.5 s settle, 4 s breather between scenes, the server asked only
  every 20 s in `use-dialogue.ts`, so a scene that becomes due waits up to 20 s; refetch on navigation and after a build,
  refuel or accept), the "another popup is open" check, an anchor that is not on the current screen, and whether the
  scene order skips scenes. Add an e2e that follows the owner's path (build, Getting started, refuel, board) and asserts
  each scene appears within a few seconds of its trigger.
- [ ] **Mission card: the route map is far too zoomed out, and the card layout is broken.** The map in the mission card
  shows a huge area: it needs a really close zoom framing the route of the mission (start to end with a little margin),
  like the map screen's trip window. The details layout is also wrong since the giver badge was added: the map, then
  the guildmaster below it, then another column, and the details below all of that. Expected: one tidy layout (map and
  facts side by side, the giver as a small header line, details under them). Files: `apps/web/src/features/board/mission-card.tsx`,
  `mission-row.tsx`, `apps/web/src/ui/RouteMap.tsx`, `apps/web/src/styles/missions.css` and `giver.css`; check at 320 px
  (the widths e2e) and in pt-BR.
- [ ] Upgrades (the upgrade tab, materials, costs): to be discussed with the owner after balance round 5.

## Open

- [ ] Late game (parked): the fusion torch engine and the fusion reactor family above nuclear, and a
  pre-warning before a bridge is destroyed. Needs the early and mid economy to hold first.
- [ ] Playtest the new start (2026-10-18): a new pilot gets 750 credits (the old 200 + a basic shield + a small battery),
  both parts are always on the shelf, and the market tip recommends them. Check on a fresh account whether
  players take them and whether the first fights feel fair; then decide on the bigger-bridge test.
- [ ] Sim (checked 2026-10-20, see `docs/design/sim-report-2026-10-20.md`): the economy is still good. Open: late money piles up
  (wallet 57-340k at Legendary; decide on a sink or a lower top reward), the ion build still spends 54% on repair, and the greedy / safe temperaments
  and `sim-replay` were not run.
- [ ] Watch: the race e2e needs a race offer on the board (run it first on a fresh database, as CI does).

## Planned / follow-ups (owner, 2026-10-20)
- [ ] **Balance, round 5**: the game was too easy and money was quick to farm (owner, 2026-10-20). Sim check
  `docs/design/sim-report-2026-10-22.md`, plan `docs/design/balance-round-5-plan.md`. **Applied 2026-10-22** (reward at
  the top flatter, pirates above parity in zones 2-3, Epic parts x2 and Legendary x3 dearer; migration
  `20261022000000_balance_round_5`). Retest in the sim on the new numbers and tune; Rare must stay comfortable.
- Done 2026-10-20: every credit amount x10 (a fresh database is needed: the seed fills prices only when empty); the pad's
  way back pays a tenth (`missions.short_trip_reward_factor`).

