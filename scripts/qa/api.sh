#!/usr/bin/env bash
# QA helper: authenticated, timed curl against the local API.
# Usage: scripts/qa/api.sh GET /me
#        scripts/qa/api.sh POST /chat '{"message":"..."}'
# Prints timing to stderr and body to stdout. Token comes from
# /tmp/desigual-qa-token (run scripts/qa/login.mjs first).
set -euo pipefail
METHOD="${1:-GET}"
PATH_="${2:?path required}"
BODY="${3:-}"
BASE="${QA_API_BASE:-http://127.0.0.1:3001}"
TOKEN="$(cat /tmp/desigual-qa-token)"
ARGS=(-s -X "$METHOD" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"
      -w $'\n__TIME__%{time_total} %{http_code}' -m "${QA_TIMEOUT:-30}")
if [[ -n "$BODY" ]]; then ARGS+=(-d "$BODY"); fi
curl "${ARGS[@]}" "$BASE$PATH_"
