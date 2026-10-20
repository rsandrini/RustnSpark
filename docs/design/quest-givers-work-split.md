# Quest givers: file-level work split for two agents (2026-10-20)

Companion to `quest-givers-plan.md` (the design, with the mentor section). This file says **which files each lane
creates or edits**, in what order, and where the two lanes must agree first, so two agents can work at once
without touching the same file. Two lanes, one hand-off (the contract), one shared-file rule.

Lane **A (backend)**: schema, seed, generation, API, contract types, Admin API, sim.
Lane **B (frontend)**: player screens, i18n, Admin screens, e2e. B builds against the contract and a mock until A's
endpoints land, so B never waits for A except for the final wiring.

## 0. Step zero: the contract (Lane A, first, about an hour, merged before anything else)
Everything else depends on these shapes; changing them later is what causes conflicts. A writes them and pushes
**before** B starts; after that, neither lane changes them without telling the other.

`packages/contract/src/index.ts` (A only, one commit):
- `GiverRoleSchema = 'GIVER' | 'MENTOR'`
- `GiverRefSchema = { id, name, title: {en,'pt-BR'}, role, factionId, portraitUrl: string | null }`
- `OfferInfoSchema` gets `giver: GiverRefSchema.nullable()` and `brief: {en,'pt-BR'}` (the voiced text; falls back
  to the template description on the server, so the web just renders `brief`).
- `ActiveMissionSchema` gets the same `giver` (nullable) and `brief`.
- Report schema gets `giverLine: {en,'pt-BR'} | null` and `giver`.
- `TutorialProgressSchema` unchanged. New `MentorSchema = GiverRefSchema + { welcome, lines: Record<stepKey, {nudge, done}> }`
  returned by `GET /v1/players/me/mentor` (so the tutorial card needs no giver lookup of its own) and
  `PublicFactionSchema` gets `mentor: { name, title, portraitUrl, welcome } | null` for the faction choice screen.
- Admin entity shape for `quest-givers` is covered by the generic entity API (see §2), no contract change.

