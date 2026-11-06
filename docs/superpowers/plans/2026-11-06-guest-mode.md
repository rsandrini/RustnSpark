# Guest Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor can press "Play as guest" and start flying with no email and no password, and can later claim the pilot with an email and password without losing anything.

**Architecture:** A guest is an ordinary `Account` + `Player` flagged `isGuest`, with a synthetic unusable email and a random password hash, so every existing game rule, guard and query keeps working unchanged. The guest's only credential is a random **guest key kept in the browser's localStorage** (the server stores only its hash); the key signs the guest back in (`resume`), so a guest outlives the 30-day refresh cookie. "Claim" turns the guest account into a normal one in place (same ids, so nothing moves). Guests are held back from the public surfaces (rankings, public card, bug-report email), and unclaimed guests idle for 30 days are **frozen** (kept, not deleted) by a worker job.

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

- Guest clears browser data or switches device: the local key is gone and so is the pilot; the UI says so before it happens, and offers claim.
- Someone scripts `POST /auth/guest`: per-IP throttle and a global daily cap, not an unbounded account factory.
- Claim with an email that already exists: 409 with the same non-revealing message as register, the guest stays a guest and keeps playing.
- Guest asks for a password reset: nothing is sent to the synthetic address.
- Freezing a guest with a flight in progress, or one that just claimed: a claimed account is never frozen, and a flight in progress is never cut off.
- A stolen or guessed key: 32 random bytes, hash-only storage, `resume` throttled per IP like login.

---

## File structure

- `apps/api/prisma/schema.prisma` + new migration: `Account.isGuest Boolean @default(false)`, `Account.guestKeyHash String? @unique`, `AccountStatus` gains `FROZEN`. No `lastSeenAt` (use the player stats `lastActive` that already exists).
- `apps/api/src/auth/guest.service.ts` (new): `createGuest(locale)`, `resume(guestKey)`, `claim(accountId, input)`, `freezeIdle(now)`.
- `apps/api/src/auth/auth.controller.ts`: routes `POST /v1/auth/guest`, `POST /v1/auth/guest/resume`, `POST /v1/auth/claim`.
- `apps/api/src/jobs/` : repeatable `guest-freeze` job and processor (follow the pattern of the existing processors, with the Sentry failure hook).
- `apps/api/src/config/*`: `auth.guest_enabled`, `auth.guest_daily_cap`, `auth.guest_freeze_days`.
- `apps/web/src/features/auth/`: `guest-button.tsx`, `claim-popup.tsx`, `auth.api.ts`, `auth.context.tsx`, `landing.tsx`, `ui/AccountMenu.tsx`.
- `docs/` : `docs/operations.md` (freeze, cap, unfreeze), `README` line. `apps/api/src/admin/cli/account.cli.ts` gains `unfreeze --email|--player`.

### Task 1: Data model and the guest account service

**Files:**
- Modify: `apps/api/prisma/schema.prisma`; Create: migration `apps/api/prisma/migrations/<timestamp>_account_is_guest/`
- Create: `apps/api/src/auth/guest.service.ts`
- Test: `apps/api/test/integration/guest.int-spec.ts`

**Interfaces:**
- Produces: `GuestService.createGuest(locale: 'en' | 'pt-BR'): Promise<AuthSession & { guestKey: string }>`; `AuthSession` gains `isGuest: boolean` (api-local type, mirrored in the contract package). `guestKey` is shown once, only here.

