# Market Part Compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a pilot compare a Market/Store listing (a part they don't own yet) against the part already installed of the same class, stat by stat with color, before they buy — the one item from the round-2 backlog (§5b item 4) that was explicitly deferred when the same comparison was built for the Hangar tray in round 3.

**Architecture:** The Hangar tray already has this comparison for *owned* loose parts (`PartCompareContext`/`PartDetail` in `apps/web/src/features/parts/part-detail.tsx`), calling `POST /v1/ships/:id/preview` with the candidate's own owned `partInstanceId` added to the ship's installed set. A market listing has no owned instance id yet, so that call shape doesn't work. This plan adds a second mode to the same preview endpoint — a "virtual" catalog part (`partType` + `condition`, no owned instance) that the server folds into the sheet computation exactly like a real installed part, optionally replacing one real installed part of the same class. The client picks which installed part (if any) a listing would replace with a small pure matching function, and threads the resulting compare context through `PartCard` into the existing `PartDetail` popup, which already knows how to render a before/after table — it only needs to learn this second, "not owned yet" way of asking for the after side.

**Tech Stack:** NestJS + Prisma (API), React + TanStack Query + react-i18next (web), Jest (API tests), Vitest + Testing Library + MSW (web tests).

**Spec:** `docs/superpowers/plans/2026-09-27-playtest-round-2-plan.md`, §5b item 4 ("Compare a market part with the one in the ship (B2)"), and the round-3 decision that scoped the first (Hangar-only) version of this comparison out of Market/Port (§12 Batch B item 7's own note: *"Not shown in Market/Port: nothing is 'applied to the ship' yet there... there's no owned instance id to preview with anyway"*).

## Global Constraints

- Never touch `apps/api/prisma/seed-data/parts.ts` or `apps/api/test/integration/seed.int-spec.ts` — standing instruction from the current playtest session (a parallel workstream owns catalog content there); this plan only *reads* catalog rows, it adds no new ones.
- Every new/changed file gets typechecked (`tsc --noEmit`) and its own tests before commit, same as every other workstream in the round-2 plan doc.
- No new catalog content, no new admin fields, no new database migration — this is entirely existing-data-driven (the seeded `PartCatalog` table already has everything needed).
- Match existing code conventions exactly: DTOs use `class-validator` decorators (not zod) on the API side; the web side has no shared request-schema layer for ship endpoints today (bodies are inline object literals) — do not introduce one for just this feature.
- The comparison is informational only: it must never let a market purchase or the underlying `/preview` call mutate any ship/part state (the endpoint already guarantees this for its existing modes; the new mode must hold the same guarantee — no writes, ever).

## Review Focus

1. **No installed part of the candidate's class exists at all** (e.g., browsing shields with none installed) — must fall back to a pure "if you install this" addition, not error out or silently show nothing.
2. **Two or more installed parts share the candidate's class** (e.g., two Cargo Holds of different sizes) — the match must be deterministic (same pick every render) and prefer the one the candidate could actually occupy (same footprint) over an arbitrary one.
3. **A used listing's condition must reach the comparison** — the "if swapped" sheet must use the listing's own (possibly <100%) condition for the virtual part, not silently assume new-condition stats, since per-part condition already scales contribution to the derived sheet.
4. **The candidate's catalog row goes missing between page load and the compare call** (retired mid-session, or a bad id) — the server must reject it cleanly (404-class, not a 500), and the popup must show a normal "couldn't check that" state instead of hanging on "Checking what this would do to the ship…" forever.
5. **The Market listing card never fires a preview call just by being on screen** — the compare query must stay gated to the popup actually being open (verified: `Popup` doesn't mount its children until `open`), so rendering a full page of listings never fans out dozens of preview requests.

---

### Task 1: API — `/v1/ships/:id/preview` accepts a not-yet-owned "virtual" part

**Files:**
- Modify: `apps/api/src/ships/dto/ship-operations.dto.ts`
- Modify: `apps/api/src/ships/ships.service.ts`
- Modify: `apps/api/src/ships/ships.controller.ts`
- Test: `apps/api/test/integration/parts-ships.int-spec.ts`

**Interfaces:**
- Consumes: `PrismaService.partCatalog.findUnique`, `PartsService.findPlayerParts` (existing), `pickCatalogStats` (existing, `../parts/parts.service.js`), `deriveSheet`/`checkViability`/`deriveShipClass` (existing), the module-private `toInstalledPart`/`PartInstanceWithCatalog` already declared at the bottom of `ships.service.ts`.
- Produces: `ShipsService.preview(shipId: string, layout?: Placement[], partInstanceIds?: string[], virtualPart?: { partType: string; condition: number }, replacePartInstanceId?: string): Promise<PreviewResponse>` — same `PreviewResponse` shape as today (`{ sheet, shipClass, viability, layout, omittedPartInstanceIds }`); later tasks call this only through the HTTP route, never import the service directly.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block inside the existing `describe('preview', ...)` in `apps/api/test/integration/parts-ships.int-spec.ts` (after the existing "works while ON_MISSION" test):

```ts
describe('preview with a virtual (not-yet-owned) part', () => {
  it('swaps a virtual candidate in for the installed part of the same class', async () => {
    await freshSeededApp();
    const { token } = await seedAndToken();
    const onboarded = await onboard(token, 'luna');
    const shipId = asShip(onboarded).id;
    await assembleStarterKit(httpServer(testApp.app), token, shipId);

    const inventory = await request(httpServer(testApp.app))
      .get('/v1/inventory')
      .set('Authorization', `Bearer ${token}`);
    const hull = (inventory.body as Array<{ id: string; partType: string; location: string }>).find(
      (item) => item.partType === 'hull' && item.location === 'INSTALLED',
    );
    expect(hull).toBeDefined();

    const before = await request(httpServer(testApp.app))
      .get(`/v1/ships/${shipId}`)
      .set('Authorization', `Bearer ${token}`);

    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        virtualPart: { partType: 'hull_uncommon', condition: 100 },
        replacePartInstanceId: hull!.id,
      });

    expect(response.status).toBe(200);
    const preview = asPreview(response);
    // hull partHp 20 -> hull_uncommon partHp 26: the sheet's hp goes up by exactly the gap,
    // nothing else about the ship (still using the real installed set otherwise) changes it.
    expect(preview.sheet.hp).toBe(asShip(before).sheet.hp + 6);
    // The endpoint never mutates anything: this is a read.
    const after = await prisma.partInstance.findUnique({ where: { id: hull!.id } });
    expect(after?.partType).toBe('hull');
  });

  it('adds a virtual candidate with nothing to replace when no part of its class is installed', async () => {
    await freshSeededApp();
    const { token } = await seedAndToken();
    const onboarded = await onboard(token, 'luna');
    const shipId = asShip(onboarded).id;
    await assembleStarterKit(httpServer(testApp.app), token, shipId);

    const before = await request(httpServer(testApp.app))
      .get(`/v1/ships/${shipId}`)
      .set('Authorization', `Bearer ${token}`);
    // The starter kit has no weapon: a weapon_ballistic candidate is a pure addition.
    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ virtualPart: { partType: 'weapon_ballistic', condition: 100 } });

    expect(response.status).toBe(200);
    const preview = asPreview(response);
    expect(preview.sheet.pdf).toBeGreaterThan(asShip(before).sheet.pdf ?? 0);
  });

  it('scales a used candidate by its own (reduced) condition, not new-condition stats', async () => {
    await freshSeededApp();
    const { token } = await seedAndToken();
    const onboarded = await onboard(token, 'luna');
    const shipId = asShip(onboarded).id;
    await assembleStarterKit(httpServer(testApp.app), token, shipId);

    const full = await request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ virtualPart: { partType: 'weapon_ballistic', condition: 100 } });
    const half = await request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ virtualPart: { partType: 'weapon_ballistic', condition: 50 } });

    expect(asPreview(half).sheet.pdf).toBeLessThan(asPreview(full).sheet.pdf);
  });

  it('rejects a virtual part type that does not exist', async () => {
    await freshSeededApp();
    const { token } = await seedAndToken();
    const onboarded = await onboard(token, 'luna');
    const shipId = asShip(onboarded).id;

    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ virtualPart: { partType: 'not_a_real_part', condition: 100 } });

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:int -- parts-ships` (from `apps/api`)
Expected: the 4 new tests FAIL — either 400 (unknown DTO field stripped/rejected) or the response not matching, since `virtualPart`/`replacePartInstanceId` don't exist on `PreviewDto` yet and `ShipsService.preview` has no such branch.

- [ ] **Step 3: Add the DTO fields**

In `apps/api/src/ships/dto/ship-operations.dto.ts`, extend the `class-validator` import and add:

```ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
```

```ts
export class VirtualPartDto {
  @IsString()
  partType!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  condition!: number;
}

export class PreviewDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlacementDto)
  layout?: PlacementDto[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  partInstanceIds?: string[];

  // Market-compare only (round-2 plan §5b item 4): a not-yet-owned catalog part to fold into
  // the sheet computation, standing in for the owned instance a purchase would later create.
  @IsOptional()
  @ValidateNested()
  @Type(() => VirtualPartDto)
  virtualPart?: VirtualPartDto;

  // With `virtualPart`: the currently-installed instance (same class) it would replace. Omitted
  // when nothing of that class is installed yet — the virtual part is then a pure addition.
  @IsOptional()
  @IsUUID('4')
  replacePartInstanceId?: string;
}
```

- [ ] **Step 4: Implement `previewWithVirtualPart` and branch to it**

In `apps/api/src/ships/ships.service.ts`, change the `preview` method's signature and add the branch:

```ts
async preview(
  shipId: string,
  layout?: Placement[],
  partInstanceIds?: string[],
  virtualPart?: { partType: string; condition: number },
  replacePartInstanceId?: string,
): Promise<PreviewResponse> {
  const { ship, rules } = await this.loadShipWithRules(shipId);
  const playerParts = await this.partsService.findPlayerParts(ship.ownerPlayerId);

  if (virtualPart !== undefined) {
    return this.previewWithVirtualPart(ship, rules, playerParts, virtualPart, replacePartInstanceId);
  }

  let installed: InstalledPart[];
  let effectiveLayout: Placement[];
  let omittedPartInstanceIds: string[] = [];

  if (layout !== undefined && layout.length > 0) {
    this.assertLayoutValid(layout, playerParts, shipId);
    effectiveLayout = layout;
    installed = this.buildInstalledParts(layout, playerParts);
  } else {
    const candidateParts = this.filterCandidateParts(playerParts, partInstanceIds);
    const arranged = arrange(candidateParts.map(toInstalledPart));
    installed = arranged.placed;
    effectiveLayout = arranged.layout;
    omittedPartInstanceIds = arranged.omitted.map((part) => part.instance.id);
    this.assertLayoutValid(effectiveLayout, playerParts, shipId);
  }

  const sheet = deriveSheet(installed, rules);
  const viability = checkViability(sheet, installed, rules);
  return {
    sheet,
    shipClass: deriveShipClass(installed, rules),
    viability,
    layout: effectiveLayout,
    omittedPartInstanceIds,
  };
}

// Market-compare only: builds the sheet as if `virtualPart` (a catalog type the player does not
// yet own) were installed in place of `replacePartInstanceId` (or simply added, when omitted).
// Skips arrange()/assertLayoutValid() entirely — a stat preview needs no real grid slot, only
// deriveSheet()'s per-part stat sums, so the virtual part's own condition is all it contributes.
private async previewWithVirtualPart(
  ship: Ship,
  rules: GameRules,
  playerParts: PartInstanceWithCatalog[],
  virtualPart: { partType: string; condition: number },
  replacePartInstanceId?: string,
): Promise<PreviewResponse> {
  const catalogRow = await this.prisma.partCatalog.findUnique({
    where: { partType: virtualPart.partType },
  });
  if (!catalogRow || !catalogRow.active) {
    throw new NotFoundException('part type not found');
  }

  const installedReal = playerParts.filter(
    (part) =>
      part.location === 'INSTALLED' &&
      part.shipId === ship.id &&
      part.id !== replacePartInstanceId,
  );
  const synthetic: InstalledPart = {
    instance: {
      id: 'virtual',
      partType: virtualPart.partType,
      ownerPlayerId: ship.ownerPlayerId,
      condition: virtualPart.condition,
      location: 'INSTALLED',
      shipId: ship.id,
      propRoll: null,
    },
    catalog: pickCatalogStats(catalogRow),
  };
  const installed = [...installedReal.map(toInstalledPart), synthetic];
  const sheet = deriveSheet(installed, rules);
  const viability = checkViability(sheet, installed, rules);
  return {
    sheet,
    shipClass: deriveShipClass(installed, rules),
    viability,
    layout: (ship.layout as unknown as Placement[]) ?? [],
    omittedPartInstanceIds: [],
  };
}
```

`PartInstanceWithCatalog` and `toInstalledPart` are already declared later in the same file (type aliases and function declarations are hoisted, so referencing them above their textual declaration compiles fine — the same pattern the file already relies on for `arrange`/`buildCatalogMap`).

- [ ] **Step 5: Thread the new fields through the controller**

In `apps/api/src/ships/ships.controller.ts`:

```ts
preview(@Param('id') shipId: string, @Body() dto: PreviewDto) {
  return this.shipsService.preview(
    shipId,
    dto.layout,
    dto.partInstanceIds,
    dto.virtualPart,
    dto.replacePartInstanceId,
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:int -- parts-ships` (from `apps/api`)
Expected: all 4 new tests PASS, and every pre-existing test in the file still passes (the new branch is additive and only triggers when `virtualPart` is present).

- [ ] **Step 7: Typecheck and run the full API unit + integration suites**

Run: `npx tsc --noEmit -p .` (from `apps/api`), then `npm run test:unit`, then `npm run test:int` (from `apps/api`).
Expected: clean typecheck, all unit tests pass, all integration tests pass (watch `git status --short` first and exclude `prisma/seed-data/parts.ts`/`test/integration/seed.int-spec.ts` from anything staged, per the Global Constraints).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/ships/dto/ship-operations.dto.ts apps/api/src/ships/ships.service.ts apps/api/src/ships/ships.controller.ts apps/api/test/integration/parts-ships.int-spec.ts
git commit -m "API: preview accepts a not-yet-owned virtual part for market comparisons"
```

---

### Task 2: Web — pure "which installed part would this replace" matcher

**Files:**
- Create: `apps/web/src/features/parts/part-compare-match.ts`
- Test: `apps/web/src/features/parts/part-compare-match.spec.ts`

**Interfaces:**
- Consumes: nothing beyond plain data shapes (no API calls, no React).
- Produces:
  ```ts
  export interface InstalledPartForCompare {
    id: string;
    displayName: LocalizedText;
    catalog: { partClass: string; w: number; h: number };
  }
  export function findReplaceCandidate(
    installed: readonly InstalledPartForCompare[],
    candidate: { catalog: { partClass: string; w: number; h: number } },
  ): InstalledPartForCompare | undefined
  ```
  Task 3 imports `InstalledPartForCompare` for its own context type; Task 4 imports both `InstalledPartForCompare` and `findReplaceCandidate`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/features/parts/part-compare-match.spec.ts
import { describe, it, expect } from 'vitest';
import { findReplaceCandidate, type InstalledPartForCompare } from './part-compare-match';

const name = (en: string): InstalledPartForCompare['displayName'] => ({ en, 'pt-BR': en });

const part = (
  id: string,
  partClass: string,
  w: number,
  h: number,
): InstalledPartForCompare => ({ id, displayName: name(id), catalog: { partClass, w, h } });

describe('findReplaceCandidate', () => {
  it('returns undefined when nothing of the class is installed', () => {
    const installed = [part('bridge-1', 'BRIDGE', 2, 2)];
    const candidate = { catalog: { partClass: 'DEFENSE', w: 2, h: 1 } };
    expect(findReplaceCandidate(installed, candidate)).toBeUndefined();
  });

  it('prefers the same-class part with the same footprint over another same-class part', () => {
    const small = part('cargo-small', 'CARGO', 1, 1);
    const big = part('cargo-big', 'CARGO', 2, 1);
    const candidate = { catalog: { partClass: 'CARGO', w: 2, h: 1 } };
    expect(findReplaceCandidate([small, big], candidate)?.id).toBe('cargo-big');
  });

  it('falls back to the first same-class part when no footprint matches', () => {
    const a = part('cargo-a', 'CARGO', 1, 1);
    const b = part('cargo-b', 'CARGO', 1, 2);
    const candidate = { catalog: { partClass: 'CARGO', w: 3, h: 3 } };
    expect(findReplaceCandidate([a, b], candidate)?.id).toBe('cargo-a');
  });

  it('is deterministic: the same input always returns the same match', () => {
    const installed = [part('cargo-a', 'CARGO', 1, 1), part('cargo-b', 'CARGO', 1, 1)];
    const candidate = { catalog: { partClass: 'CARGO', w: 1, h: 1 } };
    const first = findReplaceCandidate(installed, candidate);
    const second = findReplaceCandidate(installed, candidate);
    expect(first?.id).toBe(second?.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/parts/part-compare-match.spec.ts` (from `apps/web`)
Expected: FAIL — `./part-compare-match` does not exist.

- [ ] **Step 3: Implement the matcher**

```ts
// apps/web/src/features/parts/part-compare-match.ts
import type { LocalizedText } from '../../api/generated';

/** The minimal shape of an installed part this matcher needs — satisfied directly by
    `InventoryItem` (both Port's and My Ship's inventory query already return this shape). */
export interface InstalledPartForCompare {
  id: string;
  displayName: LocalizedText;
  catalog: { partClass: string; w: number; h: number };
}

/**
 * Which installed part (if any) a market candidate would replace, for the "if you swap this
 * in" comparison. Same class is required; among same-class parts, one with the identical
 * footprint (the candidate could actually occupy its slot) is preferred over an arbitrary one.
 * Returns undefined when nothing of the candidate's class is installed — the comparison is
 * then a pure addition instead of a swap.
 */
export function findReplaceCandidate(
  installed: readonly InstalledPartForCompare[],
  candidate: { catalog: { partClass: string; w: number; h: number } },
): InstalledPartForCompare | undefined {
  const sameClass = installed.filter((part) => part.catalog.partClass === candidate.catalog.partClass);
  if (sameClass.length === 0) return undefined;
  const sameFootprint = sameClass.find(
    (part) => part.catalog.w === candidate.catalog.w && part.catalog.h === candidate.catalog.h,
  );
  return sameFootprint ?? sameClass[0];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/parts/part-compare-match.spec.ts` (from `apps/web`)
Expected: PASS, all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/parts/part-compare-match.ts apps/web/src/features/parts/part-compare-match.spec.ts
git commit -m "Web: pure matcher for which installed part a market candidate would replace"
```

---

### Task 3: Web — `PartDetail` learns the "not-owned-yet" (virtual/swap) comparison

**Files:**
- Modify: `apps/web/src/features/parts/part-detail.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/pt-BR.json`
- Create: `apps/web/src/features/parts/part-info-button.spec.tsx`

**Interfaces:**
- Consumes: `InstalledPartForCompare` (Task 2, for the `replace` field's shape).
- Produces: `PartCompareContext` gains an optional `replace?: { partInstanceId: string; displayName: LocalizedText }` field. `PartDetail`/`PartInfoButton`'s existing `compare` prop is unchanged in name and required fields — Task 4 is the only caller that will ever set `replace`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/features/parts/part-info-button.spec.tsx
import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { PartInfoButton } from './part-info-button';
import type { PartInfoData } from './part-detail';
import type { ShipSheet } from '../../api/generated';

// A full sheet (every ShipSheetSchema field required — a bare partial would leave every
// row but the one under test reading NaN), same fixture shape as hangar.spec.tsx's testSheet.
const baseSheet: ShipSheet = {
  pot: 25, pdf: 0, bli: 12, esc: 0, sen: 2, crg: 5, min: 0, hp: 40, mass: 24,
  energyCont: 8, energyCombat: 0, batCharge: 4, batOutput: 10, batInput: 8,
  fuelCap: 40, fuelUse: 1, structureUsed: 18, structureBudget: 40,
  autonomy: 40, mob: 2, condition: 100,
};

const catalog: PartInfoData['catalog'] = {
  partType: 'cargo_uncommon',
  partClass: 'CARGO',
  w: 2,
  h: 1,
  mass: 2,
  structureCost: 4,
  partHp: 4,
  basePrice: 200,
  pot: 0,
  pdf: 0,
  bli: 0,
  esc: 0,
  sen: 0,
  crg: 8,
  min: 0,
  energyCont: 0,
  energyCombat: 0,
  fuelCap: 0,
  fuelUse: 0,
  batCharge: 0,
  batOutput: 0,
  batInput: 0,
  pressurized: false,
  lifeSupport: false,
};

// A market listing: no owned instance id, matching the real shape (MarketListing has none).
const listingPart: PartInfoData = {
  displayName: { en: 'Reinforced Cargo Rack', 'pt-BR': 'Suporte de Carga Reforçado' },
  description: { en: 'A bigger cargo rack.', 'pt-BR': 'Um suporte de carga maior.' },
  rarity: 'UNCOMMON',
  catalog,
  condition: 100,
};

describe('PartInfoButton: market (not-owned-yet) comparison', () => {
  it('asks for a virtual-part swap preview and shows it under a "swap" title', async () => {
    server.use(
      http.post('/v1/ships/:id/preview', async ({ request }) => {
        const body = (await request.json()) as {
          virtualPart?: { partType: string; condition: number };
          replacePartInstanceId?: string;
        };
        expect(body.virtualPart).toEqual({ partType: 'cargo_uncommon', condition: 100 });
        expect(body.replacePartInstanceId).toBe('part-cargo-a');
        return HttpResponse.json({
          sheet: { ...baseSheet, crg: baseSheet.crg + 8 }, // the candidate's own crg (8)
          shipClass: 'MULTIROLE',
          viability: { viable: true, problems: [] },
          layout: [],
          omittedPartInstanceIds: [],
        });
      }),
    );

    renderWithProviders(
      <PartInfoButton
        part={listingPart}
        compare={{
          shipId: 'ship-1',
          installedPartIds: ['part-cargo-a'],
          currentSheet: baseSheet,
          replace: { partInstanceId: 'part-cargo-a', displayName: { en: 'Cargo Rack', 'pt-BR': 'Suporte de Carga' } },
        }}
      />,
      { withRouter: false },
    );

    fireEvent.click(screen.getByRole('button', { name: /Details/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/swap this in for Cargo Rack/i)).toBeInTheDocument();

    const cargoRow = within(dialog).getByRole('row', { name: /^Cargo/ });
    await waitFor(() => expect(within(cargoRow).getByText('+8')).toBeInTheDocument());
    expect(within(cargoRow).getByText('+8')).toHaveClass('delta-good');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/parts/part-info-button.spec.tsx` (from `apps/web`)
Expected: FAIL — `compare.replace` doesn't exist on the type, and even if it compiled, the request body would still be `{ partInstanceIds: [...] }` (wrong shape) because `part.id` is undefined today and the current code has no branch for that case, so the "swap this in for" text never renders.

- [ ] **Step 3: Extend `PartCompareContext` and branch the query in `PartDetail`**

In `apps/web/src/features/parts/part-detail.tsx`:

```ts
/** Hangar only: what installing this (already-owned) part would do to the ship, compared to how
    it stands today. Needs the part's own instance id (`PartInfoData.id`) to ask the server. */
export interface PartCompareContext {
  shipId: string;
  /** Every part instance already on the ship. */
  installedPartIds: readonly string[];
  /** The ship's own current sheet — the "before" side of the comparison. */
  currentSheet: ShipSheet;
  /** Market only: the installed part (of the candidate's class) it would replace, and its name
      for the "swap" wording — omitted when nothing of that class is installed yet, in which
      case the candidate is compared as a pure addition instead of a swap. */
  replace?: { partInstanceId: string; displayName: LocalizedText };
}
```

Replace the `comparePreview` query and its `enabled` condition:

```ts
const comparePreview = useQuery({
  queryKey: [
    'partCompare',
    compare?.shipId,
    compare?.installedPartIds,
    compare?.replace?.partInstanceId,
    part.id,
    catalog.partType,
    part.condition,
  ],
  enabled: compare !== undefined,
  queryFn: () =>
    part.id !== undefined
      ? // Owned (Hangar tray): add this already-owned part to the current arrangement.
        client.post<PreviewResponse>(`/v1/ships/${compare?.shipId ?? ''}/preview`, {
          partInstanceIds: [...(compare?.installedPartIds ?? []), part.id],
        })
      : // Not owned yet (Market/Store): ask for a virtual-part swap or addition.
        client.post<PreviewResponse>(`/v1/ships/${compare?.shipId ?? ''}/preview`, {
          virtualPart: { partType: catalog.partType, condition: part.condition ?? 100 },
          replacePartInstanceId: compare?.replace?.partInstanceId,
        }),
});
```

Update the title line to say "swap" when replacing something:

```tsx
{compare !== undefined && (
  <p className="muted part-compare-note">
    {comparePreview.isLoading
      ? t('parts.compare.loading')
      : compare.replace !== undefined
        ? t('parts.compare.titleSwap', { name: pickLocalized(compare.replace.displayName, i18n.language) })
        : t('parts.compare.title')}
  </p>
)}
```

`catalog.partType` requires `PartCatalogStats` to carry `partType` — confirm it already does (it's used elsewhere, e.g. `hangar.page.tsx`'s tray rows read `part.catalog.partType`... actually check: if it's not already read anywhere, grep `PartCatalogStats` definition in `apps/web/src/api/generated.ts`'s source, `packages/contract`, to confirm the field exists before writing this step as final — it does, since `MarketListing.catalog` is the same `PartCatalogStats` type and every catalog row includes `partType` per the API's `pickCatalogStats`).

- [ ] **Step 4: Add the new i18n key**

`apps/web/src/i18n/en.json`, inside `parts.compare`:
```json
"titleSwap": "If you swap this in for {{name}}"
```

`apps/web/src/i18n/pt-BR.json`, inside `parts.compare`:
```json
"titleSwap": "Se você trocar por {{name}}"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/features/parts/part-info-button.spec.tsx` (from `apps/web`)
Expected: PASS.

- [ ] **Step 6: Run the existing Hangar/part-detail-dependent tests to confirm no regression**

Run: `npx vitest run src/features/hangar/hangar.spec.tsx` (from `apps/web`)
Expected: PASS unchanged — the owned-part branch (`part.id !== undefined`) is untouched in behavior, only its `queryKey` gained harmless extra entries.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .` (from `apps/web`)
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/parts/part-detail.tsx apps/web/src/features/parts/part-info-button.spec.tsx apps/web/src/i18n/en.json apps/web/src/i18n/pt-BR.json
git commit -m "Web: PartDetail supports comparing a not-yet-owned (market) part"
```

---

### Task 4: Web — wire the comparison into Market/Store cards

**Files:**
- Modify: `apps/web/src/features/parts/part-card.tsx`
- Modify: `apps/web/src/features/market/market-panel.tsx`
- Modify: `apps/web/src/features/port/port.page.tsx`
- Modify: `apps/web/src/features/hangar/hangar.page.tsx`
- Test: `apps/web/src/features/market/market-panel.spec.tsx`

**Interfaces:**
- Consumes: `findReplaceCandidate`/`InstalledPartForCompare` (Task 2), `PartCompareContext` (Task 3, now with `replace`).
- Produces: `PartCardProps` gains `compare?: PartCompareContext` (passed straight to its internal `PartInfoButton`). `MarketPanelProps` gains `shipId?: string`, `installedParts?: readonly InstalledPartForCompare[]`, `currentSheet?: ShipSheet` — all optional, so a caller that omits them just gets no compare column (never a crash).

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/features/market/market-panel.spec.tsx` (reuses the file's existing `onboarded()`/`renderPortMarket()` helpers). These tests control both sides of the comparison themselves — a full, self-contained `ShipResponse` fixture (overriding `/v1/ships`, since `ShipSheetSchema` requires every field and the file's default fixture's exact values shouldn't be a hidden dependency of a new test) and a preview mock derived from that same baseline:

```tsx
const baseSheet: ShipSheet = {
  pot: 25, pdf: 0, bli: 1, esc: 0, sen: 0, crg: 0, min: 0, hp: 20, mass: 24,
  energyCont: 8, energyCombat: 0, batCharge: 4, batOutput: 10, batInput: 8,
  fuelCap: 40, fuelUse: 1, structureUsed: 18, structureBudget: 40,
  autonomy: 40, mob: 2, condition: 100,
};

const shipWithSheet = (sheet: ShipSheet) =>
  http.get('/v1/ships', () =>
    HttpResponse.json(
      [
        {
          id: 'ship-1',
          ownerPlayerId: 'player-1',
          name: 'luna starter',
          fuel: 40,
          status: 'IN_PORT',
          currentLocationId: 'ceres',
          stance: 'NEUTRAL',
          layout: [],
          sheet,
          shipClass: 'MULTIROLE',
          yard: { halfSize: 10 },
          activity: { kind: 'idle', until: null, missionId: null },
        },
      ],
      { status: 200 },
    ),
  );
```

```tsx
it('compares a listing against the installed part of the same class, colored by whether it helps', async () => {
  server.use(
    onboarded(),
    shipWithSheet(baseSheet),
    http.get('/v1/inventory', () =>
      HttpResponse.json(
        [
          {
            id: 'part-hull-installed',
            partType: 'hull',
            displayName: { en: 'Plated Hull', 'pt-BR': 'Casco Blindado' },
            description: { en: '', 'pt-BR': '' },
            rarity: 'COMMON',
            condition: 100,
            broken: false,
            location: 'INSTALLED',
            shipId: 'ship-1',
            catalog: { partType: 'hull', partClass: 'DEFENSE', w: 2, h: 2, mass: 4, structureCost: 5, partHp: 20, basePrice: 100, pot: 0, pdf: 0, bli: 1, esc: 0, sen: 0, crg: 0, min: 0, energyCont: 0, energyCombat: 0, fuelCap: 0, fuelUse: 0, batCharge: 0, batOutput: 0, batInput: 0, pressurized: false, lifeSupport: false },
          },
        ],
        { status: 200 },
      ),
    ),
    http.post('/v1/ships/:id/preview', async ({ request }) => {
      const body = (await request.json()) as { replacePartInstanceId?: string };
      expect(body.replacePartInstanceId).toBe('part-hull-installed');
      // hull's own partHp (20) -> hull_uncommon's (26): +6, matching real seeded catalog values.
      return HttpResponse.json({
        sheet: { ...baseSheet, hp: baseSheet.hp + 6 },
        shipClass: 'MULTIROLE',
        viability: { viable: true, problems: [] },
        layout: [],
        omittedPartInstanceIds: [],
      });
    }),
  );
  await renderPortMarket();
  await screen.findByText('Plated Hull');

  fireEvent.click(within(panel()).getByRole('button', { name: /Details: Plated Hull/i }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/swap this in for/i)).toBeInTheDocument();
  const hpRow = within(dialog).getByRole('row', { name: /^Hit points/ });
  await waitFor(() => expect(within(hpRow).getByText('+6')).toBeInTheDocument());
  expect(within(hpRow).getByText('+6')).toHaveClass('delta-good');
});

it('compares a listing with nothing installed of its class as a plain addition, not a swap', async () => {
  server.use(
    onboarded(),
    shipWithSheet(baseSheet),
    http.get('/v1/inventory', () => HttpResponse.json([], { status: 200 })),
    http.post('/v1/ships/:id/preview', () =>
      HttpResponse.json({
        sheet: { ...baseSheet, hp: baseSheet.hp + 20 },
        shipClass: 'MULTIROLE',
        viability: { viable: true, problems: [] },
        layout: [],
        omittedPartInstanceIds: [],
      }),
    ),
  );
  await renderPortMarket();
  await screen.findByText('Plated Hull');

  fireEvent.click(within(panel()).getByRole('button', { name: /Details: Plated Hull/i }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('If you install this now')).toBeInTheDocument();
});
```

`ShipSheet` needs importing at the top of the spec file: `import type { ShipSheet } from '../../api/generated';`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/market/market-panel.spec.tsx` (from `apps/web`)
Expected: FAIL — `MarketPanel` never renders a `compare` context yet, so no "swap this in for"/"If you install this now" text appears, and the `PartInfoButton` inside `PartCard` never receives a `compare` prop at all.

- [ ] **Step 3: Thread `compare` through `PartCard`**

In `apps/web/src/features/parts/part-card.tsx`:

```ts
import { PartDetail, type PartCompareContext, type PartInfoData } from './part-detail';
```

```ts
export interface PartCardProps {
  part: PartInfoData;
  price?: number;
  priceCaption?: string;
  note?: string;
  used?: boolean;
  actions?: ReactNode;
  /** Market/Store only: what buying this would do to the ship, shown in its detail popup. */
  compare?: PartCompareContext;
}
```

```ts
export function PartCard({ part, price, priceCaption, note, used = false, actions, compare }: PartCardProps) {
```

```tsx
<footer className="pcard-actions">
  <PartInfoButton part={part} compare={compare} />
  {actions}
</footer>
```

- [ ] **Step 4: Build the compare context per listing in `MarketPanel`**

In `apps/web/src/features/market/market-panel.tsx`:

```ts
import type { LocalizedText, ShipSheet } from '../../api/generated';
import { findReplaceCandidate, type InstalledPartForCompare } from '../parts/part-compare-match';
import type { PartCompareContext } from '../parts/part-detail';
```

```ts
export interface MarketPanelProps {
  locationId: string;
  presetClass?: string | null;
  onNotice?: (message: string | null) => void;
  showBalance?: boolean;
  /** Compare column (round-2 plan §5b item 4): the ship to compare against, its currently
      installed parts, and its current sheet. Omitted entirely (no host-side ship context) just
      means listings show no compare column — buying still works exactly the same either way. */
  shipId?: string;
  installedParts?: readonly InstalledPartForCompare[];
  currentSheet?: ShipSheet;
}
```

```ts
export function MarketPanel({
  locationId,
  presetClass = null,
  onNotice,
  showBalance = false,
  shipId,
  installedParts,
  currentSheet,
}: MarketPanelProps) {
```

```ts
const compareContextFor = (listing: MarketListing): PartCompareContext | undefined => {
  if (shipId === undefined || currentSheet === undefined) return undefined;
  const replaceTarget =
    installedParts !== undefined ? findReplaceCandidate(installedParts, listing) : undefined;
  return {
    shipId,
    installedPartIds: (installedParts ?? []).map((part) => part.id),
    currentSheet,
    replace:
      replaceTarget === undefined
        ? undefined
        : { partInstanceId: replaceTarget.id, displayName: replaceTarget.displayName },
  };
};
```

Pass it to each card:

```tsx
<PartCard
  key={listing.listingId}
  part={{ ...listing }}
  price={listing.price}
  priceCaption={t('market.youPay')}
  used={listing.kind === 'used'}
  compare={compareContextFor(listing)}
  actions={...}
/>
```

- [ ] **Step 5: Pass ship context from both hosts**

In `apps/web/src/features/port/port.page.tsx`, the Market tab:

```tsx
{tab === 'market' && (
  <section className="stack">
    <MarketPanel
      locationId={ship.currentLocationId}
      onNotice={setNotice}
      shipId={ship.id}
      installedParts={installed}
      currentSheet={ship.sheet}
    />
  </section>
)}
```

(`installed` is the page's existing `inventory.filter((entry) => entry.location === 'INSTALLED')` — already computed for the Goods tab.)

In `apps/web/src/features/hangar/hangar.page.tsx`, the Store tab:

```tsx
{sideTab === 'store' &&
  (ship.status === 'IN_PORT' ? (
    <MarketPanel
      locationId={ship.currentLocationId}
      presetClass={storeClass}
      showBalance
      shipId={ship.id}
      installedParts={parts.filter((part) => part.location === 'INSTALLED')}
      currentSheet={sheet}
    />
  ) : (
    <p className="muted">{t('hangar.side.storeUnavailable')}</p>
  ))}
```

(`sheet` may be `undefined` here per its existing `const sheet = preview?.sheet ?? ship?.sheet;` — passing `undefined` is fine, `MarketPanelProps.currentSheet` is optional and `compareContextFor` already treats a missing sheet as "no compare column.")

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/features/market/market-panel.spec.tsx` (from `apps/web`)
Expected: PASS.

- [ ] **Step 7: Run the full web suite**

Run: `npx vitest run` (from `apps/web`)
Expected: every test passes, including `port.spec.tsx` and `hangar.spec.tsx` (neither should need changes — both hosts' existing tests don't assert on the Market/Store tab's compare column, and the new props are additive).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit -p .` (from `apps/web`)
Expected: clean.

- [ ] **Step 9: Rebuild and verify live**

```bash
docker compose build api web
docker compose up -d --wait api web
docker compose restart web   # known 502-after-rebuild workaround
```

Log in as the owner's account, open Port → Market (and My Ship → Store), open a listing whose class is already installed (e.g. Hull Frame) and confirm the popup reads "If you swap this in for <current part name>" with a colored delta table; open a listing whose class has nothing installed and confirm it instead reads "If you install this now" with the addition-style delta. Confirm no extra network requests fire just from scrolling the list (only on opening a popup).

- [ ] **Step 10: Update the plan doc and commit**

Mark §5b item 4 in `docs/superpowers/plans/2026-09-27-playtest-round-2-plan.md` as Done, with a short implementation summary (mirroring how every other item in that doc is closed out), then:

```bash
git add apps/web/src/features/parts/part-card.tsx apps/web/src/features/market/market-panel.tsx apps/web/src/features/port/port.page.tsx apps/web/src/features/hangar/hangar.page.tsx apps/web/src/features/market/market-panel.spec.tsx docs/superpowers/plans/2026-09-27-playtest-round-2-plan.md
git commit -m "Web: show the market/store compare column on part cards (round-2 plan §5b.4)"
```

---

Each task is independently testable and shippable — Task 1 can ship alone (a strictly additive API capability nothing yet calls), Task 2 is a pure function with zero UI risk, Task 3 makes `PartDetail` capable of the new mode without touching any real screen, and Task 4 is the only task that changes what a player actually sees. Stopping after any task leaves nothing half-broken.
