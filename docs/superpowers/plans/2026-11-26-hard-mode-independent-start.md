# Hard Mode (Independent Start) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth card on the faction screen, "Independent", lets a pilot start with no flag, no money and no flyable ship at a safe core port of their choice. They earn by scavenging on foot and selling scrap, buy an engine and a tank, assemble their first ship, and may join a faction later. They have their own ranking board.

**Architecture:** An Independent is a player whose `factionId` is the existing non-playable `free` faction, so no new column or table is needed. No faction lists `free` in its `relations`, so `relationOf` already returns `neutral` (factor 1.0) for prices, repairs and mission pay. "No ship" reuses what the API already has: onboarding creates the same `Ship` row it creates today, at the chosen port, with `fuel: 0` and only a loose `bridge` in INVENTORY. Every `ships[0]` / `findFirst({ownerPlayerId})` assumption keeps holding. The hull is simply not viable (`NO_ENGINE`), and the existing gates handle that already. Foot scavenging already needs nothing but that row (`scavenge-job.service.ts` skips every ship gate on foot; `deriveSheet` clamps `mob` to 1). The pilot becomes a normal pilot the moment the hangar layout is viable. Nothing flips state.

**Tech Stack:** NestJS + Prisma (apps/api), React + react-query + i18next (apps/web), zod (packages/contract), sim (apps/api/sim, Node 22).

**Spec:** `docs/TODO_v0.1.5.md` item 9, including the owner decisions of 2026-11-26 recorded under it.

## Facts found in the code (the plan argues from these)

- `free` faction row: seed `apps/api/prisma/seed-data/factions.ts:52` (playable false, colour `#9ca3af`, "Free pilots"). Migration `20261110200000_prologue_guides` inserted it in prod. Its three `MENTOR` givers (Kite, Dara, Oren) are the opening's guides.
- The opening plays BEFORE the faction picker (`prologue-mode.tsx:83`: factionId null and outcome null), so an Independent has already seen it. **This plan adds no new opening and no dialogue.** The only guide is a static "Build your ship" panel in the Port (least work). The faction-mentor dialogue must NOT pick a `free` MENTOR (`dialogue.service.ts:115`, `givers.service.ts:108`).
- The safe core zones 0 and 1 (dev DB) have four places with a shop (`buy` and `sell`) that are also `RESCUE_BASE_TYPES`: `ceres` (port, luna, z0), `tycho` (shipyard, luna, z0), `cair` (outpost, explorers, z0) and `vesta` (outpost, luna, z1). Sun's home `hedus` is not in zones 0-1.
- A BRIDGE is never sold in the market (`market.service.ts:157,277`), and `bridge` has `basePrice: 0`. So the Independent kit MUST contain the bridge; "no ship" means the bridge alone.
- **Minimal ship** (`checkViability` + seed `parts.ts`, COMMON tier): `bridge` (0) + `engine_chem_small` (1000) + `tank_small` (2000) = **base 3000**. It has no warnings: energy 2-1-1 = 0, MOB 25/12×1.6 = 3.3, structure 10/60. At zone-0 shelf prices (isolation 0.9 × mood) that is about 2480 at cair, 2750 at ceres/tycho and 3060 at vesta. Fuel at 4.5/unit is extra. The cheaper `bridge` + `engine_ion_micro` (1500) is "viable" but flies with `ENERGY_CRUISE_NEGATIVE` (-4). The used shelf can be cheaper still.
- Scrap is a fixed-price material (`basePrice` 100, `fixedPrice`, `pricing.service.ts:96`): about 25-31 scrap buy the kit, and found parts sell on top of that. A foot search has no cooldown (`scavenge-job.service.ts:146`), takes `foot_duration_seconds` 300 and keeps `foot_factor` 0.5 of the find chance. In zone 0, `nothing_chance` is 0.45.
- Destroyed ship (`ship-loss.service.ts`): it re-kits from `starter_parts` and moves to `home_locations[faction]`. Support reset (`support.service.ts:243-283`) does the same and grants `start_credits`. Both would hand an Independent the full faction kit.
- Escort (`escort.service.ts:249`) and tow (`ships.service.ts:878`): "own port" means a base whose `factionId === player.factionId`. No place is `free`, so an Independent sitting in its start port reads as stuck (`hullCannotFly`) and would be offered an escort.
- Starter offer (`missions.service.ts:321`): it needs a viable ship. The first one goes to a `test_pad`, and tycho and vesta have no pad, so no offer appears there.
- Rankings (`rankings.service.ts:67`): live SQL over `Player.factionId`, guests excluded (`NOT a."isGuest"`).

