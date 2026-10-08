#!/bin/sh
# WareSys database backup — runs inside the `db-backup` container
# (postgres:16-alpine, so pg_dump matches the server's major version).
#
#   backup.sh daemon      run forever: one backup per day at BACKUP_TIME
#   backup.sh once        take one backup now (e.g. before a deploy)
#   backup.sh validate F  check an existing dump file
#   backup.sh prune       apply retention only
#   backup.sh health      exit 0 if the last success is recent (healthcheck)
#
# Layout under /backups (a host bind mount, ./backups):
#   daily/waresys_<YYYYMMDD_HHMMSS>.dump            pg_dump custom format
#   daily/waresys_<YYYYMMDD_HHMMSS>.dump.sha256
#   daily/waresys_uploads_<YYYYMMDD_HHMMSS>.tar.gz  uploaded files, same run
#   daily/waresys_uploads_<YYYYMMDD_HHMMSS>.tar.gz.sha256
#   weekly/waresys_<YYYY-Www>...                    first backup of each ISO week
#   status/last_success, status/last_failure
#
# A backup only counts once the dump has been VALIDATED (see validate_dump):
# until then it lives under a dot-prefixed .tmp name that nothing else
# (retention, offsite copy, restore) ever picks up.

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DAILY="$BACKUP_DIR/daily"
WEEKLY="$BACKUP_DIR/weekly"
STATUS="$BACKUP_DIR/status"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"

KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"
BACKUP_TIME="${BACKUP_TIME:-02:00}"          # HH:MM, in the container's TZ
RETRY_MINUTES="${BACKUP_RETRY_MINUTES:-60}"   # after a failed attempt
MIN_BYTES="${BACKUP_MIN_BYTES:-10240}"        # a real WareSys dump is ~MBs
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"   # health: last success must be newer

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

# Atomic write of a small status file.
write_status() {
  mkdir -p "$STATUS"
  printf '%s\n' "$2" > "$STATUS/.$1.tmp"
  mv "$STATUS/.$1.tmp" "$STATUS/$1"
}

# A dump is valid only if:
#   1. it's at least MIN_BYTES,
#   2. pg_restore can read its table of contents,
#   3. the TOC holds data for _prisma_migrations (it's a WareSys database),
#   4. it has one table entry per table in the live database's public
#      schema (skipped when validating a file with no database to compare),
#   5. pg_restore can read EVERY data block end to end (catches a
#      truncated or corrupted file — reading only the TOC would not).
validate_dump() {
  file="$1"
  expected_tables="${2:-}"

  size=$(wc -c < "$file")
  if [ "$size" -lt "$MIN_BYTES" ]; then
    log "INVALID: $file is only $size bytes (minimum $MIN_BYTES)"
    return 1
  fi
  toc="$(mktemp)"
  if ! pg_restore --list "$file" > "$toc" 2>/dev/null; then
    log "INVALID: pg_restore cannot read the table of contents of $file"
    rm -f "$toc"; return 1
  fi
  if ! grep -q 'TABLE DATA public _prisma_migrations' "$toc"; then
    log "INVALID: $file has no _prisma_migrations data — not a WareSys database dump"
    rm -f "$toc"; return 1
  fi
  tables=$(grep -c ' TABLE public ' "$toc" || true)
  rm -f "$toc"
  if [ -n "$expected_tables" ] && [ "$tables" -ne "$expected_tables" ]; then
    log "INVALID: $file has $tables tables, the database has $expected_tables"
    return 1
  fi
  if ! pg_restore --file=/dev/null "$file" 2>/dev/null; then
    log "INVALID: $file is truncated or corrupted (data blocks unreadable)"
    return 1
  fi
  log "valid: $file ($size bytes, $tables tables)"
}

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

# Writes "<hash>  <basename>" next to the file, so `sha256sum -c` works
# from inside the directory (and after an offsite copy).
write_checksum() {
  ( cd "$(dirname "$1")" && sha256sum "$(basename "$1")" > ".$(basename "$1").sha256.tmp" \
    && mv ".$(basename "$1").sha256.tmp" "$(basename "$1").sha256" )
}

# (Shell variables are global — names here must not reuse run_backup's.)
backup_uploads() {
  ts="$1"
  if [ ! -d "$UPLOADS_DIR" ]; then
    log "no uploads directory mounted — skipping uploaded files"
    return 0
  fi
  up_final="$DAILY/waresys_uploads_$ts.tar.gz"
  up_tmp="$DAILY/.waresys_uploads_$ts.tar.gz.tmp"
  if tar -czf "$up_tmp" -C "$UPLOADS_DIR" . && gzip -t "$up_tmp" && tar -tzf "$up_tmp" > /dev/null; then
    mv "$up_tmp" "$up_final"
    write_checksum "$up_final"
    log "wrote $up_final ($(du -h "$up_final" | cut -f1))"
  else
    rm -f "$up_tmp"
    log "WARNING: uploads archive failed — the database backup is still good"
    return 1
  fi
}

# First backup of each ISO week is also kept as that week's weekly copy
# (hard links: no extra disk space, and pruning the daily copy doesn't
# touch the weekly one).
promote_weekly() {
  ts="$1"
  week="$(date +%G-W%V)"
  mkdir -p "$WEEKLY"
  [ -e "$WEEKLY/waresys_$week.dump" ] && return 0
  for pair in "waresys_$ts.dump:waresys_$week.dump" "waresys_uploads_$ts.tar.gz:waresys_uploads_$week.tar.gz"; do
    src="$DAILY/${pair%%:*}"; dst="$WEEKLY/${pair#*:}"
    [ -e "$src" ] || continue
    ln "$src" "$dst" 2>/dev/null || cp "$src" "$dst"
    # Checksum file names the weekly file, not the daily one.
    printf '%s  %s\n' "$(cut -d' ' -f1 "$src.sha256")" "$(basename "$dst")" > "$dst.sha256"
  done
  log "kept as weekly backup $week"
}

