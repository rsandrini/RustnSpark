# UX audit and redesign plan (P5)

Status: **done (2026-10-17): phases 1 to 4 are built; see `frontend-rules.md` for the result and `phase-2-shell-plan.md`, `phase-3-*.md` and `phase-4-hardening-plan.md` for the steps.** Original status: proposal; a clickable demo exists (`docs/design/demo/index.html`, also published as a private page).** Owner answers so far: lowercase serif headlines kept as in Lumen (to test), fonts may be self-hosted, Hallmark stays read from the repo (a global install is allowed). Still open: approval of the navigation (section 3), to be judged on the demo. Scope: the whole game, **admin excluded**.
Date: 2026-10-16. Evidence: screenshots in `docs/design/before/` (desktop 1440x900 and phone 390x844, a fresh
Luna pilot on the dev stack; `capture-screens.mjs` retakes them) plus the router and page code.

Method: no UX skill is installed in this environment, so the audit uses Nielsen's ten heuristics, the
navigation questions "where am I / where can I go / what can I do here", and Hallmark's rules
(`structure`, `layout-and-space`, `interaction-and-states`, `responsive`) as the checklist.

## 1. What the player sees today (the map)

Routes: `/hangar/:tab?` (ship, port, board are all tabs of one page), `/map`, `/report/:id`, `/profile`,
`/login`, `/register`, `/onboarding`, plus redirects (`/board`, `/port`, `/transit` -> hangar tabs).

Top bar, one row on desktop and **three rows on a phone**: `My Ship | Port | Board | Map`, then the ship
identity (faction badge, ship name, "Docked at Ceres Port"), then language select, wallet, Profile, Sign out.

Inside the pages:

| page | second level | third level |
|---|---|---|
| My Ship | Parts / Store | rarity and condition toggles, rotate, remove, save, auto layout, empty, format |
| Port | Market, Your goods, Repair (7), Refuel, Upgrade, Scavenging, Mining (**7 tabs**) | part-class chips, search, rarity, size, new/used, sort |
| Board | type chips (7) + "only eligible" | per-mission card, accept / hold |
| Map | none | none |

## 2. Findings (severity: H high, M medium, L low)

1. **H: the navigation says one thing and the routes another.** "My Ship", "Port" and "Board" are top-level
   links but live at `/hangar/...`; `/transit` still exists as a redirect; the word "Hangar" is used in the
   URL, "My Ship" in the nav, "Assembly yard" in the page. Three names for one place.
2. **H: two shops.** My Ship has a "Store" tab and Port has "Market"; both sell parts. A pilot cannot tell which
   one to use, and the Store is a cut-down copy of the Market.
3. **H: Port has seven sibling tabs of unequal weight** (Market, Your goods, Repair, Refuel, Upgrade,
   Scavenging, Mining), mixing buying, maintenance and work. Repair carries a count badge, nothing else does.
4. **H: the market is a wall.** About 60 equal cards in a five-column grid, each with a large blue button;
   a pilot with 200 credits sees "Not enough funds" on thirty of them. Nothing says "what does my ship need".
   (The hangar already knows which part class fixes each problem; the market does not use it.)
5. **H: phone chrome eats the screen.** Three header rows plus a 170 px place banner: the real content starts
   about 380 px down. The yard canvas then leaves a ~150 px void under "No loose parts in storage".
6. **M: the place banner repeats on every tab** (same art, same height) and carries a "Hide animation"
   control that nobody needs on every page. It pushes the actual work down on Ship, Port and Board.
7. **M: one mission on the board looks lost.** A 360 px card in an empty 1440 px page, with a duplicate route
   map inside it; the eight pieces of information inside the card have the same visual weight.
8. **M: the map is a dead end.** It shows places and risk, but selecting a place offers no action (go there,
   see its board, see its services).
9. **M: the wallet is shown twice** (top bar and the Port tab row), and status ("Docked at Ceres Port") sits in
   the nav bar next to unrelated account links.
10. **M: weak hierarchy.** Blue buttons, amber tabs and chips, green ok, orange used, red risk, faction badges:
    six accents compete and primary and destructive actions look alike ("Save layout" and "Empty the ship"
    sit in one row at the same size).
11. **L: no deliberate type system** (inherit, Georgia, monospace), 109 hex and 75 rgb literals outside the
    tokens, 5,943 lines in one sheet.

What works and should survive: the ship yard itself (the grid is a real game object), the ship sheet's mono
uppercase labels, the map's risk coding, the rarity colours, the report's three views, reduced-motion support.

## 3. Proposed information architecture

Principle: **one place per job, three levels at most, status never inside navigation.**

```
Header:   [wordmark]   Ship   Port   Missions   Map                     [wallet]  [account v]
Status:   Docked at Ceres Port · ship ready          (thin strip; flying / mining / repairing shows a countdown)
```

