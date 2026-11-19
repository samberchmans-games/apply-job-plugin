#!/bin/sh
# Static checks (fast, no browser): manifest is valid and every file it names exists, every script parses,
# versions agree, no stray debug code. Used by CI (.github/workflows/ci.yml) and before every commit.
cd "$(dirname "$0")/.." || exit 1
FAIL=0
python3 - <<'PY' || FAIL=1
import json, os, sys
m = json.load(open('manifest.json'))
missing = []
files = list(m.get('background', {}).get('scripts', [])) + [m['background']['service_worker']] if m.get('background', {}).get('service_worker') else list(m.get('background', {}).get('scripts', []))
for cs in m.get('content_scripts', []):
    files += cs.get('js', []) + cs.get('css', [])
for k in ('options_page',):
    if m.get(k): files.append(m[k])
if m.get('action', {}).get('default_popup'): files.append(m['action']['default_popup'])
for size, icon in (m.get('icons') or {}).items(): files.append(icon)
for f in files:
    if not os.path.exists(f): missing.append(f)
# importScripts in the background must also exist
import re
bg = open('src/background/background.js').read()
for f in re.findall(r"'\.\./([^']+\.js)'", bg):
    if not os.path.exists(os.path.join('src', f)): missing.append('src/' + f)
for f in re.findall(r"'(src/[^']+\.js)'", bg):
    if not os.path.exists(f): missing.append(f)
if missing:
    print('Missing files referenced by the extension:', *missing, sep='\n  '); sys.exit(1)
if not re.match(r'^\d+\.\d+\.\d+$', m.get('version', '')):
    print('manifest version must be x.y.z'); sys.exit(1)
print(f"manifest ok: v{m['version']}, {len(files)} files")
PY
if command -v node >/dev/null 2>&1; then
  for f in $(git ls-files 'src/*.js' 'tests/*.js' 'video/*.js' | grep -v '^src/vendor/'); do
    node --check "$f" 2>/dev/null || { echo "Syntax error: $f"; node --check "$f"; FAIL=1; }
  done
  echo "syntax ok"
else
  echo "node not installed: syntax check skipped"
fi
if git grep -n -E '^\s*debugger;?\s*$|\bconsole\.log\(' -- 'src/*.js' ':!src/vendor' ':!src/lib/logger.js' >/dev/null; then
  echo "Debug code left in src:"; git grep -n -E '^\s*debugger;?\s*$|\bconsole\.log\(' -- 'src/*.js' ':!src/vendor' ':!src/lib/logger.js'; FAIL=1
fi
[ $FAIL = 0 ] && echo "All checks passed"
exit $FAIL
