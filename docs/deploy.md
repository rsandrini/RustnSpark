# Deploying on one server (Docker + Cloudflare tunnel)

The `prod` profile of `compose.yaml` runs the API, the worker, nginx (web) and `cloudflared`. **Postgres and
Redis are your own instances**: this stack does not run or manage a database. The server opens no inbound
port: the tunnel connects outward to Cloudflare, and Cloudflare forwards the public hostname to
`http://web-prod:80` inside the compose network.

## Where the data lives

| What | Where | If lost |
|---|---|---|
| **The database** (accounts, pilots, ships, parts, missions, tuning) | **Your Postgres**, in the database `DATABASE_URL` names | Everything. Back it up with your own tooling. |
| Job queues, config cache, rate-limit counters | **Your Redis** | Nothing permanent: the worker re-queues flights on start. |
| Images uploaded in Admin (factions, places) | Docker volume `art-data` on this server | The art; the database keeps only the file names. |

`docker compose down` keeps `art-data`; **`down -v` deletes it.** `bash scripts/backup-prod.sh` archives the art
and, when `pg_dump` is installed on the host, also dumps the database into `./backups`. Restore steps are in
`docs/operations.md` section 5.

## Requirements on your Postgres and Redis

- **Postgres 16**: an empty database and a user that owns it. The migration container creates the tables and
  seeds the default game data on first start.
- **Redis 7** with **`maxmemory-policy noeviction`**: the job queue must never lose a key. If Redis is shared
  with other apps, prefer a separate instance or at least confirm that setting.
- Both must be reachable from the containers. If they run on the Docker host itself, use
  `host.docker.internal` as the host name (the compose file maps it) and make sure they listen on an address the
  Docker network can reach, not only on `127.0.0.1`.

## Preparing your Postgres and Redis

**Postgres** (as the `postgres` superuser, e.g. `sudo -u postgres psql`). Use a hex password
(`openssl rand -hex 24`) so it needs no URL-encoding:

```sql
CREATE ROLE rustnspark LOGIN PASSWORD '<hex password>';
CREATE DATABASE rustnspark OWNER rustnspark ENCODING 'UTF8';
\c rustnspark
ALTER SCHEMA public OWNER TO rustnspark;          -- Postgres 15+ no longer lets other roles create in public
CREATE EXTENSION IF NOT EXISTS btree_gist;        -- the schema needs it (one migration); see the check below
```

