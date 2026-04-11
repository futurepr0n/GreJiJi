#!/usr/bin/env sh
set -eu

node scripts/migrate.js
node src/server.js
