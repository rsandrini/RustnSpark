# To do - v0.1.5

Owner's list for v0.1.5 (planned 2026-11-09 as v0.1.4; v0.1.4 shipped without it, renamed 2026-11-23). Delete an item when it ships.
The order of work and the gates: `docs/superpowers/plans/2026-11-23-v0.1.5-roadmap.md` (card fix, then ALL the UI, then the mission world, then ship damage; the tutorial last or dropped).

## 1. Missions follow the ship's own specialty (transport, escort, delivery, race)

- [ ] The mining rework (v0.1.3 item 8) sets the pattern: a mission's time and difficulty come from the ship's stat that matters for it,
  so a prepared ship does the job faster and a weak one slower, or not at all. Owner will plan each type later. First guesses:
  transport from cargo (a load above the hold needs several trips), escort from firepower and defense, delivery and race from
  mobility (already so). Needs the sim before any change.
- Status 2026-11-26: built (specialty rows for escort, transport, delivery; admin keys `specialty.escort/transport/delivery`), **gate fails: owner's call**.
  Sim gate (balanced, 300 missions, seed 1; baseline `spec1-base` at f95946e0, new `spec1-new` with `sim/edits/specialty-v1.json`; chem and hybrid re-run with 24 runs: `spec1-base24-*` vs `spec1-new24-*`).
  Net credits/h (reward+combat+sales+fuel+repair per game hour), base -> new: chem 37988 -> 37048 (97.5%, 24 runs; 8 runs 99.4%), chem-shield 36572 -> 36856 (100.8%), ion-shield 52416 -> 51814 (98.9%), hybrid 35895 -> 33290 (92.7%, 24 runs; 8 runs 94.3%).
  L2/L3 median day delta: chem -2.7%/-0.4% (24 runs), chem-shield +3.9%/-9.1%, ion-shield +1.0%/+4.3%, hybrid +3.7%/+18.9% (24 runs; 8 runs +12.8%/+15.2%).
  Stalls: base 0 in every build; new 1 chem (seed 7) and 1 hybrid (seed 5), both "nothing takeable ... NOT_ENOUGH_FUEL" (also in the 24-run sets). Failed criteria: hybrid net/h < 95%, hybrid L3 > +10%, two new stalls.
  Mix per run base -> new (24 runs): hybrid ESCORT 36.4 -> 33.8 with its mean time about doubled (16 -> 33), DELIVERY 136.9 -> 133.7; chem ESCORT 28.2 -> 27.0 (time 14 -> 20), DELIVERY 126.2 -> 120.3. TRANSPORT is taken 0 times in every build, base and new (the bots never pick it), so the transport minimum is not exercised by the sim.
  Knob most likely to move it: `specialty.escort.reference` (lower = weaker ships stretch less; `per_danger` and `exponent` next).

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
- Slice 1.7 (juice) built on develop and unit-tested (web suite 1359 tests, tsc, lint, prettier and build clean), NOT checked in a browser yet (the owner reviews later): count-ups on the wallet, the HUD chips and the report credits; a reward moment in the mission result popup; haptics for the main actions with an opt-out in the account menu (default on); explanatory text behind a '?' help tip (9 moved, 8 kept inline because they state a rule, consequence or state). NO sound, by decision. The wallet's e2e helper (`walletOf`) now reads `data-value` (the final amount while the number counts). The e2e specs touching it are economy, a-race, prologue (via `walletOf`), smoke, a11y, keyboard, widths and dialogue (account menu), not run.
- Open: the Port as a place (needs a mockup).
- Owner review round 1 (2026-11-25), built on develop and unit-tested, NOT checked in a browser yet (the owner reviews later). Of the owner's nine points:
  - 1: the part icon is centred in its cell.
  - 2 and 3: the ship sheet has Stats | Profile toggles and a breakdown of the profile, using the server's `profileDetail`.
  - 4 and 5: the store has a list view, a placeholder while loading, no port words, and the part icon in the drawing.
  - 6: repair is one bar to drag (current condition and target together).
  - 8: refuel is one bar plus a chart of the tanks.
  - 9: part lists have no stat sentences; the upgrade tab shows a mini ship with the part highlighted.
  - Deferred follow-ups: real part art (slice 1.9), per-tank fuel from the server (the chart estimates it), and the type-icon group centring uses an estimate. The e2e literals still match (no spec changes needed).

