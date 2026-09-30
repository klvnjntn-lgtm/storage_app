# WareSys backups (server / docker-compose)

Two services in `docker-compose.yml`:

| Service | What it does | Runs by default |
|---|---|---|
| `db-backup` | Daily `pg_dump` + archive of uploaded files into `./backups`, validated, 14 daily + 8 weekly kept | **Yes** |
| `backup-offsite` | Copies finished backups from `./backups` to Google Drive (rclone), same retention there | **No**, only with the `offsite` profile |

## What a backup is

Every day at `BACKUP_TIME` (default 02:00, `BACKUP_TZ` default Asia/Jakarta):

```
backups/
├── daily/
│   ├── waresys_20261001_020000.dump                 database (pg_dump custom format)
│   ├── waresys_20261001_020000.dump.sha256
│   ├── waresys_uploads_20261001_020000.tar.gz       uploaded files (media, logos, delivery proofs)
│   └── waresys_uploads_20261001_020000.tar.gz.sha256
├── weekly/                                          first backup of each ISO week (hard links)
│   └── waresys_2026-W40.dump ...
└── status/
    ├── last_success            e.g. "2026-10-01T02:00:05+07:00 waresys_20261001_020000.dump 97980778 bytes, uploads ok"
    ├── last_failure
    └── last_offsite_success
```

A dump only becomes a backup after it passes validation (until then it is a hidden `.tmp` file that nothing else picks up):

1. at least 10 KB;
2. `pg_restore` can read its table of contents;
3. it contains `_prisma_migrations` data (it really is a WareSys database);
4. it has exactly as many tables as the live database;
5. `pg_restore` can read **every data block** (catches truncated/corrupted files).

The `.sha256` is written last. Retention only runs after a successful backup and counts backups by name, so a run of failures never deletes the good backups that are left.

If the container was down at 02:00, the missed backup is taken as soon as it is back. On a fresh install with no backups yet, one is taken immediately.

## Everyday commands (from the project folder)

```bash
# Health: status "healthy" = a validated backup in the last 26 hours
docker compose ps db-backup
cat backups/status/last_success

# Take a backup now (e.g. before a deploy)
docker compose exec db-backup sh /scripts/backup.sh once

# Logs
docker compose logs --tail 50 db-backup
```

## Restore

Always drill first. It restores into a throwaway database and drops it again, without touching live data:

```bash
ops/backup/restore.sh check backups/daily/waresys_20261001_020000.dump
```

A real restore **replaces** the live database. It asks you to type `RESTORE`, stops backend/frontend, restores in a single transaction (all or nothing), then starts them again:

```bash
ops/backup/restore.sh restore backups/daily/waresys_20261001_020000.dump
ops/backup/restore.sh restore backups/daily/waresys_20261001_020000.dump --with-uploads   # also uploaded files
```

The checksum is verified before anything happens. The file must be inside `./backups`.

## Google Drive copy (off by default)

Free: it uses a normal Google account's 15 GB. At roughly 100 MB per database backup, 14 daily + 8 weekly ≈ 2–3 GB.

### 1. Authorize rclone (once)

Use a dedicated Google account for backups if you can. The `drive.file` scope below lets rclone see **only the files it created itself**, not the rest of the Drive.

On the server, from the project folder:

```bash
mkdir -p secrets/rclone && chmod 700 secrets
docker run --rm -it -v "$PWD/secrets/rclone:/config/rclone" rclone/rclone:1.71 config
```

Answer:
- `n` (new remote), name: **`gdrive`**
- Storage: **`drive`**
- client_id / client_secret: leave empty
- scope: **`drive.file`**
- service_account_file: leave empty
- Edit advanced config: `n`
- Use web browser to automatically authenticate: **`n`** (the server has no browser)

rclone prints a command like `rclone authorize "drive" "eyJ..."`. Run that command on **your own PC** (install rclone from https://rclone.org/downloads/). A browser opens; log in with the backup Google account and allow access. Paste the token it prints back into the server prompt. Then answer `n` for "Configure this as a Shared Drive", then `y` to keep the remote, then `q` to quit.

Check that it works:

```bash
docker run --rm -v "$PWD/secrets/rclone:/config/rclone" rclone/rclone:1.71 lsd gdrive:
chmod 600 secrets/rclone/rclone.conf
```

`secrets/` is git-ignored. `rclone.conf` holds the Drive token, so treat it like a password.

### 2. Turn it on

Add to `.env`:

```
COMPOSE_PROFILES=offsite
OFFSITE_REMOTE=gdrive:WareSys/backups
```

```bash
docker compose up -d backup-offsite
docker compose logs -f backup-offsite      # expect "copy verified"
cat backups/status/last_offsite_success
```

It copies every hour (`OFFSITE_INTERVAL_MINUTES`). Only finished backups are copied, every copy is checked against the checksums, and Drive keeps the same 14 daily + 8 weekly. Old backups removed from Drive go to Drive's trash (auto-emptied after 30 days).

Local backups are mounted **read-only** in this container. Drive-side retention is decided from the Drive listing only, so a wiped local folder can never cause backups on Drive to be deleted.

### 3. Restoring from Drive

```bash
mkdir -p backups/restore
docker run --rm -v "$PWD/secrets/rclone:/config/rclone" -v "$PWD/backups:/backups" rclone/rclone:1.71 \
  copy gdrive:WareSys/backups/daily/ /backups/restore/ --include "waresys_20261001_020000*"
ops/backup/restore.sh check   backups/restore/waresys_20261001_020000.dump
ops/backup/restore.sh restore backups/restore/waresys_20261001_020000.dump
```

## Later: object storage

When Google Drive stops being a good fit, point `OFFSITE_REMOTE` at an S3-compatible bucket configured in rclone (for example `r2:waresys-backups`). Nothing else changes.
