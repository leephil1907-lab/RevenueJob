#!/bin/sh
# Give the mounted volume to the unprivileged app user, then drop privileges.
# A Fly volume always shows up owned by root on first boot, and the store needs
# to write store.json, outbox/ and the lock file inside it.
set -e

DATA="${RP_DATA_DIR:-/var/data}"
mkdir -p "$DATA"
chown -R node:node "$DATA" 2>/dev/null || true

exec su-exec node "$@"
