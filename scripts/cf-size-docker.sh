#!/usr/bin/env bash
# Measures the real Cloudflare Worker size of an app on Linux (like CI), from a Windows PC where
# `cf:build` cannot run (symlink EPERM). Needs Docker Desktop and the local Postgres running with
# migrated + seeded data (the website copies its content from it at build time).
#
#   bash scripts/cf-size-docker.sh web      # or: staff
#
# Prints wrangler's "Total Upload: <uncompressed> KiB / gzip: <compressed> KiB". Nothing is deployed.
set -euo pipefail

APP="${1:-web}"
HERE="$(cd "$(dirname "$0")" && pwd)"
INNER="$HERE/cf-size-inner.sh"
REPO="$(cd "$HERE/.." && (pwd -W 2>/dev/null || pwd))"
export PATH="$PATH:/c/Users/${USERNAME:-$USER}/AppData/Local/Programs/DockerDesktop/resources/bin"

MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$REPO:/src:ro" \
  -v "$(cd "$HERE" && (pwd -W 2>/dev/null || pwd)):/scripts:ro" \
  --add-host=host.docker.internal:host-gateway \
  -e APP="$APP" \
  -e DATABASE_URL="postgresql://salon:salon_dev_only@host.docker.internal:5433/salon" \
  node:24 bash /scripts/cf-size-inner.sh
