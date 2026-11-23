# Game UI plan for v0.2: from a website to a game

Status: **proposal, owner-reviewed on 2026-11-21 (decisions in section 2). Not built.**
Scope: the whole game screens, **admin excluded**. Mockups: `docs/design/game-ui-v0.2/mockups/` (HTML and PNG, six boards).
Evidence: `docs/design/game-ui-v0.2/before/` (desktop captures of today's screens, a fresh Luna guest on the dev stack).

## 1. The problem

The owner's read: the game uses too much text and too many explanations, and too many default web components. It is a game, so the
screens need their own components.

What the audit found (details in the captures):

1. **Sentences where a symbol would do.** Port opens with a four-line "Your ship needs" list (a sentence plus a "Show parts" button
   per line). Missions says the same problem three times (banner, bullet list, empty state). Faction cards are three paragraphs.
2. **Stock web controls.** Sort dropdowns, underlined text tabs, rows of grey filter pills (15 in the Port), plain bordered cards.
3. **Every screen is the same dark box.** Profile is a grid of zeros, Rankings a plain table.
4. **No art on items.** `PartThumb` is a letter on a tile; stats are sentences ("Firepower 3 · Power used (flight) 2").
5. **Almost no feedback.** No count-ups, loot reveals, hit effects, sounds, progress moments (the result popup is the exception).
6. **Page-based navigation.** Four tabs, then sub-tabs in the Port.

What already works and must stay: the ship grid with its glow, the installed-part blocks (name, ports, condition bar, exhaust
arrow), the port banner and ship-stage animation, the faction portraits, the phone bottom bar, the `Gauge` component.

## 2. Decisions so far (owner, 2026-11-21)

- **Installed parts on the ship stay as they are today.** They are better than the first mockup. We only add a small **type
  subtitle** under (A) or in a corner chip (B) of each block. **Decided (2026-11-23): layout B**, the type as an icon + label row inside the cell, below the connector band and above the name (never over the dots; icon only at 1×1 phone size).
- **Connections (ports) are a core mechanic and are never abstracted.** Every place that shows a part shows its ports with the same
  language the ship uses: dots on the edge, **kind = number of dots** (1 central, 2 split, 3 universal), **state = colour**
  (green connected, blue free, red incompatible). Rules: central joins central, split joins split, universal joins anything but
  none, none joins nothing (`compatible()` in `apps/api/src/parts/connectors.ts`).
- **Contracts (Missions) and the Map: approved as a start**, "maybe some changes".
- Pilot card/podium and the component kit: not discussed yet, kept in the mockups.

## 3. Principles

1. **One short line per panel.** Anything longer moves to a tooltip or the Guide. Target: cut the hint text of every screen.
2. **Symbols over sentences:** icon + number for stats, pips for risk, chips for blockers (each chip a link to its fix).
3. **Rarity is a frame colour, type is a subtitle**, not grey words.
4. **The ship's state lives in a HUD** (fuel, hull, cargo, wallet) on every screen, instead of banners.
5. **Ports are always visible and explained** (principle from section 2).
6. **Feedback on every action:** count-ups, short reward moments, sounds and haptics (opt-out), no page changes for rewards.
7. **Custom components, not defaults:** icon tabs, segmented toggle, gauge, resource chip, risk pips, slot frame, stat pip with
   compare arrow, blocker chip, reward toast, panel frame, tooltip card.

## 4. Per screen

| Screen | Change | Mockup |
|---|---|---|
| Ship (yard) | Keep the parts as they are; add the type subtitle (layout B, decided 2026-11-23); HUD gauges in the top bar; "Needs" as two chips plus a dashed slot on the ship; tray rows show the part's mini port square | `1-ship-screen` |
| Port > Store | Item cards: the part's footprint with its ports is the largest element, a one-line "does it fit my ship" verdict, type subtitle, rarity frame, icon stats with compare arrows, a "Fits my free ports" filter, icon type tabs. A legend for the ports and a "what joins what" table. While placing a part, the ghost shows each edge green or red before the drop | `2-port-and-parts` |
| Port (rest) | Buy / Service / Work as a place (illustrated scene with hotspots) instead of nested tabs. **Not mocked up yet** | none |
| Missions | Contract cards: giver portrait (faction ring), route arrow, risk pips, time, big reward, "Accept"; locked contracts show blocker chips instead of paragraphs; icon filters | `3-contracts` |
| Map | Star chart: faction territories, fuel-range ring, animated planned route, bottom sheet with "Plan trip"; the 29-card place list goes away | `4-map` |
| Profile / Rankings | Pilot ID card (avatar, rank bar, ship picture, key stats, medals) and a podium | `5-pilot-and-podium` |
| Report, popups | Already condensed in v0.1.4 work; follow the kit | none |
| Faction pick | Fewer words per card, a ship silhouette per faction | none |

## 5. Phases (each one shippable alone)

1. **Kit and HUD.** The component kit (gauge, chips, pips, icon tabs, slot frame, tooltip, toast) plus the HUD in the top bar.
   Replaces the warning banners.
2. **Ports first-class.** Port store item cards with the port diagram and the fit verdict; ship tray rows with the mini square;
   placement ghost with green/red edges. Needs a `fits my ship` computation (the web already has `hangar/connectors.ts`).
3. **Contracts.** Contract cards, blocker chips with jump-to-fix, icon filters.
4. **Map.** Territories, range ring, planned route, bottom sheet.
5. **Ship type subtitle + Needs chips + empty slot hints.**
6. **Pilot card and podium.**
7. **Juice.** Count-ups, reward moments, sound and haptics; copy diet across screens.
8. **Port as a place** (needs its own mockup first).

Each phase gets its own implementation plan in `docs/superpowers/plans/` when it is picked up.

## 6. Open questions

- Art: generated icons per part type, or commissioned art? (The mockups use placeholder shapes.)
- Sound: any assets yet? Opt-out setting?
- Does "Fits my free ports" need the server (to count free ports) or can the web compute it from the ship and part layouts?
- Phone: the contract cards, the star chart bottom sheet and the part cards must be redone for 390px; not mocked up.
- i18n: every new label in English and pt-BR (the existing rule); the copy diet removes many keys, which must be removed from both files.

## 7. Risks

- Rewriting 11,000 lines of CSS: do it screen by screen behind the kit, keep tests green per phase (about 650 web tests, the
  e2e literals break when copy changes: grep the old text first).
- Port clarity must not regress: the connection mechanic is the game; test with a player who has never seen the ports.
- Art placeholders can read as unfinished: decide the art direction before phase 2.
