# Ship identity: type from the main point + a spider chart (plan, not yet built)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans). Steps use checkbox syntax. This plan is a design + task outline; the first task is a design check with the owner's numbers (see "Open questions"), then the tasks below.

**Goal:** the ship's type names what the ship is MAINLY good at (or says it is balanced only when it really is), and a spider chart on the ship sheet shows its profile at a glance, including a "before/after" ghost when a part is considered.

**Spec:** owner request 2026-11-24 ("ship type is too matching with multipurpose instead of getting the main point; add a spider chart to show some info about the ship"). Depends on the UI kit (slice 1.1). Fits UI slice 1.5 (ship type subtitle + Needs chips): build it there or right after.

## What the code does today (checked 2026-11-24)

- `apps/api/src/ships/ship-class.ts` `deriveShipClass(parts, rules)`: classes `HAULER | TRANSPORT | WARSHIP | MINER | MULTIROLE`.
  Shares are of STRUCTURE COST (everything but the bridge), tested in a fixed order, first match wins:
  cargo share >= 0.30 -> Hauler; pressurized share >= 0.20 -> Transport; weapon+defense share >= 0.45 -> Warship; ANY part with `min > 0` -> Miner; otherwise **Multirole**.
  Thresholds: config `ship_class.{cargo_share, pressurized_share, combat_share}` (defaults 0.3 / 0.2 / 0.45), admin-tunable.
- Why it reads as "multipurpose": (1) the fallback catches every ship below a threshold, and with engines, tanks, a bridge and a little of each, most ships are below all three; (2) it measures what the parts COST, not what the ship CAN DO (a small gun on a cheap hull and a big shield are both weak "combat share" signals; shields/armor/sensors/mobility are not looked at except weapons+defense cost); (3) first match wins: 30% cargo + 60% combat is a Hauler; (4) any single mining part makes a Miner regardless of its weight; (5) no class for fast, sensor or escort builds.
- The class is display-only: no mission or rule reads it (`grep shipClass apps/api/src` finds only the derive, the sheet/profile responses and the sim playstyle). Changing it cannot break gameplay.
- Shown in: ship sheet panel (`apps/web/src/features/hangar/ship-sheet-panel.tsx`, `hangar.classes.*`), the pilot card (`features/profile/pilot-card.tsx`), the prologue sandbox (`sandbox-ship.ts`, fixed `TRANSPORT`).
- The sheet (`ShipSheetSchema`, `packages/contract/src/index.ts:188`) already has the capability stats: `pot` (firepower), `pdf`/`bli`/`esc` (defense: shield esc, armor bli), `sen` (sensors), `crg` (cargo), `min` (mining), `mob` (mobility), `autonomy` (range), `fuelCap`, `hp`, `condition`. There is NO passenger-capacity number on the sheet (only `pressurized` per part).

## Design

1. **Profile = a score 0..1 per axis, computed on the server from the sheet** (single source for the type AND the chart, so they cannot disagree). Axes (7): Cargo (`crg`), Passengers (new, see open question 1), Firepower (`pot`), Defense (`esc` + `bli` x armor pool factor), Mobility (`mob`), Range (`autonomy`), Mining (`min`). Sensors is not an axis (decided).
   Each axis score = `min(1, value / reference)`, where the reference is a **config knob per axis** (`ship_profile.ref_*`: "the value that counts as a full axis"), starting from the strongest value seen in the sim/prod fleets so a good mid-game ship fills about 60 to 70% of its main axis. Admin owns every number.
2. **Type = the main point.** The top-scoring axis names the type (Hauler, Transport, Warship, Miner, plus new Racer (mobility) and Scout (sensors/range) if the owner wants them; defaults: keep the 5 existing names + Racer). It is "Balanced" (rename of Multirole) ONLY when the top axis is below `ship_profile.min_main` (a weak ship) or its lead over the second axis is below `ship_profile.lead_margin`. A strong second axis adds a modifier shown as a second line ("Hauler, armed"). Config: `ship_profile.min_main`, `ship_profile.lead_margin`, `ship_profile.second_min`.
   The old `ship_class.*_share` knobs are removed (migration of the config registry; DB wins, so a migration deletes the stored keys).
