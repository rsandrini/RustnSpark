# Drag and Drop for Ship Parts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the web (mouse and pen) a pilot can drag a loose part from the parts list onto the ship to place it, and drag a placed part out of the ship onto the parts list to remove it, while click-then-click keeps working exactly as today.

**Architecture:** The yard already drags placed parts as a ghost and commits through `placePart`. This adds (1) a pure geometry module shared by the yard and the new drag, (2) a "drop on the parts list = remove" end for the existing ghost, and (3) a page-level tray drag (a floating chip, a drop outline in the yard, one `placePart` call on release). Touch stays on click-click: the phone's parts list is a scrolling bottom sheet and a drag there fights the scroll.

**Tech Stack:** React, TypeScript, Vitest + Testing Library (jsdom), Playwright smoke.

**Spec:** owner request, 2026-11-06 ("drag to use, and drag out to remove", web only today). Decisions are listed at the end.

## Global Constraints

- Web only for this plan; no phone/touch drag (`pointerType === 'touch'` never starts a drag).
- Player-facing text bilingual (en + pt-BR), no hard-coded strings.
- Click-then-click must keep working unchanged (a press that moves less than 6 px is still a click).
- A drag never validates on its own: placement goes through the existing `placePart` (which uses `placementIssue`), removal through the existing remove path; the server still validates on save.
- `modifyBlocked` / `editable === false` (ship out on a mission): no drag starts.
- Run `pnpm test:e2e` and the browser smoke before pushing; `jsx-no-literals` lint applies.

## Review Focus

- A click with a little hand jitter (under 6 px) still selects the part; it does not start a drag or swallow the click.
- Dropping on an invalid cell, outside the yard, or releasing after Escape / pointer cancel changes nothing and the part stays in the list.
- A placed part dropped anywhere except the parts list returns to where it started (never removed by accident); with the Store tab open there is no drop zone, so it also returns.
- The pointer is released outside the browser window or the page scrolls mid-drag: the chip and the highlights clear, no stuck "dragging" state.
- Ship on a mission: pressing and moving on rows or blocks does nothing.

## File structure

- Create `apps/web/src/features/hangar/drag-geometry.ts`: pure helpers (screen point to cell, drag threshold, drop-zone test).
- Create `apps/web/src/features/hangar/use-tray-drag.ts`: the page-level hook for the list-to-yard drag.
- Create `apps/web/src/features/hangar/tray-drag-chip.tsx`: the floating chip that follows the pointer.
- Modify `ship-yard.tsx` (shared geometry, `onRemovePart`, `cellFor` handle, `dropPreview` outline), `tray-part-row.tsx` (drag start), `hangar.page.tsx` (`removePart`, drop zone, wiring), `i18n/en.json`, `i18n/pt-BR.json`, `styles/ship.css`.
- Tests: `drag-geometry.spec.ts`, `ship-yard.spec.tsx`, `hangar.spec.tsx`, `apps/web/e2e/drag-parts.spec.ts`.

### Task 1: Shared drag geometry

**Files:**
- Create: `apps/web/src/features/hangar/drag-geometry.ts`
- Modify: `apps/web/src/features/hangar/ship-yard.tsx` (the `pointerToCells` function uses the new helper)
- Test: `apps/web/src/features/hangar/drag-geometry.spec.ts`

