# Rust and Spark

A space-trading and mission game: the pilot builds a ship from parts, flies missions across a map of ports and hostile space, and grows it by upgrading parts and its bridge.

## Ship

**Bridge**:
The command part every ship has exactly one of. It sets how much structure the ship can carry and which ship formats it opens. If it is destroyed, the ship is destroyed.
_Avoid_: Core, command module

**Ship format**:
The assembly yard a ship is built inside: the set of cells its parts must fit. A format opens by the bridge's rarity and size.
_Avoid_: Layout (that is where parts sit inside the format), grid, hull

**Expand / Shrink**:
Changing the bridge's size at a port. Expand turns a 1×1 bridge into the 2×2 one rarity level below, for its full price; Shrink sells a 2×2 and gives the 1×1 of the same rarity.
_Avoid_: Upgrade (that raises rarity, never size), downgrade

## Carrying

**Cargo hold**:
The ship's cargo space: where ore and a mission's cargo are kept. A mining run needs some.
_Avoid_: Hold (ambiguous with spare slots), storage

**Spare slots**:
The places the bridge has for loose parts carried along. More loose parts than slots and the ship cannot depart.
_Avoid_: Inventory slots, hold

**Goods**:
What the pilot holds ashore and sells at a port: ore, scrap, core fragments. They take no ship space.

## Materials

**Scrap**:
The one generic, cheap material left of worn-out parts. Upgrades ask for it and any port buys it.
_Avoid_: Wreckage (that is the place scrap is found), per-part scrap

**Core fragment**:
A shard found in dangerous places. Epic and legendary upgrades ask for several of them directly.
_Avoid_: Core, prototype core, ancient core (cores no longer exist)

## Missions and the map

**Deep field**:
A far, hostile place beyond the settled map, reached by long dangerous routes, where only rare crystals are dug and with difficulty.
_Avoid_: Zone (a zone is a danger tier from 0 to 3)

**Zone**:
A danger tier of a place, 0 (safest) to 3. Pirates, scavenging and wear are keyed by it.

**Find**:
A part or piece of scrap a scavenging run brings back.
_Avoid_: Drop (a drop is what a mission or a fight leaves)

## Combat

**Draw**:
A fight that ends with neither side broken and no winner: only when the hulls are exactly level at the round cap.

**Flee**:
A side leaving a fight on purpose once its hull falls to the retreat threshold. Not a draw.

**Destroyed ship**:
The result of a bridge reaching the dead threshold: every part is lost and the pilot restarts with a new starter pack, keeping money and goods.
