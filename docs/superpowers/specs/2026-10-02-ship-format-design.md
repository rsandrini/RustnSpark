# Ship Format Design

**Status:** approved by owner (conversational brainstorming), ready for implementation planning.

## Summary

Today every ship builds on a fixed 20×20 square grid (`GRID_HALF_SIZE = 10` in
`apps/api/src/ships/geometry.ts`). This spec adds **Ship Format**: a named,
admin-drawn shape (an explicit set of grid cells, anchored on the bridge) that
a player selects independently of which bridge part they have installed,
gated only by that bridge's rarity. The format defines *which cells exist* —
nothing else. It carries no stats of its own; ship stats continue to come
entirely from installed parts, exactly as today.

This is purely a placement-shape feature. It does not touch combat,
viability formulas, or the sheet-derivation pipeline. It is also the
foundation a later "draw the ship's external silhouette" feature can trace
from the same cell set — not built here, but the data model is chosen so it
is possible later without another migration.

## Goals

- A player can see which formats their current bridge's rarity unlocks, and
  switch between them.
- An admin can **draw** a format's shape in a grid tool (click/drag to
  paint/erase cells) rather than hand-authoring coordinate JSON, name it,
  describe it, and set its rarity gate.
- Existing ships keep working with no visible change unless the player
  deliberately picks a different format.

## Non-goals (explicitly out of scope for this spec)

- Any stat effect from the format itself (no bonus structure budget, mass,
  etc. — purely spatial).
- Drawing/rendering the ship's external silhouette on screen (future work;
  this spec only makes the data shape available for it).
- Per-bridge-part fixed formats (format is a free, independent choice, gated
  only by rarity — not baked into a specific bridge catalog entry).
