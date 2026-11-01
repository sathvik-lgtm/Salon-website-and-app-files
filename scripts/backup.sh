#!/usr/bin/env bash
# Exports the whole database to one file, optionally encrypts it, and optionally proves it can be
# restored. This is the scheduled export that sits next to Neon's own point-in-time restore
# (see docs/DEPLOYMENT.md, "Backups").
#
#   BACKUP_DATABASE_URL=postgresql://...   the database to export (Neon's DIRECT string, not the pooled one)
#   BACKUP_PASSPHRASE=...                  if set, the file is encrypted (AES-256) and the plain copy deleted
#   BACKUP_DIR=backups                     where the file goes (default ./backups)
#
#   bash scripts/backup.sh             export
#   bash scripts/backup.sh --verify    export, then restore it into a throwaway database and count rows
#
# Needs Docker (the export runs inside the postgres:17 image, so its pg_dump always matches Neon's
# Postgres 17) and openssl (to encrypt). The file holds customer names and phone numbers: keep it
# encrypted and never commit it or attach it anywhere public.
set -euo pipefail

VERIFY=0
[ "${1:-}" = "--verify" ] && VERIFY=1

: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL (the database to export)}"
DIR="${BACKUP_DIR:-backups}"
IMAGE="postgres:17"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"
PLAIN="$DIR/salon-$STAMP.dump"

# Docker Desktop on Windows/Mac: "localhost" inside a container is the container itself.
URL="${BACKUP_DATABASE_URL/@localhost:/@host.docker.internal:}"
URL="${URL/@127.0.0.1:/@host.docker.internal:}"

export MSYS_NO_PATHCONV=1
# Docker Desktop on Windows does not always put itself on the PATH of Git Bash.
command -v docker >/dev/null 2>&1 || export PATH="$PATH:/c/Users/${USERNAME:-$USER}/AppData/Local/Programs/DockerDesktop/resources/bin"
DOCKER=docker

# A failed export must not leave a half-written file that looks like a backup.
trap '[ -s "$PLAIN" ] || rm -f "$PLAIN"' ERR
echo "Exporting..."
# Custom format: compressed, and pg_restore can restore all of it or any one table.
"$DOCKER" run --rm --add-host=host.docker.internal:host-gateway "$IMAGE" \
  pg_dump --format=custom --no-owner --no-privileges "$URL" > "$PLAIN"
[ -s "$PLAIN" ] || { echo "The export is empty: something went wrong." >&2; rm -f "$PLAIN"; exit 1; }

FILE="$PLAIN"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  FILE="$PLAIN.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE -in "$PLAIN" -out "$FILE"
  # Keep the plain copy only while verifying, so an encrypted backup never leaves a plain one behind.
  [ "$VERIFY" = 1 ] || rm -f "$PLAIN"
else
  echo "Note: BACKUP_PASSPHRASE is not set, so this file is NOT encrypted." >&2
fi
echo "Wrote $FILE ($(wc -c < "$FILE" | tr -d ' ') bytes)"

if [ "$VERIFY" = 1 ]; then
  echo "Verifying: restoring into a throwaway database..."
  NAME="salon-backup-verify-$$"
  cleanup() { "$DOCKER" rm -f "$NAME" >/dev/null 2>&1 || true; [ "$FILE" = "$PLAIN" ] || rm -f "$PLAIN"; }
  trap cleanup EXIT
  "$DOCKER" run -d --name "$NAME" -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    "$DOCKER" exec "$NAME" pg_isready -U postgres -d verify >/dev/null 2>&1 && break
    sleep 1
  done
  # (Postgres restarts once while initialising, so give it a moment after the first "ready".)
  sleep 2
  if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in "$FILE" \
      | "$DOCKER" exec -i "$NAME" pg_restore -U postgres -d verify --no-owner --exit-on-error
  else
    "$DOCKER" exec -i "$NAME" pg_restore -U postgres -d verify --no-owner --exit-on-error < "$FILE"
  fi
  "$DOCKER" exec "$NAME" psql -U postgres -d verify -At -F ': ' -c "
    select 'Branch', count(*) from \"Branch\"
    union all select 'Service', count(*) from \"Service\"
    union all select 'Staff', count(*) from \"Staff\"
    union all select 'Customer', count(*) from \"Customer\"
    union all select 'Appointment', count(*) from \"Appointment\";
    select 'no-overlap rule present: ' || count(*) from pg_constraint where conname = 'Appointment_no_staff_overlap';"
  echo "Backup verified: it restores cleanly."
fi
