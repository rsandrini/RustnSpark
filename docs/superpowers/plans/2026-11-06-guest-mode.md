# Guest Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor can press "Play as guest" and start flying with no email and no password, and can later claim the pilot with an email and password without losing anything.

**Architecture:** A guest is an ordinary `Account` + `Player` flagged `isGuest`, with a synthetic unusable email and a random password hash, so every existing game rule, guard and query keeps working unchanged. The only credential is the refresh-token cookie the guest session already issues. "Claim" turns the guest account into a normal one in place (same ids, so nothing moves). Guests are held back from the public surfaces (rankings, public card, bug-report email) and old unclaimed guests are purged by a worker job.

**Tech Stack:** NestJS, Prisma/Postgres, BullMQ worker, React, TanStack Query, msw/Vitest, Jest (int/e2e).

**Spec:** this document (owner request, 2026-11-06: "a guest mode, so the user doesn't need to create an account"). Open questions are listed at the end with the default each task assumes.

## Global Constraints

- Code in English; player-facing text bilingual (en + pt-BR), no hard-coded strings; new error codes need en + pt-BR.
- `apps/api/src` must not import the contract package; use local types, parse in the int-spec.
- Tunable numbers (retention days, daily cap) live in the admin config; DB wins over TS defaults, seed is insert-only, add them to the seed AND the defaults and prove with `scripts/seed-drift.sh`.
- Rebuild the `worker` container too.
- Run `pnpm test:e2e` before pushing.
- A guest must be able to do everything a new pilot does in the first sessions (onboarding, tutorial, flights, repairs).

## Review Focus

- Guest clears browser data or switches device: the pilot is gone; the UI says so before it happens, and offers claim.
- Someone scripts `POST /auth/guest`: per-IP throttle and a global daily cap, not an unbounded account factory.
- Claim with an email that already exists: 409 with the same non-revealing message as register, the guest stays a guest and keeps playing.
- Guest asks for a password reset: nothing is sent to the synthetic address.
- Guest purge while the guest has a flight in progress or just claimed: a claimed account is never purged.

---

## File structure

- `apps/api/prisma/schema.prisma` + new migration: `Account.isGuest Boolean @default(false)`, `Account.lastSeenAt` is NOT added (use the player stats `touch` that already exists for activity).
- `apps/api/src/auth/guest.service.ts` (new): `createGuest(locale)`, `claim(accountId, email, password)`, `purgeIdle(now)`.
- `apps/api/src/auth/auth.controller.ts`: routes `POST /v1/auth/guest`, `POST /v1/auth/claim`.
- `apps/api/src/jobs/` : repeatable `guest-purge` job and processor (follow the pattern of the existing processors, with the Sentry failure hook).
- `apps/api/src/config/*`: `auth.guest_enabled`, `auth.guest_daily_cap`, `auth.guest_retention_days`.
- `apps/web/src/features/auth/`: `guest-button.tsx`, `claim-popup.tsx`, `auth.api.ts`, `auth.context.tsx`, `landing.tsx`, `ui/AccountMenu.tsx`.
- `docs/` : `docs/operations.md` (purge, cap), `README` line.

### Task 1: Data model and the guest account service

**Files:**
- Modify: `apps/api/prisma/schema.prisma`; Create: migration `apps/api/prisma/migrations/<timestamp>_account_is_guest/`
- Create: `apps/api/src/auth/guest.service.ts`
- Test: `apps/api/test/integration/guest.int-spec.ts`

**Interfaces:**
- Produces: `GuestService.createGuest(locale: 'en' | 'pt-BR'): Promise<AuthSession>`; `AuthSession` gains `isGuest: boolean` (api-local type, mirrored in the contract package).

