# Admin: structured editors for JSON fields, field help, faction/place art, new mission types

**Status:** PLAN — awaiting owner decisions (bottom). Evidence from the code and the live DB.

## Findings
- **JSON fields edited as raw text** (a textarea): `Location.services`, `Part.specialProp`,
  `MissionTemplate.requirements / rewardCalc / deadlineCalc / encounterPolicy`, `DropTable.tiers`,
  `Faction.relations`, `Faction.starterKitHint`. Real shapes seen in the DB:
  - services `{"buy":true,"sell":true,"repair":true,"missions":true,"passengers":true}` → five checkboxes
  - requirements `{"originTypes":["port","shipyard"],"originFactions":["luna"]}` (+ cargo/speed hints in code)
    → two checkbox groups (location types, factions) + number fields
  - encounterPolicy `{"missionForcesFlee":true}` → one checkbox; rewardCalc/deadlineCalc are `{}` today
  - tiers `[{"tier":"COMMON","chance":0.6},…]` → rows (tier + %), total must be 100%
  - specialProp `{pressurized, lifeSupport}` → two checkboxes
  - relations `{sun:"neutral",…}` → a matrix. **Bug found:** the faction relations matrix on the edit screen only
    changes a local copy; it never writes into the form's values, so its edits are not saved (only the JSON
    textarea saves). The new editor must write into the form.
- **Location `type`** is free text (garrison, relay, port, dead_zone, outpost, junction, scrap_field, shipyard,
  frontier) → a select of the known types.
- **Faction/place art is not data.** Faction art is a static file by naming convention
  (`/factions/<id>.wide.svg`), place art `/places/<id>.{wide|square|icon}.svg`, both in `apps/web/public`. There
  is no logo/banner/background field anywhere in the schema, API or admin, so nothing can be edited today.
- **Mission types are hardcoded.** `MissionType` is a Prisma enum (DELIVERY, TRANSPORT, ESCORT, MINING, RESCUE,
  TRAVEL, SCAVENGE) and each type has its own behaviour in code (requirements checker, resolver, encounter
  policy, board). A new type needs a migration plus its rules; the admin can only pick among existing types.

## Design
### A. Structured editors (replace JSON textareas)
A field type per shape, each with a plain-language label and help per option: `flags` (checkbox set: services,
specialProp, encounterPolicy), `choice-list` (checkbox group fed by another entity or an enum: originTypes,
originFactions), `weighted-rows` (tiers with a live total), `matrix` (faction relations, wired into the form),
`number-map` (reward/deadline parameters as labelled number inputs). Every editor keeps a collapsed "advanced
JSON" fallback so unknown keys are never lost or blocked, and server validation stays the single authority.
Location `type` becomes a select (known values + "other").
### B. Help text for every field
A `help` (en + pt-BR: what it does, what it affects, units) on every schema field that has only a short label;
shown under the field; part of the contract so the list pages can reuse it as header tooltips.
### C. Faction art (and, if wanted, place art)
New nullable columns for logo, banner and background (and wide/square/icon for places); admin shows the current
image, an upload button and "reset to default"; the web uses the uploaded file when set, else today's static SVG.
### D. New mission types
Not an admin-only change. Plan: define the new type's behaviour first (what it requires, how it pays, how it
resolves), then add enum value + resolver rules + board generation + admin template support in one change.

## Decisions needed
1. Art storage: upload files through the admin (stored on a volume, served by the app) or just URL fields?
2. Does "new mission type" mean a type that reuses an existing behaviour (e.g. a themed delivery) or genuinely
   new rules? (If it is a themed variant, a data-driven "template family" is much cheaper than a new enum value.)
