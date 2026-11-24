#!/bin/bash
# Device-flow login with the released CLI, approved as $E2E_STUDENT (default user) through the web session API.
set -euo pipefail
E2E="$(cd "$(dirname "$0")" && pwd)"
source "$E2E/env.sh"

curl -s -c "$CLI_STATE/student.jar" -o /dev/null -w 'student web login %{http_code}\n' \
  -H 'content-type: application/json' -d "{\"email\":\"$E2E_STUDENT@example.com\",\"password\":\"$E2E_STUDENT\"}" "$B/auth/login"

"$CLI" mooc -c vscode_plugin login >"$CLI_STATE/login.out" 2>"$CLI_STATE/login.err" &
pid=$!
code=""
for _ in $(seq 1 60); do
  code="$(grep -o '"user_code":"[^"]*"' "$CLI_STATE/login.out" | head -1 | cut -d'"' -f4 || true)"
  [ -n "$code" ] && break
  sleep 0.5
done
[ -n "$code" ] || { echo "no user code"; cat "$CLI_STATE/login.out" "$CLI_STATE/login.err"; kill $pid; exit 1; }
echo "user code $code"
curl -s -b "$CLI_STATE/student.jar" -H 'content-type: application/json' -d "{\"user_code\":\"$code\"}" \
  "$B/main-frontend/oauth/device_verification/approve"; echo
wait $pid && echo "login exited 0"
tail -1 "$CLI_STATE/login.out"
