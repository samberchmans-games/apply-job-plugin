/*
 * check-error-docs.js — the docs agree with the error catalog (src/lib/errors.js), so they can't drift:
 *   - every "errors.js … N codes" in ARCHITECTURE.md and PLAN.md says the real number;
 *   - SUPPORT.md lists every code (and no code that no longer exists).
 * Run by tests/check.sh. Exit 1 with the differences.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
globalThis.chrome = { runtime: { getURL: () => '' } };
for (const f of ['core', 'logger', 'errors']) require(path.join(root, 'src/lib', f + '.js'));
const codes = Object.values(globalThis.AJP.ERRORS).map((e) => e[0]);
const problems = [];

for (const doc of ['docs/ARCHITECTURE.md', 'docs/PLAN.md']) {
  const text = fs.readFileSync(path.join(root, doc), 'utf8');
  const said = [...text.matchAll(/errors\.js`[^|\n]{0,6}?(\d+) codes/g)].map((m) => Number(m[1]));
  if (!said.length) problems.push(`${doc}: no "errors.js … N codes" line found`);
  for (const n of said) if (n !== codes.length) problems.push(`${doc}: says ${n} error codes, errors.js has ${codes.length}`);
}

const support = fs.readFileSync(path.join(root, 'docs/SUPPORT.md'), 'utf8');
const listed = new Set([...support.matchAll(/^\| `(AJP-[A-Z0-9-]+)`/gm)].map((m) => m[1]));
for (const c of codes) if (!listed.has(c)) problems.push(`docs/SUPPORT.md: ${c} is not listed`);
for (const c of listed) if (!codes.includes(c)) problems.push(`docs/SUPPORT.md: ${c} is listed but no longer exists`);

if (problems.length) {
  console.log('Docs and error catalog disagree:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`error docs ok: ${codes.length} codes`);
