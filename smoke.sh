#!/usr/bin/env bash
# Puff smoke test — boots the app headlessly and asserts the UI fully builds.
#
# Catches whole-script crashes (e.g. temporal-dead-zone ReferenceErrors) that
# `node --check` passes silently: if app.js dies mid-boot, the trigger grid
# stays empty and this fails. Run before every push.
#
# Usage: bash smoke.sh
set -u
cd "$(dirname "$0")"

PORT=8123
OUT="$(mktemp)"
SERVER_PID=""
fail=0

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -f "$OUT"
}
trap cleanup EXIT

# Serve the repo (SW-relative paths need an http origin, not file://)
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 1

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || CHROME="$(command -v google-chrome || command -v chromium || true)"
if [ -z "$CHROME" ]; then
  echo "FAIL: no Chrome/Chromium found for headless run"
  exit 2
fi

"$CHROME" --headless=new --disable-gpu --virtual-time-budget=5000 \
  --dump-dom "http://localhost:$PORT/" >"$OUT" 2>/dev/null

check() { # <name> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "PASS  $1 ($3)"
  else
    echo "FAIL  $1 — expected $2, got $3 (script likely crashed mid-boot)"
    fail=1
  fi
}

TRIGGERS=$(grep -o 'class="trigger-btn' "$OUT" | wc -l | tr -d ' ')
check "trigger buttons built" 16 "$TRIGGERS"

CARDS=$(grep -Ec 'id="menu-(triggers|badges|health|settings)"' "$OUT")
check "menu cards built" 4 "$CARDS"

HEALTH=$(grep -c 'id="health-screen"' "$OUT")
check "health screen present" 1 "$HEALTH"

WEEKLY=$(grep -c 'id="weekly-summary"' "$OUT")
check "weekly summary present" 1 "$WEEKLY"

if [ "$fail" = "0" ]; then
  echo "SMOKE OK"
else
  echo "SMOKE FAILED"
fi
exit $fail
