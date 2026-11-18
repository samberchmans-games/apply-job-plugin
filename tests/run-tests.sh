#!/bin/sh
# Runs the pure-logic tests with Node (if installed) or macOS JavaScriptCore via osascript.
cd "$(dirname "$0")/.." || exit 1
FILES="src/lib/core.js src/lib/logger.js src/lib/skills-dictionary.js src/lib/matcher.js tests/matcher.test.js"
if command -v node >/dev/null 2>&1; then
  node -e "global.console=console; for (const f of process.argv.slice(1)) require('vm').runInThisContext(require('fs').readFileSync(f,'utf8'),{filename:f}); const r=globalThis.__TEST_RESULTS__; console.log(r.join('\n')); process.exit(r.some(x=>x.startsWith('FAIL'))?1:0)" $FILES
else
  OUT=$( { echo 'var console={log(){},debug(){},info(){},warn(){},error(){}}; var setTimeout=function(){};'; cat $FILES; printf '%s\n' '; globalThis.__TEST_RESULTS__.join(String.fromCharCode(10))'; } | osascript -l JavaScript - 2>&1)
  echo "$OUT"
  echo "$OUT" | grep -q '^FAIL' && exit 1 || exit 0
fi
