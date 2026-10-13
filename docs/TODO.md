# To do

The owner's backlog, newest first. Items are written as the owner asked for them, with a note on
where the code lives so whoever picks one up can start quickly. Move an item to "Done" (with the
commit) when it ships. Raise questions before starting anything marked *needs design*.

## Open

### Added 2026-10-12

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
  bridges are needed so bigger ships can exist. A COMMON `bridge_2x2` (2×2, 120 structure, base
  price 10000) already exists in the catalog and is buyable in the shop (it rolls onto the shelf
  like any catalog part), but **ship formats still unlock only by bridge rarity**, so the 2×2 buys
  nothing new today. *Design decided 2026-10-13:* gate ship formats by **bridge size in addition
  to rarity** — add `ShipFormat.minBridgeSize Int @default(1)` (per-axis: a format is unlocked only
  when the installed bridge's `w` **and** `h` are both `>= minBridgeSize`; a 2×2 bridge has
  footprint 2, so big formats get `minBridgeSize: 2`). Keep rarity and size as two **orthogonal**
  axes (a RARE 1×1 stays small; the 2×2 is COMMON but large). Enforce the gate in **both**
  `listFormats()` and `setFormat()` (`apps/api/src/ships/ships.service.ts`, alongside the existing
  `RARITY_ORDER` / `minRarity` checks), expose `minBridgeSize` in the contract
  (`ShipFormatSchema` in `packages/contract/src`) and in the admin `ship-formats` screen
  (`SHIP_FORMAT_FIELDS` in `apps/api/src/admin/tuning/entity-schemas.ts`), and seed the big formats
  to size 2 by migration. **Downswap rule (decided):** swapping to a *smaller* bridge while the
  ship sits on a bigger format is **blocked** with a clear error (e.g. `FORMAT_REQUIRES_BRIDGE`)
  until the pilot moves to an unlocked format — least surprising; no auto-kick. Still open: sizes
  per rarity, structure budgets (today 60 / 75 / 120 / 170 / 260 for the five rarities), price,
  mass, power, connectors, and the 4×4. *Where:* `apps/api/prisma/schema.prisma` (`ShipFormat`),
  the two gate methods above, the contract + admin schema, a migration, and
  `apps/api/prisma/seed-data/parts.ts` / the catalog sync (DB wins over the seed) for the bridge
  parts themselves.

- [ ] **Admin parts browser: filters that stick, selectable columns, search + sort, comparison
  charts.** The tuning list screen is too weak to actually work with the catalog: (1) **filters and
  search reset after every save** — they live in `useState` in `EntityScreen.tsx` and the screen
  *unmounts* while the form is open, so returning remounts empty (`admin-routes.tsx` routes
  `:new`/`:id`/`:id/clone` to a separate `EntityFormScreen` that navigates back with no query
  string). *Fix:* move filters/search into URL search params (`useSearchParams`, precedent
  `board.page.tsx`), and carry `location.search` when the form navigates back. (2) **No column
  selection** — the list hardcodes 5 columns (`LIST_COLUMNS`, first 5 visible schema fields minus
  `active`), so part attributes can't be compared side by side; make the column set choosable from
  the schema's visible fields and persist it in the same URL params (e.g. `?cols=w,h,mass,pot`).
  (3) **Search is a raw `JSON.stringify(row)` substring match with no sorting** — replace with a
  localized name search (`pickLocalized(row.displayName)`, comparator-map sorting, clickable
  headers; copy the `market-panel.tsx` `SortKey`/`useMemo` pattern). (4) **Comparison chart**: let
  the admin tick rows and compare selected parts — either all engines of a rarity, or one part
  across rarities — plotting the chosen numeric fields. No chart lib exists in the repo today; first
  ship a comparison **table** (model on `part-detail.tsx` stat-compare tables), then a small chart
  (recharts, or hand-rolled SVG bars like `GridCellsPreview`) gated to `entityName === 'parts'`
  the same way `PART_SECTIONS` / `MANUAL_SAVE_ENTITIES` already specialize parts. Stats/labels
  already exist under `parts.stat.*` i18n. *Where:* `apps/web/src/admin/tuning/EntityScreen.tsx`
  (filters, columns, search, sort), `EntityFormScreen.tsx` (preserve search on navigate-back),
  `entity-screen.spec.tsx` (regression: filters survive a save round-trip), and a new compare
  component beside `part-detail.tsx`'s compare tables.

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

- 2026-10-12 — An expired accepted mission can no longer be dispatched (commit `3dd8a9a`).
  `DispatchService.dispatch` re-checks both the offer deadline (`expiresAt`) and the mission's own
  start deadline (`deadlineAt`) before flying and rejects with `MISSION_EXPIRED` (the accept path
  already refused them; dispatch was the path that let a stale ACCEPTED mission through). On the
  web the transit page disables the Dispatch button and shows the reason once either deadline
  passes, and the board's mission card ticks so an offer that expires while the board is open
  flips to its "Expired" state on its own.

- 2026-10-12 — On-foot scavenging works without a working ship and while the ship is being
  repaired (commit `8574331`). "On foot" skips the ship-state gates that "with the ship" keeps
  (`SHIP_REPAIRING`, `SHIP_NOT_IN_PORT`, `SHIP_NOT_AT_LOCATION`): it needs only the pilot being at
  the place. "With the ship" still requires a ready, in-port ship at the place. The port's
  Scavenging tab falls back to foot mode with a reason when the ship is under repair (as it already
  did when the ship cannot fly), and the on-foot card stays enabled in every one of those cases.

- 2026-10-13 — "Reset ship" in the admin no longer fails with a 500 (commit `aab5bd2`). The admin
  resetting their own account (caller playerId = target) wiped the in-flight IdempotencyKey row, so
  the interceptor's post-commit update missed it (P2025). Reset's wipe now skips the pending row,
  and `complete()` recreates the row on P2025 as a safety net. Also fixed the worker boot (a
  pre-existing DI gap since `6c3dd6d`: `PartsService` grew a `PricingService` dep that `JobsModule`
  never registered).
