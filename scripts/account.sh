#!/usr/bin/env bash
# Emergency account tool for the production server: promote/demote an admin, ban/unban, reset a password.
# Usage (from the repo root):  bash scripts/account.sh <command> --email you@example.com [...]
#   bash scripts/account.sh show --email you@example.com
#   bash scripts/account.sh promote --email you@example.com
#   bash scripts/account.sh unban --email someone@example.com
#   bash scripts/account.sh set-password --email you@example.com --password 'a new long password'
# Run `bash scripts/account.sh` with no arguments for the full list. Every change is audited (actor "cli").
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose --env-file .env.prod --profile prod run --rm api-prod \
  node dist/admin/cli/account.cli.js "$@"
