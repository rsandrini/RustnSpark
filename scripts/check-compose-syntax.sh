#!/usr/bin/env bash
# Fails if the compose file has a top-level version key or anything invokes the legacy hyphenated compose binary.
set -euo pipefail
cd "$(dirname "$0")/.."

status=0

if grep -nE '^version:' compose.yaml; then
  echo "compose.yaml must not declare a top-level 'version:' key" >&2
  status=1
fi

# The pattern is built with a bracket so this script does not match itself.
targets=(compose.yaml docker scripts package.json apps/api/package.json .github)
existing=()
for t in "${targets[@]}"; do [ -e "$t" ] && existing+=("$t"); done
if grep -rnE 'docker[-]compose' "${existing[@]}"; then
  echo "use 'docker compose' (v2 CLI), never the hyphenated legacy binary" >&2
  status=1
fi

exit "$status"
