#!/bin/sh
# WareSys off-server backup copy — runs inside the `backup-offsite`
# container (rclone/rclone). Copies finished backups from ./backups to
# OFFSITE_REMOTE (a Google Drive folder, e.g. "gdrive:WareSys/backups")
# and keeps the same retention there: newest 14 daily + 8 weekly.
#
#   offsite-sync.sh daemon   copy every OFFSITE_INTERVAL_MINUTES (default 60)
#   offsite-sync.sh once     copy now
#   offsite-sync.sh health   exit 0 if the last successful copy is recent
#
# Safety:
# - /backups is mounted READ-ONLY here (only /backups/status is writable),
#   so nothing in this container can damage the local backups.
# - Only finished backups are copied: a file counts once its .sha256
#   exists (backup.sh writes that last, after validation).
# - Every copy is verified against the local checksums (rclone check).
# - Remote retention is decided from the REMOTE listing and only runs
#   after a verified copy — an empty or broken local folder can never
#   cause remote backups to be deleted.

set -eu

REMOTE="${OFFSITE_REMOTE:?set OFFSITE_REMOTE, e.g. gdrive:WareSys/backups}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
STATUS="$BACKUP_DIR/status"
INTERVAL="${OFFSITE_INTERVAL_MINUTES:-60}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"
MAX_AGE_HOURS="${OFFSITE_MAX_AGE_HOURS:-26}"

log() { echo "[offsite] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

write_status() {
  printf '%s\n' "$2" > "$STATUS/.$1.tmp"
  mv "$STATUS/.$1.tmp" "$STATUS/$1"
}

# Finished files in one folder: every file that has a .sha256, plus the
# .sha256 itself.
finished_files() {
  dir="$1"
  ls -1 "$dir" 2>/dev/null | grep -E '^waresys_.*\.sha256$' | while read -r sum; do
    base="${sum%.sha256}"
    [ -f "$dir/$base" ] && printf '%s\n%s\n' "$base" "$sum"
  done
}

prune_remote() {
  sub="$1"; keep="$2"
  names="$(rclone lsf "$REMOTE/$sub" --files-only --include 'waresys_[0-9]*.dump')" || return 1
  printf '%s\n' "$names" | grep -E '\.dump$' | sort -r | tail -n +"$((keep + 1))" | while read -r dump; do
    stamp="${dump#waresys_}"; stamp="${stamp%.dump}"
    for f in "$dump" "$dump.sha256" "waresys_uploads_$stamp.tar.gz" "waresys_uploads_$stamp.tar.gz.sha256"; do
      rclone deletefile "$REMOTE/$sub/$f" 2>/dev/null || true
    done
    log "pruned remote $sub/$dump"
  done
}

sync_dir() {
  sub="$1"; keep="$2"
  [ -d "$BACKUP_DIR/$sub" ] || return 0
  list="$(mktemp)"
  finished_files "$BACKUP_DIR/$sub" > "$list"
  if [ ! -s "$list" ]; then rm -f "$list"; return 0; fi

  rclone copy "$BACKUP_DIR/$sub" "$REMOTE/$sub" --files-from "$list" --checksum || { rm -f "$list"; return 1; }
  # Every local finished file must be on the remote, byte-identical.
  rclone check "$BACKUP_DIR/$sub" "$REMOTE/$sub" --files-from "$list" --one-way || { rm -f "$list"; return 1; }
  rm -f "$list"
  prune_remote "$sub" "$keep"
}

run_sync() {
  log "copying to $REMOTE"
  if sync_dir daily "$KEEP_DAILY" && sync_dir weekly "$KEEP_WEEKLY"; then
    latest="$(finished_files "$BACKUP_DIR/daily" | grep -E '^waresys_[0-9].*\.dump$' | sort | tail -1)"
    write_status last_offsite_success "$(date -Iseconds) $REMOTE latest=${latest:-none}"
    log "copy verified"
  else
    write_status last_offsite_failure "$(date -Iseconds) copy to $REMOTE failed"
    log "FAILED — will retry in $INTERVAL minutes"
    return 1
  fi
}

health() {
  f="$STATUS/last_offsite_success"
  [ -f "$f" ] || { echo "no successful offsite copy yet"; exit 1; }
  if [ -n "$(find "$f" -mmin -"$((MAX_AGE_HOURS * 60))")" ]; then cat "$f"; exit 0; fi
  echo "last successful offsite copy is older than ${MAX_AGE_HOURS}h: $(cat "$f")"; exit 1
}

case "${1:-daemon}" in
  daemon)
    trap 'log "stopping"; exit 0' TERM INT
    log "started: every $INTERVAL minutes to $REMOTE"
    while true; do
      run_sync || true
      sleep "$((INTERVAL * 60))" & wait $!
    done
    ;;
  once) run_sync ;;
  health) health ;;
  *) echo "usage: $0 daemon|once|health" >&2; exit 2 ;;
esac
