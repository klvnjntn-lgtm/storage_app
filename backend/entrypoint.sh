#!/bin/sh
set -e

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
exec node dist/main.js