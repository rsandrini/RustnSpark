# Rust and Spark

> **Asynchronous multiplayer space idle game.** You assemble a ship from parts, dispatch it
> on missions that resolve in real time, and come back to read — narrated like a text RPG —
> what happened. Other players inhabit the same persistent world.
> Tone: *The Expanse* + *Euro Truck Simulator*.

v0.1 is **implemented and in active playtesting**. The design (GDD) and the technical
architecture below are the single source of truth — the implementation follows them to the
letter. What remains is fine-tuning: balancing (driven by playtesting, live via Admin →
Tuning, no deploy) and UX/copy polish, tracked and worked through in
[docs/superpowers/plans](./docs/superpowers/plans).

## Running locally

Requires Docker and the [Compose plugin](https://docs.docker.com/compose/install/).

```bash
cp .env.example .env
# edit .env: JWT_ACCESS_SECRET and COOKIE_SECRET (32+ chars each) — generate with:
#   openssl rand -base64 48
docker compose --profile dev up -d --wait --build
```

- Web: http://localhost:8080
- API: http://localhost:3000 (the `web` container also exposes `/v1` via proxy)

Create the first admin and see the full runbook (environment variables, deploy,
backup/restore, shutdown drill) in **[docs/operations.md](./docs/operations.md)**.

To develop the frontend with hot reload outside the container, keep the `dev` stack
running (API/worker/Postgres/Redis) and replace the compose `web` service with:

```bash
pnpm install
pnpm dev:web   # Vite on :5173, with /v1 proxied to the API on :3000
```

### Tests

```bash
pnpm typecheck                 # all workspaces
pnpm --filter web test         # Vitest (unit/component, web)
pnpm test:unit                 # Jest (unit, API)
pnpm test:int                  # Jest (integration, API — requires the compose `test` stack)
pnpm --filter web e2e          # Playwright, against the real `dev` stack (no mocks)
```

## Where to start

1. **[GDD-rust-and-spark-v0.1.md](./GDD-rust-and-spark-v0.1.md)** — the Game Design
   Document. **What** the game does: all mechanics, gameplay, and v0.1 screens, with
   numbers validated by simulation. The single source of truth for design. Start here.
2. **[arquitetura-tecnica-v0.1.md](./arquitetura-tecnica-v0.1.md)** — the technical
   companion. **How** it was built: stack, authoritative model, tick/jobs, security,
   testing.

## Structure

```
rust-and-spark/
├── README.md                        you are here
├── GDD-rust-and-spark-v0.1.md       full design (the what)
├── arquitetura-tecnica-v0.1.md      technical plan (the how)
├── apps/
│   ├── api/                         NestJS: HTTP API + worker (BullMQ) + Prisma (schema/migrations/seed)
│   └── web/                         React + Vite SPA (play and administer — Admin is an area of the same SPA)
├── packages/
│   └── contract/                    zod schemas shared between API and web (the source of truth for types)
├── docs/
│   ├── operations.md                runbook: topology, env vars, deploy, backup, first admin
│   └── superpowers/plans/           implementation and playtest plans (living work history)
├── design/                          design documents (the fine detail the GDD summarizes)
├── prototypes/                      HTML UX proofs of concept — historical VISUAL REFERENCE, not production
└── simulation/                      Python simulators + results (the spec behind the numbers)
```

- **`apps/api`** and **`apps/web`** — the real implementation. Authoritative server: the
  client sends intents, the server resolves everything and is the only source of stats and
  rules (no game number is derived on the client).
- **`design/`** — documents that go deeper on each system (parts, wear, economy, missions,
  schema, UX…). The GDD integrates them; consult them when you need an exact value or the
  reasoning behind a decision.
- **`prototypes/`** — the HTML sketches that validated the UX before the real implementation
  (fake data, no backend). They have already become the React components in `apps/web`; they
  stay here as a historical record of the design process, not as something kept in sync.
- **`simulation/`** — the scripts that balanced the game (combat tournament, a sweep of 17
  million lives). They are the executable specification of the numbers: the resolution engine
  in `apps/api` reproduces these results in the validation tests (`pnpm test:validation`).

## Stack (summary)

NestJS (TypeScript) · PostgreSQL · Redis + BullMQ (tick/jobs) · React + Vite (SPA) ·
JWT · Docker Compose. Authoritative server: the client sends intents, the server resolves
everything. Secure and tested from the first commit. Details in the architecture document.

## Operations

**[docs/operations.md](./docs/operations.md)** — runbook: topology, environment variables,
deploy, first admin, backup/restore, game operations, shutdown drill.

## Project status

- **Design:** ✅ locked (v0.1)
- **Technical architecture:** ✅ implemented
- **Implementation:** ✅ v0.1 complete — API, worker, SPA (game + Admin), tests (unit,
  integration, economic validation, browser e2e)
- **Balancing:** ✅ validated by simulation; ongoing fine-tuning from real playtesting,
  applied live via Admin → Tuning (no deploy)
- **Playtest:** 🔄 in progress — feedback and progress tracked in
  [docs/superpowers/plans](./docs/superpowers/plans)

Living document — versioned (v0.2, v0.3…) as gameplay reveals what the launch numbers
actually need.