## Global Constraints

- Independent = `factionId === 'free'`. Use the constant `INDEPENDENT_FACTION_ID`, never the bare literal in new code.
- Prices: no penalty and no discount for an Independent (neutral, `economy.faction_mult.neutral` 1.0). Do not add `free` to any faction's `relations`. Item 13 (a 10% own-faction discount) is separate, and an Independent is never "own".
- All missions at normal pay. Joining a faction later is one-way and carries no penalty and no bonus.
- No retro-compat: no legacy branches, no migration of old players.
- Admin owns every tunable: each new key gets a config-registry entry with `en` + `pt-BR`. DB wins. New keys need no migration. A changed default of an EXISTING key needs an SQL migration.
- Every player string goes in en + pt-BR. `apps/web/src/i18n/keys.spec.ts` requires literal `t('...')` keys. Every new API error code also needs `error.<CODE>` in both `en.json` and `pt-BR.json`.
- `apps/api/src` must not import `@rustandspark/contract`. Use local `*.types.ts` files and have an int-spec parse the response with the contract schema.
- Code is in English. Do not add browser or e2e tasks: the web is verified by vitest unit tests.
- Sims run on Node 22 (`set -a; . ../../.env; set +a` in `apps/api`). Re-export the snapshot after the migration.
- Parts art is deferred. The tutorial is dropped: no tutorial changes.
- Commit on `develop` only. Run `git branch --show-current` before every commit. Never commit to `release/*`, `main` or `master`.
- Run targeted tests only: web `npx vitest run <spec>`, api `pnpm test:unit -- <spec>` and `pnpm test:int -- <spec> -t "<name>"` on the test stack.

## Review Focus

1. **A ship-less pilot on every endpoint**: market, sell, sell-material, refuel, repair, travel quote, board, accept, scavenge (ship and foot), escort, rescue, hangar save. Each must answer with an existing domain error (`SHIP_NOT_VIABLE`, `FUEL_EMPTY`, `NO_ENGINE`...), never a 500 or 404. Test: T3 `ship-less pilot` int-spec walks them.
2. **Selling or scrapping the only bridge** (the market and the scrapyard both allow it today). An Independent cannot buy another one, so the run would be dead. Expected: `409 LAST_BRIDGE`. Test: T3.
3. **Double onboarding and racing requests**: `onboarding` twice with `free`, then `free` followed by `luna`, and two concurrent calls. Expected: one ship, the first choice kept, `ConflictException` for the second faction. Test: T2.
4. **Joining a faction with a mission or search under way**, or while ADRIFT. Expected: `409 ACTIVE_MISSION_EXISTS` while a mission is IN_PROGRESS. ADRIFT is allowed (the tow still works). Test: T6.
5. **Ship loss and admin reset of an Independent** must not hand out the 3000-credit faction kit. Expected: the bridge only, 0 credits added, back at the chosen start port. Test: T3.

---

### Task 1: Independent identity, config keys, faction row, no mentor

**Files:**
- Create: `apps/api/src/players/independent.ts`
- Modify: `apps/api/src/config/game-config.defaults.ts` (onboarding), `game-rules.schema.ts:419`, `game-config.types.ts` (key union + `onboarding` type), `config-registry.ts` (next to `onboarding.home_locations`), `apps/api/src/admin/tuning/config-reference.validator.ts`
- Modify: `apps/api/src/dialogue/dialogue.service.ts:115`, `apps/api/src/missions/givers.service.ts:108`, `apps/api/src/missions/mentor.controller.ts:25`
- Modify: `apps/api/prisma/seed-data/factions.ts:52`. Create: `apps/api/prisma/migrations/20261126120000_independent_faction/migration.sql`
- Test: `apps/api/test/unit/players/independent.spec.ts`, `apps/api/test/unit/config/` (the existing registry/defaults spec)