- [ ] **Step 1: Write the failing test** `createGuest makes a flagged account whose email cannot receive mail and whose name is guest-<6 chars>`: two calls give two players, `account.isGuest === true`, email ends with `@guest.invalid`, names match `/^guest-[a-z0-9]{6}$/` and differ, `session.isGuest === true`, the stored `guestKeyHash` is the hash of the returned key and the key itself is not stored; a normal `register` gives `isGuest === false`.
- [ ] **Step 2: Run** `pnpm --filter api test:int -- guest`. Expected: FAIL (no service).
- [ ] **Step 3: Implement** the migration and `createGuest`: email `guest-<uuid>@guest.invalid`, `passwordHash` = hash of 32 random bytes (never shown), name `guest-<6 lowercase base36 chars>` retried on `P2002`; `guestKey` = 32 random bytes base64url, stored as SHA-256; reuse `buildSession` and the refresh token issue path from `AuthService` (extract the shared bit rather than copy it).
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): guest accounts`.

### Task 2: `POST /v1/auth/guest`, `POST /v1/auth/guest/resume`, throttle, switch and daily cap

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/guest.service.ts`, config defaults/seed/types for `auth.guest_enabled` (default true), `auth.guest_daily_cap` (default 300)
- Test: `apps/api/test/integration/guest.int-spec.ts`, `apps/api/test/security/` (extend the throttle spec)

**Interfaces:**
- Consumes: `GuestService.createGuest`.
- Produces: `POST /v1/auth/guest` body `{ locale }` answering the `login` shape plus `guestKey` (cookie included); `POST /v1/auth/guest/resume` body `{ guestKey }` answering the `login` shape (new refresh cookie); error codes `GUEST_DISABLED` (403), `GUEST_CAP_REACHED` (503), `GUEST_FROZEN` (403), with en + pt-BR texts. A wrong or unknown key answers the generic login failure.

- [ ] **Step 1: Write the failing tests:** disabled switch answers `GUEST_DISABLED`; the (cap+1)th guest of the day answers `GUEST_CAP_REACHED`; the throttle policy answers 429 after the per-IP limit; a guest session can call an authenticated route (`GET /v1/players/me`); `resume` with the key returned by `guest` gives a working session for the same player, a wrong key gets 401, a claimed account's old key is refused.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the route (`@Public()`, `@ThrottleRoute(GUEST_POLICY)` modelled on `REGISTER_POLICY`) and the cap as a count of guest accounts created since 00:00 UTC.
- [ ] **Step 4: Run int + security specs, and `scripts/seed-drift.sh`.** Expected: PASS, no drift.
- [ ] **Step 5: Commit** `feat(auth): POST /auth/guest, throttled and capped`.

### Task 3: Claim a guest pilot (`POST /v1/auth/claim`)

**Files:**
- Modify: `apps/api/src/auth/guest.service.ts`, `auth.controller.ts`, `apps/api/src/auth/dto/` (new `ClaimDto`: `email`, `password` with the same validation as register, optional `name` with the register name rule)
- Test: `apps/api/test/integration/guest.int-spec.ts`

**Interfaces:**
- Produces: `GuestService.claim(accountId: string, input: { email: string; password: string; name?: string }): Promise<AuthSession>` (the `guest-xxxxxx` name stays unless a name is given; a taken name is the register conflict); route authenticated; 409 `REGISTER_CONFLICT_MESSAGE` on a taken email; 409 `NOT_A_GUEST` for a normal account.

- [ ] **Step 1: Write the failing tests:** claim keeps the same `account.id` and `player.id` and all progress (credits, ship), flips `isGuest` to false and clears `guestKeyHash`, lets `login` work with the new email and password afterwards; a taken email leaves the guest a guest; a normal account gets `NOT_A_GUEST`; the email is lower-cased (R17).
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

### Task 5: Freeze idle guests

**Files:**
- Create: `apps/api/src/jobs/processors/guest-freeze.processor.ts`; Modify: queue registration, `GuestService.freezeIdle`, `AuthService.login/refresh` and `GuestService.resume` (refuse FROZEN), `account.cli.ts` + `account-commands.ts` (`unfreeze`), config `auth.guest_freeze_days` (default 30)
- Test: `apps/api/test/integration/guest-freeze.int-spec.ts`, extend `account-cli.int-spec.ts`

**Interfaces:**
- Produces: `GuestService.freezeIdle(now: Date): Promise<number>` returning how many guests were frozen; account status `FROZEN` (data kept, nothing deleted).

