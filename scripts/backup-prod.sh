#!/usr/bin/env bash
# Backs up the uploaded art into ./backups, and the database when pg_dump is installed (run from the
# repo root). Your own Postgres may already have its own backups: then only the art archive matters here.
# Usage: bash scripts/backup-prod.sh   (add to cron daily)
set -euo pipefail
cd "$(dirname "$0")/.."
stamp=$(date +%F-%H%M)
mkdir -p backups
compose=(docker compose --env-file .env.prod --profile prod)

"${compose[@]}" exec -T api-prod tar -C /data -cz art > "backups/prod-art-$stamp.tgz"

if command -v pg_dump >/dev/null; then
  # shellcheck disable=SC1091
  url=$(grep -E '^DATABASE_URL=' .env.prod | cut -d= -f2-)
  # inside compose the host is host.docker.internal; from the host shell it is localhost
  url=${url//host.docker.internal/localhost}
  pg_dump --format=custom --no-owner "$url" > "backups/prod-db-$stamp.dump"
else
  echo "pg_dump not installed here: back the database up with your Postgres tooling" >&2
fi

ls -1t backups/prod-db-*.dump 2>/dev/null | tail -n +15 | xargs -r rm --
ls -1t backups/prod-art-*.tgz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "backup written in backups/ ($stamp)"
