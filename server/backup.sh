#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL required}"
STAMP=$(date -u +%Y%m%d-%H%M%S)
mkdir -p /backups
pg_dump "$DATABASE_URL" --format=custom --no-owner --file="/backups/trailer-temp-${STAMP}.dump"
find /backups -type f -name '*.dump' -mtime +30 -delete