- [ ] **Step 1: Write the failing test** `freezeIdle freezes unclaimed guests idle longer than the setting and never a claimed account, a recent guest, or a guest with a flight in progress; a frozen guest cannot refresh or resume (GUEST_FROZEN) and its data is untouched`; and `unfreeze` in the CLI sets it ACTIVE again.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** `freezeIdle` (last activity from the player stats `lastActive`), the daily repeatable job (failures go through `captureJobFailure` like the other processors), the FROZEN checks and the CLI command.
- [ ] **Step 4: Run int specs and the job-registration spec.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): idle guests are frozen, not deleted`.

### Task 6: Web: "Play as guest", the guest badge and the claim popup

**Files:**
- Modify: `apps/web/src/features/auth/auth.api.ts`, `auth.context.tsx`, `landing.tsx`, `apps/web/src/ui/AccountMenu.tsx`, `apps/web/src/i18n/en.json`, `pt-BR.json`
- Create: `apps/web/src/features/auth/guest-button.tsx`, `claim-popup.tsx`
- Test: `apps/web/src/features/auth/guest.spec.tsx`

**Interfaces:**
- Consumes: `POST /v1/auth/guest`, `/guest/resume`, `/claim`, `session.isGuest`.
- Produces: `playAsGuest(locale): Promise<void>` in the auth API module (stores `guestKey` under the localStorage key `rs.guestKey`); startup resume: no session but a stored key means `resume` before the login redirect; `<ClaimPopup open onClose />`.

- [ ] **Step 1: Write the failing tests:** reloading with only the stored key signs the guest back in; a frozen or unknown key is cleared and the landing page explains it; the landing page has a "Play as guest" button that starts a session and lands on onboarding; the account menu of a guest shows a "Guest" label and a "Save your progress" item that opens the claim popup; submitting email + password closes it and the label disappears; a taken email shows the translated conflict and keeps the popup open; the popup says clearing the browser data loses a guest pilot (pt-BR has the same keys) and asks for email, password and an optional pilot name; logging out of a guest asks first (it would lose the pilot) and clears the key.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the pieces; the guest button sits under the register form on the landing and on the phone layout; reuse `Popup` and the feedback `notify` for the "Saved" answer.
- [ ] **Step 4: Run web tests, `tsc`, `eslint`, the i18n key spec.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): play as guest, and save the pilot later`.

### Task 7: Gentle reminders, docs, e2e

**Files:**
- Modify: `apps/web/src/features/tutorial/` or the feedback host for one reminder after the first completed mission; `docs/operations.md` (switch, cap, freeze days, unfreeze), `README.md`; Create: Playwright smoke in the existing browser smoke spec
- Test: web unit for the reminder; browser smoke `guest starts, flies the first mission and claims`

- [ ] **Step 1: Write the failing web test** `a guest sees one reminder to save the pilot after the first report, and not again once dismissed` (dismissal kept in `localStorage`).
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** the reminder (a feedback notice with a "Save" action opening the claim popup) and the docs (switch, cap, freeze, unfreeze, what a guest cannot do).
- [ ] **Step 4: Run web tests, `pnpm test:e2e`, and the browser smoke on the scratch stack.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: guest reminder and docs`.

---

## Decisions (owner, 2026-11-06)

1. No rankings for guests (also no public card) until they claim.
2. Idle guests are **frozen** after 30 days, not deleted (tunable `auth.guest_freeze_days`); an admin can unfreeze from the CLI.
3. Daily cap on new guests: 300 (tunable `auth.guest_daily_cap`); the per-IP throttle is the first line, the cap is the backstop.
4. A guest has no chosen name: `guest-` plus 6 random lowercase letters and digits.
5. No login for a guest: the credential is a key in localStorage. The cost: clearing the browser or switching device loses the pilot unless it was claimed.

Also done separately (2026-11-06): the player password minimum went from 10 to 6 characters everywhere a player sets or uses one.
