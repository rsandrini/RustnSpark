# Phase 3, screen 2: Missions (plan, nothing built yet)

Scope rule, as for Port: **the logic does not change.** Same API calls, same accept / hold / release flows, same
eligibility from the server, same test ids and roles. This is markup, defaults and styling.

## 1. What the screen is today (facts)

- The route is `/missions` (the old Board). It renders `BoardPage` inside the same page as Ship and Port, so it
  shares the 170 px place banner above it.
- Controls: a chip row of the seven mission types (All, Delivery, Transport, Escort, Mining, Rescue, Race) and an
  **"Only eligible"** chip that is **on by default** (an earlier owner request: most offers on a busy board are
  ones the ship cannot take yet). The server's order is kept; there is no sort.
- Each offer is a `MissionCard` (402 lines): type label, title, reward, route with a mini map, description,
  distance / legs / flight time, "You need:" with a tick or a cross per requirement and the numbers (your ship
  against the need), a fuel gauge, expiry, eligibility and starter badges, then Accept and Hold. Races add the
  field table, mining adds the material line. The grid is one card per cell (about 330 px wide), so a board of
  three offers fills a quarter of a wide screen.
- A mission already taken is shown above the list as the same big card ("Your mission") with a "Go to ship"
  button.
- `MissionCard` is also used by **Transit** (the accepted-mission card on the Ship tab, with the trip map beside
  it). That use is not part of this step.

## 2. What changes

### Frame
- The banner becomes the slim place header already used on Port (104 px, place art, serif title with the accent
  word). Under it, one mono line: **"MISSIONS BOARD · 3 OPEN, 2 YOU CAN TAKE"** (counts from the data on screen).
- The filter row stays one line: type chips, "Only eligible" (still **on by default**), and a new **sort**
  select at the right.

### Sort (new, no API change)
Reward high to low (default), shortest trip, lowest risk, soonest to expire. Today the list is in the server's
order. Sorting is done in the browser over the offers already loaded.

### The list: rows, not cards
Each offer becomes a **row** (full width on desktop, stacked on a phone):

| column | content |
|---|---|
| type | mono type label, a small icon-free coloured pip by mission type |
| the job | title, then "route" in one line (origin → destination · distance), the starter / held badges |
| what it asks | requirement chips: a tick for each met one, a coral cross with "need 4, you have 3" for each unmet one |
| the trip | flight time and fuel used, mono |
| risk | the existing risk pill |
| pay | reward in mono brass, then **Accept** (primary) and **Hold** |

The full card moves **behind a "Details" disclosure inside the row**: the route map, description, the fuel gauge,
the material line, the race field, the engine levels. It is the same `MissionCard`, so Transit and every detail
keep working, and every existing test id stays in the DOM.

- An offer the ship cannot take keeps its row (when "Only eligible" is off) but is dimmed, and its Accept button is
  disabled and reads **"Not eligible"**; the reasons stay as the coral chips in the row.
- **Your mission** becomes a pinned row at the top with a brass border, the tag "YOUR MISSION" and the
  "Go to ship" button, instead of the big card.

### Empty states
"Nothing here you can take. Switch off Only eligible to see 4 more." (today: a bare "No offers at this location.").

### Styles
The 55 `mcard` selectors move out of the legacy sheet into `styles/missions.css` as they are rebuilt; the
Transit card keeps the card look, so the card rules stay together in that file.

## 3. What does not change
Accept, Hold and Release behaviour; the eligibility the server sends; the "Go to ship" jump; races and mining
content; the rescue banner and the empty-ship notice; the Transit card on the Ship tab; the map's "missions from
here" links (`/missions?location=...`).

## 4. Decisions before I start

1. **Rows with the card behind "Details"**, as above, or keep the card grid and only restyle it?
   *Recommended: rows. A board is something you scan and compare, and the grid wastes most of a wide screen.*
2. **Header:** the slim place strip like Port, plus the mono "missions board · N open" line. Or a visible serif
   page title "*missions* from ceres"? *Recommended: the strip and the mono line; the place name is already the
   serif title there, and a second big title would repeat it.*
3. **Sort select**, default reward high to low. *Recommended: yes.*
4. **"Not eligible" as the disabled Accept label** (instead of an unlabeled disabled "Accept"). *Recommended: yes.*
5. **Pinned "Your mission" row** instead of the big card. *Recommended: yes.*

## 5. Steps (each one shipped, tested and green on its own)

| step | what | touches |
|---|---|---|
| M1 | Frame: slim header, mono count line, sort select, empty states | `board.page.tsx`, `hangar.page.tsx` (slim stage on this tab), `missions.css` |
| M2 | The row: summary columns, requirement chips, Details disclosure around the existing card | new `mission-row.tsx`, `mission-card.tsx` (small), `missions.css` |
| M3 | Pinned "Your mission" row, disabled-state labels, dimmed rows | `board.page.tsx`, `mission-row.tsx` |
| M4 | 320 to 1280 px pass, specs, browser smoke, screenshots | `board.spec.tsx` (575 lines, about 10 expectations on card counts and texts), e2e |

## 6. Cost and risk
`board.spec.tsx` keeps most of its checks because each row contains one `MissionCard` (so `.mcard` counts stay);
the ones that read the Accept button name or the "You need" block are updated. The e2e smoke clicks the first
enabled "Accept" on the board; it still finds one. The risk is the race rows: the field table is wide, so it lives
only inside Details, and the row shows the entry requirement and the prize in the summary.
