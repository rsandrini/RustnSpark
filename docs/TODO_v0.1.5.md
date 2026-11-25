# To do - v0.1.5

Owner's list for v0.1.5 (planned 2026-11-09 as v0.1.4; v0.1.4 shipped without it, renamed 2026-11-23). Delete an item when it ships.
The order of work and the gates: `docs/superpowers/plans/2026-11-23-v0.1.5-roadmap.md` (card fix, then ALL the UI, then the mission world, then ship damage; the tutorial last or dropped).

## 1. Missions follow the ship's own specialty (transport, escort, delivery, race)

- [ ] The mining rework (v0.1.3 item 8) sets the pattern: a mission's time and difficulty come from the ship's stat that matters for it,
  so a prepared ship does the job faster and a weak one slower, or not at all. Owner will plan each type later. First guesses:
  transport from cargo (a load above the hold needs several trips), escort from firepower and defense, delivery and race from
  mobility (already so). Needs the sim before any change.

## 3. The real tutorial hides things on the first flights (owner, 2026-11-10; moved from v0.1.3 item 10)

- [ ] The guided tutorial (the one after the faction pick) can hide information on the first flights: the "Your ship needs" note, the ship
  sheet, and the "your starter kit" text. They show up later, after the first flights.
- The first ship can arrive PRE-MOUNTED: the pilot adds only the last parts and completes it.
- Related to the new opening: decide together how much the opening and the first minutes of the real tutorial overlap.

## 4. A game-like UI (moved from v0.2; no sound in this version; the art for the parts is the last task)

- [ ] Make the screens feel like a game, not a website: fewer words, custom components instead of default web controls, the ship's
  state in a HUD, contract cards, a star-chart map, pilot card and podium, feedback on every action.
- Plan, decisions and mockups: `docs/design/game-ui-v0.2-plan.md` (mockups in `docs/design/game-ui-v0.2/`). Eight phases, each
  shippable alone; the first is the component kit and the HUD.
- Fixed by the owner: the installed parts on the ship stay as they are today (only a type subtitle is added), and the connection
  ports are shown everywhere a part appears (never abstracted).
- Decided 2026-11-23: subtitle layout B (icon + type row inside the cell, below the connector band). No sound. The art for the parts is the last task.
- Slice 1.1 HUD built: fuel, hull and cargo gauges under the top bar (a compact row on a phone); the wallet stays in the account menu.
- Slice 1.1 (kit and HUD) built on branch feat/ui-slice-1-1-kit-and-hud, verified in a browser: HUD and chips render at 1240 and 390 px, but axe flags the HUD as outside a landmark (region) on every screen; the other e2e failures also fail on develop.
- Slice 1.2 (ports first-class) built on develop, verified in a browser at 1280 and 390 px: port diagram, verdict, Fits my free ports, icon tabs, ports legend, tray chips and the placement ghost all render with no horizontal scroll; the red ghost edge was not reproduced (starter parts all join) and an empty ship shows No fit on every tray row; the a11y, widths pt-BR and phone prologue-race e2e failures also fail before 1.2.
- Slice 1.3 (contracts) built on develop, verified in a browser at 1280 and 390 px (en and pt-BR): contract cards with a faction ring, risk pips, big reward and one action; icon type tabs with counts; red blocker chips whose links land on the Store with the class preselected (or the Ship tab); the ship's faults told once; the taken mission keeps its tag, status and countdown; no horizontal scroll. Browser-found fixes: the sender name no longer squashes in the half-width desktop card, the store link works from the board, the countdown stays on a phone. Known: a card's chips repeat the ship faults line (as in the mockup); the board shifts a little while it loads (CLS about 0.19 desktop); e2e failures a11y, widths pt-BR, phone prologue-race x2, smoke (report popup) and the admin giver specs (admin sign-in) are not in the board flows.
- Slice 1.4 (the map) built on develop, verified in a browser at 1280 and 390 px (touch emulation): faction territories with labels (free places none), fuel-range halos from what is in the tank (full, half, low, and a pure-ion ship with unlimited range; places out of reach dimmed with a mark), legend chips that toggle the range and planned-trip layers and wrap on a phone, the pilots-anchored badge, a bottom sheet per place (name, faction, contracts link, time, fuel, risk pips with a word, Plan trip, Details) with an animated route preview, the fuel-short case (red chip to Refuel, Plan trip off with a reason), Escape and focus, the Places drawer with search, pinch and drag, and the flight path, ship marker, planned trips, quest tips and tow route unchanged. Browser-found fixes: the tall sheet no longer sits under the Places button; on a phone the camera aims at the free strip above the sheet so the chosen place is not under it; the legend chips are thumb-sized on a phone. Known: on a 667 px tall phone the sheet leaves little map; while adrift the sheet still draws a preview from the last port; the cold-load shift of the shell (CLS about 0.13 desktop) is not the map's; e2e failures a11y (report popup), widths pt-BR (ship name link 25px), smoke, phone prologue-race and the admin giver specs are not in the map flows.
- Slice 1.5 (part type subtitle, needs chips, empty-slot hints) built on develop and unit-tested (web suite 1180 passing, lint, prettier and build clean), NOT checked in a browser yet (the owner reviews later): part type row (icon + name) in the tray, store and part popup; the ship needs as chips that lead to the part; dashed empty-slot hints on the ship where a needed part could go (docked in port only, at most 3). The only e2e spec touching it is tutorial.spec (updated to No shield).
- Slice 1.6 (pilot card and rankings podium) built on develop and unit-tested (web suite 1241 tests, tsc, lint, prettier and build clean), NOT checked in a browser yet (the owner reviews later): the pilot card as an ID card (avatar, ship and radar, big numbers); the profile page opens with the pilot's own card; the rankings as a podium with the pilot's own place and the gap to the pilot ahead; icon tabs for the boards and a segmented period toggle. The e2e specs touching it are rankings.spec (updated), profile-stats.spec, a11y.spec, widths.spec and smoke.spec (not run). NOT built: the rank/XP bar and the medals from the mockup (no such system exists: they need game design).
- Open: the Port as a place (needs a mockup).

