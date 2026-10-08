# Operations runbook (v0.1)

Everything an operator needs to run Rust and Spark. Commands assume the repository root and a
`.env` copied from `.env.example`.

## 1. Topology

| Service | What it is | Notes |
|---|---|---|
| `api` / `api-prod` | NestJS HTTP API | stateless; run several behind the proxy |
| `worker` / `worker-prod` | BullMQ mission-resolution + reconcile worker | same image, `node dist/worker.js`; no HTTP port |
| `web` / `web-prod` | nginx serving the SPA and proxying `/v1` to the API | sets `X-Forwarded-For` (the API trusts it from private addresses only) |
| PostgreSQL 16 | system of record | external in `prod` |
| Redis 7 | BullMQ queues, config cache, rate-limit counters | external in `prod` |
| `migrate` / `migrate-prod` | one-shot: `prisma migrate deploy` + insert-only seed | api and worker wait for it |

Profiles: `dev` (everything local), `test` (tmpfs Postgres/Redis on 5433/6380), `prod` (app
containers only, external Postgres/Redis).

## 2. Environment reference

The API refuses to boot when a required variable is missing or invalid (zod schema in
`apps/api/src/common/env`).

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `NODE_ENV` | yes | – | `development` \| `test` \| `production` |
| `PORT` | no | 3000 | HTTP port |
| `DATABASE_URL` | yes | – | Postgres URL |
| `REDIS_URL` | yes | – | Redis URL |
| `CORS_ORIGINS` | yes | – | comma-separated bare origins allowed to call the API with credentials |
| `JWT_ACCESS_SECRET` | yes | – | ≥ 32 chars: `openssl rand -base64 48` |
| `COOKIE_SECRET` | yes | – | ≥ 32 chars |
| `ARGON2_MEMORY_KIB` / `ARGON2_TIME_COST` / `ARGON2_PARALLELISM` | no | 19456 / 2 / 1 | password hashing cost (OWASP floor) |
| `RECONCILE_INTERVAL_MS` | no | 30000 | how often the worker sweeps for stuck missions |
| `API_PORT` / `WEB_PORT` | no | 3000 / 8080 | host ports published on 127.0.0.1 |

Rotating `JWT_ACCESS_SECRET` signs everyone out (access tokens are short-lived; refresh
cookies keep working until the next refresh fails on the new secret — expect a re-login).
Rotating `COOKIE_SECRET` invalidates refresh cookies.

Game balance is **not** configuration: it lives in the database and is edited in Admin →
Tuning, effective immediately, with a revision history and one-click revert.

## 3. Deploying

```bash
# prod: external Postgres/Redis, secrets in the environment or an env file
docker compose --profile prod config >/dev/null   # validates before touching anything
docker compose --profile prod up -d --build
```

Order is enforced by compose: `migrate-prod` (schema + insert-only seed; existing tuned values
are never overwritten) → `api-prod` + `worker-prod` → `web-prod`. Migrations are forward-only;
to roll back the application, redeploy the previous image — new columns/tables are additive.

Probes (all public, no auth):

| Endpoint | Use |
|---|---|
| `GET /v1/health/live` | liveness: the process answers; touches no dependency (do not restart on Postgres/Redis outages) |
| `GET /v1/health/ready` | readiness: Postgres and Redis reachable — route traffic only when 200 |
| `GET /v1/health` | same as `ready` (compose healthcheck) |

The worker has no HTTP port; its health is "the queue drains": watch the admin dashboard's
mission counts and Redis `bull:mission:*` waiting/active.

## 4. First admin

There is no public path to an admin account. On a fresh install, create one from the API image:

```bash
# prod (compiled CLI inside the runtime image)
docker compose --profile prod run --rm api-prod \
  node dist/admin/cli/create-admin.cli.js --email you@example.com --name Captain --password '<10–128 chars>'

# dev (from the repo)
pnpm --filter api admin:create --email you@example.com --name Captain --password '<10–128 chars>'
```

Log in on the web app; the Admin area appears for `ADMIN` accounts. Password, e-mail and name
follow the same rules as registration (password 10–128 chars, name 3–24). Admin accounts cannot be banned through support actions.

## 5. Backup and restore

What matters, in order:

1. **PostgreSQL** — the only irreplaceable state (accounts, players, ships, parts, missions,
   logs, tuning history, audit log).
2. **Redis** — *replaceable*. It holds queued/delayed mission jobs, the config cache and rate-limit
   counters. If it is lost, restart the worker: the reconciler re-enqueues every `IN_TRANSIT`
   mission from Postgres (D4); counters and cache rebuild themselves.

```bash
# backup (logical, consistent, safe while running)
pg_dump --format=custom --no-owner "$DATABASE_URL" > rustandspark-$(date +%F).dump

# restore into an EMPTY database, then run the app (migrate-prod is a no-op when up to date)
createdb rustandspark_restore
pg_restore --no-owner --dbname "$RESTORE_URL" rustandspark-2026-01-01.dump
```

Take a dump before every deploy that carries a migration and on a daily schedule; keep at least
7 dailies. **Test a restore** into a scratch database after the first backup and monthly after:
an untested backup is a hope. Because mission resolution is deterministic (D19) and each
`MissionLog` stores its seed, rules hash and dispatch snapshot, any mission can be replayed from a
restored database (Admin → Players → report → Replay).

### 5.1 Keeping Admin-tuned values across a DB reset

A reset (drop/recreate DB) loses everything tuned in the Admin. Save it first, re-apply after:

