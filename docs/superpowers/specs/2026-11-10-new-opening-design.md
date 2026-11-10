# A new opening: "the wreck and the rival" (design)

Status: DRAFT for the owner's review. It competes with the earlier idea (a pre-made ship, a fake mission, a ship lost in mission two, then the faction pick). Nothing here is built. Items marked **(call)** are the writer's choice, not the owner's; the owner has not confirmed them.

## Why

Beta testers rejected two things: choosing a faction before they knew what one is, and a multi-step tutorial. They want to fly and do missions first, and learn building later. The reference idea was *Need for Speed Underground*: you race first, the game shows its tone and danger, and only then do the options mean something.

The owner's own read: today's tutorial is short and direct, yet testers still complain. So the fix is the **order and the feeling**, not the length.

## Intent

A short, story-led opening in which the player **flies, races, builds and loses something that matters before they ever meet a menu of choices**. The faction choice arrives at the end as an answer to a question the story asked ("who do you fight the pirates with?"), not as a form at the start.

## The arc

1. **The gift.** The player starts with a ship that has no engine. A friendly, helpful pilot (the **friend**) gives them an old engine, worn but working. The player fits it themselves, on the real ship screen, with the real connector and port rules and autosave.
2. **The race.** A very short race, 3 legs, against the friend (and optionally one or two other pilots). The player sees the contest on the real mission card, map and transit scene. The result is **scripted so the friend wins and the player is close**. The player loses nothing.
3. **First stop.** The player refuels and fits one more part (their pick from a short list **(call)**). The board shows 2 or 3 new offers (**(call)**: a passenger run, a cargo run, another race). The player picks one, so the game feels open. The friend comments on the pick. Two or three short missions follow, depending on what is chosen.
4. **The final mission, fatal.** A dangerous route. Pirates attack. The **friend is killed**. The player survives (scripted, see below).
5. **The rescue screen.** A rescue crew arrives; only the player is alive. A quiet, serious scene, deliberately the opposite of the race. It must carry weight: a full-screen popup with a short description, not a log line.
6. **The port after.** A new character introduces an opportunity: the three powers fight the pirates and the player can fly under one flag. The faction choice is presented as "who do I fight with", with each faction shown through a person, not a form.
7. **A new ship.** The chosen faction gives the player a new ship (the player's own is gone). The player then reaches the **existing tutorial**, which may be revised separately.

## Goals

- The player is flying within about a minute of the first screen, with no faction, no shop, no upgrade, no tab to understand.
- The player has done each core verb once before the opening ends: fit a part, take and dispatch a mission, win or lose a contest, refuel, choose between offers.
- The friend's death gives the rest of the game a reason to fly (fight pirates), and the player should care because the opening has been about the friend.
- The opening reuses the real screens (ship yard, mission card, route map, transit scene, report, dialogue box) with the extras hidden, so the player is learning the real game.

## Non-goals

- No step-by-step lesson screens or checklists. The previous tutorial form is what testers rejected.
- No controls that the real game does not have. In particular **the player does not steer or choose during the fight**; combat resolves on its own, as it does in the real game. The player's real decisions come before the fight: the ship, the parts, the route.
- No mock-up of mining, upgrades, the market, ranks or the other mission types. Those belong to the existing tutorial.
- Not a rewrite of the economy, combat or the existing tutorial.

## Anti-goals (would make this a failure even if it works)

- The opening feels like a slow cutscene the player cannot skip.
- The player is confused about what is scripted and what is real, and so distrusts the real game's results.
- The friend's death feels cheap or arbitrary, so it reads as the game being unfair.
- The faction choice at the end still feels like a form.

## What the player sees: texts and the guide

The story is told through **characters speaking in the game's own dialogue box** (the giver badge with a portrait and name), not popups of instructions. Voice lines are short, spoken, in the world.

- One recurring voice for most of the opening: the **friend** (calls, comments, teaches by doing). **(call)** When the friend dies, the next voice is the rescuer / the port contact.
- A different faction person can speak at the end, so the player has already met a face for each flag when they pick (**call**: the three flag people appear in the port scene, not before).
- The opening explains **why** the player is flying (earn, grow, fight pirates) once, early, in a line from the friend, not as a screen.
- Draft lines exist in the brainstorm session and are placeholders. The owner will write or approve the real wording. All strings are bilingual (en + pt-BR) from the start.

## Scripted versus real

Real: ship screen and fitting rules, mission board and card, the map, dispatch, transit and report screens, the dialogue box.

Scripted: the race result (the friend wins), the death of the friend, the player's survival, and the fact that the player's ship does not carry forward. These are **fixed outcomes**. The builder decides whether the scripted missions run through the real resolver with a seeded outcome, or are played from stored scenes. The result must never depend on luck, and a player must not be able to change it.

## What already exists in the repo and may be reused (observed, not verified in depth)

- A **dialogue system** (`apps/api/src/dialogue/`, `apps/web/src/features/dialogue/`) with scenes, triggers, a per-faction mentor and a giver badge. It is admin-editable.
- **Onboarding** (`apps/api/src/players/onboarding.service.ts`, `apps/web/src/features/onboarding/`): picking a faction sets the home port and gives a starter kit with a full tank. The server refuses a second faction.
- **Ship loss** (`apps/api/src/missions/ship-loss.service.ts`): a destroyed bridge destroys the ship, keeps money, materials, faction and history, and gives a new starter pack at the faction's home port.
- **RACE missions** with generated rival ships, shown on the card (`missions.service.ts`).
- The tutorial card (`features/tutorial/`), steps ticked from what the player did, and the player's `tutorialDone` flag.

The faction is currently chosen **before** a ship exists. This design needs a state where the player has a ship and **no faction yet**; whether that is a real database state or a separate sandbox is left to the builder.

## Constraints

- All player-facing text is bilingual (en + pt-BR); no hard-coded strings (project language policy).
- Tunable data (the friend's lines, offers, race length) belongs in admin-editable config, per the project's tuning policy, where it is reasonable to do so.
- The opening works on a phone as well as desktop.
- Existing accounts and the current onboarding keep working. The new opening applies to **new** accounts; the owner said prod will be reset, so no migration of existing players is required.
- Work is committed on `develop` only (see `CLAUDE.md`).

## Left to the builder

The data model for the no-faction ship state, how scripted missions are run, how the dialogue scenes are authored, the exact race length and rival stats, art for the portraits, the rescue popup's layout, and how the existing tutorial is entered after the new ship.

## Decisions from the owner (2026-11-10)

1. **Skippable, with a big warning.** The opening can be skipped, but skipping shows a BIG, unmissable warning that the opening matters for first-time players and they should follow it. The warning is part of the design, not polish. A returning tester or second account can still skip.
2. **The friend is gone for good.** The death is final: no return, no memory, no ship or wreck later. The friend does not appear again.
3. **The player keeps the credits.** The amount the normal game starts a player with is **aligned to the amount a player ends the opening with**, so a player who skips has exactly the same money as one who played it. Consequence: the opening's earnings must be **fixed and known** (scripted payouts), so the normal start can be set to the same number. If the opening's payouts change, the normal start changes with it; the builder should keep both in one config value.
4. **The friend is a free pilot.** Not tied to any faction, so no flag is favoured when the player chooses at the end.

## Still open

Nothing the owner has flagged. The "left to the builder" list above stands.