**Interfaces:**
- Produces:
  - `INDEPENDENT_FACTION_ID = 'free'`
  - `isIndependent(factionId: string | null | undefined): boolean`
  - `ownBaseIdsOf(factionId: string | null, bases: readonly { id: string; type: string; factionId: string }[], rules: GameRules): Set<string>`. For an Independent this returns the `independent_start_locations` that are in `bases`. For anyone else it returns the bases with the same `factionId`.
  - New keys `onboarding.independent_start_locations: readonly string[]` (default `['ceres', 'tycho', 'cair', 'vesta']`) and `onboarding.independent_parts: readonly string[]` (default `['bridge']`).

- [ ] **Step 1: Write the failing tests.**
  - `isIndependent('free') === true`, and it is false for `'luna'`, `null` and `undefined`.
  - `ownBaseIdsOf('free', bases, rules)` equals `{ceres, tycho, cair, vesta}` ∩ bases. `ownBaseIdsOf('luna', ...)` returns only the luna bases.
  - The registry has both keys, with `en` and `pt-BR` descriptions.
  - `GameRulesSchema` rejects an empty `independent_parts`. Use `z.array(z.string().min(1)).min(1)`, and the same for the start list.
- [ ] **Step 2: Run** `pnpm test:unit -- independent.spec` and expect FAIL.
- [ ] **Step 3: Implement.**
  - The validator calls `assertActiveParts` for `onboarding.independent_parts` and `assertLocations` for `onboarding.independent_start_locations`.
  - `mentorOf` in dialogue.service and givers.service returns `null` when `isIndependent(factionId)`.
  - `mentor.controller` returns `null` for an Independent.
  - Seed: the `free` row's displayName becomes `{ en: 'Independent', 'pt-BR': 'Independente' }`, and its description becomes "Pilots who fly under no flag, until the day they choose one." / "Pilotos que não voam sob bandeira alguma, até o dia em que escolhem uma."
  - The migration does an `UPDATE "Faction" SET "displayName"=…, "description"=… WHERE id='free' AND "displayName"->>'en'='Free pilots'` (DB wins: an admin edit stays).
- [ ] **Step 4: Run** the specs above plus `pnpm test:unit -- dialogue` and expect PASS. Then run `npx prisma migrate dev` on the dev DB.
- [ ] **Step 5: Commit** `feat(players): the independent pilot (free faction): start places and kit keys, no faction mentor`

### Task 2: Onboarding as an Independent (API)

**Files:**
- Modify: `apps/api/src/players/onboarding.service.ts`, `dto/onboarding.dto.ts`, `players.controller.ts`
- Create: `apps/api/src/players/onboarding.types.ts`
- Modify: `packages/contract/src/index.ts` (add `IndependentStartsResponseSchema`), web `en.json`/`pt-BR.json` `error.INVALID_START_LOCATION`
- Test: `apps/api/test/integration/onboarding-independent.int-spec.ts`

**Interfaces:**
- Consumes: T1.
- Produces:
  - `OnboardingDto { faction: string; startLocationId?: string }`, where `startLocationId` is `@IsOptional() @IsString() @MaxLength(64)`.
  - `OnboardingService.onboard(playerId: string, faction: string, startLocationId?: string): Promise<ShipResponse>`
  - `OnboardingService.independentStarts(): Promise<IndependentStartsResponse>`, served at `GET /v1/players/me/onboarding/independent`, returning `{ startLocations: { id: string; displayName: { en: string; 'pt-BR': string }; zone: number; factionId: string }[] }` in config order.
  - `INDEPENDENT_START_EVENT = 'onboarding.independent_start'`, payload `{ locationId }`.
  - `independentHomeOf(tx: Prisma.TransactionClient, playerId: string, rules: GameRules): Promise<string>`. It reads the latest event and falls back to `independent_start_locations[0]`.
  - `OnboardingService.applyKit(tx, playerId, shipId, rules, factionId: string): Promise<void>`. It replaces `applyStarterKit`: an Independent gets `independent_parts` at `starter_condition` and `fuel: 0`, and skips the viability proof. Everyone else keeps today's path.

