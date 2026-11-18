#!/bin/sh
# Command-line test run (fast, no browser): core helpers, matcher, logger redaction,
# AI output parsing, autofill rules. Uses Node if installed, else macOS JavaScriptCore.
#
# The FULL suite (autofill on real forms, job-page reading, storage, background,
# end-to-end) runs in a browser: open tests/test-runner.html.
cd "$(dirname "$0")/.." || exit 1
FILES="tests/harness.js src/lib/core.js src/lib/logger.js src/lib/storage.js src/lib/skills-dictionary.js src/lib/matcher.js src/lib/ai.js src/content/form-filler.js
       tests/unit/core.test.js tests/unit/matcher.test.js tests/unit/logger.test.js tests/unit/ai.test.js tests/unit/form-filler.test.js"
if command -v node >/dev/null 2>&1; then
  node -e "const vm=require('vm'),fs=require('fs'); for (const f of process.argv.slice(1)) vm.runInThisContext(fs.readFileSync(f,'utf8'),{filename:f}); const o=AJPTest.runSync(); console.log(o); process.exit(/^FAIL/m.test(o)?1:0)" $FILES
else
  OUT=$( { echo 'var console={log(){},debug(){},info(){},warn(){},error(){}}; var setTimeout=function(){return 0}; var clearTimeout=function(){};'; cat $FILES; printf '%s\n' '; AJPTest.runSync()'; } | osascript -l JavaScript - 2>&1)
  echo "$OUT"
  echo "$OUT" | grep -q '^FAIL' && exit 1 || exit 0
fi
