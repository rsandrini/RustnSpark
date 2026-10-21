# The mentor speaks: RPG-style dialogue scenes (plan, 2026-10-21)

Owner direction: the quest-giver face on a card is not enough. The faction's main person should **talk to the
pilot** in a popup that can sit in different places of the screen: a welcome, something about the faction, something
about the first ship, in RPG style, with options to click to move the conversation on. The Getting started card goes
back to being **a plain checklist**.

This builds on `quest-givers-plan.md` (section 9, the mentor) and replaces its idea of a speech bubble inside the
checklist. Nothing here is built. Review, then say "as recommended" or change the open points at the end.

## 1. What the player sees
- A **dialogue popup**: the mentor's portrait (faction symbol until a picture is uploaded), name and title, the text,
  and one or more buttons ("Continue", or choices like "Tell me about the Authority" / "Show me my ship").
- The text appears with a short typewriter effect (a click or key shows the rest at once; no effect when the pilot
  asked for reduced motion). Several nodes make a **scene**; the pilot clicks through it.
- **Positions**: each node says where the popup sits: centre (a big moment, dimmed screen), bottom (like an RPG text
  box), left or right (so the ship or the map stays visible), top. It can also **point at a part of the screen** (the
  Refuel tab, the Accept button, the ship grid): that element gets a highlight ring and the popup sits beside it.
- **Choices** can branch (a lore node that comes back to the main line) or act ("Take me to the Port" goes there
  and ends the scene). A scene can always be skipped; a skipped scene does not come back by itself, but the pilot
  can replay it from the profile menu ("Talk to <name> again").
- **The checklist** (Getting started) keeps only the steps, ticks and links. No portrait, no speech there.
- Phone: the popup is a bottom sheet; the highlight ring still shows; text and buttons are large enough to tap.

## 2. The scenes (first content, per faction, in the mentor's own voice, en + pt-BR)
| Scene | When it starts | About |
|---|---|---|
| `welcome` | right after the faction is chosen, on the first Ship screen | who the mentor is, what the faction stands for, what the pilot is here to do (about 6 nodes, 1-2 lore choices) |
| `first_ship` | after the welcome | the starter ship: the bridge, the parts, how to build it with Auto layout; points at the ship grid and the Auto layout button |
| `first_flight` | when the ship is built and the tank is low | refuel, take the test flight to the pad; points at Refuel and the Missions tab |
| `after_first_report` | the first time the pilot reads a report | what the report is, wear, repairs, what comes next |
| `low_fuel` | first time the tank is too low for the chosen mission | short, one node |
| `first_failure` | first failed or lost mission | short, kind; points at repair and rescue |
| `milestone_<tier>` | a new ship tier is reached (later) | a line of pride from the leader |
About 25 nodes per faction (75 in total), drafted by me, edited in Admin. A scene with no text yet is simply skipped.

## 3. How it works (data and rules)
- **Scenes are data, owned by Admin.** `QuestGiver` gets a `scenes` JSON column (only mentors use it at first). A
  scene = `{ id, trigger, once, nodes: [...] }`; a node = `{ id, text: {en, pt-BR}, position, anchor?, blocking?,
  next?, choices?: [{ label: {en, pt-BR}, next?, action? }] }`. `action` is one of a small fixed list (`goto:/port`,
  `goto:/port?tab=refuel`, `goto:/missions`, `replay`, `end`), never free code. `anchor` is a name from a fixed list
  of tour points the web exposes (`ship_grid`, `auto_layout`, `port_refuel`, `missions_tab`, `accept_button`...).
- **Progress is per pilot, on the server**: a `PlayerDialogue` row per scene (`sceneId`, `nodeId` last seen,
  `status` = seen | skipped | done, timestamps). A database reset starts fresh; a pilot never sees a finished scene
  again unless they ask to replay it.
- **Triggers are decided by the server** from the pilot's own records, as the checklist already is: `onboarded`,
  `ship_built`, `tank_low`, `first_report_read`, `first_failure`, `tier_reached`. `GET /v1/players/me/dialogue`
  returns the next scene that is due (one at a time, in order) with its nodes localized; `POST
  /v1/players/me/dialogue/:scene` records `advance`, `skip` or `done`. The web only renders; it never decides when.
