# To do

The owner's backlog, by priority (P0 first). Items are written as the owner asked for them, with a
note on where the code lives so whoever picks one up can start quickly. Delete an item when it
ships (the commit has the history). Raise questions before starting anything marked *needs design*.

## P0

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

- [ ] **Rare crystals are too hard to find; the board is too weak until a rare ship.** The drop makes
  sense but is too rare, and the mission board is good only until the ship reaches rare. *Needs
  design:* expand the map with harder and longer quests (farther zones) with better drops of rare
  crystals and other rare materials, so the late game has its own content. Related: the economy
  simulation (see below) can measure how long it takes to find the materials the upgrades need.
  *Where:* world builder (`apps/api/prisma/seed-data/world-builder.ts`), mission templates
  (`mission-templates.ts`), drop tables and `economy.core_drops` / mining materials.

- [ ] **Ancient and prototype cores: the UI is bad and they feel like one more thing to manage.**
  The items show no description in the UI, even though the seed has one
  (`seed-data/materials.ts`), so the screen where they are listed is not rendering it. They also
  read as extra inventory to track. *Improve:* show the description and what each core unlocks
  (prototype: rare → epic, ancient: epic → legendary), where it drops and how fragments craft it,
  and show it next to the upgrade that needs it rather than as a loose item. Consider whether the
  separate fragment → core crafting step is worth keeping.

## P1 — CI/CD

- [ ] **Fix the CI/CD and keep it green.** Every push to `develop` must end with the aggregate `CI`
  job green: quality, unit, web, integration (`test:cov` with the coverage thresholds and the
  Prisma migration diff), compose-check, docker-lifecycle, security, oracle-fixtures-fresh and
  browser-smoke. After the 2026-10-14 fixes (heap 8 GB, resolve transaction 30 s, connection pool
  20, repair test flake) the last settled run was green; rapid pushes cancel each other, so
  confirm one full run on the head before calling it done. Watch for: a CI-only failure is
  reproduced with a full local `test:cov` (cross-suite state), after checking for a stray jest
  process; the soak test prints the rejection reasons when it fails; never edit `baselines.json`
  by hand (regenerate it with `tools/oracle/gen_fixtures.py`).

## P2 — Simulations

- [ ] **Check the simulations: is the economy bot simulation feature complete? Run it and get
  insights.** Specs: `docs/superpowers/specs/2026-10-11-economy-bot-simulation-design.md`, plan:
  `docs/superpowers/plans/2026-10-11-economy-bot-simulation-plan.md`, code in `apps/api/sim`. First
  verify it against the plan (what is built, what is missing), then run it and report what it says
  about progression through the bridge rarities and the economy. *Known drift to fix first:* the
  game now has one generic `scrap` material, and the sim still models per-part scrap
  (`scrap_<type>`).

## P3 — Missions

- [ ] **Mission scaling by bridge rarity.** Reward, requirements, fuel and repairs scale with the
  bridge level: requirements follow the capacity growth of each rarity, rewards follow the price
  ladder. Waiting for the simulation's baseline (P2) before building.

## P4

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

- [ ] **Mining animation.** The mining job and its screen need an animation (like the ship scene
  for scavenging / travel). *Where:* `apps/web/src/ui/ActionArt.tsx` (the port action art),
  the mining tab in `port.page.tsx`, and the ship stage in `apps/web/src/ui/ShipStage.tsx`.

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

## P5 — Look and feel

- [ ] **Upgrade the CSS to https://github.com/nutlope/hallmark: investigate first, to choose which
  one will be used.** Today the styles are one hand-written sheet (`apps/web/src/styles/index.css`)
  and the design tokens live in it. The investigation compares what hallmark offers with what the
  game needs (the dark yard look, the rarity colours, the part cards, the popups and the Admin
  screens), what the migration would touch, and what it costs; it ends with a recommendation to
  pick the one to use. No code changes until that is decided.