- The Connectors mechanic (separate spec, see
  `docs/superpowers/plans/2026-09-27-playtest-round-2-plan.md` conversation
  context — bridges will eventually carry 4 directional connectors, but that
  is entirely out of scope here; this spec does not reference connectors at
  all beyond anchoring the format's origin cell on the bridge).

## Data model

### New table: `ShipFormat`

```prisma
model ShipFormat {
  id          String   @id                 // e.g. "classic_square", "cross_mk1"
  displayName Json                         // { en, pt-BR }
  description Json                         // { en, pt-BR }
  cells       Json                         // [[x, y], [x, y], ...] — relative to the bridge at (0,0)
  minRarity   Rarity                       // bridge rarity required to unlock this format
  active      Boolean  @default(true)
  ships       Ship[]
}
```

- `cells` always includes `[0, 0]` (the bridge's anchor cell) — the admin
  drawing tool enforces this (that cell is pre-painted, non-erasable).
- `minRarity` reuses the existing `Rarity` enum (`COMMON` < `UNCOMMON` <
  `RARE` < `EPIC` < `LEGENDARY`) and the same ordering convention already
  established for part-upgrade tiers (`part-upgrade.calculator.ts`).
- `active: false` retires a format the same way `PartCatalog.active` and
  `MissionTemplate.active` already do — existing ships keep whatever they
  have; it stops appearing in the unlock list for new selections.

### `Ship` gains

```prisma
model Ship {
  // ...existing fields...
  formatId String      @default("classic_square")
  format   ShipFormat  @relation(fields: [formatId], references: [id])
}
```

### Migration

The `ShipFormat` table and the `classic_square` row must exist before the
`Ship.formatId` column (with its default) is added — either as two ordered
migrations or one transaction that creates the table, inserts the row, then
adds the column, in that order.

A seed/migration step inserts `ShipFormat` row `classic_square`:
`cells` = every `(x, y)` with `-10 <= x < 10` and `-10 <= y < 10` (reproducing
today's exact grid, 400 cells), `minRarity: COMMON`, so the unlock list is
never empty even for a COMMON bridge. Every existing `Ship` row is backfilled
with `formatId: 'classic_square'` (the column default already covers new
rows; existing rows get an explicit `UPDATE`). No existing layout changes
shape or needs re-validation at migration time — `classic_square`'s cell set
is identical to the hardcoded bounds it replaces.

## Placement validation (`apps/api/src/ships/geometry.ts`)

`validateLayout` currently checks each occupied cell against
`GRID_HALF_SIZE`'s fixed bounds. It instead takes the ship's format's cell
set (loaded as a `Set<string>` of `"x,y"` keys, one lookup per occupied
cell) and swaps the bounds check for a set-membership check. The error code
stays `OUT_OF_BOUNDS` (same meaning to the player: "this cell isn't part of
your ship"). The bridge-reachability flood-fill (`reachablePartIds`) is
**unchanged** — it already walks edge-adjacency between occupied cells,
which works identically inside an irregular shape.

`GRID_HALF_SIZE` itself is retained only as the admin drawing tool's canvas
ceiling (see below), not as a gameplay constant — no format's cells may
exceed `[-15, 15)` on either axis (a generous ceiling comfortably above
today's ±10, enforced by the drawing tool and re-validated server-side on
save).

## API

### Player-facing

- **`GET /v1/ship-formats`** — no parameters; resolves the caller's own ship
  the same way `GET /v1/ships` already does (one ship per player). Returns
  every format where `active` and (`minRarity <= ` the viewer's current
  bridge rarity, or `minRarity === COMMON`) — always includes
  `classic_square`. Shape: `{ id, displayName, description, cells,
  minRarity }[]`.
- **`POST /v1/ships/:id/format`** — body `{ formatId }`. Validates the
  target format is unlocked for the ship's current bridge rarity (409
  `FORMAT_NOT_UNLOCKED` otherwise), re-validates the ship's **current**
  layout against the new cell set, and for every placement whose cell(s)
  fall outside the new shape: removes it from `layout` and returns it to
  `INVENTORY` (identical effect to the existing "remove a part" path —
  reuses that code, not a new removal mechanism). Returns the updated
  `ShipResponse` (already carries `yard`; `yard.cells` replaces
  `yard.halfSize`, see Contract changes below).

### Admin

Registered as a new entity (`ship_format`) in the existing generic
entity-tuning system (`apps/api/src/admin/tuning/entity-schemas.ts` +
`entity-tuning.service.ts`), which already gives every entity list, get,
create, update, retire, and revision-history endpoints for free
(`/v1/admin/tuning/ship_format[/...]`) — no bespoke admin controller needed,
consistent with how `parts`/`mission_templates`/etc. are administered today.

The one addition: a new `EntityFieldType` variant, `'grid-cells'`, alongside
the existing `string | integer | float | boolean | json | enum |
locale-map` union in `entity-schemas.ts`. Server-side validation for it is
`z.array(z.tuple([z.number().int(), z.number().int()]))` plus a refinement
requiring `[0, 0]` to be present and every coordinate within the ±15 canvas
ceiling. `ship_format`'s schema declares `cells: { type: 'grid-cells',
required: true }`.

### Contract changes (`packages/contract`)

- `ShipResponseSchema`'s `yard: { halfSize: number }` becomes `yard: {
  cells: [number, number][] }` (the frontend already only reads
  `yard.halfSize` to size its own rendering — this is a breaking but
  contained change, both apps ship together).
- New `ShipFormatSchema`: `{ id, displayName, description, cells: [number,
  number][], minRarity }`.

## Frontend

### Hangar (player-facing)

- A "Format" control near the yard's existing Rotate/Remove controls (same
  visual weight). Opens the unlocked-formats list (from `GET
  /v1/ship-formats`); picking one calls `POST /v1/ships/:id/format` and
  refetches the ship.
- The yard's SVG grid (`ship-yard.tsx`) renders only cells present in
  `ship.yard.cells` — cells outside the format are neither drawn nor
  clickable (today it always draws the full square from `halfSize`).
- If the format switch drops any placed parts to inventory, the existing
  "N problems" / tray-update UI already used when parts are removed covers
  the feedback — no new notification mechanism needed.

### Admin — format drawing tool

A new `'grid-cells'` case in the existing generic field renderer
(`apps/web/src/admin/tuning/SchemaForm.tsx`'s field-type dispatch, which
already branches on `field.type === 'boolean' | 'enum' | 'locale-map' |
'json' | ...`): a small paint-grid component — click to toggle a cell,
drag to paint a run, the bridge's `(0,0)` cell pre-painted and locked. Reads
and writes the same `[[x,y], ...]` array the generic entity form already
round-trips for a `json`-typed field; only the widget changes. This reuses
100% of `EntityScreen.tsx`'s existing list/create/update/revision-history
machinery — the new entity (`ship_format`) needs no bespoke admin page.

## Error handling

| Case | Response |
|---|---|
| Switch to a format whose `minRarity` exceeds the current bridge | `409 FORMAT_NOT_UNLOCKED` |
| Switch to an unknown/retired `formatId` | `404` (unknown) / `409 FORMAT_INACTIVE` (retired) |
| Admin draws a format missing `[0,0]` or exceeding the ±15 ceiling | `400 VALIDATION_ERROR` (same path as any other entity-tuning validation failure) |
| A ship has no bridge installed at all when checking unlocks | Only `classic_square` (and any other `minRarity: COMMON` format) is unlocked |

## Testing

- **API unit:** `validateLayout` against a non-square cell set (in-shape,
  out-of-shape, bridge-always-anchored-valid cases); existing
  OVERLAP/DISCONNECTED cases re-run unaffected to confirm no regression.
- **API integration:** format list reflects bridge rarity; format switch
  drops out-of-shape parts to inventory and returns the updated ship;
  `FORMAT_NOT_UNLOCKED` on a gated switch attempt; migration backfill
  (existing ship reads back `classic_square` with the full legacy square).
- **Web component:** format picker (lists unlocked formats, switching
  calls the endpoint, yard redraws to the new shape); admin paint-grid
  widget (paint/erase/drag, bridge cell locked, save round-trips the same
  array back).

## Review Focus

(Per the writing-plans convention — carried into the implementation plan's
own Review Focus section, listed here since this spec is the source of
truth for what a reasonable player/admin would expect.)

1. Switching away from a format and back should restore any dropped parts'
   *positions* if they still fit (not just silently lose the old layout) —
   **decided out of scope**: dropped parts go to inventory and must be
   re-placed by hand, same as manual removal; no undo/history of positions.
2. A bridge that gets *downgraded* mid-game (is that even possible? parts
   don't downgrade today) is not a real scenario — not tested.
3. An admin retiring (`active: false`) a format that ships are currently
   using must not break those ships — their `formatId` FK stays valid
   regardless of `active`; only new selections are filtered.
4. Two formats with the same `minRarity` and overlapping cell sets are
   allowed (no uniqueness constraint beyond `id`) — this is intentional,
   formats are a presentation/shape choice, not a rarity-indexed ladder.
5. The ±15 drawing ceiling must be enforced **server-side**, not just in
   the admin tool's UI — a direct API call must not be able to save an
   oversized format.
