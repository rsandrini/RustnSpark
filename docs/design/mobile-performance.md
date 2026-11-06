# Phone heating (owner report, 2026-11-05)

A tester reported the phone getting hot while the game was open. This is what the code was checked for,
what was changed, and what is still unmeasured.

## Inventory (read from the code)

Polls (TanStack pauses `refetchInterval` while the tab is hidden, so none of these run in the background):

| Where | Every | Only when |
| --- | --- | --- |
| active mission (map, transit, flight watcher) | `transitPollInterval` | always |
| board | 15 s | on the board |
| active ship stage | 15 s | on the ship |
| dialogue | 10 s | always |
| tutorial progress | 4 s | the checklist is on screen |
| repair (port) | 4 s | the ship is repairing |
| notice banner | 60 s | always |

Timers: one 1 s interval per `Countdown`, a 800 ms calm check in the dialogue host, a 400 ms anchor read while a
dialogue box points at something. None of them re-render when the value does not change.

CSS: 29 endless animations. The ship animation banner is already off on phones. What kept running on a phone
during a long flight: the dashed route line, the ship's pulse on the route map, the "here" pulse on the map,
the status light in the ship header, and the landing ship's flame.

## Changed

- `styles/mobile.css`: those five decorations stop on phones (`max-width: 700px` or `hover: none`).

## Not measured yet

Nothing here was measured on a device. To measure: open the game on the phone with the remote inspector
(Safari or Chrome), start a long flight, leave the transit screen open for five minutes and read the CPU and
"paint" rows in the performance panel. If it is still hot, the next suspects are the yard's SVG on the hangar
screen and the 1 s countdowns (one shared ticker would replace one interval per card).
