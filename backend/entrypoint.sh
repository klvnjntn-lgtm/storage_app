#!/bin/sh
# entrypoint.sh — starts as root only long enough to hand the writable
# volumes to the unprivileged "node" user, then re-runs itself as node.
set -e

if [ "$(id -u)" = "0" ]; then
  # Volumes created by earlier images (which ran as root) are root-owned.
  # chown only when the top-level owner is wrong, so a large uploads volume
  # isn't walked on every start.
  for dir in /app/data /app/uploads /tmp/gdb-imports; do
    mkdir -p "$dir"
    if [ "$(stat -c %u "$dir")" != "$(id -u node)" ]; then
      chown -R node:node "$dir"
    fi
  done
  exec su-exec node "$0" "$@"
fi

echo "==> Running database migrations..."
ATTEMPTS=0
until npx prisma migrate deploy; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge 15 ]; then
    echo "==> Migrations failed after $ATTEMPTS attempts. Giving up."
    exit 1
  fi
  echo "    Database not ready yet (attempt $ATTEMPTS), retrying in 3s..."
  sleep 3
done

echo "==> Starting server..."
exec node dist/src/main.js
