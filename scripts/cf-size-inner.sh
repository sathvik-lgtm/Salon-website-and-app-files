#!/usr/bin/env bash
# Runs INSIDE the Linux container started by cf-size-docker.sh. Do not run it directly.
set -e
npm i -g pnpm@12.16.1 >/dev/null 2>&1
mkdir -p /work && cd /src
tar cf - --exclude=node_modules --exclude=.next --exclude=.open-next --exclude=.turbo \
  --exclude=.git --exclude=.wrangler --exclude=src/generated . | tar xf - -C /work
cd /work
pnpm install --frozen-lockfile >/dev/null 2>&1
pnpm --filter "@salon/$APP" cf:build > /tmp/cf.log 2>&1 || { tail -40 /tmp/cf.log; exit 1; }
cd "apps/$APP"
npx wrangler deploy --dry-run --outdir .wrangler/dry 2>&1 | grep "Total Upload"
