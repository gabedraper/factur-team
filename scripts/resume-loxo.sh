#!/usr/bin/env bash
# Continue the Loxo migration where it left off.
#
#   ./scripts/resume-loxo.sh
#   ./scripts/resume-loxo.sh --resumes    # afterwards: pull the CV files
#
# Safe to run as often as you like: every record carries its Loxo id and every
# write is an upsert, so this converges rather than duplicating. People already
# imported are skipped, so a restart does not redo the ones already here.
#
# `caffeinate` keeps the machine awake while it runs and releases when it exits.
# Closing the lid will still suspend it -- leave it open, or run it in clamshell
# on an external display.
set -uo pipefail
cd "$(dirname "$0")/.."

# .env.local is *parsed*, not sourced. Several values in it are unquoted and
# contain spaces (NEXT_PUBLIC_SITE_NAME=Factur Team), and `source` runs the
# second word as a command -- which killed the first attempt at this script.
if [ ! -f ./.env.local ]; then
  echo "No .env.local found in $(pwd)" >&2
  exit 1
fi
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  case "$line" in *=*) ;; *) continue ;; esac
  key=${line%%=*}
  value=${line#*=}
  value=${value%\"} ; value=${value#\"}
  value=${value%\'} ; value=${value#\'}
  export "$key=$value"
done < ./.env.local

: "${LOXO_API_KEY:?Set LOXO_API_KEY in .env.local}"
: "${LOXO_AGENCY_SLUG:?Set LOXO_AGENCY_SLUG in .env.local}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY in .env.local}"

exec caffeinate -i node scripts/import-loxo.mjs "$@"
