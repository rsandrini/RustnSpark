#!/usr/bin/env bash
# Rebuild the web container and compare every screen with the baseline in visual/__shots__.
set -u
export PATH="/home/rsandrini/.nvm/versions/node/v22.23.2/bin:$PATH" LD_LIBRARY_PATH=$HOME/.local/pwlibs/root/usr/lib/x86_64-linux-gnu
cd "$(dirname "$0")/../../.." && docker compose up -d --build web >/dev/null 2>&1
cd apps/web && timeout 500 npx playwright test -c visual/playwright.config.mjs 2>&1 | grep -E "✓|✘|passed|failed|Expected:|pixels \(" | cut -c1-170