3. **Spider chart** (web): a small SVG radar, `ShipRadar` in `apps/web/src/ui/kit/`, props `{ axes: {key, value0to1}[], ghost?: same, label }`. Axis icons + short names around the rim (icons are the kit's), the filled polygon uses the type's colour, the optional ghost polygon (dashed) shows "if I fit this part" (the preview response already returns a sheet/profile for a candidate layout). Accessible: a visually hidden table with the same numbers. 390px: 160 to 200px square; the ship sheet shows it beside the headline tiles on desktop, above them on phone. The pilot card shows a small one.
4. **Where it shows:** ship sheet panel (always), pilot card (small), hover/ghost while placing a part and in the store's compare popup (before/after) as a follow-up.

## Decisions (owner, 2026-11-24) and what is still open

DECIDED: add Racer (mobility); rename Multirole to Balanced; 7 axes (cargo, passengers, firepower, defense, mobility, range, mining; sensors is NOT an axis); add the `pax` passenger-capacity stat to the part catalog and the sheet (migration + seed + admin editor + sheet field + en/pt-BR labels). Types: Hauler, Transport, Warship, Miner, Racer, Balanced. Still open: the reference values per axis (from the real fleet, in Task A) and the exact `pax` numbers per cabin part.

Original questions, for the record:

1. **Passengers axis:** there is no passenger-capacity stat. Either add `pax` to the part catalog/sheet (cabins already exist as pressurized parts; a migration + sheet field) or drop Passengers from the chart and keep Transport as "has a cabin". Recommendation: add `pax` (a missing stat blocks Transport from ever being "the main point").
2. **Which types:** keep Hauler, Transport, Warship, Miner; add Racer and Scout? Rename Multirole to "Balanced"?
3. **How many axes:** 7 (above) or 8 with Sensors.

## Tasks (outline; each its own subagent task with TDD once the questions are answered)

### Task A0: the `pax` stat (first)
- Add a passenger-capacity stat to the part catalog (cabin / pressurized parts), the sheet (`ShipSheetSchema.pax`, sum over installed connected parts), the admin part editor, the seed (family tables, per the parts-catalog rules) and a MIGRATION for prod (the seed only fills empty tables); en + pt-BR labels; the part detail and compare card show it. Tests first: a cabin part adds its `pax` to the sheet, a ship without a cabin has 0, the migration sets values for existing cabin parts. Numbers per cabin tier: owner/sim.

Note (owner, 2026-11-24, TODO item 8): the same task also adds `lifeCap` (people a life-support module keeps alive, scaling with tier and size) and a head count per TRANSPORT mission; the `pax` axis of the chart is the ship's seats. Today a passenger mission checks only the two flags (a pressurized part and a life-support part), so any group fits any ship.

### Task A: the profile on the server
- Files: create `apps/api/src/ships/ship-profile.ts` (+ spec), modify `ship-class.ts` (derive from the profile), `config/game-config.defaults.ts`, `game-rules.schema.ts`, `config-registry.ts` (new knobs with en + pt-BR labels), a migration that drops the old `ship_class.*` rows, `ships.service.ts` (return `profile` next to `shipClass` in the three places that return the sheet), `packages/contract/src/index.ts` (`profile` optional on the ship/preview responses).
- Tests first: a pure-cargo ship is Hauler; a gun-heavy hull with a big shield is Warship; one tiny mining part on a cargo ship is Hauler, not Miner; two equal axes -> Balanced; a weak ship (everything under `min_main`) -> Balanced; lead margin; config changes take effect at once. Check against real prod ships (read-only DB recipe in memory `reference_prod_db_readonly.md`): how many prod ships fall in each type before and after. Sim playstyle (`apps/api/sim/bots/playstyle.ts`) updated if it names the classes.
- Gate: api specs for ships + config; owner sees the before/after type table for the real fleet.

### Task B: the radar component
- Create `apps/web/src/ui/kit/ShipRadar.tsx` (+ spec), CSS in `styles/kit.css`. Tests: N axes draw an N-gon, a value 0 collapses to the centre and 1 touches the rim, the ghost draws a second polygon, the hidden table lists every axis with its percent, a value above 1 is clamped.

### Task C: wire it into the screens and the type label
- Ship sheet panel + pilot card use `profile`; the class row shows type + modifier line; new `hangar.classes.*` and `hangar.profile.*` keys in en AND pt-BR (remove none that are still used); prologue sandbox ship gets a profile; the preview while placing parts passes the candidate profile as the ghost.
- Tests: sheet panel renders the radar and the type; opening shows the radar only if the opening shows the sheet (decide with the tutorial: default hidden in the opening); pt-BR no overflow at 390px.

### Task D: browser check + status
- Isolated stack check at 1280 and 390px with ships of each type; screenshots in `docs/design/game-ui-v0.2/after/`.

## Review Focus
- A ship with no parts but the bridge, and a ship with only one axis > 0: the radar still draws, the type is Balanced (not a crash on a divide).
- An axis value far above its reference (a late-game ship): clamped, the type still stable.
- Config edited in the admin while pilots are online: type and chart change at once, nothing cached stale.
- Existing saved data: the class is derived, not stored (check `Ship` has no stored class column); the profile summary in the pilot card and rankings use the new derivation.
- pt-BR names are short enough for the axis labels at 390px.
