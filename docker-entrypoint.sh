#!/bin/sh
set -e

mkdir -p /paperclip
mkdir -p /paperclip/instances/default/logs

chown -R node:node /paperclip || true
chmod -R 775 /paperclip || true

exec su node -s /bin/sh -c "cd /app && node --import ./server/node_modules/tsx/dist/loader.mjs server/dist/index.js"