```sh
# 1. BEFORE the reset: export GameConfig + every entity table (read-only)
docker compose exec -T api node dist/admin/cli/tuning-snapshot.cli.js --export /tmp/tuning.json
docker compose cp api:/tmp/tuning.json ./backups/tuning-snapshot-$(date +%F).json

# 2. reset the DB, then migrate + seed as usual (seed fills defaults only)

# 3. AFTER: dry run (default) — shows creates/updates/unchanged and rows that fail validation
docker compose cp ./backups/tuning-snapshot-<date>.json api:/tmp/tuning.json
docker compose exec -T api node dist/admin/cli/tuning-snapshot.cli.js --import /tmp/tuning.json
# 4. apply (snapshot values win over seed defaults; exits 1 if any row failed)
docker compose exec -T api node dist/admin/cli/tuning-snapshot.cli.js --import /tmp/tuning.json --apply
```

Notes: fields the running build no longer has (e.g. a retired column) are skipped and listed
under `skippedFields`; `null` values in the snapshot ("never set") are left at whatever the seed
filled. Every applied row writes an audited tuning revision (actor `tuning-snapshot-cli`).

The snapshot also carries the faction and location **art references** (file names). The image
files themselves are not in it: they live on the `art-data` volume (section 5.2), so keep that
volume across a reset — or re-upload from the Admin — or the references point at nothing.

### 5.2 Uploaded art (`art-data` volume)

Faction art (banner, logo, background) and place art (wide, square, icon) are uploaded in the
Admin (Tuning → Factions / Locations). Files are stored by content hash under `ART_DIR`
(`/data/art` in the containers, named volume `art-data`; `./data/art` for local runs, see
`.env.example`) and served publicly and immutably at `GET /v1/art/:file`. SVGs are scanned and
sandboxed on upload. Back the volume up with the database; `docker compose down -v` deletes it.
Public lists for the web client: `GET /v1/factions` (authenticated: names, descriptions, colours,
art) and `GET /v1/places/art`.

### 5.3 RACE missions

A RACE is a competition against 3–5 generated rival ships; the pilot needs a fast ship (entry
speed). Everything is tunable under the `race.*` config keys (Tuning → Config): `competitors_min`
/ `competitors_max`, `min_mobility` (entry speed), `reference_mob`, `speed_spread`,
`time_jitter` and `prize_share_1..3` (prize multipliers for places 1–3). An offer keeps the entry
speed it was generated with, so a change applies to offers generated afterwards. The board and
transit screens show the rivals' speeds and times; the mission report shows the standings.

### 5.4 Reaching the game from other computers (HTTPS)

Set `WEB_BIND=0.0.0.0` in `.env` to publish the web port on the network. The refresh-token cookie
is `Secure`, so other computers need HTTPS: run `scripts/make-dev-cert.sh <lan-ip> localhost` (creates
`certs/`: a local CA plus a server certificate, git-ignored), recreate the web container, and open
`https://<lan-ip>:8443` (`WEB_TLS_PORT`). Trust `certs/ca.crt` on each client computer, otherwise the browser
shows a certificate warning. Without `certs/server.crt` nginx serves plain HTTP only.

## 6. Operating the game

| Situation | Action |
|---|---|
| Something is wrong and players should stop acting | Admin → System → turn **maintenance** on: intents answer 503 while reads and admin keep working |
| Close signups (attack, capacity) | Admin → System → `register.open` off; takes effect on the next request |
| Tell players something | Admin → System → broadcast (English and pt-BR both required); shown in-game within a minute |
| Balance change | Admin → Tuning; every change has a reason and a revision; revert from the history |
| Player stuck / wrong balance / abuse | Admin → Players → support actions (each needs a reason and is audit-logged) |
| Who did what | Admin audit log; player sheet views are logged too |

Rate limits (per account when authenticated, otherwise per IP; counters in Redis so they hold
across instances): reads 300/min, intents 120/min, previews 240/min, login 5/min per IP+e-mail,
register 10/min per IP. A `429` carries `Retry-After`. If Redis is down the limiter fails open.

## 7. Graceful shutdown drill (manual)

The worker finishes the job in hand on `SIGTERM` (BullMQ's shutdown hook); the API drains open
requests. Run this before each release:

1. `docker compose --profile prod up -d`, register a player, accept and dispatch a mission with a
   long duration (Admin → Tuning → `missions.time_scale` low for the drill).
2. While the mission is `IN_TRANSIT`: `docker compose --profile prod stop worker-prod`
   (sends `SIGTERM`, default 10 s grace). The worker log must show a clean shutdown, no
   `unhandledRejection`.
3. `docker compose --profile prod start worker-prod`. Within `RECONCILE_INTERVAL_MS` the mission
   must resolve exactly once: one `MissionLog`, one payout event.
4. Repeat with `stop api-prod` while issuing requests in a loop: in-flight requests complete,
   new ones fail fast, no `5xx` from a half-closed connection pool.
5. Kill Redis (`docker compose stop redis`) for 30 s while sending requests: reads and intents
   that need Redis fail with a clean error, `/v1/health/live` stays 200, `/v1/health/ready`
   goes 503, and everything recovers when Redis returns without a restart.

## 8. Troubleshooting

| Symptom | Look at |
|---|---|
| API exits at boot | its log names the invalid env variable |
| Everyone gets 429 | a proxy in front of nginx that is not private-network (untrusted `X-Forwarded-For` ⇒ all clients share the proxy's IP) |
| Missions never resolve | worker running? `docker compose logs worker-prod`; Redis reachable; reconcile interval |
| A mission report looks wrong | Admin → Players → report → **Replay**: `matchesStored` false means the engine no longer reproduces the stored run |
| Banned player still plays | at most ~5 s on other API instances (status cache); immediate on the instance that handled the ban |