- [ ] **Step 1: Write the failing int tests** (`describe('independent onboarding')`).
  - `onboards free at ceres`: response `currentLocationId === 'ceres'` and `fuel === 0`. Inventory partTypes are `['bridge']` and nothing is INSTALLED. `credits === 0`. `factionId === 'free'`. The `onboarding.independent_start` event has `locationId: 'ceres'`. No wallet movement row exists.
  - `rejects a start place outside the list`: `startLocationId: 'hedus'` gives 400 `INVALID_START_LOCATION`, and so does a missing `startLocationId` for `free`.
  - `a faction pilot ignores startLocationId`: `luna` + `startLocationId: 'cair'` still lands at `ceres` with the starter kit and `start_credits`.
  - `second call keeps the first answer`: `free` twice returns the same ship id. `free` then `luna` gives 409.
  - `lists the start places`: GET returns the four ids in config order. Parse it with `IndependentStartsResponseSchema`.
- [ ] **Step 2: Run** `pnpm test:int -- onboarding-independent` and expect FAIL.
- [ ] **Step 3: Implement.**
  - `onboard`: when `isIndependent(faction)`, the location is `startLocationId`, which must be in `independent_start_locations`. Otherwise keep the `home_locations` check (`UNKNOWN_FACTION`).
  - In the same transaction, record the event and skip `walletService.credit`, because a 0 amount is invalid.
  - The ship name is `callsignOf({ factionId: 'free', ... })`, which gives `FRE-…`.
- [ ] **Step 4: Run** the spec and expect PASS. Also run `pnpm test:int -- support` (the `applyKit` rename).
- [ ] **Step 5: Commit** `feat(onboarding): start as an independent at a safe core port with only a bridge`

### Task 3: The ship-less pilot across the API

**Files:**
- Modify: `apps/api/src/economy/escort.service.ts:249`, `apps/api/src/ships/ships.service.ts:878`, `apps/api/src/missions/ship-loss.service.ts:51-71`, `apps/api/src/admin/inspector/support.service.ts:243-283`, `apps/api/src/missions/missions.service.ts:349`, `apps/api/src/economy/market.service.ts` (`sell`), `apps/api/src/parts/scrap-part.service.ts:153`
- Modify: web `en.json`/`pt-BR.json` `error.LAST_BRIDGE`
- Test: `apps/api/test/integration/ship-less-pilot.int-spec.ts`

**Interfaces:**
- Consumes: `ownBaseIdsOf` and `isIndependent` (T1), `independentHomeOf` and `applyKit` (T2).
- Produces: error `LAST_BRIDGE` (409). It is raised when a sale or scrap would leave the player owning no BRIDGE part, for any pilot.

- [ ] **Step 1: Write the failing int tests** (`describe('ship-less pilot')`, a `free` pilot at ceres with only the bridge).
  - `every port action answers with a domain error`:
    - market GET is 200 and lists no BRIDGE.
    - sell-material of 1 scrap gives +100 credits.
    - travel quote reasons include `NO_ENGINE` (or `SHIP_NOT_VIABLE`).
    - accepting a board offer gives 400 `SHIP_NOT_VIABLE`.
    - ship-mode scavenge gives 400 `SHIP_NOT_VIABLE`.
    - foot scavenge is 200 and resolves with `durationSeconds === foot_duration_seconds × time_scale`.
    - refuel with 0 credits gives an existing error, not a 500.
  - `escort is not offered at a start port`: the escort options' reasons include `ALREADY_SAFE`.
  - `escort at a non-start port tows to a start port`: move the ship to `ziggy`. The tow plan's `baseId` is in the start list.
  - `cannot sell or scrap the last bridge`: both give 409 `LAST_BRIDGE`. A faction pilot with two bridges can still sell one.
  - `ship loss rebuilds the independent kit at the chosen start`: call `ShipLossService.destroy` for a `free` pilot who started at `cair`. Afterwards the parts are `['bridge']`, `fuel === 0`, `currentLocationId === 'cair'` and credits are unchanged.
  - `support reset gives the independent kit and 0 credits`.
  - `no test-pad first flight for an independent`: with a viable ship (install engine + tank), the starter offer at `tycho` exists and is not to a `test_pad`.
  - `prices are neutral`: buying `tank_small` at ceres costs the same for a `free` pilot as for a `sun` pilot (both neutral to luna).
