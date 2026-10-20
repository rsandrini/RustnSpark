# Quest givers: a face and a voice for every mission (plan, 2026-10-20)

Owner idea: the board is "click here, click there, wait". Give each port **people** who hand out the quests: a
picture on the card, a name, a line in their own voice, and a personality that decides what they offer. The first
mission should say, in RPG style, that it is a test flight. Several people per faction, picked at random. No
images need generating: Admin gets a place to upload the picture and edit the parameters; until then the faction
symbol is the placeholder.

Nothing here is built. Review, then say "as recommended" or change the open points at the end.

## 1. What the player sees
- **Mission card / row**: a portrait (round, 48 px on a row, 96 px on the open card), the giver's name and role
  ("Dispatcher Ines Moura, Ceres Port"), and the brief **in their voice** instead of the flat template text. The
  facts (route, reward, fuel, requirements) stay exactly as they are; the voice only replaces the description.
- **Active mission and report**: the same portrait and a short closing line when the report is read ("Good flying.
  Come back when the tank is full."), a different line for success, partial and failure.
- **Port header (optional, phase 3)**: "Today at Ceres: Ines, Tomas, Old Vik", the people who have offers now.
- **The first flight**: a fixed giver per faction (a trainer / dockmaster) whose brief says "This is a test flight:
  a hop to the pad and back. Fuel up first." The tutorial steps stay as they are; the voice makes the reason clear.
- Placeholder: no portrait uploaded → the faction symbol on the faction colour, so every build looks finished.
- Everything bilingual (en + pt-BR), no hard-coded strings; names are data, not translated (a name may carry
  both languages if the owner wants).

## 2. The model
A new table, owned by Admin (the tuning policy: DB wins, no TS defaults for the content):

`QuestGiver`
- `id` (slug), `factionId`, `active`
- `displayName` (plain text), `title` (bilingual JSON: "Dockmaster", "Mecânica-chefe")
- `art` (JSON `{portrait?}` → file name in the existing art store, same shape as `Faction.art`)
- `personality` (JSON, see below), `lines` (bilingual JSON pools, see §4)
- `locationIds` (where they work; empty = any place of their faction), `weight` (how often they are picked)

`MissionInstance` gets `giverId` (nullable, set when the offer is generated). The giver is **chosen at generation
time and stored**, so the same offer shows the same person on every read, and the seed stays deterministic
(`createRng(seed).child('giver')`).

## 3. Personality = what they offer
`personality` is data, not code:
- `types`: weighted mission types ("transport 60, delivery 30, rescue 10"). A giver never offers a type with
  weight 0. Examples: the **Quartermaster** only delivery and transport; the **Rescue coordinator** only rescue;
  the **Prospector** only mining and scavenging-flavoured delivery; the **Race marshal** races and escorts; a
  **Fixer** is generic (all types, flat weights).
- `riskBand`: min/max zone they hand out (a cautious dockhand stays in zones 0-1; a smuggler goes to the edge).
- `rewardBias`: ±% on the reward (generous / stingy), small, bounded by the existing reward rules (never above
  the tuning caps, so the balance work is unchanged).
- `tone`: a tag used to pick lines ("formal", "gruff", "friendly", "nervous").

Selection when a board slot is filled: today `fillMission` picks a template (type by the board variety rules).
New order: (1) pick the **giver** among those who work at this place (weighted, and not the same giver in more
than half the board, like the type rule), (2) pick the **type** from the giver's weights intersected with what
the place can serve (`eligibleTypesAt`), (3) pick the template of that type and faction as now. The variety rules
(every type before repeats, board sizes) still apply on top, so a board never becomes four of one thing; if a
giver cannot fill the rules, the board falls back to a generic giver of the faction (always at least one, a
guard in the seed and in Admin: a faction cannot be left without a generic giver).

## 4. The voice
Templates keep their facts; the giver supplies the words. Two layers so we do not write 30 x 40 texts:
- **Template flavour** stays as `MissionTemplate.description` (what the job is). It remains the fallback.
- **Giver lines** are pools keyed by mission type and moment: `offer.<type>`, `accepted`, `report.success`,
  `report.partial`, `report.failure`, plus `first_flight` for the test flight. Each is a list of short bilingual
  lines with placeholders (`{destination}`, `{cargo}`, `{reward}`) filled from the offer; the line is chosen by
  the mission seed (stable per offer). Missing pool → the template description, so a giver with no lines yet still
  works (the owner can add voice gradually).
- First pass of writing: 4 givers per faction x ~3 lines per pool is about 150 lines; I draft them in both
  languages, the owner edits in Admin.

## 5. Admin (excluded from the redesign, so plain forms like the rest of Admin)
- **Quest givers** list (filter by faction), create / edit page: name, title (en / pt-BR), faction, places,
  weight, active, portrait upload (reuse the existing art service: add kind `givers` with slot `portrait`; same
  size and type checks), personality editor (type weights as numbers, risk band, reward bias, tone), and the
  line pools as editable lists per key with a **live preview** of one rendered card.
- Audit log entries and the config snapshot behave as the other Admin editors do; deleting is "deactivate" when
  offers refer to the giver.
- Placeholder rule shown in the form: "No portrait: the faction symbol is used".

## 6. API and contract
- Offer (`BoardOffer`) and active mission get `giver: { id, name, title, portraitUrl | null, factionId }` and the
  voiced `brief` (already localized by the server like the other bilingual fields; the web only renders).
- Report gets `giverLine` (the closing line for the result).
- `GET /v1/art/...` already serves uploads; the web falls back to the faction symbol when `portraitUrl` is null.

## 7. Build order
1. Schema + migration (`QuestGiver`, `MissionInstance.giverId`), seed: 3 generic givers (one per faction, the
   trainer with the `first_flight` pool) so nothing changes visually yet except the voice on the first flight.
2. Generation: giver choice + type weights in `fillMission` / `board.service`; the starter offer uses the trainer;
   unit tests on weights, fallback and determinism; int test for the board.
3. API + contract: giver block on offers/active/report; voiced briefs.
4. Web: `GiverBadge` (portrait or faction symbol, name, title) on card, row, active mission and report; i18n;
   width checks at 320 px both languages (e2e widths spec already walks the screens).
5. Admin: list / form / portrait upload / preview.
6. Content: 4 givers per faction (generic, cargo-minded, rescue-minded, a specialist per faction flavour) with
   their lines, en + pt-BR.
7. Sim: the bots read the board the same way (the giver changes only type mix and tone); run one balanced sim to
   confirm the type mix did not shift reward flow.

Rough size: steps 1-4 are the core (about the size of the board-variety change); 5 and 6 are Admin and writing.

## 8. Risks and notes
- **Balance**: giver type weights and reward bias change the mix of missions; bounded by the existing rules and
  checked by the sim (step 7). `rewardBias` can be dropped if it complicates the tuning story.
- **Content volume** is the real cost; the pool fallback keeps the game working while lines are being written.
- **Existing offers** (no giver) keep working: the web shows the faction symbol and the template text.
- Existing pilots and ships are ignored, as agreed (the database is reset often).

## Open points (recommendation first)
1. Portrait shape: **round**, one image per giver (recommended). Alternative: a wide banner per place.
2. Names in en + pt-BR: **one name, not translated** (recommended); titles are bilingual.
3. A giver tied to places (**recommended**: some roam, some belong to one port, so a port feels like a place) vs.
   fully random per faction.
4. Report closing line in phase 1 (**recommended**) vs. later.
5. Reward bias per personality: **leave out of v1** (recommended), types and risk band only.

## 9. The faction mentor: the onboarding guide has a face (added 2026-10-20)

Owner idea: the **main person of each faction** (its leader or chief instructor) gives the onboarding
instructions, together with the getting-started guide.

- **Same table, one more role.** `QuestGiver` gets `role`: `GIVER` (default) or `MENTOR`. Exactly one active
  mentor per faction (Admin refuses to deactivate the last one). The mentor can also hand out the first-flight
  mission (the trainer of §1 becomes the mentor), so the person who teaches you is the person who sends you.
- **Where the mentor speaks**
  - *Faction choice screen*: a short welcome from each faction's leader when its card is selected (who they are,
    what the faction stands for), replacing the flat description paragraph.
  - *Getting-started card* (the checklist): the mentor's portrait at the top and a speech line for the current
    step ("Fill the tank first, pilot. A dry ship goes nowhere."). Step titles and the (i) detail stay plain and
    factual, so the instructions are never only flavour; the mentor adds the reason and the tone.
  - *Moments*: welcome (first Ship screen), each step's nudge, each step's "done" line, the "all done" farewell
    that hands the pilot to the open board, and one line when the pilot first fails a mission or runs out of fuel
    ("Everyone drifts once. Here is how to avoid it.").
  - The mentor reappears on the board as the author of the first flight and then steps back; later the same
    person can return at milestones (new ship tier), as a cheap way to mark progress.
- **Content shape**: pools keyed `tutorial.welcome`, `tutorial.<step>` (build, ports, refuel, mission, dispatch,
  report, repair, work), `tutorial.<step>.done`, `tutorial.finished`, `tutorial.first_failure`, `tutorial.low_fuel`,
  bilingual, with the same placeholder rules. About 20 lines per faction (60 total), drafted by me, edited in
  Admin. A missing line falls back to today's plain tutorial text, so nothing breaks.
- **Rules kept**: the tutorial still ticks from the pilot's own records (no change to the progress endpoint); the
  mentor is presentation only. The step order and links are unchanged.
- **Web**: the existing tutorial card gets a `GiverBadge` header and a speech bubble (collapsed on the phone pill
  until opened, like the checklist). The pre-faction screens use the faction's mentor portrait from its pick card.
- **Build order**: after step 4 of §7 (the badge exists), add `role` + the tutorial pools (small schema change),
  then the card and faction-screen changes, then the 60 lines. About half a day on top of the core.

Open points for this part (recommended first): (a) the mentor is **also** the first-flight giver (yes);
(b) the mentor stays out of ordinary boards after the first flight (yes, they are the guide, not a vendor);
(c) the leader is **one named person per faction** rather than a pool (yes, a recognisable face).
