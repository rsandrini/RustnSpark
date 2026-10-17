# Phase 3, screen 3: Map (MP1-MP3 built; decisions all as recommended; zoom and pan later)

Scope rule, as for Port and Missions: **the logic does not change.** Same queries, same trip quote and
"fly there" flow, same suggestions, same test ids and roles. Markup, layout and styling. Zoom and pan are a
new feature, so they are a separate, optional step (decision 3).

## 1. What the screen is today (facts)

- `/map` is its own page (`map.page.tsx`, 522 lines, spec 368 lines). It has **no visible title** (the `<h1>` is
  `sr-only`; owner request: no text before the map), then the SVG sector map in a `.stage` box, then a legend row
  (risk low / medium / high and "you are here").
- The map: places as nodes (core fill = risk band, ring = faction colour), corridors as lines (hot ones
  highlighted from a server flag), a pulsing "you are here" tag, the ship marker moving along its route while in
  flight, a floating marker when out of fuel, a mission count above a node. The view is fixed to the bounds of
  all places; 16 places on the dev database (15 in CI).
- Clicking a node (or Enter / Space on it) opens a **modal `Popup`** over the map with: place art, type and zone,
  description, faction and risk badges, "you are here" when it is the ship's place, a **"Fly there" travel box**
  (route, time, distance, fuel gauge, blockers, button) when the ship is docked elsewhere, the missions list
  (that place's own board when you are there, otherwise **the missions on your board that deliver there**) with
  eligibility and reasons, and a "Open mission board" link.
- It still uses the old page chrome: `<main className="app wide">`, the legacy `.stage`, `.legend`, node and
  popup rules in the 5,900-line `index.css`.

## 2. What changes

### Frame
- The page gets the same **slim header strip** as Port and Missions (place art, serif title with the accent word,
  e.g. "sector *map*"), plus one mono line: **"SECTOR MAP · 16 PLACES · YOU ARE AT CERES PORT"**. The owner's rule
  "no text before the map" is about long copy; this is one strip and one line. *(Decision 1: do it, or keep the
  page bare?)*
- The ship stage is **not** shown on the map page today and stays that way.
- Legend: moves under the header line as a compact row of mono chips (risk dots and "you are here"), instead of
  below the map. Same items.

### Layout: map plus a side panel instead of a modal
- Desktop (above 960 px): the map on the left (about 2/3), a **docked side panel** on the right (about 1/3) that
  shows the selected place. Nothing selected: the panel shows a short hint and the list of places sorted by
  distance from the ship, which doubles as a keyboard-friendly alternative to clicking nodes. The map no longer
  gets covered when you look at a place, so you can compare two places by clicking one then the other.
- Phone (960 px and below): the map on top, the panel **below** it (scrolls with the page) instead of a modal;
  selecting a node scrolls the panel into view. *(Decision 2: side panel, or keep the modal?)*
- The panel content is the existing `PlaceDetails`: place art becomes a short banner, the type / zone / faction /
  risk move into one mono line with the two badges, the travel box and the missions list are restyled with the kit
  (hairline cards, brass primary button, the fuel gauge already brass). Same data, same order.
- Deep link: `?place=<id>` selects a place (so the Port and Missions screens can link to it); **new, no API.**
  *(small; skip if you prefer)*

### The map itself
- Restyle only: node cores and rings keep their meaning, labels in the body font, mono sub-labels, hairline
  corridors, the hot ones in coral, the brass "you are here" tag and pulse. The mission count becomes a small
  brass pill. Selected node: brass ring.
- The legacy `.stage` box becomes a hairline panel on the paper token.

### Zoom and pan (optional, step MP4)
You asked for it earlier ("a zoom and a way to move around") for the later, larger map. Plan: the SVG already
uses a `viewBox`, so zoom is a view-box state (scroll wheel and +/- buttons, pinch on phones), pan is drag, with a
"fit all" button. No new data. Only worth it once the map has more places than fit comfortably, so I would build it
together with the map expansion, **not in this phase** unless you want it now. *(Decision 3.)*

### Styles
The map, node, legend and popup-content rules (about 40 selectors) move from the legacy sheet into
`styles/map.css`, imported after `missions.css`. The Popup component itself stays (other screens use it).

## 3. What does not change
The queries and their refresh, the trip quote and "fly there" mutation and its error text, the suggested
deliveries logic, the work-at-place tag, the floating marker, node keyboard access, accessible names of nodes, the
`travel` test id, the link target `/missions?location=...`.

## 4. Decisions before I start

1. **Slim header strip and mono line on Map** (against "no text before the map"). *Recommended: yes, one strip
   and one line; the long copy stays out.*
2. **Docked side panel** (desktop) / panel under the map (phone), instead of the modal. *Recommended: yes. The
   modal hides the map you are choosing from, and the panel gives the nearest-places list a home.*
3. **Zoom and pan** now, or with the map expansion. *Recommended: later, with the expansion.*
4. **`?place=` deep link.** *Recommended: yes, it is five lines and makes the Port and Missions links useful.*
5. **Nearest-places list** in the empty panel. *Recommended: yes (needs distance from the ship: computed in the
   browser from the node coordinates, no API).*

## 5. Steps (each shipped, tested and green on its own)

| step | what | touches |
|---|---|---|
| MP1 *(done)* | Frame: slim header strip, mono line, legend row, hairline map panel, node restyle into `map.css` | `map.page.tsx`, new `styles/map.css` |
| MP2 *(done)* | Docked panel replaces the modal (desktop and phone), `?place=` link, nearest-places list; `PlaceDetails` restyled | `map.page.tsx`, `map.css` |
| MP3 *(done)* | 320 to 1280 px pass, specs (`map.spec.tsx`: the popup tests become panel tests, about 8 expectations), browser smoke, screenshots | specs, e2e |
| MP4 *(optional, later)* | Zoom and pan | `map.page.tsx`, `map.css` |

## 6. Cost and risk
`map.spec.tsx` opens the dialog on a node click and closes it again; those checks become "the panel shows the
place" and "the panel clears". Roles and names are kept where possible (the heading, the node buttons, the link).
The browser smoke only checks the page title, the node count (15) and overflow, so it keeps passing. The risk is
the phone layout: the node tap targets and the panel below the map must not fight over the scroll; checked at 320
and 390 px in MP3.
