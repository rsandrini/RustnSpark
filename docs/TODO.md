# To do

The owner's backlog, newest first. Items are written as the owner asked for them, with a note on
where the code lives so whoever picks one up can start quickly. Move an item to "Done" (with the
commit) when it ships. Raise questions before starting anything marked *needs design*.

## Open

### Added 2026-10-12

- [ ] **BUG: an expired mission can still be started.** The mission card shows it as expired (an
  "Expired" label next to the faction, seen on an ACCEPTED starter mission in the My Ship screen)
  but Dispatch still works and the mission runs. Expected: once the offer's time is up it cannot be
  dispatched, the card says so, and the buttons are disabled. *Check both cases:* (1) the **offer
  deadline** (`expiresAt`: the server refuses `accept`/`hold` and dispatch with `MISSION_EXPIRED`,
  `apps/api/src/missions/missions.service.ts` around lines 400-525, so find which path lets an
  already ACCEPTED mission through, for example a mission accepted before it expired whose dispatch
  does not re-check it); (2) the **start deadline** (`deadlineAt`, "start before" shown in the My
  Ship briefing: `transit.startDeadline`), which should block Dispatch and expire the mission when
  it passes. The web card computes the label on render, so it also needs a timer that re-checks
  it (same cause as the progress bar that does not tick). *Where:* `missions.service.ts` (accept,
  dispatch, the expiry flips), `apps/web/src/features/board/mission-card.tsx` (the "Expired"
  label), `apps/web/src/features/transit/transit.page.tsx` (the Dispatch button for an ACCEPTED
  mission). Add a test that dispatching an expired accepted mission returns `MISSION_EXPIRED`.

