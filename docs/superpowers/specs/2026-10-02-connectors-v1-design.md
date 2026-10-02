# Connectors v0.1 (Topology) Design

**Status:** approved by owner (conversational brainstorming), ready for implementation planning.

## Summary

Today, ship assembly treats any two parts occupying edge-adjacent cells as
connected — `validateLayout`'s `reachablePartIds` flood-fill walks plain
adjacency from the bridge, and any part it can't reach **hard-blocks saving
the layout** (`DISCONNECTED` error).

This spec replaces that all-or-nothing adjacency rule with **physical
connector nodes**: each 1×1 cell a part occupies can carry a connector on
each of its N/E/S/W sides, in one of three kinds (`central`, `split`,
`universal`). Two adjacent cells from different parts are connected through
their shared edge only if **both** facing sides carry **compatible**
connectors. A part with an unbroken chain of compatible connections back to
the bridge is "connected"; one that isn't is **not a build error** — the
layout always saves, and the disconnected part simply stops contributing
its functional stats (it still counts as mass, structure cost, and hit
points: it's still physically there, just not doing its job).

This is the foundation for a later, separate **Connectors v0.2** spec:
destroying a part mid-mission re-runs the same connectivity graph and
applies the same soft-disconnection effect to whatever falls out of the
bridge's reach. v0.1 does not implement that — it only needs to produce a
clean `connected: boolean` per part that v0.2 can later recompute at
runtime.

## Goals

- Replace plain-adjacency connectivity with connector-kind-aware
  connectivity, without adding any new *placement* restriction (parts can
  still be placed anywhere today's overlap/bounds rules already allow,
  side by side with an incompatible or absent neighbor-side connector —
  that's always legal; it just doesn't count as a connection).
- A part type's connector layout is picked once, at instance-creation time,
  from a small admin-authored set of candidate layouts — not independently
  rolled per side, and never re-rolled after creation.
- Every part type with no admin-authored layouts yet defaults to
  "universal on all sides, every cell" — nothing in the existing catalog
  breaks on day one.
- An admin can draw a part type's candidate connector layouts visually
  (reusing the existing generic entity-tuning admin system), the same way
  Ship Format's shapes are drawn.

## Non-goals (explicitly out of scope for this spec)

- **Connectors v0.2**: no mid-mission disconnection, no combat/resolver
  changes, no "destroyed part breaks the chain" behavior. This spec only
  produces the `connected` flag and the stat-contribution rule; triggering
  a *re*-computation of it during a mission is a separate spec.
- No energy/fuel/data routing semantics of any kind — connectors are
  purely structural/topological ("glue the ship together"), never a
  network for power or resources.
- No per-sub-cell-edge positional alignment — a connector is a per-(cell,
  side) attribute, not a finer physical-position system. Two facing
  connectors are compatible or not; there's no "offset" failure mode.
- No retroactive re-roll of already-created part instances when an admin
  later authors real candidate layouts for their type (see Rollout below).
- Ship Format (separate spec, `2026-10-02-ship-format-design.md`) — the two
  features don't depend on each other. Format changes which cells exist;
  connectors change which existing-cell adjacencies count as connections.

## Core model

### Connector kinds

`none | central | split | universal`, per (cell, side):

- `none` — nothing there; that side can never connect to a neighbor.
- `central` — matches another `central` or a `universal`.
- `split` — matches another `split` or a `universal`.
- `universal` — matches `central`, `split`, or another `universal`.
- `central` and `split` are **not** compatible with each other.

### Per-cell, not per-side-of-footprint

A part's connectors are defined per occupied **1×1 cell**, per side of that
cell (not once per side of the whole bounding box). For a 1×1 part that's
up to 4 connector slots. For a 2×2 part (4 cells), only the sides facing
**outside** the part's own footprint are meaningful — a side between two of
the part's own cells never needs a connector (it's one physical object,
already contiguous).

### Compatibility and the connectivity graph

Two cells from **different** part instances that are edge-adjacent are
connected through that edge only if **both** facing sides have a connector
and the kinds are compatible (see above). This is an *additional* condition
on top of today's plain adjacency — adjacency is still required (cells must
touch), connector compatibility is now also required for that touch to
count as a connection.

The connectivity computation is the same bridge-rooted flood-fill
`reachablePartIds` already performs in `apps/api/src/ships/geometry.ts`,
with one change: a neighbor cell is only enqueued if the edge between it
and the current cell is connector-compatible, not merely occupied. The
result is a `Set` of connected part-instance IDs, exactly as today, just
smaller.

