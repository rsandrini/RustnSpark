# Dragging and rotating parts (web)

What the hangar does with a mouse or a pen. A finger keeps tap-then-tap (the phone's parts list is a scrolling
sheet, and a drag there fights the scroll). Click-then-click works exactly as before everywhere.

## Drag

| From | To | Result |
| --- | --- | --- |
| A row of the parts list | A cell of the ship | The part is placed there (through `placePart`, so the same checks as a click). A green outline shows the landing cell, red when it does not fit |
| A placed part | Another cell | The part moves (this already existed) |
| A placed part | The parts list | The part leaves the ship and goes back to the list |

- A press that moves less than 6 px is a click. After a real drag the click that follows is ignored once.
- Dropping on a spot that does not fit, off the yard, or pressing Escape changes nothing.
- Only the parts list removes a part: letting go anywhere else just puts it back, so a slip never takes a part off.
  The list says so while a placed part is dragged ("Drop here to take it off the ship"). With the Store tab open there is no drop zone.
- A ship out on a mission cannot be edited: no drag starts and R does nothing.

Code: `drag-geometry.ts` (screen point to cell, threshold, who may drag), `use-tray-drag.ts` (the list-to-yard drag),
`ship-yard.tsx` (the ghost for a placed part, `cellFor`, the drop outline, release over `data-drop-zone="parts"`),
`hangar.page.tsx` (`placePart`, `removePart`, the wiring).

## Rotate with R

- R turns the part being carried (from the list or across the ship), else the part under the pointer, else the selected one.
- Not with Ctrl, Cmd or Alt (Ctrl+R reloads the page), not while typing, not with a popup open, one turn per press.
- The corner rotate icon and its press-and-drag live spin are gone. The toolbar's Rotate button stays: a phone has no R.
- A small line under the yard says "Press R to rotate the part" (hidden on touch screens).
- A part that just turned pulses for a moment, so the pilot sees which one.
- If there is no room to turn, the "no room to rotate" hint shows and nothing moves (a long part that cannot swing sideways is turned twice).

## Not done

- Touch drag (a long-press drag from the list) is separate, later work.
- Keyboard-only drag: tap-then-tap and R are the keyboard way.