- [ ] **Step 2: Run** `pnpm test:int -- ship-less-pilot` and expect FAIL.
- [ ] **Step 3: Implement.**
  - `isOwnPort` and `ownBaseIds` use `ownBaseIdsOf`.
  - In ship-loss and support: for an Independent, the kit is `independent_parts`, the fuel is 0, home is `independentHomeOf` and no credit is granted.
  - `ensureStarterOffer` passes `firstMission: completed === 0 && !isIndependent(viewer factionId)`. Read the faction alongside `completed`.
  - The bridge guard counts the owner's BRIDGE parts, excluding the one being sold or scrapped.
- [ ] **Step 4: Run** the spec plus `pnpm test:int -- escort market scrap-part` and expect PASS.
- [ ] **Step 5: Commit** `feat(independent): a ship-less pilot is safe at its start port, keeps its bridge, and is re-kitted as an independent`

### Task 4: The fourth card and the start-place picker (web)

**Files:**
- Create: `apps/web/src/features/onboarding/independent.ts` (`INDEPENDENT_FACTION_ID`, `useIndependentStarts()`)
- Modify: `apps/web/src/features/onboarding/onboarding.page.tsx`, `apps/web/src/i18n/en.json`, `pt-BR.json`, `apps/web/src/styles/onboarding.css`
- Test: `apps/web/src/features/onboarding/onboarding.spec.tsx`

**Interfaces:**
- Consumes: `GET /v1/players/me/onboarding/independent` and `POST /v1/players/me/onboarding { faction: 'free', startLocationId }` (T2).
- Produces: `useIndependentStarts(): { starts: IndependentStart[]; isLoading: boolean }`. Type it from the contract via `api/generated`.

- [ ] **Step 1: Write the failing tests.**
  - `shows a fourth Independent card after the playable three`: there are 4 radios, and the last label reads `t('onboarding.independent.name')`. That value is "Independent" in en and "Independente" in pt-BR. The DB name wins when `/v1/factions` lists `free`.
  - `picking Independent asks for a start place`: four start radios appear (Ceres, Tycho, Cair, Vesta) with their zone. Confirm stays disabled until one is picked.
  - `posts faction free with the chosen start`: the request body equals `{ faction: 'free', startLocationId: 'cair' }`.
  - `a faction card posts no start place`: the body equals `{ faction: 'luna' }`.
  - `explains the hard start`: the card shows `onboarding.independent.blurb`, which says no money, no engine, scavenge and sell scrap, build your ship, and join a faction later if you want.
  - `INVALID_START_LOCATION shows its message`.
- [ ] **Step 2: Run** `npx vitest run src/features/onboarding/onboarding.spec.tsx` and expect FAIL.
- [ ] **Step 3: Implement.** The Independent card is rendered outside the `playable` list, because `free` is `playable: false`. Fall back to the i18n name and blurb, and use the `--free` grey (`#9ca3af`) when no DB colour is present. Add the keys `onboarding.independent.{name,blurb,startTitle,startHint,zone}` in both languages.
- [ ] **Step 4: Run** the spec plus `npx vitest run src/i18n` and expect PASS.
- [ ] **Step 5: Commit** `feat(web): the Independent card and its start-place picker`

### Task 5: The Port and Hangar for a pilot with no flyable ship (web)

**Files:**
- Create: `apps/web/src/features/port/independent-start-panel.tsx`
- Modify: `apps/web/src/features/port/port.page.tsx` (render after `<RescueBanner />`, line 873, and default `scavengeMode` to `'foot'` when `!shipUsable`), `en.json`, `pt-BR.json`
- Test: `apps/web/src/features/port/independent-start-panel.spec.tsx`, `port.spec.tsx`

**Interfaces:**
- Consumes: `user.factionId` (auth context) and `ship.viability.viable` (ShipResponse).
- Produces: `IndependentStartPanel({ onGoTo }: { onGoTo: (tab: PortTabId | 'hangar') => void })`.

What a ship-less pilot sees: the Port of the start place with the usual tabs. On top sits a "Build your ship" panel with four steps:
1. Scavenge on foot (goes to the scavenge tab, with foot preselected).
2. Sell scrap and found parts (the goods tab).
3. Buy an engine and a fuel tank (the market tab).
4. Assemble in the Hangar, then refuel.
The HUD wallet shows 0. The ship stage shows the lone bridge. The board lists offers but accepting one says "assemble it in the Hangar first" (the existing `SHIP_NOT_VIABLE` copy).

