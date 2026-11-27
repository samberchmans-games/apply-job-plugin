#!/bin/sh
# Performance benchmark (made-up data, database on): Job Radar scan saving, matching with 3 tracks, log writes,
# repeated reads. Prints one line per measure (median ms). Not a pass/fail test: compare before and after a change.
#   ./tests/run-bench.sh
cd "$(dirname "$0")/.." || exit 1
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -x "$CHROME" ] || { echo "Chrome not found. Open tests/bench.html through tests/serve.py instead."; exit 2; }
TMP="$(mktemp -d)"
PORT="${PORT:-8767}"
python3 tests/serve.py "$PORT" --results-file "$TMP/results.json" >/dev/null 2>&1 &
SERVER=$!
sleep 1
"$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check $CHROME_FLAGS --user-data-dir="$TMP/profile" \
  "http://127.0.0.1:$PORT/tests/bench.html" >/dev/null 2>&1 &
BROWSER=$!
i=0
while [ ! -s "$TMP/results.json" ] && [ $i -lt "${TIMEOUT:-300}" ]; do sleep 1; i=$((i + 1)); done
kill $BROWSER $SERVER 2>/dev/null
wait $BROWSER $SERVER 2>/dev/null
[ -s "$TMP/results.json" ] || { echo "No results (bench crashed or took too long)"; rm -rf "$TMP"; exit 1; }
python3 -c "import json,sys; print('\n'.join(json.load(open(sys.argv[1]))['lines']))" "$TMP/results.json"
rm -rf "$TMP"