## 5. More missions per port, more mission kinds, a bigger map (owner, 2026-11-23) - *needs design*

Related to item 1 (missions follow the ship's specialty); plan them together. Needs the sim before any number changes.

### 5a. More missions per port, always short and long ones

- **Status (2026-11-25): built in code, sim gate result below; the owner decides the release.** A board now has the 4 core types, at least 2 races, a short and a long offer (planner in `board-composition.ts`; `topUp` and the sim's `boardAt` use it). Board sizes 10/8/6. Measured on the seeded map (25 refreshes per port, every board 10 rows, min per board: 4 core types, 2 races): offers up to 800 / from 4800 distance summed over 25 boards: ceres 99/46, tycho 80/47, gate 68/25, hedus 106/26, marsa 76/26, rennick 59/25, cair 48/25 (25 means one per board). Sim (re-measured 2026-11-26 with the bot's stuck handler: no refuel-to-unlock loop, a hop for work skips ports found empty lately, a fuel reserve of a whole tank before shopping, no tow that adds no fuel, the 3-tow cap counts tows in a row without work; balanced, 24 runs, 300 missions, seed 1, new vs base with the same bot, base = commit 17a9f2c4 in a temporary worktree), operating net credits per game hour (income minus fuel and repair), gate 95%, levels (mean day) gate +10%: **the gate still fails, now on the board, not on bot traps.** chem 95.9% (L2 +6.5%, L3 +11.7%), chem-shield 94.3% (L2 +6.2%, L3 +10.2%), hybrid 99.2% (L2 -7.3%, L3 -7.9%, passes), ion-shield 96.9% (L2 +12.9%, L3 +10.7%). Stalls: new 0, base 3 (chem-shield). ion-shield levels are 11-18% later in every run of the new board (3 gates of 24 runs), so that is the board, not noise. A playtest-calibrated persona (`steady`: pay per hour, trips inside half a tank) was tried and made it worse (ion-shield 89%, L2 +30%); not kept. The playtest data (7 guest pilots, 26 board missions) is too thin for a learned bot. Full report: `.superpowers/sim-bot-report.md`. No game number was tuned. For the balance round: the forced TRANSPORT slot is dead for kits without passenger seats, and the forced long offer usually loses money for the bot (see `sim-diagnosis.md`). Deploy: run migration `20261125120000_board_mix_sizes`, rebuild api AND worker, then re-export the sim snapshot; new knobs `missions.board_core_types`, `board_min_races`, `board_short_max_seconds`, `board_long_min_seconds`, `board_reference_mob`. Open content decision: Ruling 6 (see the slice 2.1 plan).
- [ ] About 4 mission types on every port's board: cargo transport, people transport, escort and mining. Plus at least 2 races, and other
  kinds. So the board limit (10/8/6 today) goes away.
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

- Owner, 2026-11-25: the NEXT version expands the map about 5x, with missions of 8+ hours. Slice 2.1's 'long' threshold (an admin knob, 1 h today) is to be raised with it.
- Owner, 2026-11-25: the far zones / hours-long crossings are NOT part of v0.1.5; they come with the next version's 5x map. Slice 2.2 (5d) builds the route planning and stops on today's map so they scale.

### 5d. Refuel between ports

- [ ] The option to refuel between ports (today the pilot refuels docked at a port).
- Owner, 2026-11-25: slice 2.2 is the LAST slice of v0.1.5 (change requests from testing come first). Rulings: only ports and stations sell fuel (one rule, an Admin list of place types; the map marks places with no fuel); a stop is MANUAL (the ship docks, the pilot refuels/repairs/shops by hand and presses "Continue the trip"; nothing is bought automatically); docked time is real time added to the mission; prices unchanged (today's quote per place); amber at 20% of the tank (Admin knob). Plan: `docs/superpowers/plans/2026-11-25-slice-2-2-route-fuel-planning.md`.

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