### Soft disconnection, not a build error

`validateLayout` **no longer emits `DISCONNECTED`** (the error code is
retired; `LayoutErrorCode` becomes `'OUT_OF_BOUNDS' | 'OVERLAP'`). A layout
with disconnected parts always saves. Instead, every part in the resolved
layout carries a `connected: boolean`, computed from the flood-fill above.

### Effect on ship stats (`deriveSheet`)

`deriveSheet` (`apps/api/src/ships/sheet.deriver.ts`) splits its per-part
sum by connection status:

- **Always counts, connected or not** (structural): `mass`, `structureCost`
  (→ `structureUsed`), `partHp` (→ `hp`).
- **Only counts when connected** (functional): `pot`, `pdf`, `bli`, `esc`,
  `sen`, `crg`, `min`, `energyCont`, `energyCombat`, `batCharge`,
  `batOutput`, `batInput`, `fuelCap`, `fuelUse`.

Mobility (`pot ÷ mass`, in `rawMobility`) falls out of this automatically:
a disconnected engine still counts its mass but contributes no `pot`, so a
ship dragging dead weight gets measurably slower — no special-casing
needed beyond the split above.

The bridge's own cell is always "connected" (it's the flood-fill's root —
there's no chain to check for itself). Its own connector sides still
matter exactly like any other part's: whatever's placed next to the bridge
only connects to it if the bridge's facing side has a compatible
connector. The existing rule that `structureBudget` comes from the
bridge's own `structureCost` is unaffected either way.

## Data model

### `PartCatalog` gains `connectorLayouts: Json`

A list of complete candidate layouts, e.g. for a 1×1 tank with the
example you gave (central connector, either on the bottom or the left):

```json
[
  { "cells": [{ "dx": 0, "dy": 0, "side": "S", "kind": "central" }] },
  { "cells": [{ "dx": 0, "dy": 0, "side": "W", "kind": "central" }] }
]
```

`dx`/`dy` are offsets within the part's own footprint (0,0 is the part's
own origin cell, same convention `w`/`h` already use); `side` is one of
`N | E | S | W` in the part's **unrotated** orientation. A cell/side pair
not listed for a given candidate is `none`.

**Fallback:** `connectorLayouts` empty or absent → treat as a single
synthetic candidate with `universal` on every side of every occupied cell.
This is the behavior for every part type today, until an admin authors
real layouts for it.

**The bridge part type** gets its own `connectorLayouts` authored the same
way as any other type — in practice a single candidate with all 4 sides of
its cell(s) set (likely `universal`, to maximize what can dock to it), per
your "bridges always have 4 connectors" description. No special-casing in
the data model or code — purely a content decision made in the admin tool.

### `PartInstance` gains `connectors: Json`

Resolved **once**, at the moment the instance is created (market purchase,
mining/scavenge find, starter kit, admin grant) — picked uniformly at
random from the owning catalog entry's `connectorLayouts` (or the
universal fallback). Stored in the same shape as one candidate (`{cells:
[...]}`), fixed for the instance's lifetime — same pattern as `rarity` and
`condition`-at-creation already being locked into the instance, not
re-derived from the catalog on every read.

**No backfill, ever.** If an admin authors real `connectorLayouts` for a
part type that already has owned instances, only instances created **from
that point on** roll against the new candidates. Existing instances keep
whatever they already have (the universal fallback, if they predate any
authored layout) permanently. There is no migration job that touches
`PartInstance.connectors` retroactively.

### Rotation

A placement's existing `rot` field (0 or 90, the same rotation that
already transforms `w`×`h` in `canPlace`/`validateLayout`) applies the same
transform to connector sides: at `rot: 90`, `N→E→S→W→N` (each side rotates
one step clockwise), exactly mirroring how width and height swap today.
The catalog/instance data is always stored in the **unrotated**
orientation; the rotation is applied where placements are evaluated, the
same place width/height rotation already happens.

## API

### Player-facing

