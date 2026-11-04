# Deploying on one server (Docker + Cloudflare tunnel)

The whole game runs from `compose.yaml`'s `prod` profile: Postgres, Redis, the API, the worker, nginx
(web) and `cloudflared`. The server opens **no inbound port**: the tunnel connects outward to Cloudflare,
and Cloudflare forwards the public hostname to `http://web-prod:80` inside the compose network.

## Where the data lives

Docker named volumes, on the server's disk (usually `/var/lib/docker/volumes/<project>_<name>/_data`):

| Volume | What | If lost |
|---|---|---|
| `postgres-prod-data` | **The database**: accounts, pilots, ships, parts, missions, tuning | Everything. Back it up. |
| `redis-prod-data` | Job queues, config cache, rate-limit counters | Nothing permanent: the worker re-queues flights on start. |
| `art-data` | Images uploaded in Admin (factions, places) | The art; the database keeps only the file names. |

`docker compose down` keeps the volumes. **`down -v` deletes them.** Back up with
`bash scripts/backup-prod.sh` (database dump plus art archive in `./backups`), daily from cron, and copy
the files off the server. Restore steps are in `docs/operations.md` section 5.

## One-time setup

1. Install Docker (with the compose plugin) and clone the repo: `git clone <repo> && cd RustnSpark`.
2. `cp .env.prod.example .env.prod` and fill it in (secrets, `PROD_POSTGRES_PASSWORD`, the public
   `https://` address in `CORS_ORIGINS` and `WEB_URL`, the tunnel token, the Resend values).
3. In Cloudflare (Zero Trust > Networks > Tunnels) give the tunnel a **public hostname** whose service is
   `http://web-prod:80`. The `cloudflared` service in `compose.yaml` runs the tunnel with your token, so
   you do not run the `docker run cloudflare/cloudflared ...` command by hand.
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
- The API trusts `X-Forwarded-For` from the private network, so rate limits count each player by their real
  IP behind Cloudflare.
- To use a managed Postgres or Redis instead, set `PROD_DATABASE_URL` / `PROD_REDIS_URL` in `.env.prod`.
