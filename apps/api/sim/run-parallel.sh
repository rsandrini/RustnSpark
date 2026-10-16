#!/usr/bin/env bash
# Plays one experiment as one process per build (archetype), all at once, edited matrix only.
#   sim/run-parallel.sh <name> <edit.json> [extra experiment flags]
# Each process stores its own experiment `<name>-<archetype>-edit`; read them with a name prefix.
# The sim is single-threaded, so this uses as many cores as there are builds.
set -euo pipefail
name="$1"; edit="$2"; shift 2
cd "$(dirname "$0")/.."
mkdir -p "${CLAUDE_JOB_DIR:-/tmp}/tmp"
for archetype in chem chem-shield ion-shield hybrid; do
  pnpm sim experiment --archetypes all --archetype-only "$archetype" --playstyle generalist \
    --skip-base --edit "$edit" --name "$name-$archetype" "$@" \
    > "${CLAUDE_JOB_DIR:-/tmp}/tmp/$name-$archetype.txt" 2>&1 &
done
wait
echo "all builds finished: $name"
