# To do

The owner's backlog, by priority (P0 first). Items are written as the owner asked for them, with a
note on where the code lives so whoever picks one up can start quickly. Delete an item when it
ships (the commit has the history). Raise questions before starting anything marked *needs design*.

## P1 — CI/CD

- [ ] **Keep the CI/CD green.** Every push to `develop` must end with the aggregate `CI` job
  green: quality, unit, web, integration (`test:cov` with the coverage thresholds and the Prisma
  migration diff), compose-check, docker-lifecycle, security and oracle-fixtures-fresh. State on
  2026-10-14: green on the head (`c6d7341`) after the heap (8 GB), resolve transaction (30 s),
  connection pool (20) and repair-test fixes. *Standing rules:* (1) the **browser smoke does not
  gate the aggregate** (`continue-on-error`), so a red smoke is a real regression that goes
  unnoticed (the far fields broke the map count and the race board for eight commits): read it on
  every run, and promote it to required once it has stayed green for a week (see the comment in
  `.github/workflows/ci.yml`); (2) rapid pushes cancel each other (`cancel-in-progress`), so confirm
  one full run on the head before calling anything done; (3) a CI-only failure is reproduced with a
  full local `test:cov` (cross-suite state), after checking for a stray jest process; the soak
  test prints the rejection reasons when it fails; (4) never edit `baselines.json` by hand
  (regenerate it with `tools/oracle/gen_fixtures.py`).

## P2 — Simulations

- [ ] **Check the simulations: is the economy bot simulation feature complete? Run it and get
  insights.** Specs: `docs/superpowers/specs/2026-10-11-economy-bot-simulation-design.md`, plan:
  `docs/superpowers/plans/2026-10-11-economy-bot-simulation-plan.md`, code in `apps/api/sim`. First
  verify it against the plan (what is built, what is missing), then run it and report what it says
  about progression through the bridge rarities and the economy. *Known drift to fix first:* the
  game now has one generic `scrap` material, and the sim still models per-part scrap
  (`scrap_<type>`); scavenging now picks cheap parts far more often, caps a run at two part finds
  and caps the price of a find by zone (`scavenging.max_part_finds`, `price_weight_power`,
  `find_price_cap`), so measure the value of an average run per zone against a mission's reward. Also measure
  the combat outcome mix with the new rules (`combat.stalemate_by_hull`, `escalation_*`,
  `loss_bridge_wear`): the dev logs had 78% draws before; check that wins, losses and the rate of
  destroyed ships (a lost fight now wears the bridge) are where we want them.

### P2 status — balance round (2026-10-15)

Done: the sim is trustworthy (builds `chem`, `chem-shield`, `ion-shield`, `hybrid`; foot scavenging;
partial repair; idle-part removal; fuel reserve; store schema v2). The economy math (repair grows with
ship value ×33 from tier 1 to 5, reward ×6) drove one config round, applied to the DB by migration
`20261015020000_balance_round_wear_repair_fuel` and to the factory defaults: `repair_factor` 0.62,
`maintenance_per_tier` 60, `fuel_price` 0.65, `wear.base_min/max` 1/1.7, `environment_damage_factor` 1,
`hull_to_condition` 0.3, `pirate_zone_strength` {0.35, 0.5, 0.65, 1.1}. Results (sim experiments
46→47): wear per mission 57–76 → 18–32, repair share of reward 53–69% → 23–44%, stalls 0–2 of 6,
ion L2 day ~17 and L3 day ~35. Rules learned: repair must not go below ~0.6 × part price (the
buy-used/repair/sell exploit floor), so wear is the lever, not a repair price curve.

- [ ] Re-baseline: one full 16-cell run on the new defaults (stored), the reference for what follows.
- [ ] Reward ladder: zone 3 should out-earn zone 1 (today zone 1 pays most and is nearly free).
- [ ] Bot gaps: buy a mining rig when only `MINER` work is on the board; prefer shorter routes when
  fuel-bound.
- [ ] Late game (parked): fusion torch engine + fusion reactor family above nuclear (see GLOSSARY once
  written); needs the early and mid economy to hold first.

**Deferred on purpose (owner): the bigger bridge / starter shield test.** First the game, the sim and
the balance must all work; only then go back to a starter shield with a larger bridge budget.

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
