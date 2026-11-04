#!/usr/bin/env bash
# Does a brand-new install (migrate + seed from the repo) equal what the dev database holds today?
# Builds a scratch database on the test Postgres, seeds it, and compares every tuned value with the
# running dev stack's. Prints what differs: config keys and entities (parts, routes, missions, mentors...).
# Needs: the dev stack up (docker compose --profile dev up -d) and the images built.
# Usage: bash scripts/seed-drift.sh
set -euo pipefail
cd "$(dirname "$0")/.."
out=$(mktemp -d)
trap 'rm -rf "$out"; docker compose exec -T postgres-test psql -U rustandspark -d rustandspark_test -qc "drop database if exists seed_drift" >/dev/null 2>&1 || true' EXIT

docker compose --profile test up -d --wait postgres-test redis-test >/dev/null
docker compose exec -T postgres-test psql -U rustandspark -d rustandspark_test -qc "drop database if exists seed_drift" -c "create database seed_drift"
db=postgresql://rustandspark:rustandspark@127.0.0.1:5433/seed_drift

docker compose --profile dev build migrate api >/dev/null
docker run --rm --network host -e DATABASE_URL="$db" rustandspark-migrate:dev >/dev/null 2>&1
docker run --rm --network host -v "$out:/out" -e NODE_ENV=production -e DATABASE_URL="$db" \
  -e REDIS_URL=redis://127.0.0.1:6380 -e JWT_ACCESS_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  -e COOKIE_SECRET=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb -e CORS_ORIGINS=https://x.example -e ART_DIR=/tmp/art \
  rustandspark-api:dev node dist/admin/cli/tuning-snapshot.cli.js --export /out/seed.json >/dev/null 2>&1
docker compose exec -T api node dist/admin/cli/tuning-snapshot.cli.js --export /tmp/dev-tuning.json >/dev/null 2>&1
docker compose cp api:/tmp/dev-tuning.json "$out/dev.json" >/dev/null 2>&1

# SEED_EXPORT_OUT=<file> keeps the freshly seeded snapshot (to apply it to dev with --import).
[ -n "${SEED_EXPORT_OUT:-}" ] && cp "$out/seed.json" "$SEED_EXPORT_OUT"
python3 - "$out/seed.json" "$out/dev.json" <<'PY'
import json, sys
seed, dev = (json.load(open(p)) for p in sys.argv[1:3])
bad = 0
ENTRY_KEY = ('key', 'name')
def entries(snapshot):
    rows = snapshot['config']['entries']
    key = next(k for k in ENTRY_KEY if k in rows[0])
    return {r[key]: {f: v for f, v in r.items() if f not in ('revision', 'updatedAt', 'updatedBy')} for r in rows}
sv, dv = entries(seed), entries(dev)
for k in sorted(set(sv) | set(dv)):
    if sv.get(k) != dv.get(k):
        bad += 1
        print(f"config  {k}: seed={sv.get(k)!r} dev={dv.get(k)!r}"[:220])
for name in sorted(set(seed['entities']) | set(dev['entities'])):
    rows = seed['entities'].get(name, []) + dev['entities'].get(name, [])
    key = 'partType' if rows and 'partType' in rows[0] else 'id'
    s = {r[key]: r for r in seed['entities'].get(name, [])}
    d = {r[key]: r for r in dev['entities'].get(name, [])}
    for i in sorted(set(s) | set(d)):
        if i not in s: bad += 1; print(f"{name}  {i}: only in dev")
        elif i not in d: bad += 1; print(f"{name}  {i}: only in seed")
        elif s[i] != d[i]:
            bad += 1
            print(f"{name}  {i}: differs in {[k for k in s[i] if s[i][k] != d[i].get(k)]}")
print("seed == dev" if bad == 0 else f"{bad} difference(s)")
sys.exit(1 if bad else 0)
PY
