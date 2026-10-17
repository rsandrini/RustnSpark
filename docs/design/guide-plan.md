# In-game Guide (the wiki) (built; decisions answered by the owner)

From `docs/TODO.md`: a place that explains the game's mechanics (defense / armor / shields / hull, engines, batteries,
weapons, rarity, size, bridge level, upgrading, fuel, repair, scavenging, mining, missions, ports and connectors).

## Decisions (owner, 2026-10-17)
1. **In-game components with live numbers** (not markdown): figures the Admin can tune are read from the API.
2. **All nine topics in v1.**
3. **Reached from the account menu** ("Guide"), plus links from the tutorial's last line and, later, from screens.
4. **Search** (new request): one box that finds a topic, a mechanic, or a part by its name, from anywhere in the Guide.

## Shape
- `/guide` (and `/guide/:topic`): a topic list on the left (a list first on phones), one topic on the right.
- A **search box** at the top of the list: type "shield", "rarity", "Small Fuel Tank" and see topics and parts that match
  (topics by title, keywords and body text; parts by name from the catalog the game already serves). Picking a part
  result opens the topic that explains its class, with that part's own card shown; picking a topic opens it. Works
  in English and Portuguese (it searches the text of the language on screen).
- Topics (each a small component: short text, a few live figures, links to the matching screens):
  run, parts, ports (connectors), rarity (rarity, size, bridge level), missions, fuel (fuel, repair, wear),
  upgrading, work (scavenging, mining), danger (risk, factions, zones, money).
- **Live numbers:** new `GET /v1/guide/rules` returns a curated set of player-facing figures (fuel price, repair scrap and
  time, sell ratio, rescue cost, upgrade price markups and materials, scavenging and mining durations, combat shield
  regen and armor, spare slots, ship tier thresholds). No new tunables; it only reads the config the game already uses.
  Texts quote values through placeholders, never typed-in numbers.
- All strings in `en` and `pt-BR`.

## Steps
| step | what |
|---|---|
| G1 *(done)* | API: `GET /v1/guide/rules`, contract schema, integration and contract tests |
| G2 *(done)* | Web: `/guide` route, topic list, topic page frame, account-menu entry, `guide.css`, topics 1 and 2 (run, parts) |
| G3 *(done)* | Search: index of topics (title, keywords, body) plus the parts catalog, result list, keyboard handling |
| G4 *(done)* | Topics 3 to 9 with their live figures |
| G5 *(done)* | Links (tutorial last line, a "Learn more" link on a few screens), en and pt-BR check, specs, e2e, width pass |
