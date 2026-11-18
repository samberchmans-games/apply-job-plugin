/*
 * harness.js — a tiny zero-dependency test framework.
 *
 *   describe('suite', () => { it('does x', async () => { eq(a, b); }); }, { env: 'browser' });
 *
 * env: 'any'      runs in the CLI (Node / macOS JavaScriptCore) and in the browser runner
 *      'browser'  needs a DOM / async browser APIs — runs only in tests/test-runner.html
 */
(function () {
  'use strict';
  const T = (globalThis.AJPTest = { suites: [] });
  let cur = null;

  T.describe = (name, fn, opts = {}) => {
    cur = { name, env: opts.env || 'any', tests: [], beforeEach: null, afterEach: null };
    T.suites.push(cur);
    fn();
    cur = null;
  };
  T.it = (name, fn) => cur.tests.push({ name, fn });
  T.beforeEach = (fn) => (cur.beforeEach = fn);
  T.afterEach = (fn) => (cur.afterEach = fn);

  // ---- Assertions ---------------------------------------------------------
  const show = (v) => {
    try {
      return JSON.stringify(v);
    } catch (_) {
      return String(v);
    }
  };
  class AssertionError extends Error {}
  T.eq = (actual, expected, msg) => {
    if (show(actual) !== show(expected)) throw new AssertionError(`${msg ? msg + ': ' : ''}expected ${show(expected)}, got ${show(actual)}`);
  };
  T.ok = (v, msg) => {
    if (!v) throw new AssertionError(msg || `expected truthy, got ${show(v)}`);
  };
  T.notOk = (v, msg) => {
    if (v) throw new AssertionError(msg || `expected falsy, got ${show(v)}`);
  };
  T.includes = (hay, needle, msg) => {
    const has = typeof hay === 'string' ? hay.includes(needle) : Array.isArray(hay) ? hay.some((x) => show(x) === show(needle)) : false;
    if (!has) throw new AssertionError(`${msg ? msg + ': ' : ''}expected ${show(hay).slice(0, 400)} to include ${show(needle)}`);
  };
  T.excludes = (hay, needle, msg) => {
    const has = typeof hay === 'string' ? hay.includes(needle) : Array.isArray(hay) ? hay.some((x) => show(x) === show(needle)) : false;
    if (has) throw new AssertionError(`${msg ? msg + ': ' : ''}expected ${show(hay).slice(0, 400)} NOT to include ${show(needle)}`);
  };
  T.throws = (fn, re, msg) => {
    try {
      fn();
    } catch (e) {
      if (re && !re.test(e.message)) throw new AssertionError(`${msg || 'throws'}: message ${show(e.message)} !~ ${re}`);
      return e;
    }
    throw new AssertionError(msg || 'expected function to throw');
  };
  T.rejects = async (p, re, msg) => {
    try {
      await (typeof p === 'function' ? p() : p);
    } catch (e) {
      if (re && !re.test(e.message)) throw new AssertionError(`${msg || 'rejects'}: message ${show(e.message)} !~ ${re}`);
      return e;
    }
    throw new AssertionError(msg || 'expected promise to reject');
  };
  T.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  T.waitFor = async (fn, { timeout = 2000, step = 20, msg = 'condition' } = {}) => {
    const end = Date.now() + timeout;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new AssertionError(`timed out waiting for ${msg}`);
      await T.sleep(step);
    }
  };

  // ---- Runners -------------------------------------------------------------
  const withTimeout = (p, ms, name) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`test timed out after ${ms}ms: ${name}`)), ms))]);

  // Browser runner: async, all suites (or a filter).
  T.run = async ({ filter = '', onResult = () => {}, timeout = 8000 } = {}) => {
    const results = [];
    for (const s of T.suites) {
      for (const t of s.tests) {
        const full = `${s.name} › ${t.name}`;
        if (filter && !full.toLowerCase().includes(filter.toLowerCase())) continue;
        const t0 = performance.now();
        let status = 'pass';
        let error = '';
        try {
          if (s.beforeEach) await s.beforeEach();
          await withTimeout(Promise.resolve().then(t.fn), timeout, full);
        } catch (e) {
          status = 'fail';
          error = (e && (e.stack || e.message)) || String(e);
        } finally {
          try {
            if (s.afterEach) await s.afterEach();
          } catch (e) {
            if (status === 'pass') (status = 'fail'), (error = 'afterEach: ' + e.message);
          }
        }
        const r = { suite: s.name, test: t.name, status, error, ms: Math.round(performance.now() - t0) };
        results.push(r);
        onResult(r);
      }
    }
    return results;
  };

  // CLI runner: synchronous, 'any' suites only. Async tests are skipped (run them in the browser).
  T.runSync = () => {
    const out = [];
    for (const s of T.suites) {
      if (s.env !== 'any') continue;
      for (const t of s.tests) {
        let status = 'PASS';
        let err = '';
        try {
          if (s.beforeEach) s.beforeEach();
          const r = t.fn();
          if (r && typeof r.then === 'function') status = 'SKIP';
        } catch (e) {
          status = 'FAIL';
          err = ' :: ' + e.message;
        }
        out.push(`${status} ${s.name} › ${t.name}${err}`);
      }
    }
    const n = (k) => out.filter((l) => l.startsWith(k)).length;
    out.push(`\n${n('PASS')} passed, ${n('FAIL')} failed, ${n('SKIP')} skipped (async — run tests/test-runner.html)`);
    return out.join('\n');
  };
})();
