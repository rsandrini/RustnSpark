# To do - v0.2

Owner's list for v0.2 (2026-11-16). Delete an item when it ships. Every item here is *needs design*: plan before building.
Items 1, 2 and 6 lean on the multiplayer work (item 6), so that one comes first or alongside.

## 1. Clan bases (a new type of mission)

- [ ] A clan (a group of friends from the same faction) can claim and build bases.
- A base can be conquered from the pirates, then built up with parts bought at other ports.
- Once built, a base can support repair, store fuel, and so on. Needs a lot of planning yet (what a base offers, its upkeep,
  who may use it, what happens when pirates take it back).
- Depends on all the multiplayer functions (item 6), clans above all.

## 2. War

- [ ] Some places (or parts of the map) are at war with the pirates, and pilots can go there to fight them.
- Like Helldivers: the victories against the pirates add up to a global result. The faction with the most wins conquers the place
  and leads it from then on.
- Pirates attack in some zones and have to be fought off. This raises a lot of war missions for the pilots who want them.
- Open: how a victory is counted, how long a war lasts, what the winning faction gets, what happens to a place that is taken.

## 3. More than one ship

- [ ] A pilot can own several ships: one for racing, one for mining, one for transport, and so on.
- Limit not decided (the owner thinks 3 for now); needs thinking (price of the next hangar slot, upkeep, what moves between ships).
- The pilot can use several ships at the same time, each on its own quests.
- Today the code assumes one ship per pilot (`ships[0]` in the web, one active mission per player in the database), so this touches
  the missions, the hangar, the port and the rescue.

## 4. More than one quest per ship

- [ ] A big ship can take several tasks in one trip: cargo delivery plus cargo delivery, leaving the same port and delivering at
  the same place or at ports along the way. Taking several tasks at once is an option, not a rule.
- Open: how the cargo space is shared, how the route and the time are worked out, what happens when one task fails, how the
  rewards and the wear are split.

## 5. More RPG elements

- [ ] Add RPG elements. With everything from v0.1 and v0.2 in place, the way the NPCs deal with the players can improve too.

## 6. Finish the multiplayer

- [ ] The game must feel live to keep multiplayer working, a truly interactive experience:
  - friends list
  - clans
  - chat with the clan
  - chat with friends
  - trade between players
  - live market
  - live quests and races
  - war (item 2)
- All of this together is what makes the game feel alive; items 1 and 2 depend on it.

## 7. A game-like UI

- [ ] Make the screens feel like a game, not a website: fewer words, custom components instead of default web controls, the ship's
  state in a HUD, contract cards, a star-chart map, pilot card and podium, feedback on every action.
- Plan, decisions and mockups: `docs/design/game-ui-v0.2-plan.md` (mockups in `docs/design/game-ui-v0.2/`). Eight phases, each
  shippable alone; the first is the component kit and the HUD.
- Fixed by the owner: the installed parts on the ship stay as they are today (only a type subtitle is added), and the connection
  ports are shown everywhere a part appears (never abstracted).
- Open: subtitle layout A or B, art direction for parts, sound assets, the Port as a place (needs a mockup).
