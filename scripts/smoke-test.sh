#!/usr/bin/env bash
# Post-deploy smoke test. Usage: scripts/smoke-test.sh http://localhost:8080
set -euo pipefail
BASE="${1:-http://localhost:8080}"
check() { local path=$1 expect=$2; local code; code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path"); [[ "$code" == "$expect" ]] && echo "PASS $path -> $code" || { echo "FAIL $path -> $code (expected $expect)"; exit 1; }; }
check /health/live 200
check /health/ready 200
check /api/tasks 200
check /metrics 200
ID=$(curl -s -X POST "$BASE/api/tasks" -H 'content-type: application/json' -d '{"title":"smoke test"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s -X DELETE "$BASE/api/tasks/$ID" -o /dev/null -w 'DELETE -> %{http_code}\n'
echo "Smoke test complete"
