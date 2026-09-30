#!/usr/bin/env bash
# WareSys restore — run on the server, from the project folder
# (where docker-compose.yml is). The backup file must be under ./backups.
#
#   ops/backup/restore.sh check   backups/daily/waresys_<ts>.dump
#       Restore drill: verifies the checksum, restores into a throwaway
#       database, prints table/row counts, drops it. Touches nothing live.
#
#   ops/backup/restore.sh restore backups/daily/waresys_<ts>.dump [--with-uploads]
#       REPLACES the live database with the backup (asks you to type
#       RESTORE first). Backend/frontend are stopped during the restore.
#       --with-uploads also replaces uploaded files with the archive taken
#       in the same backup run.
#
# A backup copied back from Google Drive: put it (and its .sha256) under
# ./backups first, e.g. ./backups/restore/.
set -euo pipefail

# Where pg_restore/psql run. The db-backup container already has the
# database connection (PG* env) and ./backups mounted at /backups.
PG_EXEC="${PG_EXEC:-docker compose exec -T db-backup}"
# Never let a container call read our stdin — it would swallow the
# RESTORE confirmation typed (or piped) below.
pg() { $PG_EXEC "$@" < /dev/null; }
COMPOSE="${COMPOSE:-docker compose}"
CHECK_DB="waresys_restore_check"

die() { echo "ERROR: $*" >&2; exit 1; }

[ $# -ge 2 ] || die "usage: $0 check|restore <file under ./backups> [--with-uploads]"
mode="$1"; file="$2"; with_uploads="${3:-}"

[ -f "$file" ] || die "file not found: $file"
abs="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
backups_abs="$(cd backups 2>/dev/null && pwd)" || die "run this from the project folder (no ./backups here)"
case "$abs" in
  "$backups_abs"/*) in_container="/backups/${abs#"$backups_abs"/}" ;;
  *) die "the file must be inside ./backups (copy it there first)" ;;
esac

# 1. Checksum — refuses a file that changed since it was written.
if [ -f "$file.sha256" ]; then
  ( cd "$(dirname "$file")" && sha256sum -c --quiet "$(basename "$file").sha256" ) \
    || die "checksum mismatch — $file is damaged or incomplete"
  echo "OK  checksum"
else
  echo "WARNING: no $file.sha256 next to the file — skipping checksum check"
fi

# 2. Same validation the backup job used before accepting the file.
pg sh /scripts/backup.sh validate "$in_container" || die "backup file failed validation"

restore_into() {
  # --single-transaction: all or nothing — a failure leaves the target
  # database exactly as it was.
  pg pg_restore --clean --if-exists --no-owner --no-privileges \
    --single-transaction --exit-on-error --dbname="$1" "$in_container"
}

case "$mode" in
  check)
    echo "Restore drill into throwaway database '$CHECK_DB'..."
    pg sh -c "dropdb --if-exists $CHECK_DB && createdb $CHECK_DB"
    trap 'pg dropdb --if-exists $CHECK_DB >/dev/null 2>&1 || true' EXIT
    restore_into "$CHECK_DB"
    pg psql -XAt -d "$CHECK_DB" -c "
      SELECT 'tables: ' || count(*) FROM pg_tables WHERE schemaname = 'public';
      SELECT 'migrations: ' || count(*) FROM \"_prisma_migrations\";
      SELECT 'organizations: ' || count(*) FROM \"Organization\";
      SELECT 'users: ' || count(*) FROM \"User\";
      SELECT 'products: ' || count(*) FROM \"Product\";
      SELECT 'invoices: ' || count(*) FROM \"Invoice\";
      SELECT 'delivery orders: ' || count(*) FROM \"DeliveryOrder\";"
    echo "OK  restore drill passed — the backup is restorable (throwaway database dropped)"
    ;;

  restore)
    echo
    echo "WARNING: this REPLACES all data in the live database with:"
    echo "  $file"
    echo "Everything changed since that backup was taken will be lost."
    [ "$with_uploads" = "--with-uploads" ] && echo "Uploaded files will be replaced too."
    read -r -p "Type RESTORE to continue: " answer
    [ "$answer" = "RESTORE" ] || { echo "Cancelled. Nothing was changed."; exit 0; }

    echo "Stopping backend/frontend (database stays up)..."
    $COMPOSE stop backend frontend
    trap 'echo "Starting backend/frontend..."; $COMPOSE up -d backend frontend' EXIT

    echo "Restoring database..."
    target_db="$(pg sh -c 'echo $PGDATABASE')"
    restore_into "$target_db"
    echo "OK  database restored"

    if [ "$with_uploads" = "--with-uploads" ]; then
      stamp="$(basename "$file")"; stamp="${stamp#waresys_}"; stamp="${stamp%.dump}"
      archive="$(dirname "$file")/waresys_uploads_$stamp.tar.gz"
      [ -f "$archive" ] || die "no uploads archive for this backup: $archive (database WAS restored)"
      ( cd "$(dirname "$archive")" && sha256sum -c --quiet "$(basename "$archive").sha256" ) \
        || die "uploads archive checksum mismatch (database WAS restored)"
      archive_in="/restore/${abs%/*}/$(basename "$archive")"
      archive_in="/restore/${archive_in#"/restore/$backups_abs"/}"
      $COMPOSE run --rm --no-deps -T -v "$backups_abs:/restore:ro" --entrypoint sh backend \
        -c "find /app/uploads -mindepth 1 -delete && tar -xzf '$archive_in' -C /app/uploads"
      echo "OK  uploaded files restored"
    fi
    ;;

  *) die "unknown mode: $mode (use check or restore)" ;;
esac