# Keep the newest N backups (by timestamp in the name — never by mtime,
# and only ever run after a successful backup, so a run of failures can
# never eat the good backups that are left).
prune_dir() {
  dir="$1"; keep="$2"
  [ -d "$dir" ] || return 0
  ls -1 "$dir" | grep -E '^waresys_[0-9].*\.dump$' | sort -r | tail -n +"$((keep + 1))" | while read -r dump; do
    stamp="${dump#waresys_}"; stamp="${stamp%.dump}"
    rm -f "$dir/$dump" "$dir/$dump.sha256" \
          "$dir/waresys_uploads_$stamp.tar.gz" "$dir/waresys_uploads_$stamp.tar.gz.sha256"
    log "pruned $dir/$dump"
  done
}

prune() {
  prune_dir "$DAILY" "$KEEP_DAILY"
  prune_dir "$WEEKLY" "$KEEP_WEEKLY"
}

run_backup() {
  mkdir -p "$DAILY" "$WEEKLY" "$STATUS"
  ts="$(date +%Y%m%d_%H%M%S)"
  final="$DAILY/waresys_$ts.dump"
  tmp="$DAILY/.waresys_$ts.dump.tmp"
  log "starting backup $ts"

  expected_tables="$(psql -XAtc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" 2>/dev/null || true)"
  if [ -z "$expected_tables" ]; then
    log "FAILED: cannot reach the database"
    write_status last_failure "$(date -Iseconds) cannot reach the database"
    return 1
  fi

  # Custom format: compressed, and restorable selectively with pg_restore.
  # --no-owner/--no-privileges so it restores into any database/user.
  if ! pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$tmp"; then
    rm -f "$tmp"
    log "FAILED: pg_dump exited with an error"
    write_status last_failure "$(date -Iseconds) pg_dump failed"
    return 1
  fi
  if ! validate_dump "$tmp" "$expected_tables"; then
    rm -f "$tmp"
    write_status last_failure "$(date -Iseconds) dump failed validation"
    return 1
  fi

  mv "$tmp" "$final"
  write_checksum "$final"
  log "wrote $final ($(du -h "$final" | cut -f1))"

  uploads_note="uploads ok"
  backup_uploads "$ts" || uploads_note="uploads FAILED"

  promote_weekly "$ts"
  prune
  write_status last_success "$(date -Iseconds) $(basename "$final") $(wc -c < "$final") bytes, $uploads_note"
  log "backup $ts complete"
}

today_done() {
  ls "$DAILY"/waresys_"$(date +%Y%m%d)"_*.dump > /dev/null 2>&1
}

daemon() {
  # PID 1 in the container ignores SIGTERM unless trapped — without this,
  # `docker compose stop` waits 10s and then SIGKILLs, possibly mid-dump.
  # An interrupted backup is harmless: it only ever existed as a .tmp.
  trap 'log "stopping"; exit 0' TERM INT
  mkdir -p "$DAILY" "$WEEKLY" "$STATUS"
  # Half-written leftovers from a crash mid-backup.
  find "$DAILY" "$WEEKLY" "$STATUS" -name '.*.tmp' -delete 2>/dev/null || true
  log "daemon started: daily at $BACKUP_TIME ($(date +%Z)), keeping $KEEP_DAILY daily + $KEEP_WEEKLY weekly"

  # Each scheduled backup runs as its own `sh backup.sh once` process: a
  # function called as `run_backup || true` runs with `set -e` switched off
  # for its whole body (POSIX), so an unexpected failure inside it would
  # carry on and could still write last_success.
  last_attempt=0
  # No backup at all yet (fresh install): take one right away rather than
  # waiting until tonight.
  if ! ls "$DAILY"/waresys_*.dump > /dev/null 2>&1; then
    last_attempt=$(date +%s)
    sh "$0" once || true
  fi

  # Checked every minute rather than sleeping 24h, so a container restart
  # can't skip or shift a day: once it's past BACKUP_TIME and today has no
  # backup yet, take one (retrying hourly if it fails).
  while true; do
    now=$(date +%s)
    if [ "$(date +%H:%M)" \> "$BACKUP_TIME" ] || [ "$(date +%H:%M)" = "$BACKUP_TIME" ]; then
      if ! today_done && [ $((now - last_attempt)) -ge $((RETRY_MINUTES * 60)) ]; then
        last_attempt=$now
        sh "$0" once || true
      fi
    fi
    # Backgrounded + wait, so a stop signal is handled immediately
    # instead of after the sleep finishes.
    sleep 60 & wait $!
  done
}

health() {
  f="$STATUS/last_success"
  [ -f "$f" ] || { echo "no successful backup yet"; exit 1; }
  if [ -n "$(find "$f" -mmin -"$((MAX_AGE_HOURS * 60))")" ]; then
    cat "$f"; exit 0
  fi
  echo "last successful backup is older than ${MAX_AGE_HOURS}h: $(cat "$f")"; exit 1
}

case "${1:-daemon}" in
  daemon) daemon ;;
  once) run_backup ;;
  validate) validate_dump "$2" ;;
  prune) prune ;;
  health) health ;;
  *) echo "usage: $0 daemon|once|validate FILE|prune|health" >&2; exit 2 ;;
esac