- `ShipResponse` and `PreviewResponse`'s per-part entries gain `connected:
  boolean` (alongside the existing `condition`/`broken`) — computed
  server-side, never client-derived (same D20 rule every other derived
  stat already follows).
- `POST /v1/ships/:id/preview` and `/assemble` stop being able to return a
  `DISCONNECTED` layout error. Both still return `OUT_OF_BOUNDS`/`OVERLAP`
  exactly as today.
- No new endpoints — connectivity is folded into responses that already
  exist.

### Admin

A new `'connector-layout'` field type (alongside Ship Format's new
`'grid-cells'` type) in `apps/api/src/admin/tuning/entity-schemas.ts`'s
`EntityFieldType` union, validated as an array of `{cells: [{dx, dy, side,
kind}]}` objects (`dx`/`dy` within the part's own `w`×`h`, `side` one of
the 4 directions, `kind` one of the 4 connector kinds). Attached to the
existing `parts` entity's schema as its `connectorLayouts` field — reuses
`EntityScreen.tsx`'s existing list/edit/revision-history machinery for the
`parts` entity; no new admin page.

## Frontend

### Hangar (player-facing)

- `ship-yard.tsx` draws a small glyph on each occupied cell's sides that
  have a connector (distinct marks for `central`/`split`/`universal`;
  nothing drawn for `none`) — lets the player see directly why two parts
  aren't linking up.
- A part with `connected: false` renders visually dimmed/flagged, same
  visual language already used for `broken`.
- The Ship Sheet surfaces a short note when any installed part is
  disconnected (e.g. "2 parts disconnected"), the same way the existing
  "N problems" viability summary already surfaces other issues — not a
  blocking error, just visible.

### Admin — connector layout tool

New widget for the `'connector-layout'` field: renders the part's own
`w`×`h` footprint (already known from the entity's other fields) as a
small grid; clicking a cell's side cycles `none → central → split →
universal → none`. "Add candidate" / "duplicate candidate" / "delete
candidate" controls build the list (the tank example is two small grids
side by side, one candidate each).

## Error handling

| Case | Behavior |
|---|---|
| Part placed with no compatible connector to any neighbor | Saves fine; part's `connected: false`, functional stats don't count |
| Part type has no `connectorLayouts` authored | Universal-on-all-sides fallback applies to every instance of it |
| Admin saves a candidate referencing a cell outside the part's own `w`×`h` | `400 VALIDATION_ERROR` (same path as any other entity-tuning validation failure) |
| Admin saves a candidate with an invalid `kind` or `side` value | `400 VALIDATION_ERROR` |
| Bridge itself | Always the flood-fill root; never evaluated for its own connectivity |

## Testing

- **API unit:** connector-compatibility edge rule (central/central,
  split/split, universal/either, central/split mismatch, one-side-empty);
  flood-fill connectivity across a multi-cell part and across a rotated
  part; `deriveSheet`'s structural-vs-functional split (mass/structure/HP
  count for a disconnected part, functional stats don't); fallback
  (empty `connectorLayouts` → universal everywhere).
- **API integration:** a layout with a disconnected part saves successfully
  (200, not the old `DISCONNECTED` 400) and the response's per-part
  `connected` flags and ship stats reflect it; a newly-created instance's
  `connectors` is one of its catalog's candidates (or the fallback);
  re-fetching an existing instance after the catalog gains new candidates
  shows its `connectors` unchanged (no retroactive reroll).
- **Web:** yard renders connector glyphs per side and dims a disconnected
  part; Ship Sheet shows the disconnected-count note; admin connector-
  layout widget (cycle kinds, multiple candidates, save round-trip).

## Review Focus

1. A part with **zero** connectors anywhere (all sides `none`) is legal —
   it's just permanently disconnected unless it's the bridge itself (which
   is always "connected" as the flood-fill root) — not a special case to
   guard against.
2. `LayoutErrorCode` loses `'DISCONNECTED'` — anywhere in the codebase that
   pattern-matches on that union (frontend error-message mapping,
   `hangar.problems.DISCONNECTED` i18n keys, etc.) needs that dead case
   removed, not just the backend emitter.
3. `PartInstance` already has an unused `propRoll: Json?` column with no
   references anywhere in `src/` — this spec adds a new, separately-named
   `connectors` column rather than reusing or repurposing that field,
   since its original intent is undocumented and unrelated.
4. A format-shape cell (Ship Format spec) with no part on it at all has no
   connectors to speak of — the two specs don't interact; connectors only
   ever matter between two cells that both have parts on them.
5. The admin connector-layout widget must prevent (client-side) and reject
   (server-side) a candidate placing a connector outside the part's
   current `w`×`h` — changing a part's `w`/`h` after its connector
   candidates were authored could otherwise leave stale out-of-bounds
   entries; the admin tool should re-validate/warn on save if the
   footprint and candidates have drifted apart.