- [ ] **Step 1: Write the failing test** `createGuest makes a flagged account whose email cannot receive mail and whose name is unique`: two calls give two players, `account.isGuest === true`, email ends with `@guest.invalid`, names differ, `session.isGuest === true`; a normal `register` gives `isGuest === false`.
- [ ] **Step 2: Run** `pnpm --filter api test:int -- guest`. Expected: FAIL (no service).
- [ ] **Step 3: Implement** the migration and `createGuest`: email `guest-<uuid>@guest.invalid`, `passwordHash` = hash of 32 random bytes (never shown), name `Pilot-<6 base32 chars>` retried on `P2002`; reuse `buildSession` and the refresh token issue path from `AuthService` (extract the shared bit rather than copy it).
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): guest accounts`.

### Task 2: `POST /v1/auth/guest` with throttle, switch and daily cap

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/guest.service.ts`, config defaults/seed/types for `auth.guest_enabled` (default true), `auth.guest_daily_cap` (default 200)
- Test: `apps/api/test/integration/guest.int-spec.ts`, `apps/api/test/security/` (extend the throttle spec)

**Interfaces:**
- Consumes: `GuestService.createGuest`.
- Produces: route `POST /v1/auth/guest` body `{ locale }` answering the same shape as `login` (cookie included); error codes `GUEST_DISABLED` (403), `GUEST_CAP_REACHED` (503) with en + pt-BR texts.

- [ ] **Step 1: Write the failing tests:** disabled switch answers `GUEST_DISABLED`; the (cap+1)th guest of the day answers `GUEST_CAP_REACHED`; the throttle policy answers 429 after the per-IP limit; a guest session can call an authenticated route (`GET /v1/players/me`).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the route (`@Public()`, `@ThrottleRoute(GUEST_POLICY)` modelled on `REGISTER_POLICY`) and the cap as a count of guest accounts created since 00:00 UTC.
- [ ] **Step 4: Run int + security specs, and `scripts/seed-drift.sh`.** Expected: PASS, no drift.
- [ ] **Step 5: Commit** `feat(auth): POST /auth/guest, throttled and capped`.

### Task 3: Claim a guest pilot (`POST /v1/auth/claim`)

**Files:**
- Modify: `apps/api/src/auth/guest.service.ts`, `auth.controller.ts`, `apps/api/src/auth/dto/` (new `ClaimDto`: `email`, `password` with the same validation as register)
- Test: `apps/api/test/integration/guest.int-spec.ts`

**Interfaces:**
- Produces: `GuestService.claim(accountId: string, email: string, password: string): Promise<AuthSession>`; route authenticated; 409 `REGISTER_CONFLICT_MESSAGE` on a taken email; 409 `NOT_A_GUEST` for a normal account.

- [ ] **Step 1: Write the failing tests:** claim keeps the same `account.id` and `player.id` and all progress (credits, ship), flips `isGuest` to false, lets `login` work with the new email and password afterwards; a taken email leaves the guest a guest; a normal account gets `NOT_A_GUEST`; the email is lower-cased (R17).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** in one transaction (conditional `updateMany where isGuest = true` so two claims cannot both win); map `P2002` to the register conflict message.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): a guest can claim the pilot with an email and password`.

### Task 4: Keep guests off the public surfaces and out of email

**Files:**
- Modify: rankings and public-card queries (find them with `grep -rn "publicId" apps/api/src`), `apps/api/src/feedback/feedback.service.ts`, `AuthService.forgotPassword`
- Test: `apps/api/test/integration/rankings.int-spec.ts` (extend), `feedback` spec, auth spec

- [ ] **Step 1: Write the failing tests:** a guest is not in the rankings list and has no public card (404) until claimed, and appears right after claim; the bug report from a guest does not use the synthetic address as the reply-to; `forgotPassword` for a guest email sends nothing and answers the uniform response.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the three filters (`account: { isGuest: false }` in the ranking and card queries; skip the reply-to for guests; skip guests in `forgotPassword`).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): guests stay off the rankings and out of email`.

### Task 5: Purge idle guests