**Interfaces:**
- Produces:
  - `type Box = { left: number; top: number; width: number; height: number }`
  - `type View = { cx: number; cy: number; span: number }` (the yard's existing view window; reuse the type already in `ship-yard.tsx` instead of redefining)
  - `clientToCells(box: Box, view: View, clientX: number, clientY: number): { x: number; y: number }`
  - `insideBox(box: Box, clientX: number, clientY: number): boolean`
  - `DRAG_THRESHOLD_PX = 6` and `movedPastThreshold(startX: number, startY: number, x: number, y: number): boolean`
  - `startsDrag(pointerType: string, editable: boolean): boolean` (false for `'touch'` and when not editable)

- [ ] **Step 1: Write the failing tests** in `drag-geometry.spec.ts`: `clientToCells maps the box corners to the view corners and its centre to (cx, cy)` (box 400x400 at (100,50), view cx 10 cy 10 span 20: the top-left corner gives (0,0), the centre (10,10)); `insideBox is false just outside every edge`; `movedPastThreshold is false at 5 px and true at 6 px, in any direction`; `startsDrag refuses touch and a frozen ship, accepts mouse, pen and an empty pointer type (jsdom)`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run src/features/hangar/drag-geometry.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the module (the mapping is the one `pointerToCells` uses today: `cx - span/2 + (clientX - left) * span / max(width, 1)`), then make `pointerToCells` in `ship-yard.tsx` call `clientToCells` with the svg's `getBoundingClientRect()`.
- [ ] **Step 4: Run** the new spec and `src/features/hangar`. Expected: PASS, existing yard tests unchanged.
- [ ] **Step 5: Commit** `refactor(hangar): drag geometry in one place`.

### Task 2: Drag a placed part out to the parts list to remove it

**Files:**
- Modify: `ship-yard.tsx`, `hangar.page.tsx`, `styles/ship.css`, `i18n/en.json`, `i18n/pt-BR.json`
- Test: `hangar.spec.tsx`

**Interfaces:**
- Consumes: `startsDrag`, `insideBox` from Task 1.
- Produces:
  - `ShipYardProps.onRemovePart?: (partInstanceId: string) => void` called when a ghost is released over an element with `data-drop-zone="parts"`.
  - In `hangar.page.tsx`: `removePart(partInstanceId: string): void` (the body of today's `removeSelected`, which now calls `removePart(selectedId)`), and the parts panel carries `data-drop-zone="parts"` only while the Parts tab shows and the ship is editable.

- [ ] **Step 1: Write the failing tests** in `hangar.spec.tsx`: `dropping a placed part on the parts list removes it from the ship and puts it back in the list` (press a block, release with the pointer over the panel marked `data-drop-zone="parts"`; stub `document.elementFromPoint` to return that panel; expect the block gone and the part's row in the list); `dropping a placed part anywhere else leaves it where it was` (elementFromPoint returns the yard; expect the block unchanged); `with the Store tab open a released part is not removed` (no drop zone on the panel).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the release rule in the yard's `handlePointerEnd`: if a ghost is live, `document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-drop-zone="parts"]')` is non-null then `onRemovePart?.(ghost.partInstanceId)` (no placement); otherwise the existing placement/return rule. Add the panel attribute and `removePart` in the page. While `draggingId !== null` the panel gets class `drop-ready` and shows one hint line `hangar.drag.removeHint` ("Drop here to take it off the ship" / pt-BR); a `:hover` style on `.drop-ready` highlights it. CSS in `ship.css`.
- [ ] **Step 4: Run** the new tests and `src/features/hangar`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(hangar): drag a part out of the ship onto the parts list to remove it`.

### Task 3: Drag a loose part from the parts list onto the ship

**Files:**
- Create: `use-tray-drag.ts`, `tray-drag-chip.tsx`
- Modify: `ship-yard.tsx` (forward a ref, `dropPreview`), `tray-part-row.tsx`, `hangar.page.tsx`, `styles/ship.css`
- Test: `ship-yard.spec.tsx`, `hangar.spec.tsx`

**Interfaces:**
- Consumes: `clientToCells`, `insideBox`, `movedPastThreshold`, `startsDrag` (Task 1); `placePart(id, gx, gy)` and `placementIssue` already in the page.
- Produces:
  - `ShipYardHandle = { cellFor(partInstanceId: string, clientX: number, clientY: number): { gx: number; gy: number; width: number; height: number; valid: boolean } | null }` exposed by `forwardRef`/`useImperativeHandle` on `ShipYard`; `null` when the point is outside the svg. The cell is the part's centre under the pointer, rounded like the ghost (`Math.round(x - width / 2)`), rot 0, validity from `placementIssue(layout, catalogById, id, gx, gy, 0, cellSet) === null`.
  - `ShipYardProps.dropPreview?: { gx: number; gy: number; width: number; height: number; valid: boolean } | null`, drawn with the ghost's `ghost-cell ok|bad` classes.
  - `useTrayDrag(options: { yard: RefObject<ShipYardHandle>; enabled: boolean; onDrop: (partInstanceId: string, gx: number, gy: number) => void }): { dragging: { partInstanceId: string; x: number; y: number } | null; dropPreview: DropPreview | null; begin(partInstanceId: string, event: ReactPointerEvent): void; consumeClick(): boolean }`. `begin` records the press; once `movedPastThreshold` it starts the drag (window `pointermove` / `pointerup` / `pointercancel` / `keydown` Escape listeners, removed on end), sets `dropPreview` from `yard.cellFor`, and on release calls `onDrop` only when the preview is valid. `consumeClick()` returns true once after a real drag so the click that follows is ignored.
  - `<TrayDragChip name x y />` (position fixed, `pointer-events: none`, `aria-hidden`).
  - `TrayPartRowProps.onPointerDragStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void`.

- [ ] **Step 1: Write the failing tests:** in `ship-yard.spec.tsx`, `cellFor returns the cell under the pointer with its validity, and null outside the yard` (mock the svg's `getBoundingClientRect`; one free cell gives `valid: true`, a cell on the bridge gives `valid: false`); in `hangar.spec.tsx`, `dragging a loose part onto a free cell places it and the click that follows is ignored`, `a press that moves less than 6 px is still a click that selects the part`, `releasing over an invalid cell or outside the yard leaves the part in the list`, `Escape during the drag cancels it`, and `no drag starts while the ship is on a mission`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the handle and `dropPreview` in the yard, the hook and the chip, the row's `onPointerDown` (calls `onPointerDragStart` only when `startsDrag(event.pointerType, !disabled)`), and the page wiring: `onDrop={placePart}`, `consumeClick()` checked at the top of the row's `onSelect` so a drag never also selects. The chip shows the part's localized name. A drag also sets `body.dragging-part` (cursor `grabbing`) and removes it on end.
- [ ] **Step 4: Run** the new tests and `src/features/hangar`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(hangar): drag a loose part from the list onto the ship`.

### Task 4: Real-browser check and notes

**Files:**
- Create: `apps/web/e2e/drag-parts.spec.ts`
- Modify: `docs/design/` (a short `parts-drag-and-drop.md` with the rules below)

- [ ] **Step 1: Write the smoke** (desktop project only): `registerAndLaunch` then "Empty the ship" so the parts return to the list; drag the first row onto an empty yard cell with `page.mouse` (down, a few `move` steps, up) and expect the part block in the yard; drag that block back onto the parts panel and expect its row in the list again; then place one part by click-click to prove it still works; save, reload, expect the layout kept.
- [ ] **Step 2: Run** it on the scratch stack (`compose -p rs_verify`, the recipe in the dev notes). Expected: PASS on desktop.
- [ ] **Step 3: Write** the design note (what drags, what does not, touch stays click-click, the drop-zone rule) and **commit** `test(hangar): drag and drop smoke; notes`.

---

## Decisions (defaults assumed above; say if you want any changed)

1. Removal happens only when the part is released over the parts list, never by dropping it "anywhere outside the yard" (safer: a slip does not remove a part).
2. A tray drag always starts the part at rotation 0; `placePart` already picks a clean facing for engines and weapons, and the pilot can rotate after.
3. Dragging is pointer-only (no keyboard drag); click-then-click remains the keyboard path.
4. The drag threshold is 6 px; hover cards stay as they are.
5. Phone/touch: untouched in this plan (a long-press drag is a separate, later piece of work).
