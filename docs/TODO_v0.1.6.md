# To do - v0.1.6

Delete an item when it ships.

## 1. Ship-structure damage (owner idea, 2026-10-27; moved from v0.2 to v0.1.5, then to v0.1.6 on 2026-11-23)

- [ ] Hull damage today spreads over every part alike, so a bridge or a reactor wears like a weapon and the dearest parts drive the
  repair bill (passive parts are ~30% of it, ~44% on ion). The idea: spread damage by the layers of the build, outer parts take more and
  inner ones (bridge, reactors) less, so the layout decides the ship's integrity. The resolver sees no positions, so the dispatch
  snapshot would carry an exposure per part; the sim has no layout model yet. *Needs design.*
