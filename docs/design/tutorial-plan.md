# Newcomer tutorial (plan, nothing built yet)

From `docs/TODO.md`: a short, skippable, bilingual guided flow for a new pilot, shown after onboarding, that
ticks as the pilot does each thing: build the ship (place parts, connect them, fix red ports), refuel, repair,
scavenge and mine, get and accept missions. It pairs with the starter changes already done (a full tank, a short
private first mission), so the first minutes work.

## 1. What exists today (facts)
- Onboarding picks a faction and lands on `/ship` with the starter kit **loose in the tray**; "Auto layout"
  assembles it. A private start-safe mission is always on the home board (D43).
- Pages already take a `guided` prop (a placeholder for this, unused).
- Everything a tutorial needs to know is already in queries the pages load: the ship (installed parts, status,
  fuel), the active mission, the report list (`/v1/reports`). Port work (refuel, repair, scavenge, mine) leaves
  no single "has done it" flag in those queries.
- Nothing about tutorial progress exists on the server.

## 2. Proposal

### The shape: a checklist, not an overlay
A small **"Getting started" card** that ticks itself. No spotlight overlays and no blocking steps: those break on
every layout change and on the phone. Each step is one line, a one-sentence hint and a **"Take me there"** link.
The pilot can ignore the card, collapse it, or skip the whole thing.

### The steps (v1, seven)
| # | step | how it ticks (no new API) |
|---|---|---|
| 1 | Build your ship: press **Auto layout** (or place the parts yourself) | the ship has installed parts |
| 2 | Read the ports: green is connected, red is wrong | the ship sheet says ready to fly **and** the pilot has opened the yard once (visit) |
| 3 | Take a mission from the board | an active mission exists, or any report exists |
| 4 | Dispatch and wait for the result | a report exists |
| 5 | Read your first report | the report page was opened (visit) |
| 6 | Repair what the trip wore down (Port, Repair) | the Repair tab was opened after a report (visit) |
| 7 | Try the other work: refuel, scavenge or mine (Port) | any of the Refuel, Scavenging, Mining tabs was opened (visit) |

"Visit" steps tick when the pilot opens that screen or tab, recorded in the browser. Steps 1, 3 and 4 tick from
real game state, so they stay correct on a second device.

### Where it lives
- A **floating card** at the bottom right on desktop, above the tab bar on phones; collapsed it is a pill reading
  **"Getting started 2/7"**. Shown on every game screen once onboarding is done, until finished or skipped.
- **Skip** ("Skip tutorial", with a one-line confirm) hides it for good. Finishing step 7 shows a short "You are
  set" line with a link to the guide page (when it exists) and then goes away.
- It can be **reopened** from the account menu ("Getting started"), so skipping is never a dead end.

### Persistence
Browser storage, per account (`tutorial:<playerId>`: skipped, finished, visited steps). No migration, no API
change. The cost: a second device shows the card again (steps 1, 3 and 4 tick by themselves; "skip" is repeated).
If you want it synced across devices later, that is one small player field and two endpoints.

### Text
All strings in `en` and `pt-BR`, none hard-coded; the hint texts quote no tunable numbers (so nothing goes stale
when the Admin retunes the game).

## 3. What does not change
Game logic, API, the onboarding flow, the `guided` placeholder props (they stay unused), every existing test id.

## 4. Decisions before I start
1. **Checklist card, not highlighted overlays.** *Recommended: yes.*
2. **The seven steps above** (or a different list). *Recommended: as listed.*
3. **Progress stored in the browser** (per account), not on the server. *Recommended: yes for v1.*
4. **Floating card** bottom right, collapsible to a pill; phones above the tab bar. *Recommended: yes.*
5. **Reopen from the account menu.** *Recommended: yes.*

## 5. Steps (each shipped, tested and green on its own)
| step | what | touches |
|---|---|---|
| T1 | `useTutorial` hook: derives steps 1, 3, 4 from the existing queries, reads and writes the browser record | new `features/tutorial/`, spec |
| T2 | The card and pill (collapse, skip with confirm, finished line), styles in `styles/tutorial.css` | new component, `shell` mount |
| T3 | The visit ticks (yard, report, Repair, Refuel, Scavenging, Mining) and the "Take me there" links | `hangar.page.tsx`, `report.page.tsx`, `port.page.tsx` (one hook call each) |
| T4 | Account menu entry, i18n en and pt-BR, specs, browser smoke (a new pilot sees the card, it ticks after Auto layout), 320 to 1280 px pass, screenshots | `AccountMenu.tsx`, e2e |

## 6. Risk
The card sits over content on small screens: it starts collapsed on phones, and its pill is small and above the
tab bar. The browser smoke registers fresh pilots, so it will start seeing the card; its selectors must not match
anything inside it (it uses buttons named "Accept", "Dispatch"; the card's links use different words).