- [ ] **Step 1: Write the failing tests.**
  - `shows the four steps to an independent with a non-viable ship`.
  - `hidden once the ship is viable`.
  - `hidden for a faction pilot with a non-viable ship`.
  - `each step jumps to its tab`.
  - In port.spec: `ship-less pilot starts on the foot search mode`, where the `scavenge-mode` radio `foot` is checked and `ship` is disabled.
- [ ] **Step 2: Run** `npx vitest run src/features/port` and expect FAIL.
- [ ] **Step 3: Implement.** Add the keys `port.independent.{title,step.scavenge,step.sell,step.buy,step.assemble}` in en and pt-BR.
- [ ] **Step 4: Run** the same command and expect PASS.
- [ ] **Step 5: Commit** `feat(web): a Build-your-ship guide in the Port for a ship-less independent`

### Task 6: Join a faction later (API)

**Files:**
- Create: `apps/api/src/players/faction-join.service.ts`, `apps/api/src/players/dto/join-faction.dto.ts`
- Modify: `apps/api/src/players/players.controller.ts`, `players.module.ts`, web `en.json`/`pt-BR.json` `error.NOT_INDEPENDENT`
- Test: `apps/api/test/integration/faction-join.int-spec.ts`

**Interfaces:**
- Consumes: T1. Also `shipNamePrefix` (`ships/ship-name.ts`) and `PlayersService.getProfile`.
- Produces:
  - `POST /v1/players/me/faction { faction: string }` → `PlayerProfile`.
  - `FactionJoinService.join(playerId: string, faction: string): Promise<PlayerProfile>`.
  - Event `player.joined_faction`, payload `{ from: 'free', to }`.

- [ ] **Step 1: Write the failing int tests** (`describe('join a faction')`).
  - `an independent joins luna`: `factionId === 'luna'`. The ship name `FRE-X` becomes `LUN-X`. Credits, parts, location and stats are unchanged. The event is recorded.
  - `one way`: luna to sun gives 409 `NOT_INDEPENDENT`, and so does a player with no faction.
  - `only playable factions`: `pirates` and `free` give 400 `UNKNOWN_FACTION`. The keys of `home_locations` are the playable list.
  - `not while a mission is under way`: a foot search IN_PROGRESS gives 409 `ACTIVE_MISSION_EXISTS`. A mission that is only ACCEPTED (waiting) is allowed.
  - `the mentor appears after joining`: `GET /v1/players/me/mentor` is null before and is luna's mentor after.
  - `the ranking league follows`: covered in T8.
- [ ] **Step 2: Run** `pnpm test:int -- faction-join` and expect FAIL.
- [ ] **Step 3: Implement.** Do it in one transaction with `SELECT … FOR UPDATE` on the Player row, then use `updateMany where { id, factionId: 'free' }` so two racing joins resolve to one winner. Swap the ship-name prefix only when the name starts with `shipNamePrefix('free')`.
- [ ] **Step 4: Run** the spec and expect PASS.
- [ ] **Step 5: Commit** `feat(players): an independent can join a faction, one way and with no penalty`

### Task 7: Join a faction (web)

**Files:**
- Create: `apps/web/src/features/profile/join-faction-panel.tsx`
- Modify: `apps/web/src/features/profile/profile.page.tsx`, `en.json`, `pt-BR.json`
- Test: `apps/web/src/features/profile/join-faction-panel.spec.tsx`

**Interfaces:**
- Consumes: `POST /v1/players/me/faction` (T6) and `useFactions()` (only the playable entries).
- Produces: `JoinFactionPanel()`. It renders nothing unless `user.factionId === 'free'`.

- [ ] **Step 1: Write the failing tests.**
  - `lists the playable factions for an independent`.
  - `confirm warns it is for good`: the text is `profile.joinFaction.warning`, and the button is disabled until a faction is picked.
  - `posts and refreshes the profile`: the body is `{ faction: 'sun' }`, after which `refresh()` is called and the queries are invalidated.
  - `hidden for a faction pilot`.
  - `ACTIVE_MISSION_EXISTS shows its message`.
