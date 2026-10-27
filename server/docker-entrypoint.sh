#!/bin/sh
# Gives the data folder to the unprivileged user, then runs the relay as that user.
set -e
mkdir -p "$DATA_DIR"
chown -R node:node "$DATA_DIR"
exec su-exec node "$@"