**Files:**
- Create: `apps/api/src/jobs/processors/guest-purge.processor.ts`; Modify: queue registration, `GuestService.purgeIdle`, config `auth.guest_retention_days` (default 30)
- Test: `apps/api/test/integration/guest-purge.int-spec.ts`

**Interfaces:**
- Produces: `GuestService.purgeIdle(now: Date): Promise<number>` returning how many guests were removed.

- [ ] **Step 1: Spike (no commit):** list every table that references `Player`/`Account` (`grep -n "playerId\|accountId" apps/api/prisma/schema.prisma`) and check how the emergency `account.cli` / reset-player tool removes or resets one; reuse that path. Write the table order in the test's comment.
- [ ] **Step 2: Write the failing test** `purgeIdle removes unclaimed guests idle longer than the retention and never a claimed account, a recent guest, or a guest with a flight in progress`.
- [ ] **Step 3: Run it.** Expected: FAIL.
- [ ] **Step 4: Implement** `purgeIdle` (last activity from the player stats `lastActive`) and the daily repeatable job; the processor reports failures with `captureJobFailure` like the others.
- [ ] **Step 5: Run int spec and the job-registration spec.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(jobs): idle guests are purged after the retention`.

### Task 6: Web: "Play as guest", the guest badge and the claim popup

**Files:**
- Modify: `apps/web/src/features/auth/auth.api.ts`, `auth.context.tsx`, `landing.tsx`, `apps/web/src/ui/AccountMenu.tsx`, `apps/web/src/i18n/en.json`, `pt-BR.json`
- Create: `apps/web/src/features/auth/guest-button.tsx`, `claim-popup.tsx`
- Test: `apps/web/src/features/auth/guest.spec.tsx`

**Interfaces:**
- Consumes: `POST /v1/auth/guest`, `POST /v1/auth/claim`, `session.isGuest`.
- Produces: `playAsGuest(locale): Promise<void>` in the auth API module; `<ClaimPopup open onClose />`.

- [ ] **Step 1: Write the failing tests:** the landing page has a "Play as guest" button that starts a session and lands on onboarding; the account menu of a guest shows a "Guest" label and a "Save your progress" item that opens the claim popup; submitting email + password closes it and the label disappears; a taken email shows the translated conflict and keeps the popup open; the popup text says clearing the browser data loses a guest pilot (pt-BR has the same keys).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the pieces; the guest button sits under the register form on the landing and on the phone layout; reuse `Popup` and the feedback `notify` for the "Saved" answer.
- [ ] **Step 4: Run web tests, `tsc`, `eslint`, the i18n key spec.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): play as guest, and save the pilot later`.

### Task 7: Gentle reminders, docs, e2e

**Files:**
- Modify: `apps/web/src/features/tutorial/` or the feedback host for one reminder after the first completed mission; `docs/operations.md`, `README.md`; Create: Playwright smoke in the existing browser smoke spec
- Test: web unit for the reminder; browser smoke `guest starts, flies the first mission and claims`

- [ ] **Step 1: Write the failing web test** `a guest sees one reminder to save the pilot after the first report, and not again once dismissed` (dismissal kept in `localStorage`).
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** the reminder (a feedback notice with a "Save" action opening the claim popup) and the docs (switch, cap, retention, purge, what a guest cannot do).
- [ ] **Step 4: Run web tests, `pnpm test:e2e`, and the browser smoke on the scratch stack.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: guest reminder and docs`.

---

## Open questions (defaults assumed above)

1. Guests in the rankings? Default **no** until claimed (keeps throwaway names off the public board).
2. How long to keep an unclaimed guest? Default **30 days idle**, tunable in the admin.
3. Daily cap on new guests? Default **200**, tunable; switch off with `auth.guest_enabled`.
4. Can a guest pick a name? Default **no**, an automatic `Pilot-XXXXXX`; the name stays after the claim (changing it is a separate feature).
5. Should a guest be able to log in again on another device without claiming? Default **no** (that is exactly what claiming is for).
