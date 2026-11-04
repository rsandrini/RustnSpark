#!/usr/bin/env bash
# Backs up the production database and the uploaded art into ./backups (run from the repo root).
# Usage: bash scripts/backup-prod.sh   (add to cron daily; keep the last 7+)
set -euo pipefail
cd "$(dirname "$0")/.."
stamp=$(date +%F-%H%M)
mkdir -p backups
docker compose --env-file .env.prod --profile prod exec -T postgres-prod \
  pg_dump --format=custom --no-owner -U rustandspark rustandspark > "backups/prod-db-$stamp.dump"
docker compose --env-file .env.prod --profile prod exec -T api-prod tar -C /data -cz art > "backups/prod-art-$stamp.tgz"
# keep the newest 14 of each kind
ls -1t backups/prod-db-*.dump 2>/dev/null | tail -n +15 | xargs -r rm --
ls -1t backups/prod-art-*.tgz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "backup written: backups/prod-db-$stamp.dump backups/prod-art-$stamp.tgz"