- [ ] **Review the scavenging drops: they are absurd.** On the first attempt, in a zone 2 region,
  one scavenging run dropped a RARE solar panel AND an uncommon 4x4 nuclear reactor. *What the code
  does today (found by reading it):* the rarity of a find comes from the drop table by zone (RARE
  can drop from zone 2, EPIC and LEGENDARY from zone 3: `scavenging.tier_min_zone`), and then the
  part is picked **uniformly from every catalog part of that rarity**, regardless of its size or
  price (`rollPartFinds` in `apps/api/src/resolution/scavenge/scavenge.resolver.ts`). So a 4x4
  nuclear reactor (base price now 76,400 common and 152,800 uncommon after the repricing) is as
  likely as a small cargo hold, and a run can have up to 4 finds (one, plus extra rolls at the
  place's chance). Together with the guaranteed scrap added on 2026-10-11 this is far too generous
  for an early run. *Needs design:* weight the pick by price / size (cheap and small parts common,
  big and expensive ones very rare), cap the value of one run, make the large and nuclear families
  drop only from the dangerous zones or from quests / mining, and keep the zone 2 outcome useful but
  not game-breaking. Measure with the economy simulation (value of an average run per zone vs the
  reward of a mission) before and after. *Where:* the same resolver, the drop table
  (`DropTable` rows, `scavenging` source), `scavenging.chance`, `tier_min_zone`, `quality_*` in
  `apps/api/src/config/game-config.defaults.ts`, and the catalog pool built in
  `apps/api/src/missions/scavenge-context.ts`.

- [ ] **Scavenging on foot must work without a working ship, and while the ship is being repaired.**
  On foot there is no ship involved (no fuel, no wear, no pirates), so it should be available when
  the ship is broken, empty, not ready to fly, or in the workshop. Today `ScavengeJobService.start`
  refuses it with `SHIP_REPAIRING` when the ship has a pending repair, and requires an idle ship
  at the place (`SHIP_NOT_AT_LOCATION`, `SHIP_NOT_IN_PORT`), even for the on-foot mode. Related to
  the bug above ("scavenging dispatches without a ship"): together they say that **"with the ship"
  needs a ready ship, and "on foot" needs nothing but the pilot being at the place**. *Open points:*
  can the pilot scavenge on foot while the ship is away on a mission (probably yes, it is the pilot
  who searches, but check `ACTIVE_MISSION_EXISTS`), and what ship the job is dispatched with when
  none can fly (the dispatch needs a ship id; the job may need to run on the pilot instead).
  *Where:* `apps/api/src/missions/scavenge-job.service.ts` (`start`, the on-foot branch),
  `dispatch.service.ts` (`onFoot`), and the Scavenging tab in `apps/web/src/features/port/port.page.tsx`
  (the on-foot card must stay enabled). Add tests: on foot with a pending repair, with an empty
  ship, and with a ship that is not viable.

- [ ] **A wiki / game guide.** A place that explains the details of the game: what is the
  difference between defense, armor, shields, hull frames, engines (chemical and ion), batteries,
  reactors, weapons; how rarity, size and the bridge level work; how upgrading works (condition at
  100%, money, scrap / crystals / cores); how fuel, repair, scavenging, mining and missions work;
  what ports, connectors and incorrect ports mean; what each mission type needs. *Needs design:*
  in-game pages (a "Guide" route in the web app, bilingual en + pt-BR, no hard-coded strings) or
  markdown rendered in the app; keep it in sync with the Admin-tunable numbers by reading values
  from the API where it quotes them (for example the repair and upgrade rules), not hard-coding
  them. The part descriptions (`hangar.partClasses`, the part-class help texts) are a starting point.

- [ ] **A simple tutorial for newcomers.** Something short that shows, step by step: how to build a
  ship (place parts, connect them, fix red ports), how to refuel, repair, scavenge and mine, and
  how to get and accept tasks. *Needs design:* an in-game guided flow for a new pilot (a checklist
  that ticks as the pilot does each thing, or a few highlighted steps), shown after onboarding and
  skippable, bilingual (en + pt-BR). It pairs with the starter changes above (a full tank, a short
  first mission) so the first minutes work. It can link to the wiki for details.

- [ ] **BUG: Auto layout does not work.** Reproduce it in the Hangar (what happens: an error, parts
  left out, or a layout that is not ready to fly?) and fix it. *Possible link to check first:* the
  new flight rules (a disconnected part, `PART_DISCONNECTED`, and a connector against a part it does
  not fit, `PORT_INCORRECT`) were added on 2026-10-12, and auto layout only places parts so that
  they reach the bridge (`connectedPartIds` in `apps/api/src/ships/auto-layout.ts`); it does not
  avoid incorrect ports, so it can leave the ship "not ready". Auto layout should aim for a ship
  with no red ports and no disconnected parts when a solution exists, and say which parts it could
  not place correctly when it does not. *Where:* `apps/api/src/ships/auto-layout.ts`, the
  `auto-assemble` endpoint in `apps/api/src/ships/ships.service.ts`, the Auto layout button in
  `apps/web/src/features/hangar/hangar.page.tsx`. Add a regression test with a ship of rolled
  (non-kit) parts.

- [ ] **BUG: "Reset ship" in the admin fails with a 500.** Find the failing request and its server
  error (api container logs), fix it, and add a regression test. *Where to look:* the admin
  player/ship screens in `apps/web/src/admin` and the matching admin endpoints in
  `apps/api/src/admin`; the CLI `apps/api/src/admin/cli/reset-player.cli.ts` is a similar "fresh
  run" flow that works, so compare what it does (starter kit, ship row, layout, parts).

- [ ] **Combat: almost every fight ends in 40 rounds as a draw or a flee; no losses, wins are rare.**
  Investigate why and improve the combat. The round cap is `combat.max_rounds` (40) and the flee
  threshold `combat.retreat_hp_ratio` (0.2). *Start by measuring, not guessing:* from the owner's
  mission logs (`MissionLog.legs` events `combat_win` / `combat_loss` / `combat_draw` / flee, with
  the per-round `rounds` data: roll, DC, hit, damage, shield / armor / hull absorbed) compute the hit
  rate, the damage per hit and per round for the player and the pirate, and how the shield, armor
  cut and armor pool soak the hits. Likely suspects to test: the player's armor and shield absorb
  nearly everything (armor cut + pool + shield regeneration per round), the pirates' firepower
  (`pirate_min_pdf`, strength by zone) is too low to hurt a strong ship while the player's own
  firepower is too low to kill (pirate hp / armor), and fights where neither side can break the
  other run out the 40 rounds. Then decide the fix (damage curve, a soft cap that ends stalemates,
  pirate scaling with the ship's tier or level, a reason for fights to end in a result), simulate it
  in `apps/api/test/unit/resolution/danger-balance.spec.ts`-style runs, and confirm with the
  economy simulation. *Where:* `apps/api/src/resolution/combat/combat.resolver.ts`,
  `resolution/damage/layers.ts`, `resolution/encounter/pirate.generator.ts`, the `combat` and
  `encounter` sections of `game-config.defaults.ts`. *Needs design* once the numbers are in.

- [ ] **Split the Defense items in the shop better.** There are too many kinds of parts under
  Defense (hull frames, armor plates, shields, in five rarities and several sizes), so a part is
  hard to find. Split the class into clearer groups, for example Hull, Armor and Shields, with
  sub-filters (size, rarity) and sorting, in the market and the Hangar's Store tab. The same may
  be worth doing for other crowded classes (weapons, engines). *Needs design:* the groups and
  whether the split is a new part class (`DEFENSE` is one `PartClass` shared by hull frames, armor
  plates and shields, and the wear rules key on it) or only a display grouping. *Where:*
  `apps/web/src/features/hangar/hangar.page.tsx` (store tabs / class chips), the port market in
  `apps/web/src/features/port/port.page.tsx`, the part-class labels (`hangar.partClasses` in the
  i18n files). A display-only grouping is the safe first step.

- [ ] **Destroyed bridge = destroyed ship.** If the bridge is destroyed, the ship is destroyed and
  every part is lost. The pilot then restarts with a **new starter pack** but **keeps the current
  money**. *Needs design:* what destroys a bridge (condition reaching the dead threshold, in a
  fight or by wear) and what happens during a mission; what is kept (credits, materials, history,
  faction, reputation?) and what is lost (installed parts, loose parts, ship); where the new ship
  starts; a clear warning and a report of the loss; and whether a protected state (repair warning,
  a grace period) is needed. Interacts with the Hull Frame tanking hull wear and with a dead part
  cutting connections (a dead bridge is the root of every connection). *Where:* the bridge is
  exempt from the "dead part drops out of the connections" rule today
  (`conductiveCatalog` in `apps/api/src/ships/connectivity.ts`); onboarding creates the starter kit
  (`apps/api/src/players/onboarding.service.ts`, `STARTER_PARTS` in `prisma/seed-data/starter-kit.ts`);
  the reset-player CLI (`apps/api/src/admin/cli/reset-player.cli.ts`) is a similar "fresh run" flow
  that keeps faction and history.

- [ ] **Bridges 2×2 and 4×4 with more structure.** An epic 1×1 bridge is still a small ship; larger
  bridges are needed so bigger ships can exist. *Needs design:* sizes per rarity, structure budgets
  (today 60 / 75 / 120 / 170 / 260 for the five rarities), price, mass, power, connectors, and how
  the ship formats' grids fit them. *Where:* `apps/api/prisma/seed-data/parts.ts` (the `bridge`
  family; sizes are separate families like the other parts), the catalog sync into the dev DB
  (DB wins over the seed), the market and starter kit.

- [ ] **Rare crystals are too hard to find; the board is too weak until a rare ship.** The drop makes
  sense but is too rare, and the mission board is good only until the ship reaches rare. *Needs
  design:* expand the map with harder and longer quests (farther zones) with better drops of rare
  crystals and other rare materials, so the late game has its own content. Related: the economy
  simulation (see below) can measure how long it takes to find the materials the upgrades need.
  *Where:* world builder (`apps/api/prisma/seed-data/world-builder.ts`), mission templates
  (`mission-templates.ts`), drop tables and `economy.core_drops` / mining materials.

- [ ] **Sell a chosen amount of goods, not only "sell all".** The "Your goods" tab in the port needs
  a slider (or amount input) to sell X units of a material. *Where:* `apps/web/src/features/port/
  port.page.tsx` (goods tab); check the materials sell endpoint accepts a quantity
  (`apps/api/src/economy/materials.service.ts`).

- [ ] **Move crafting into a tab of the minerals view.** Craft becomes a tab inside the minerals /
  materials screen instead of its own place. *Where:* the craft cores UI (`.craft-core` in
  `apps/web/src/styles/index.css`, the port page / materials page that renders it).

- [ ] **Mining animation.** The mining job and its screen need an animation (like the ship scene
  for scavenging / travel). *Where:* `apps/web/src/ui/ActionArt.tsx` (the port action art),
  the mining tab in `port.page.tsx`, and the ship stage in `apps/web/src/ui/ShipStage.tsx`.

### Already planned or in progress elsewhere

- **Economy bot simulation** (another agent): `docs/superpowers/specs/2026-10-11-economy-bot-simulation-design.md`
  and `docs/superpowers/plans/2026-10-11-economy-bot-simulation-plan.md`. Its results will calibrate
  the mission scaling by bridge level (reward, requirements, fuel, repairs) described in the
  conversation: requirements follow the capacity growth of each rarity, rewards follow the price
  ladder.
- **Mission scaling by bridge rarity**: waiting for the simulation's baseline before building.

## Done

- 2026-10-12 — A part not connected to the bridge, or with an incorrect port, keeps the ship on the
  ground (blocking problem; saving the layout stays allowed). Upgrades keep the part's ports.

- 2026-10-12 — Scavenging no longer dispatches a "with the ship" mission without a usable ship
  (commit `9e00119`). The start now requires full flight viability (the same gate dispatch uses
  for SCAVENGE); a ship that cannot fly is refused with `SHIP_NOT_VIABLE` and its problems, and
  on-foot keeps no ship-quality restrictions. The web disables the "With the ship" card, falls
  back to on foot, and shows a `scavenge-no-ship` notice.

- 2026-10-12 — A new pilot's fuel tank already starts full (fixed earlier by `264e811`; verified
  live through onboarding + auto-assemble, fuel 300/300). The rescue/ration path keeps its
  deliberate `economy.rescue_fuel_fraction`.

