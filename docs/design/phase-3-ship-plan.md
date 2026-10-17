# Phase 3, screen 8 (last): Ship (S1-S6 built; decisions as recommended; callouts sit on the yard's bottom edge so they never cover the zoom bar)

The riskiest screen, so it goes last and in small steps. Scope rule as before: **the logic does not change.**
Same queries, same layout editing (drag, rotate, remove, auto layout, save, format), same sheet numbers, same
engine tuning, same Store panel, same test ids and roles. Markup, layout and styling only. The **Store tab stays**
in My Ship (owner decision), and because it is the same `MarketPanel` as Port's Market, it is already restyled.

## 1. What the screen is today (facts)

`/ship` is `HangarPage` (1,145 lines) on its Ship tab. Top to bottom:

1. **Header strip:** the animated ship stage (compact, 170 px) with a "Hide animation" overlay button.
2. **Trip summary (`TransitPage` embedded):** while a mission is accepted or flying: the mission card with the
   route map beside it, the progress line, Dispatch / Cancel buttons, the flying scene. Idle: nothing.
3. **Notices:** "ship is on a mission" error, "selected part" hint.
4. **Three columns (`hangar-layout`):**
   - **Left (`hangar-side`):** sub-tabs **Parts / Store**. Parts: the kit note, then loose parts as rows
     (`TrayPartRow`: icon, name, rarity, size, with the (i) button and the hover compare card). Store: `MarketPanel`.
   - **Centre:** `ShipYard` (1,008 lines, SVG): the cell grid, placed parts with connector ports, zoom (- / 100% / +),
     Fit ship, Rarity and Condition overlays, drag and drop, rotate; under it the action row (Rotate, Remove, Save
     layout, Auto layout, Empty the ship, Format) and the hover stats card.
   - **Right (`ShipSheetPanel`, 316 lines):** the ship sheet: class, "Ready to fly", firepower, armor / shield, cargo,
     mobility, range, condition, energy, structure, "Show all stats" and the **Engine tuning** disclosure
     (`engine-tuning.tsx`, 294 lines).
5. The page still uses the old chrome (`<main className="app wide">`, `.panel`, `.tab`, `.hangar-*` rules in the
   legacy sheet: about 70 selectors), with a screen-reader-only `<h1>`.

About 76 specs touch it (`hangar.spec.tsx` 40, `ship-yard.spec.tsx` 10, `ship-sheet-panel.spec.tsx` 3,
`transit.spec.tsx` 23). The yard's geometry and drag specs read the SVG, not the styling.

## 2. What changes

### Frame
- The same **slim header strip** as Port and Missions on this tab too (place art, serif place name with the accent
  word), plus the status line already in the shell. The "Hide animation" overlay stays. *(Decision 1.)*
- The mono line under it: **"SHIP · LUNA STARTER · 8 PARTS · READY TO FLY"** (counts from the data on screen).

### Layout: the yard as the apparatus
- Desktop: the yard takes the centre with a **brass hairline frame and a mono caption row** (zoom, Fit ship, overlay
  toggles on the caption row, like an instrument bezel), the **action row under it as one toolbar** (Save layout is
  the single primary button; Rotate / Remove / Auto layout / Empty / Format are quiet buttons, danger ones coral).
- **Callouts** (decision 2): the sheet's key numbers (firepower, armor + shield, cargo, mobility, range) appear as
  small mono labels pinned on the yard's top edge, so the effect of an edit is read **on the apparatus** without
  looking right. They are the same numbers as the sheet panel (read from the same `sheet` object, including the
  unsaved preview), only an extra place to read them. The sheet panel stays complete.
- Left column: Parts / Store become the **segment control** (like Port), the loose parts as hairline rows, the kit
  note as a coral-free info strip.
- Right column: the sheet panel restyled: mono tabular numbers, hairline groups, the "Ready to fly" / blockers
  verdict as one chip at the top (green or coral), the engine tuning as a quiet disclosure.
- Under 1100 px the order becomes yard, then sheet, then Parts / Store (the yard first, because it is the screen);
  under 860 px the yard keeps its zoom controls and the toolbar wraps. *(Decision 3: this order on small screens.)*

### Trip summary
Unchanged in content. The accepted-mission card is `MissionCard` (already restyled with the Missions screen in the
Details view), so the trip summary gets the same layout (map beside the facts); Dispatch and Cancel get the brass
primary / quiet button pair.

### Styles
The `.hangar-*`, `.yard-*`, `.sheet-*` and `.tray-*` rules (about 70 selectors) move into `styles/ship.css`; the yard's
SVG classes (cell, part fills, ports) keep their meanings and only change tokens (paper, brass, coral, steel).

## 3. What does not change
Queries, mutations and their cache keys; layout editing logic and the preview of unsaved edits; the sheet numbers
and where each comes from; the rotate / remove / save / auto-layout / format flows; the connector rules and their
colours (green connected, coral incorrect, blue available); the drag and drop geometry; the engine tuning
controls; every test id and accessible name (`Assembly yard` group, tab names, button names).

## 4. Decisions before I start
1. **Slim place header on the Ship tab** (like Port and Missions), keeping the Hide animation button.
   *Recommended: yes.*
2. **Callouts on the yard** (the key sheet numbers repeated on the yard's top edge, read-only). It is the one new
   element; everything else is restyle. *Recommended: yes, small, and easy to drop if you do not like it.*
3. **Small-screen order:** yard first, then the sheet, then Parts / Store. *Recommended: yes.*
4. **Parts / Store as a segment control** (same as Port's second level). *Recommended: yes.*
5. **Order of work:** the sheet panel first (lowest risk), then the Parts column, then the frame and toolbar, then
   the yard itself last. *Recommended: yes.*

## 5. Steps (each shipped, tested and green on its own)

| step | what | touches |
|---|---|---|
| S1 *(done)* | Sheet panel and engine tuning restyled, verdict chip; rules into `ship.css` | `ship-sheet-panel.tsx`, `engine-tuning.tsx`, `ship.css` |
| S2 *(done)* | Parts column: segment control, tray rows, kit note | `hangar.page.tsx`, `tray-part-row.tsx` |
| S3 *(done)* | Frame: slim header + mono line, three-column to responsive layout (yard first on small screens), the notices | `hangar.page.tsx`, `ship.css` |
| S4 *(done)* | Yard bezel and toolbar (caption row, Save as the one primary), hover card | `ship-yard.tsx` (markup around the SVG only), `hangar.page.tsx` |
| S5 *(done)* | Callouts on the yard (read-only) and the SVG tokens (cells, parts, ports) | `ship-yard.tsx` |
| S6 *(done)* | Trip summary (Dispatch / Cancel pair); 320 to 1280 px pass; specs; browser smoke on desktop and phone; screenshots | `transit.page.tsx`, specs, e2e |

## 6. Cost and risk
The yard is the risk: S4 and S5 touch `ship-yard.tsx`, so they only wrap or restyle the SVG and never change its
event handling or geometry; the 10 yard specs and the geometry specs are the safety net, and the browser smoke
(which assembles a ship with Auto layout and flies a mission) runs after every step. `hangar.spec.tsx` is large
(40 tests) but reads roles and names. Doing the sheet and the tray first means the two riskiest steps come last,
after the screen already looks right around them.