B then mocks these in `apps/web/src/test/msw/handlers.ts` (B's file) and builds the UI.

## 1. Lane A: backend

Create:
| File | What |
|---|---|
| `apps/api/prisma/migrations/2026102100xxxx_quest_givers/migration.sql` | table `QuestGiver`, `MissionInstance.giverId` (nullable FK, index), enum `GiverRole` |
| `apps/api/prisma/seed-data/quest-givers.ts` | 3 mentors (one per faction) + 1 generic giver per faction; lines pools v0 |
| `apps/api/src/missions/generator/giver.picker.ts` | pure: choose giver (weights, place, not more than half the board), type weights, risk band |
| `apps/api/src/missions/voice.ts` | pure: pick a line from a pool by seed, fill `{destination}` `{cargo}` `{reward}`, fall back to template text |
| `apps/api/src/missions/givers.service.ts` | read side: giver refs for a set of ids (portrait URL via art service), the mentor of a faction |
| `apps/api/src/players/mentor.controller.ts` (+ method in `players.service.ts`) | `GET /v1/players/me/mentor` |
| `apps/api/test/unit/missions/giver.picker.spec.ts`, `voice.spec.ts` | weights, fallback, determinism, half-board rule |
| `apps/api/test/integration/quest-givers.int-spec.ts` | board shows the giver, starter offer uses the mentor, mentor endpoint, art upload for `givers` |

Edit (only A edits these):
| File | Change |
|---|---|
| `apps/api/prisma/schema.prisma` | `model QuestGiver`, `giverId` on `MissionInstance`, relation on `Faction` |
| `apps/api/prisma/seed.ts` | call `seedQuestGivers` after factions and locations |
| `apps/api/src/missions/generator/template.filler.ts` | `fillMission` takes an optional giver and uses its type weights/risk band; returns `giverId` in the draft (`MissionDraft`) |
| `apps/api/src/missions/board.service.ts` | topUp picks the giver first, then type; `createStarterOffer` uses the faction mentor; persist `giverId` |
| `apps/api/src/missions/missions.service.ts` | `offerInfo`, active mission and board rows add `giver` and the voiced `brief` |
| `apps/api/src/reports/reports.service.ts`, `report.types.ts`, `summary.view.ts` | `giverLine` for success/partial/failure |
| `apps/api/src/admin/art/art.service.ts`, `art-admin.controller.ts` | new kind `givers` with slot `portrait` (`ART_KINDS`, `FILE_PATTERN`, routes `POST/DELETE quest-givers/:id/art/portrait`) |
| `apps/api/src/admin/tuning/entity-schemas.ts` | entity `quest-givers` (fields, references: factions, locations; guard: not the last active mentor of a faction) |
| `apps/api/src/admin/tuning/entity-tuning.service.ts` | the "last mentor" guard and audit if the generic path cannot express it |
| `apps/api/src/admin/art/art-public.controller.ts` (serves the public factions list) | `mentor` block on `PublicFaction` |
| `apps/api/test/integration/seed.int-spec.ts` | new row counts |
| `apps/api/src/config/*` | only if a tunable is added (e.g. `givers.max_share_of_board`, default 0.5); then also the registry key list spec |
| `apps/api/sim/**`, `sim/snapshot/*` | the snapshot export carries givers; bots unchanged |

Order inside A: contract → migration + schema + seed → picker/voice (pure, tested) → board/starter wiring → API
fields → art kind → entity schema → mentor endpoint → sim export.

## 2. Lane B: frontend

Create:
| File | What |
|---|---|
| `apps/web/src/ui/GiverBadge.tsx` (+ `GiverBadge.spec.tsx`) | portrait or faction symbol placeholder, name, title; sizes row/card/tutorial |
| `apps/web/src/ui/SpeechBubble.tsx` | the mentor's line in the checklist |
| `apps/web/src/features/tutorial/use-mentor.ts` | query `GET /v1/players/me/mentor`, line for the current step / done / finished |
| `apps/web/src/admin/tuning/GiverLinesEditor.tsx`, `GiverPersonalityEditor.tsx` (+ specs) | pools per key (en / pt-BR lists), type weights, risk band, tone |
| `apps/web/src/admin/tuning/GiverPreview.tsx` | live card preview in the form |
| `apps/web/src/styles/giver.css` | badge, bubble, preview |
| `apps/web/e2e/givers.spec.ts` | board card shows a giver and the first flight is voiced as a test flight; faction screen shows the leader |

Edit (only B edits these):
| File | Change |
|---|---|
| `apps/web/src/features/board/mission-card.tsx`, `mission-row.tsx` | `GiverBadge` + render `info.brief` instead of the description |
| `apps/web/src/features/board/active-offer.ts`, active-mission view (`features/ship/*` / transit) | giver + brief |
| `apps/web/src/features/report/report.page.tsx`, `report-overview.tsx` | giver line for the result |
| `apps/web/src/features/tutorial/tutorial-card.tsx`, `use-tutorial.ts` | mentor header, speech per step; plain titles and (i) stay |
| `apps/web/src/features/onboarding/onboarding.page.tsx`, `ui/factions.ts`, `ui/factionArt.ts` | leader welcome on the faction card |
| `apps/web/src/admin/tuning/EntityFormScreen.tsx`, `entity-shared.tsx`, `ArtEditor.tsx` | entity `quest-givers` form sections; portrait slot in `ArtEditor` |
| `apps/web/src/admin/admin-routes.tsx`, `features/admin/admin-shell.tsx` | menu entry "Quest givers" |
| `apps/web/src/admin/tuning/tuning.api.ts` | art upload for `givers` |
| `apps/web/src/i18n/en.json`, `pt-BR.json` | UI strings (badge labels, admin labels, placeholder note); **keys only under `givers.*` and `admin.givers.*`** |
| `apps/web/src/test/msw/handlers.ts` | mock giver on offers/active/report and the mentor endpoint |
| `apps/web/e2e/widths.spec.ts`, `a11y.spec.ts`, `support.ts` | the new screens at 320 px in pt-BR; portrait alt text |

Order inside B: mocks from the contract → `GiverBadge` → card/row → active mission/report → tutorial mentor →
faction screen → Admin form/editors → e2e. Wire to the real API when A's endpoints land (flip the mock off).

## 3. Shared files and who owns them (the conflict map)
| File | Owner | Rule for the other lane |
|---|---|---|
| `packages/contract/src/index.ts` | A | B asks A for a change; no direct edits after step zero |
| `apps/api/prisma/schema.prisma`, migrations, `seed.ts` | A | B never touches |
| `apps/web/src/i18n/en.json`, `pt-BR.json` | B | A adds nothing there (API text lives in the DB lines); if A needs a key, ask B |
| `docs/TODO.md`, `docs/design/*` | whoever finishes a step marks it, in a separate small commit | rebase before editing |
| `apps/api/test/integration/seed.int-spec.ts` | A | |
| `apps/web/src/test/msw/handlers.ts` | B | A's contract changes are the signal to update |
| `apps/web/e2e/*` | B | A fixes API-side e2e fallout only in `apps/api/test/**` |

Git: both lanes work on `develop` in small commits (the existing practice); stage explicit paths only; `git pull
--rebase` before every push; never commit the other lane's files. Migrations: A only, timestamps after
`20261020000000`; B never creates one. If B finds it needs a field, it asks A rather than editing the contract.

## 4. Hand-off points (the only moments the lanes sync)
1. **Contract merged** (A) → B starts. Check: `pnpm --filter @rustandspark/contract build` and `tsc` green in both apps.
2. **Seed + board giver live** (A) → B switches the board mock off and runs the e2e `givers.spec.ts`.
3. **Mentor endpoint + faction `mentor` block** (A) → B wires the tutorial card and faction screen.
4. **Art kind `givers` + entity `quest-givers`** (A) → B's Admin form saves and uploads for real.
5. **Content pass** (either, last): fill the line pools in Admin or in `seed-data/quest-givers.ts`; A owns that
   file, so lines are written there unless the owner edits them in Admin.

## 5. Tests and CI per lane (existing rules)
- A: unit for picker/voice, int for board/mentor/art/seed, `pnpm test:unit` and `test:int` (not in a shell that
  sourced `.env`; test DB needs `migrate deploy`), registry key list spec if a config key is added.
- B: vitest for badge, editors and cards, `pnpm --filter web test`, full `test:e2e` before the last push; the widths
  spec must pass in pt-BR at 320 px with the new card layout.
- Before either pushes anything that changes defaults or text literals: grep the old values in e2e and run the
  affected specs (a standing rule).
- Rebuild the `api` **and** `worker` containers after API changes (missions resolve in the worker); restart `web`.

## 6. Estimated size
Lane A about 1.5 days for the core (contract to board to mentor), half a day for Admin API + art. Lane B about 1.5
days for the core screens, one day for Admin editors + e2e. Content (4 givers x 3 factions with lines, 60 mentor
lines) is a separate half-day and can start as soon as the seed file exists.
