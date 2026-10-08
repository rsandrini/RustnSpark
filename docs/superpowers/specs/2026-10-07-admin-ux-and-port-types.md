# Admin editing UX + connector port types

**Status:** APPROVED (owner, 2026-10-07): admin edit/create as pages in the shell; mixed seed defaults = ONE kind per part (all-central, all-split or all-universal, equal chance, ports at the same place on every side) — no weighted 70/25/5 mix. Kits (starter/restart) never roll split so they always assemble. Added: a per-player 'fast missions' toggle in the player detail screen (today CLI/API only).

Original status: PLAN. Evidence below comes from a live
Playwright audit of every admin route (1400×900) against a throwaway stack.

## Status (implemented)
Done on `feat/part-direction-rules`: routed edit/create/clone pages, sectioned part form, list search +
overflow container, collapsible Config, 1/2/3-dot glyphs, `oneKindPerPart` mixed seed defaults (kits never
split), connector rules editor v2 (side cards + chips + presets + live server preview), per-player
fast-missions toggle, Playwright admin audit (`apps/web/e2e/admin.spec.ts`, desktop + phone).

## Findings

### Admin screens (items 1 and 4)
- **Edit/Create is a full-viewport modal** (`Popup` + `.modal-tuning-full`: 100vw × 100vh at
  0,0). It covers the admin top menu on every entity (parts, ship formats, factions,
  mission templates, … measured: modal rect `[0,0,1400,900]` on all four checked). So "edit" is a
  separate screen with no menu, no URL, no back button, and the browser Back leaves admin.
- **List pages:** the ship-formats list overflows horizontally (all columns in one table, headers
  as long sentences); parts / materials lists are ~7,400 px tall with no search; the Config screen is
  ~11,300 px of flat rows; other lists are fine (no horizontal overflow, top menu present).
- The top menu itself (Stats ▾ / Editable ▾) is present on all 16 admin routes.
- `SupportActions` (players inspector) also uses `Popup`; small confirm dialogs are fine as modals.

### Port types (items 2 and 3)
- All three kinds already exist end to end (`none | central | split | universal`) and the rules
  already match your model: central↔central, split↔split, **universal↔everything but none**,
  central↔split never. The generator can roll any of them.
- **But in practice only `central` exists in the game:** the seeded default rules are all-central
  (decision made earlier), so no part is ever generated with split or universal ports, and nothing
  in the UI distinguishes them well — today's marks are dot (central), bar (split), ring
  (universal), which doesn't read as "1 port / 2 small ports / 3 ports".
- The admin rules editor is a weights *table* (4 sides × 4 kinds, numeric inputs): correct but
  hard to read and no preview of what it will generate.

## Design

### A. Admin editing UX
1. **Edit/Create as pages inside the admin shell**, not a modal:
   `/admin/tuning/entities/:entity/new`, `/:entity/:id`, `/:entity/:id/clone`. The top menu stays;
   a breadcrumb ("Parts › bridge"), a sticky save/cancel bar, deep links and working Back. The
   existing auto-save-on-edit behaviour stays. `Popup` remains for confirmations only.
2. **Form layout:** generalise the ship-format split — a details column on the left and the
   "special editor" (cell grid, connector rules, relations matrix) as the main pane — for every
   entity that has one; plain entities keep the paired-field grid. Long forms get section headings
   (Identity · Stats · Energy · Connectors …) instead of one flat grid.
3. **Lists:** search box + the existing chips; compact rows; per-entity list columns (a short,
   explicit list instead of "first 5 fields"); table in an `overflow-x: auto` container with
   truncated headers + tooltip; row click opens the edit page; Config screen grouped into
   collapsible sections with search.
4. **Audit-as-test:** extend the Playwright admin smoke to visit every admin route and every
   entity edit/new route at 1400 px and 390 px and assert: top menu visible, no horizontal
   overflow, no element wider than the viewport.

### B. Port types
1. **One glyph language, everywhere** (card grid, hangar yard marks, tray, admin editor):
   central = **one dot** at the edge centre; split = **two small dots** either side of the
   centre; universal = **three** (centre + the two small) — i.e. universal visibly contains both.
   Colour keeps meaning the state (green/red/blue). Legend updated; kind names + tooltips unchanged.
2. **Connector rules editor v2** (replaces the numeric table):
   - a to-scale part diagram; click a side to open a small chip row — central / split / universal /
     none — each with a weight slider (0 = never);
   - live "what will be generated" panel: every possible side combination with its % (from the
     same enumeration the server uses), plus a "Roll 10 samples" preview drawn with the real glyphs;
   - caps and blacklist as simple controls (stepper; pick-two-sides rows) next to the diagram;
   - presets: All central · Mixed · Rear-free (engine/weapon: facing side locked to none, shown
     greyed with the reason);
   - same server validation (already enforces "can generate something" and engine/weapon W=none).
3. **Seed defaults** (decision needed, below): either keep all-central until you configure types
   in the new editor, or ship a mixed default so split/universal parts exist from the first run.

## Tasks (order)
1. B1 glyphs (`PortGlyph` + legend + tests) — small, visible immediately.
2. A1 routed edit/create pages + breadcrumb/sticky bar; remove the full-screen modal for entities.
3. A2 form layout generalisation + section headings.
4. A3 lists (search, list columns, overflow, Config grouping).
5. B2 connector rules editor v2 (diagram, probabilities, samples, presets) — needs A2's main pane.
6. A4 Playwright admin audit test; fix whatever it finds.
7. B3 seed defaults per decision; deploy + re-verify on a throwaway stack.

Estimate: 3–4 days. No API changes except (optionally) a small endpoint returning the possible
combinations + samples for a rules payload so the editor and the server can never disagree.

## Open decisions (resolved above)
1. Edit/create as **pages in the shell** (recommended; URLs, Back, menu always visible) or keep a
   modal but non-fullscreen, below the menu?
2. **Seed defaults:** keep all-central, or a mixed default (e.g. central 70 / split 25 / universal
   5 per non-facing side, engine/weapon W none)?
