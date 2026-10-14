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

- [ ] **Bridges 2×2: Expand/Shrink in the Upgrade tab, and gate ship formats by bridge size.** An epic 1×1 bridge is still
  a small ship; larger bridges are needed so bigger ships can exist. Three 2×2 bridges are already
  in the catalog (owner, 2026-10-13): `bridge_2x2` (COMMON, 10000), `bridge_2x2_uncommon` (18000),
  `bridge_2x2_rare` (32000), all structure 120. EPIC / LEGENDARY 2×2 to add later; **no 4×4 for
  now.** *Why it does nothing today:* ship formats unlock **only by bridge rarity**, so a COMMON
  2×2 unlocks the same formats as the starter 1×1 — and the shop **hides bridges from the UI**:
  `market-panel.tsx:115-118` hard-filters `partClass !== 'BRIDGE'` ("a bridge is not something you
  shop for"), a rule written when the only bridges were the free kit 1×1s. *Design decided
  2026-10-13:* (1) **Size gate** — add `ShipFormat.minBridgeSize Int @default(1)`; a format is
  unlocked only when the installed bridge's `w` **and** `h` are both `>= minBridgeSize` (per-axis).
  Rarity and size stay **orthogonal** (a RARE 1×1 stays small; a COMMON 2×2 is large). Enforce in
  **both** `listFormats()` and `setFormat()` (`apps/api/src/ships/ships.service.ts`, next to the
  `RARITY_ORDER` checks), expose `minBridgeSize` in the contract (`ShipFormatSchema`) and the admin
  `ship-formats` screen (`SHIP_FORMAT_FIELDS`), seed the big formats to size 2 by migration.
  (2) **Shop stays closed to bridges** (revised 2026-10-14, supersedes the "show 2×2s in the shop"
  idea): keep `market-panel.tsx` hiding BRIDGE **and** make sure market listing generation never
  rolls a bridge, so there is no API back door to a 2×2. (3) **Expand / Shrink in the Upgrade tab,
  port only** — the upgrade mechanic is rarity-up-only and requires identical w/h
  (`part-upgrade.service.ts:106`), so size changes are their own operations next to Upgrade.
  **Expand** (1×1 → 2×2, **one rarity level below** the current bridge, so a COMMON 1×1 cannot
  expand until its first upgrade): pays the **full price of the target 2×2, money only, no credit
  for the old bridge**; the old 1×1 is **consumed**; the new 2×2 lands in the **inventory at 100%
  condition** and the ship is left **without a bridge** until the player installs it.
  **Shrink** (2×2 → 1×1, **same rarity**): sells the 2×2 through the normal sell path (`sell_ratio`,
  condition-aware) and buys the 1×1 of that rarity at catalog price, in one transaction. Never
  discount Expand or hand-roll the Shrink refund: with full-price Expand and the market sell path,
  every Expand → Shrink loop is a net money loss. **Format picker is mandatory** whenever the bridge
  changes (Expand install, Shrink, rarity upgrade): the hangar forces a format choice and lists
  **only the formats of the new bridge's own level**, not the whole unlocked history; parts that no
  longer fit are re-seated by auto-layout and the rest go to inventory. **Downswap rule:** a ship
  that is out on a mission cannot change bridge; swapping to a *smaller* bridge while on a bigger
  format is **blocked** with `FORMAT_REQUIRES_BRIDGE` until the pilot moves to an unlocked format,
  no auto-kick. A ship with **no bridge** cannot be dispatched (see the destroyed-bridge item
  above for the viability check). *Naming
  wrinkle:* the upgrade calculator strips the rarity suffix, so `bridge_2x2_*` is its **own**
  upgrade family (`bridge_2x2` → `_uncommon` → `_rare` → `_epic` → `_legendary`) — the future
  EPIC/LEGENDARY 2×2 **must** be named `bridge_2x2_epic` / `bridge_2x2_legendary` or the ladder
  breaks. *Still open:* structure budgets / mass / power / connectors for the 2×2 line, and the
  big format grids themselves (today every format assumes the bridge is one cell at the origin; a
  2×2 bridge covers 4 cells, so format `cells` and auto-layout must treat the footprint as
  multi-cell). *Where:* `apps/api/prisma/schema.prisma` (`ShipFormat`), the two gate methods, the
  contract + admin schema, a migration, the market listing generator, the Upgrade tab (Expand / Shrink), and
  the hangar's mandatory format picker.
  *Built 2026-10-14:* the `minBridgeSize` gate, Expand / Shrink (`bridge-resize.service.ts`,
  `POST /v1/parts/:id/expand|shrink[/quote]`), the Upgrade-tab panel, the 2×2 bridge seed family, and
  the hangar's format picker after a bridge change (remembered per ship in the browser, offers only
  the new bridge's own level). *Still open:* big format grids with a 2×2 footprint, EPIC / LEGENDARY
  2×2 (a LEGENDARY 1×1 cannot expand yet), market listings excluding bridges, and the server-side
  rule that a ship without a bridge cannot be dispatched.

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

### Added 2026-10-14

- [ ] **Enforce the cargo hold for mining (and for any mission that collects cargo).** Today the UI
  shows that a cargo hold is necessary but does not enforce it: a mission or mining run can leave
  with no cargo space and then collects nothing. Block the dispatch / start with a clear error and
  message (no cargo hold, or not enough cargo space) instead of letting the run go empty. *Decide:*
  whether "no hold" is an error or a warning for missions that carry no cargo by design (delivery
  cargo modes min / fixed / open already exist). *Where:* the mining job start, the mission
  dispatch validation, and the matching warning in the web port / hangar screens.

- [ ] **Review the scrap system; it is confusing.** Every part has its own scrap with its own price,
  but upgrades also consume scrap, and it is not clear whether that is the same thing, a random
  piece, or has to come from the same part family being upgraded. Likely simplification: drop
  per-part scrap and use a **single generic scrap** with a low price, used wherever scrap is needed
  (upgrades, selling, crafting). *Decide:* how scavenging and selling a part pay out in generic
  scrap, what the upgrade scrap cost becomes per tier, and the migration of existing player scrap
  (the rarity-specific scrap IDs from the 2026-10-10 migration, `seed-data/materials.ts`, the
  upgrade requirements, `materials.service.ts`). Tuning stays in Admin (DB wins over TS defaults).

- [ ] **Ancient and prototype cores: the UI is bad and they feel like one more thing to manage.**
  The items show no description in the UI, even though the seed has one
  (`seed-data/materials.ts`), so the screen where they are listed is not rendering it. They also
  read as extra inventory to track. *Improve:* show the description and what each core unlocks
  (prototype: rare → epic, ancient: epic → legendary), where it drops and how fragments craft it,
  and show it next to the upgrade that needs it rather than as a loose item. Consider whether the
  separate fragment → core crafting step is worth keeping. Related to the scrap review above.

### Already planned or in progress elsewhere

- **Economy bot simulation** (another agent): `docs/superpowers/specs/2026-10-11-economy-bot-simulation-design.md`
  and `docs/superpowers/plans/2026-10-11-economy-bot-simulation-plan.md`. Its results will calibrate
  the mission scaling by bridge level (reward, requirements, fuel, repairs) described in the
  conversation: requirements follow the capacity growth of each rarity, rewards follow the price
  ladder.
- **Mission scaling by bridge rarity**: waiting for the simulation's baseline before building.
