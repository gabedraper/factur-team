#!/usr/bin/env bash
# Continue the Loxo migration where it left off.
#
#   ./scripts/resume-loxo.sh
#
# Safe to run as often as you like: every record carries its Loxo id and every
# write is an upsert, so this converges rather than duplicating. People already
# imported are skipped, so a restart does not redo the ones already here.
#
# `caffeinate` keeps the machine awake while it runs and releases when it exits.
# Closing the lid will still suspend it -- leave it open, or run it in clamshell
# on an external display.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.local; set +a
: "${LOXO_API_KEY:?Set LOXO_API_KEY in .env.local}"
: "${LOXO_AGENCY_SLUG:?Set LOXO_AGENCY_SLUG in .env.local}"
exec caffeinate -i node scripts/import-loxo.mjs "$@"