| top level | contains | replaces |
|---|---|---|
| **Ship** | the yard (grid + parts in storage + ship sheet). "Store" becomes a link: *"buy what your ship lacks"* -> Port, pre-filtered by the problem's part class | My Ship + its Store tab |
| **Port** | **Buy** (market, with "affordable" and "my ship needs" filters on by default; sell is a toggle, not a tab), **Service** (repair, refuel, upgrade), **Work** (scavenging, mining) | 7 tabs -> 3 |
| **Missions** | the board, and the active mission / transit below it when one is running | Board + Transit |
| **Map** | places and routes; selecting a place opens a side panel: distance, risk, services, *"missions from there"*, *"travel here"* | Map |
| account menu | wallet detail, language, profile, sign out | four loose links |

Routes: `/ship`, `/port/:tab(buy|service|work)`, `/missions`, `/map`, `/report/:id`, `/profile`. Old paths
(`/hangar`, `/hangar/port`, `/hangar/board`, `/board`, `/port`, `/transit`) redirect, so bookmarks and the
browser smoke keep working.

The big place banner becomes a **slim status strip** on every page; the full art is used once, as the
background of the Map's selected place and as the Port header.

## 4. The visual system: Hallmark "Lumen" (Night Foundry)

Chosen by the owner: black theme, Lumen. Mapping to this game:

| Lumen element | in RustnSpark |
|---|---|
| canvas `oklch(13% 0.014 265)`, ink `oklch(96% 0.006 262)` | the app background and text (replaces `--bg` `#0b0e13`, `--ink`) |
| molten-brass accent `oklch(76% 0.17 50)` and coral chord `oklch(68% 0.16 18)` | primary action, active tab, wallet; coral for warnings. **Blue buttons go away.** |
| lowercase classical serif headline (Instrument Serif) with one accent-coloured word | page titles only ("your *ship*", "the *port*"); item names stay sentence case for readability |
| UPPERCASE mono labels, tabular numerals | stat labels and every number (the ship sheet already does this) |
| the **apparatus** with leader-line callouts | **the ship in the yard is the apparatus**: callouts name its range, mobility, power and structure |
| hairline cards, soft depth shadows, blueprint grid at 4% | cards, popups, the yard canvas |
| no italics in headings, no re-drawn chrome, 8 interaction states, 320-414 px floor | project-wide rules |

Kept as semantic tokens (not part of the theme): **rarity colours** (common..legendary), **faction colours**
(luna, sun, explorers, pirates), **risk colours** (low, medium, high). They are retuned to sit on the new canvas
but keep their meaning. Fonts (Instrument Serif, Geist, Geist Mono) are open-licence; they would be self-hosted
(no third-party font request).

## 5. Plan, in phases

Each phase ends with: web tests green, CI green, before/after screenshots (desktop + phone), an owner review.

| phase | work | size |
|---|---|---|
| **0** | this audit; owner decisions (section 6) | done when you answer |
| **1 Foundations** (done 2026-10-16) | `styles/tokens.css` (Lumen Night + meaning colours + legacy aliases), self-hosted Geist / Geist Mono / Instrument Serif (`@fontsource`, latin subsets), `styles/components.css` (button, tab, chip, card, pill, form controls, popup, table, each with the 8 states), and every one of the 109 hex + 75 rgb literals moved to tokens (0 left in `index.css`). The legacy sheet is **not** split yet: its rules are scattered across features, so each screen's rules move into a feature file in phase 3, when that screen is rebuilt. | L |
| **2 Shell and navigation** | the new header, status strip, account menu, route renames with redirects, the Missions merge | M |
| **3 Screens**, in the order of the play loop | Ship (yard + sheet), Port (Buy, Service, Work), Missions (board + transit), Report, Map (with the place panel), then Auth / Onboarding / Profile | XL (Port is 1.6k lines, Ship 1.1k) |
| **4 Hardening** | 320 / 375 / 414 / 768 px pass, contrast, reduced motion, browser-smoke selectors, i18n parity (en + pt-BR, lowercase titles in both) | M |

Risks: 48 web specs are tied to labels, roles and some class names, so labels stay stable wherever the new IA
allows and the specs move with the markup; the browser smoke uses the nav labels and `/hangar` URLs (the
redirects keep it green during the migration); the type change must be checked in pt-BR (longer words).

## 6. Decisions needed from the owner

1. **Approve the navigation** (section 3): Ship / Port (Buy, Service, Work) / Missions / Map, with the old Store
   folded into Port and Transit folded into Missions?
2. **Headline style:** lowercase serif page titles in both languages (Lumen's signature), or sentence case?
3. **Fonts:** self-host Instrument Serif + Geist + Geist Mono (open licence)?
4. **Hallmark itself:** use its published rules by reading them from the repository (what this plan does), or
   install the skill globally (`npx skills add nutlope/hallmark`) so `hallmark audit` runs on every screen
   as we go? Installing writes into `~/.claude/skills`, so it is your call.