- **Never in the way**: a scene only opens on a calm screen (not while a flight animation or a popup is open),
  never twice in a row, and not during the first seconds of a page load. A pilot can turn dialogues off in the
  profile (they then get only the checklist).
- **Accessibility**: `role="dialog"`, focus moves to the first button and returns afterwards, Enter/Space advance,
  Escape skips (with a one-line confirm for the first scene), text is real text (screen readers read it at once,
  the typewriter is only visual), contrast and 320 px layouts checked by the existing widths and a11y specs.

## 4. Admin (plain forms, like the rest of Admin)
- On a mentor's page, a **Scenes** section: list of scenes, each with trigger and order; a node list with the
  bilingual text, position select, anchor select, choices (label + target node or action), and a **live preview**
  that plays the scene as the pilot sees it. Validation: every `next` points at a node that exists, no loops
  without an exit, every text has both languages, anchors and actions are from the fixed lists.

## 5. Work split (two lanes, contract first)
**Contract (A, first, about an hour)**: `DialogueSchema` (scene with nodes), `DialogueProgress`, the two endpoints.

**Lane A (backend)**
- Create: migration (`QuestGiver.scenes`, table `PlayerDialogue`), `apps/api/src/dialogue/` (`dialogue.service.ts`,
  `dialogue.controller.ts`, `triggers.ts` pure: which scene is due from the pilot's records), `seed-data/dialogue-scenes.ts`
  (the 75 nodes), unit tests for triggers and scene validation, `test/integration/dialogue.int-spec.ts`.
- Edit: `schema.prisma`, `seed.ts`, `entity-schemas.ts` + `entity-tuning.service.ts` (scene validation), the
  route audit and idempotency lists (`test/security/*`), `seed.int-spec.ts`.

**Lane B (frontend)**
- Create: `features/dialogue/` (`dialogue-host.tsx` mounted in the in-game chrome, `dialogue-box.tsx`,
  `use-dialogue.ts`, `anchors.ts` the fixed tour points + highlight ring, `typewriter.ts`), `styles/dialogue.css`,
  Admin `SceneEditor.tsx` + preview, `e2e/dialogue.spec.ts`.
- Edit: tutorial card (remove portrait and bubble; checklist only), `ui/GiverBadge` reuse, anchors added as
  `data-tour` attributes on the ship grid, Auto layout, Refuel tab, Missions tab, Accept button, profile menu
  (dialogues on/off, replay), i18n (`dialogue.*`, `admin.dialogue.*`), `test/msw/handlers.ts`.
- Rule as before: B never edits the contract, schema, migrations or `apps/api`; A never edits `apps/web`.

Order: contract, then A (schema, triggers, endpoints, seed) and B (host, box, anchors against mocks) in parallel,
then wiring, Admin editor, e2e, content.

## 6. Risks and notes
- **Annoyance**: a pop-up that interrupts is the risk. Mitigations: one scene at a time, calm-screen rule, skip
  always available, replay on request, off switch, only 4 scenes before the pilot's first mission is done.
- **Content volume** is the real cost (about 75 nodes, two languages); the engine works with one scene.
- **Anchors** depend on the screens keeping their `data-tour` hooks: a missing anchor falls back to a centred popup.
- The existing `GET /players/me/mentor` lines (checklist nudges) stay for the checklist's plain texts only if the
  owner still wants them; otherwise they are retired with the bubble.
- Existing pilots are ignored as agreed (resets are frequent): everyone starts at `welcome`.

## Open points (recommendation first)
1. **Blocking vs not**: the first `welcome` is a centred, dimmed, blocking scene; every later scene is a
   non-blocking box at the bottom or side (recommended). Alternative: all non-blocking.
2. **Typewriter effect**: on, skippable, off for reduced motion (recommended).
3. **Highlight ring on screen elements**: yes (recommended), with the centred fallback.
4. **Choices**: lore branches and "take me there" actions only; no choice changes the game (recommended). No
   reputation or faction effects from dialogue in v1.
5. **Replay and off switch** in the profile menu (recommended).
6. **Retire the checklist's mentor lines** (`/players/me/mentor` steps) once scenes exist (recommended); keep
   the endpoint for the mentor's identity only.