- [ ] **Step 2: Run** `npx vitest run src/features/profile/join-faction-panel.spec.tsx` and expect FAIL.
- [ ] **Step 3: Implement.** Add the keys `profile.joinFaction.{title,body,warning,confirm,joining}` in en and pt-BR.
- [ ] **Step 4: Run** the spec plus `npx vitest run src/i18n` and expect PASS.
- [ ] **Step 5: Commit** `feat(web): join a faction from the pilot page`

### Task 8: The Independent ranking board

**Files:**
- Modify: `apps/api/src/stats/rankings.types.ts`, `rankings.service.ts:46-80`, `rankings.controller.ts:30-35`, `packages/contract/src/index.ts:1995+`, `apps/web/src/features/rankings/rankings.page.tsx`, `rankings-fixtures.ts`, `en.json`, `pt-BR.json` (`error.INVALID_LEAGUE`, `rankings.league.*`)
- Test: `apps/api/test/integration/rankings.int-spec.ts`, `rankings-api.int-spec.ts`, `apps/web/src/features/rankings/rankings.spec.tsx`

**Interfaces:**
- Produces:
  - `RANKING_LEAGUES = ['factions', 'independent'] as const` and `type RankingLeague`.
  - `RankingsService.board(playerId, board, window, route?: string, league: RankingLeague = 'factions')`.
  - Query `?league=`, where an unknown value gives 400 `INVALID_LEAGUE`.
  - `RankingResponse.league: RankingLeague`, and the same in `RankingResponseSchema`. `race-routes` stays global.

- [ ] **Step 1: Write the failing tests.**
  - int: `the factions board leaves independents out` and `the independent board ranks only free pilots`. Two pilots with distance stats: the `luna` one is only on `factions` and the `free` one is only on `independent`. `me` is null for the pilot not on that league.
  - int: `an empty independent board`: no `free` pilot with stats gives `entries: []`, `total: 0` and `me: null`.
  - int: `joining moves the pilot`: after T6 `join`, the same pilot is on `factions`.
  - int: `guests stay out of both`.
  - api: the response parses with the contract schema.
  - web: `league toggle switches the board`: two tabs, `rankings.league.factions` ("Factions") and `rankings.league.independent` ("Independent"). The query key carries the league, and the request URL has `league=independent`.
- [ ] **Step 2: Run** `pnpm test:int -- rankings` and `npx vitest run src/features/rankings` and expect FAIL.
- [ ] **Step 3: Implement.** Add `AND p."factionId" IS DISTINCT FROM 'free'` for the factions league and `AND p."factionId" = 'free'` for the independent one, using `Prisma.sql` with the constant.
- [ ] **Step 4: Run** both and expect PASS.
- [ ] **Step 5: Commit** `feat(rankings): a separate Independent board`

### Task 9: Sim: the `independent` bot and the scrap economy check

**Files:**
- Modify: `apps/api/sim/bots/temperament.ts`, `apps/api/sim/core/state.ts:138` (`starterPlayer`), `apps/api/sim/bots/bot.ts` (`playRun`, `RunResult`), `apps/api/sim/README.md`
- Create: `apps/api/sim/bots/first-ship.ts`
- Test: `apps/api/test/unit/sim/first-ship.spec.ts`, `temperament.spec.ts`, `apps/api/test/unit/players/minimal-ship.spec.ts`

**Interfaces:**
- Produces:
  - `Temperament` gains `'independent'`. It orders offers like `balanced` and starts as an Independent.
  - `StarterPlayerOptions.start?: 'faction' | 'independent'`. `independent` uses `independent_parts`, `wallet: 0`, `fuel: 0`, `factionId: 'free'` and `locationId = rules.onboarding.independent_start_locations[seed % length]`.
  - `firstShipStep(state, ctx, world, nowMs): { done: boolean; spentMs: number }`. Each step is a foot search, then a sale of all scrap and of every found part not needed for the kit. Keep a found ENGINE or TANK when it would make the ship viable (`fitWouldBeViable`). Then buy the cheapest in-stock engine/tank still missing (new or used), fit it, and refuel for the cheapest route out.
  - `RunResult.firstShipSeconds: number | null`, in game-clock seconds from the start to the first viable ship with fuel.

