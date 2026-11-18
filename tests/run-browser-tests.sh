#!/bin/sh
# Runs the FULL browser test suite headless in Chrome (real time) and prints the results.
#   ./tests/run-browser-tests.sh [filter]
# Requires Google Chrome (or set CHROME=/path/to/chrome). Exit code 1 on failure.
cd "$(dirname "$0")/.." || exit 1
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -x "$CHROME" ] || { echo "Chrome not found. Open tests/test-runner.html in any browser instead."; exit 2; }

TMP="$(mktemp -d)"
PORT="${PORT:-8765}"
python3 tests/serve.py "$PORT" --results-file "$TMP/results.json" >/dev/null 2>&1 &
SERVER=$!
sleep 1
"$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check --user-data-dir="$TMP/profile" \
  "http://127.0.0.1:$PORT/tests/test-runner.html?report=1&grep=$1" >/dev/null 2>&1 &
BROWSER=$!

i=0
while [ ! -s "$TMP/results.json" ] && [ $i -lt 180 ]; do sleep 1; i=$((i + 1)); done
kill $BROWSER $SERVER 2>/dev/null
wait $BROWSER $SERVER 2>/dev/null

if [ ! -s "$TMP/results.json" ]; then echo "No results after 180s (runner crashed?)"; rm -rf "$TMP"; exit 1; fi
python3 - "$TMP/results.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
for f in r['failed']:
    print('FAIL', f)
if r.get('loadErrors'):
    for e in r['loadErrors']: print('LOAD ERROR', e)
print(f"\n{r['total'] - len(r['failed'])} passed, {len(r['failed'])} failed ({r['total']} tests, {r['suites']} suites, {r['ms']} ms)")
sys.exit(1 if r['failed'] or r.get('loadErrors') else 0)
PY
CODE=$?
rm -rf "$TMP"
exit $CODE
