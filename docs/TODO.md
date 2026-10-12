# To do

The owner's backlog, newest first. Items are written as the owner asked for them, with a note on
where the code lives so whoever picks one up can start quickly. Move an item to "Done" (with the
commit) when it ships. Raise questions before starting anything marked *needs design*.

## Open

### Added 2026-10-12

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

- [ ] **BUG: scavenging dispatches a mission "on ship" without a ship.** The scavenge start does not
  validate that there is a ship to send, and the mission is dispatched anyway. *Likely cause (to
  confirm):* `ScavengeJobService.start` only checks that a `Ship` row exists at the location and
  is idle (`SHIP_NOT_AT_LOCATION`, `SHIP_ON_MISSION`, `SHIP_NOT_IN_PORT`); it has no viability
  gate on purpose ("scavenging is manual work"), so a ship with **no installed parts** (an emptied
  ship, or a ship that lost its parts) still passes and is sent as a "ship" job with an empty
  sheet. Expected: the "with the ship" mode needs a ship with at least a bridge (and parts); with
  no usable ship the only option should be **on foot**, with a clear message in the Scavenging tab.
  Check the web side too (the "with the ship" card should be disabled and explain why).
  *Where:* `apps/api/src/missions/scavenge-job.service.ts` (`start`), the dispatch it calls
  (`dispatch.service.ts`, the `handicapped` rule for SCAVENGE), and the Scavenging tab in
  `apps/web/src/features/port/port.page.tsx`. Add a regression test with a ship that has no
  installed parts.

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

- [ ] **Hide fuel when the ship has no fuel use.** Fuel indicators in quests (the requirement
  checklist and the "fuel needed" bar on the mission card) and on the mission board must be hidden
  when the ship is 100% ion thrust (no chemical engine, so no fuel).
  *Where:* `apps/web/src/features/board/mission-card.tsx` (fuel bar, `fuelHave`/`fuelCap`),
  the board and transit pages that pass them; the ship sheet's `fuelUse` / `fuelCap` say whether
  the ship burns fuel at all.

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

- [ ] **Rework "discard damaged".** Discarding parts at 15% or less is strange. Change it to
  "discard 1% or less" (parts that are basically dead), say on the screen that they will be turned
  into scrap, and add an option to **auto-sell the scrap** (when it is worth something).
  *Where:* `PartsService.discardDamaged` and `economy.sell_min_condition` (15 today) in
  `apps/api/src/parts/parts.service.ts` and the config; the discard button and text in the port
  page; scrap is `scrap_<partType>` materials, sold at their fixed price. Note the discard already
  gives scrap back (`economy.discard_scrap_per_part`).

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