- [ ] **Step 1: Write the failing tests.**
  - minimal-ship.spec (seed `PARTS` + `GAME_CONFIG_DEFAULTS`): `bridge + engine_chem_small + tank_small` is viable with `warnings: []`, and the sum of `basePrice` is 3000. `bridge + engine_ion_micro` is viable with the warning `ENERGY_CRUISE_NEGATIVE`. `bridge` alone gives problems that include `NO_ENGINE`.
  - first-ship.spec (fixture snapshot): from the independent start, `playRun({ temperament: 'independent', seed: 1, missions: 20 })` returns a non-null `firstShipSeconds`, `scavengesDone > 0`, and a wallet that never goes below 0 before the first ship.
  - temperament.spec: `temperamentOf('independent') === 'independent'`.
- [ ] **Step 2: Run** `pnpm test:unit -- first-ship minimal-ship temperament` and expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same and expect PASS.
- [ ] **Step 5: Economy check (Node 22).**
  - `pnpm sim export`, then `sim/run-parallel.sh indep sim/edits/none.json --temperament independent --runs 8 --missions 100 --seed 1`.
  - Read the median `firstShipSeconds`. **Target: first ship within 2 sim days (4 game hours)**, with no run beyond 4 sim days.
  - If it is slower, tune EXISTING keys only (`scavenging.scrap_min`/`scrap_max`, `nothing_chance[0..1]`, `foot_factor`) through an edit file, keeping the faction runs' `levels.py` medians within 5% of the stored baseline. Ship each changed default with an SQL migration that updates the `GameConfig` row only when it still holds the old value.
  - Record the result (median, p90, kit price paid) in `sim/README.md`.
- [ ] **Step 6: Commit** `feat(sim): the independent bot and the first-ship economy check` (plus the tuning migration, if any).

### Task 10: Docs and the gate

**Files:**
- Modify: `docs/TODO_v0.1.5.md` item 9 (mark built, with rulings), `docs/GDD.md` or the faction/onboarding section that lists the three factions (add the Independent start), and the memory note `project_independent_start.md` plus its MEMORY.md line.

- [ ] **Step 1:** Update item 9: set it `[x]`, name the representation (`free`), the start list, the minimal ship (3000 base) and the sim's measured median. Add the rulings listed below.
- [ ] **Step 2: Gate.**
  - Run `pnpm -r typecheck`.
  - Run the targeted specs of T1-T9.
  - Run `docker compose --profile dev build api worker` (the contract import check, and the worker resolves missions).
  - Run the existing API e2e suite once (`pnpm test:e2e`; no new e2e tests). Grep for any literal that changed: the `free` displayName "Free pilots" and `applyStarterKit`.
- [ ] **Step 3: Commit** `docs: hard mode (independent start) built`

## Rulings made by this plan (the owner may overturn)

1. Independent = the existing `free` faction row, renamed "Independent"/"Independente" (only if unedited). Neutral pricing falls out of the existing `relationOf` default. That includes **pirate ports, which are neutral to an Independent** (faction pilots pay hostile 2.5 there).
2. "No ship" = a ship row with only a loose **bridge** and 0 fuel. A bridge cannot be bought (`partClass BRIDGE` is never on the shelf), so it is given. The last bridge can no longer be sold or scrapped, for any pilot.
3. No opening and no mentor dialogue for an Independent: the shared opening already played before the picker. The guide is a static four-step Port panel.
4. A destroyed ship or a support reset of an Independent gives the bridge-only kit at the chosen start port (stored as an event), not the faction starter kit, and no credits.
5. The start list is the four zone 0-1 bases with a shop (ceres, tycho, cair, vesta), editable in Admin. Sun has no core start of its own.
6. The guaranteed first flight to a test pad is skipped for Independents. They get ordinary starter offers.
7. Joining a faction is refused while a mission or search is under way. The ship name's tag changes (`FRE-` → `LUN-`).
8. The Independent board is a league filter on every existing board. The main boards no longer show Independents.
9. No new knob for foot-search yield. The sim tunes the existing scavenging keys (with migrations) if the 2-sim-day target is missed.

## Decisions truly needed from the owner

None block the work. Ruling 1's pirate-port price (neutral rather than hostile) is the one most likely to be unwanted.
