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

## Bugs found testing v0.1.4 in prod

- [ ] (the owner will add them here as they are found; each ships in v0.1.5, or as a `v0.1.4b` hotfix if it blocks play)
