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

## Carrying your tuning over

Prefer a fresh database on the server and bring only the Admin-tuned values: export on the dev machine and
import on the server with the snapshot CLI (`docs/operations.md` section 5.1).

## Notes

- Cookies are `Secure`, so the game must be opened over the https hostname (Cloudflare provides it).
- The API trusts `X-Forwarded-For` from the private network, so rate limits count each player by their real IP
  behind Cloudflare.