- 2026-10-12 — Fuel indicators are hidden for a pure-ion ship (commit `0b92d6f`). `MissionCard`
  takes an optional `fuelUse` prop; when it is 0 the fuel row, gauge and low-fuel note are
  dropped, and the board/transit pages pass it from the ship sheet.

- 2026-10-12 — The first mission is short and quick (commit `64345e2`). A new tunable,
  `missions.starter_max_distance` (default 600, 0 = off), caps the starter trip and the filler
  now picks the **nearest** safe destination deterministically (falling back to the nearest when
  the cap excludes everything).

- 2026-10-12 — The trip progress bar and the ship on the map tick on their own (commit `6eeec45`).
  `TransitPage` drives progress from the existing `useNow` ticker while a flight is under way and
  the arrival `Countdown`s refetch the active mission on zero; a regression test advances fake
  timers with no interaction and asserts `aria-valuenow` climbs.

- 2026-10-12 — "Rework discard damaged" (commits `6c3dd6d`, `479a3e1`). `economy.sell_min_condition`
  drops 15 → 1, so discard is for genuinely dead parts and ordinary used parts stay sellable.
  `POST /v1/inventory/discard` takes `{ sellScrap }` (default false) and, when set, sells the
  freshly-granted `scrap_<type>` back to the ship's port in the same transaction at its fixed
  price (guarded like any material sale); the response gains `scrapSold`/`credits`. The port
  dialog has a "Sell the scrap" checkbox, on by default.