## 5. More missions per port, more mission kinds, a bigger map (owner, 2026-11-23) - *needs design*

Related to item 1 (missions follow the ship's specialty); plan them together. Needs the sim before any number changes.

### 5a. More missions per port, always short and long ones

- [ ] About 4 mission types on every port's board: cargo transport, people transport, escort and mining. Plus at least 2 races, and other
  kinds. So the board limit (8 today) goes away.
- [ ] Rethink and balance the offers so a port always has short missions (the shortest routes around the place) and long ones (some hours
  of mission).

### 5b. New mission subtypes

- [ ] **Tank cargo** (decided 2026-11-23): a new separate cargo-tank part family, with tank kinds water, chemicals and fuel (fuel carried as cargo is not consumed by the ship). Missions to carry them; each needs a tank of its kind.
- [ ] **Explore a region:** needs a radar on the ship.
- [ ] **Fight in a zone** (decided 2026-11-23): waves of pirates with a target; a score is kept and a partial result that reaches the target is still a victory. Seed of the v0.2 War idea (factions conquering zones): for now only the fight, no faction points.
- [ ] **Repair something:** may need a specialized tool fitted on the ship.
- [ ] Others of the same kind (each subtype asks for the part that fits it, like mining asks for a drill).

### 5c. Review the map distances

- [ ] Make zones with really long distances, hours to cross between ports, so bigger tanks are worth having and can be validated.
  The initial zone stays as it is (or with small adjustments).

### 5d. Refuel between ports

- [ ] The option to refuel between ports (today the pilot refuels docked at a port).

## 6. The ship's type names its main point, and a spider chart shows its profile (owner, 2026-11-24)

- [ ] The type is too often "Multirole" (the fallback when no cost share reaches a threshold: cargo 30%, cabin 20%, combat 45%; any
  one mining part makes a Miner). Make it name what the ship is mainly good at, and call it balanced only when it really is.
- [ ] A spider (radar) chart on the ship sheet (and a small one on the pilot card): cargo, passengers, firepower, defense, mobility,
  range, mining (sensors maybe), with a before/after ghost when a part is considered.
- Decided 2026-11-24: add the Racer type, rename Multirole to Balanced, 7 axes (cargo, passengers, firepower, defense, mobility, range, mining), add a passenger-capacity stat (`pax`) to the cabin parts and the sheet.
- Plan (tasks and what is still open: axis reference values, `pax` numbers): `docs/superpowers/plans/2026-11-24-ship-identity-and-spider-chart.md`.
  Best built with UI slice 1.5 (type subtitle and Needs chips).
- Built on develop (2026-11-25) and unit-tested (api unit 1778 passing, web 1203 passing, tsc, lint, prettier and build clean), NOT checked in a browser yet (the owner reviews later): types by main point incl. Racer and Balanced, the 7-axis spider chart on the ship sheet and a small one on the pilot card, `pax` on cabin parts and the sheet. Reference values: `docs/balance/ship-profile-references.md`.
- Deploy notes for the owner:
  - Run the two migrations: `20261124120000_part_pax_and_life_capacity` and `20261124130000_ship_profile_replaces_ship_class` (the second replaces the `ship_class.*` config keys with `ship_profile.*`).
  - Rebuild the api AND the worker (missions resolve in the worker).
  - Review the new admin knobs: `ship_profile.*` (the refs, `min_total`, `min_share`, `lead_margin`, `second_share`, `second_min`, `racer_min`), `missions.transport_passengers_min/max`, `missions.transport_pay_per_extra_passenger`, and the part editor fields `pax` and `lifeCap`.
  - Average transport pay is up about 25% (head count 1-6, +10% per extra passenger). The sim re-check is still needed; it was not rebalanced.
  - The integration specs (`dispatch.int-spec`, `contract.int-spec`, `parts-ships.int-spec`, `profile-stats.int-spec`) and the migration SQL were NEVER run (they need the docker stack): run them before deploying.
  - `apps/api/sim-data/snapshot.json` still holds the old ship_class rules: re-run the snapshot export when refreshing the sims.

## 7. The map badge shows the pilots anchored at a place, not the missions (owner, 2026-11-24)

- [x] Done in UI slice 1.4: the badge on each place counts the pilots anchored (docked) there, hidden at 0; the mission count stays in the place sheet. (Was: the number counted the missions on offer.)
- Small, web only: the server already sends `pilotCount` per place (`apps/api/src/world/world.service.ts`, distinct pilots with a
  docked ship, suspended accounts excluded) and the place dialog already shows it. Change the badge in `apps/web/src/features/map/map.page.tsx`
  (`miss-badge`, near line 587) to `pilotCount`, its tooltip (`map.missionsHere` becomes a pilots-here text, en AND pt-BR), and the map specs.
  The mission count stays in the place dialog. Do it with UI slice 1.4 (the map).
- Decide: hide the badge at 0 (as today), and whether the pilot's own ship counts (it does today: it is docked there).

## 8. People transport has no capacity: one small life support carries any number of passengers (owner, 2026-11-24)

- [ ] Confirmed in the code (2026-11-24): a TRANSPORT mission only checks two yes/no flags, a pressurized part AND a life-support part
  installed (`missionRequirementChecklist`, `apps/api/src/missions/requirements.checker.ts`; `pressurized` and `lifeSupport` are
  booleans in the part's `specialProp`). A mission carries no number of people, a cabin has no seats, and a life-support module
  has no limit, so the smallest of each moves any group. The same two flags also gate flying (`viability.ts`).
- Design: a mission carries a head count (like the delivery `cargo` hint); a cabin gives seats (`pax`, the same new stat as the spider
  chart, item 6); a life-support module gives a capacity (`lifeCap`: how many people it keeps alive) that scales with tier and
  size, and costs power in proportion. A ship takes the job when `pax >= people` AND `lifeCap >= people`; the blocker chip says
  which one is short. Bigger groups pay more, per person, and take the board's short/long mix into account (item 5a).
- Needs: the generator (`apps/api/src/missions/generator`), the checker and its blocker reasons (en AND pt-BR), the part catalog
  (`pax`, `lifeCap` on cabin and life-support parts, seed + MIGRATION for prod + admin editor), the prologue sandbox (its passenger
  job), the sim for pay per person. Existing accepted/flying TRANSPORT missions must keep working (default head count when none is stored).
- Plan: with item 6's task A0 (the `pax` stat); see `docs/superpowers/plans/2026-11-24-ship-identity-and-spider-chart.md`.
- Built on develop (2026-11-25) and unit-tested, NOT checked in a browser yet (the owner reviews later): `pax` and `lifeCap` on the parts (seed, migration, admin editor), a head count on TRANSPORT missions (`missions.transport_passengers_min/max`, default when none is stored), the checker needing `pax >= people` and `lifeCap >= people` with blocker chips in en and pt-BR, pay +10% per extra passenger. Deploy notes: see item 6.

## 9. Hard mode: start with no flag, no money, no ship (owner, 2026-11-24) - *needs a plan*

- [ ] A pilot can start WITHOUT a faction to fight for. This is the hard mode. It starts with no money and no kit: everything is
  collected from scrap (scavenging), and the pilot picks the start point among "safe" places. Once enough is collected to mount a
  ship, it was built without any help, and the pilot pays the price as a neutral, not as a friend of a faction.
- Written as "0.1.4" in the request; v0.1.4 already shipped, so it is filed on the open list (v0.1.5) and flagged *needs plan*. Consider
  v0.2: it touches onboarding, the economy and the factions at once.
- What exists today (checked 2026-11-24): onboarding picks a faction and creates the pilot with `start_credits` and the starter kit
  (`onboarding.service.ts`: `starter_parts`, start fuel); a `free` faction already exists (the mentor NPCs belong to it); prices
  apply the player's faction relation to the place's faction (`pricing.service.ts`, `relationOf(...)`), so "neutral" can be a
  relation of its own; scavenging exists (scrap, drops) and scrap sells at a fixed price everywhere.
- To plan: how a pilot with no ship and no money moves and earns (scavenge on foot? from a start station?); the list of "safe"
  start places and how the pilot picks one; how much scrap buys the first ship (a minimum viable ship by the part catalog) and
  whether a cheap used hull is sold; the neutral price relation (worse prices and what else); whether the pilot can join a faction
  later and how; the guide and the opening for this mode; ranking (a separate board or the same); the sim to tune the scrap economy.
- Open question for the owner: is "start with nothing" a choice on the faction screen (a fourth card) or a separate "hard mode" switch?

## 10. Turn old parts into scrap, with a chance of more scrap by health and quality (owner, 2026-11-25)

- [ ] An option to transform old parts into scrap (a "scrap it" action next to sell). The scrap yield has a CHANCE of extra pieces that
  depends on the part's health (condition) and its quality (rarity): a healthy rare part gives more than a worn common one.
- What exists today (checked 2026-11-25): "discard" (`parts.service.ts` ~210-250) destroys parts that are below `economy.sell_min_condition`
  (default 15%: the ones no port will buy) and gives a FIXED `economy.discard_scrap_per_part` (default 1) generic `scrap` per part
  (it can sell that scrap at once with `sellScrap`). Scrap is also found by scavenging (`scrap_min`/`scrap_max`, `scrap_share`) and used
  by repair (`repair_points_per_scrap`, `repair_scrap_max`) and by upgrades (money + scrap/crystals/cores); `scrapValue` is a column
  of the part catalog. So the new action extends "discard": any part (not only the dead ones), a yield formula, a random extra.
- To decide in its plan: which parts can be scrapped (any in the hold? installed ones are not); the formula (e.g. base by rarity
  tier + a share of the catalog `scrapValue`, times the condition fraction, plus a chance roll for +1..N scrap that grows with condition
  and rarity); whether the pilot sees the odds before confirming (a preview of the min/max); whether the yield could ever beat the sell
  price (it should not: selling must stay the better deal for a healthy part, scrapping for a worn one); config knobs in the admin
  (`economy.scrap_*`), the idempotent API action and its report/ledger entry, the UI (a button on the part row/popup with a confirm
  that names the odds), the sim (scrap supply) and the guide text. Plan before building.

## Bugs found testing v0.1.4 in prod

- [ ] (the owner will add them here as they are found; each ships in v0.1.5, or as a `v0.1.4b` hotfix if it blocks play)