- Special needs: only the `btree_gist` extension (it ships with Postgres 16's standard packages). Check with
  `SELECT name FROM pg_available_extensions WHERE name = 'btree_gist';`. Creating it as the superuser (above) avoids any
  permission question; the app's own user does not need to be a superuser.
- Let the containers in: add `172.16.0.0/12` and `192.168.0.0/16` (Docker's networks) to `listen_addresses`' reach, e.g.
  `listen_addresses = 'localhost,172.17.0.1'`, and a `pg_hba.conf` line
  `host  rustnspark  rustnspark  172.16.0.0/12  scram-sha-256` (plus `192.168.0.0/16` if your compose network uses it),
  then `SELECT pg_reload_conf();` and restart for `listen_addresses`. Keep the firewall closed to the internet.

**Redis** (7 recommended), `redis.conf`:

```
maxmemory-policy noeviction      # the job queue must never lose a key
appendonly yes                   # keep queued flights across a restart
bind 127.0.0.1 172.17.0.1        # reachable from the Docker bridge, not from the internet
```

Then a password. Simplest, when this Redis is for the game only: `requirepass <hex password>` in `redis.conf`, and
`REDIS_URL=redis://:<hex password>@host.docker.internal:6379`. If the Redis is shared, make a user for the game
(the app uses queues, plain keys and a few Lua scripts, so give it everything except admin and flush commands):

```
redis-cli ACL SETUSER rustnspark on '>YOURPASSWORD' '~*' '&*' +@all -@admin -flushall -flushdb
redis-cli ACL SAVE        # or put the same line in your aclfile
```

with `REDIS_URL=redis://rustnspark:<password>@host.docker.internal:6379`. If a Redis warning about the eviction policy
shows up in the worker log with this restricted user, it is only the queue library unable to read the setting; set
`noeviction` in `redis.conf` as above.

**Test both from a container before starting the game** (same route the app uses):

```bash
docker run --rm --add-host host.docker.internal:host-gateway postgres:16 \
  psql 'postgresql://rustnspark:<password>@host.docker.internal:5432/rustnspark' -c 'select 1'
docker run --rm --add-host host.docker.internal:host-gateway redis:7 \
  redis-cli -u 'redis://:<password>@host.docker.internal:6379' ping
```

`1` and `PONG` mean the URLs in `.env.prod` will work.

## One-time setup

1. Install Docker (with the compose plugin) and clone the repo: `git clone <repo> && cd RustnSpark`.
2. `cp .env.prod.example .env.prod` and fill it in (secrets, `DATABASE_URL`, `REDIS_URL`, the public `https://`
   address in `CORS_ORIGINS` and `WEB_URL`, the tunnel token, the Resend values).
3. In Cloudflare (Zero Trust > Networks > Tunnels) give the tunnel a **public hostname** whose service is
   `http://web-prod:80`. The `cloudflared` service in `compose.yaml` runs the tunnel with your token, so you do
   not run the `docker run cloudflare/cloudflared ...` command by hand.
4. Start it:

```bash
docker compose --env-file .env.prod --profile prod config --quiet     # validates first
docker compose --env-file .env.prod --profile prod up -d --build
```

5. Create the first admin (there is no public path to one):

```bash
docker compose --env-file .env.prod --profile prod run --rm api-prod \
  node dist/admin/cli/create-admin.cli.js --email you@example.com --name Captain --password '<10-128 chars>'
```

## Updating

```bash
bash scripts/backup-prod.sh
git pull
docker compose --env-file .env.prod --profile prod up -d --build
```

Migrations run by themselves before the API and worker start. Watch with
`docker compose --env-file .env.prod --profile prod logs -f api-prod worker-prod`.

## Loading the game data (balance, names, images) into production

What "the game as it is today" is made of, and where each part goes:

| Part | Where it lives | What to do on the server |
|---|---|---|
| Balance (config), parts, routes, locations, factions, missions, report texts, mentors' dialogue | The database | The first start's seed fills it from the repo. Rehearsed: a fresh install matches the dev tuning exactly (see below). |
| Names (part and place names, faction names, ship-name blocklist) | The database (same as above) | Same. |
| Place and faction images, icons | In the repo (`apps/web/public`), built into the web image | Nothing: they arrive with the code. |
| Images uploaded in Admin | The `art-data` volume | None exist in dev today. Anything uploaded later stays in the server's `art-data`; back it up. |

**A brand-new install already equals the dev tuning.** The seed in the repo carries today's balance, names and
texts, so a fresh database starts as the game is in dev: no import needed. Check it any time with:

```bash
bash scripts/seed-drift.sh     # builds a scratch DB from the repo, compares it with the dev stack; "seed == dev" when equal
```

(2026-11-04: the only difference was the mentors' dialogue scenes, which were updated in dev, and it now prints
`seed == dev`.) If it lists differences after you tune in Admin, either carry them over with the snapshot below, or
bring them into the seed files (`apps/api/prisma/seed-data`) so a new install has them too.

If you tune more in dev before launch, carry it over like this:

```bash
# on the dev machine: export the Admin-tuned values
docker compose exec -T api node dist/admin/cli/tuning-snapshot.cli.js --export /tmp/tuning.json
docker compose cp api:/tmp/tuning.json ./backups/tuning-snapshot-$(date +%F).json
scp backups/tuning-snapshot-<date>.json you@server:RustnSpark/backups/

# on the server, after the first start (the stack must be up):
docker compose --env-file .env.prod --profile prod cp backups/tuning-snapshot-<date>.json api-prod:/tmp/tuning.json
docker compose --env-file .env.prod --profile prod exec -T api-prod \
  node dist/admin/cli/tuning-snapshot.cli.js --import /tmp/tuning.json           # dry run: lists create/update/unchanged
docker compose --env-file .env.prod --profile prod exec -T api-prod \
  node dist/admin/cli/tuning-snapshot.cli.js --import /tmp/tuning.json --apply   # applies (exits 1 if a row failed)
```

Read the dry run first: every row under `update` will be overwritten by the dev value. Every applied row writes an
audited tuning revision, so Admin > Tuning shows what changed and can revert it.

## Error tracking (Sentry) and logs

- Create two projects in Sentry (free plan is enough for the beta): **Node** for the API and worker, **React** for the
  browser. Put their DSNs in `.env.prod` as `SENTRY_DSN` and `SENTRY_WEB_DSN`, then
  `docker compose --env-file .env.prod --profile prod up -d --build`. Blank = off.
- Reported: server faults (HTTP 5xx) and failed background jobs (flight resolution, repairs, the reconciler), tagged with
  the request id or queue and job id, and crashes of the browser screen. Not reported: wrong passwords, validation
  errors and the like (those are 4xx). No request bodies, cookies or auth headers are sent, and no session replay.
- The web DSN is public by design (it is in the page). The browser reaches Sentry through the content security policy
  entry `connect-src https://*.sentry.io` in `docker/nginx.conf`; if you pick a self-hosted Sentry, change it there.
- Logs: `docker compose --env-file .env.prod --profile prod logs -f api-prod worker-prod` (JSON, one line per request). Docker keeps
  5 files of 10 MB per container and rotates them, so logs cannot fill the disk.

## Notes

- Cookies are `Secure`, so the game must be opened over the https hostname (Cloudflare provides it).
- The API trusts `X-Forwarded-For` from the private network, so rate limits count each player by their real IP
  behind Cloudflare.
