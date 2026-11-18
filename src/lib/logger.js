/*
 * logger.js — structured logging shared by every context.
 *
 * - Prints to the console as  [AJP][context][module] message
 * - Batches entries and persists them (background owns the write; other
 *   contexts forward via runtime messages).
 * - Redacts secrets / contact details before anything is stored, so users
 *   can safely export and share logs when they raise an issue.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.logger) return;

  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
  const SENSITIVE_KEY = /(api[_-]?key|keys|token|password|passwd|secret|authorization|ssn|email|phone|dataurl|eeo|race|veteran|disability|gender)/i;
  const MAX_STR = 1500;

  let minLevel = 'info';
  let sink = null; // set in background: async (entries) => persist
  let buffer = [];
  let timer = null;

  function redact(v, depth = 0) {
    if (v == null) return v;
    if (typeof v === 'string') return v.length > MAX_STR ? v.slice(0, MAX_STR) + `…[${v.length} chars]` : v;
    if (typeof v !== 'object') return v;
    if (v instanceof Error) {
      return { name: v.name, message: v.message, stack: String(v.stack || '').split('\n').slice(0, 6).join('\n') };
    }
    if (depth > 3) return '[…]';
    if (Array.isArray(v)) return v.slice(0, 40).map((x) => redact(x, depth + 1));
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(val, depth + 1);
    return out;
  }

  function emit(level, mod, msg, data) {
    if (LEVELS[level] < LEVELS[minLevel]) return;
    const entry = { t: new Date().toISOString(), lvl: level, ctx: AJP.logContext || '?', mod, msg: String(msg) };
    if (data !== undefined) entry.data = redact(data);
    const fn = console[level] || console.log;
    try {
      fn.call(console, `[AJP][${entry.ctx}][${mod}] ${entry.msg}`, data === undefined ? '' : entry.data);
    } catch (_) {}
    buffer.push(entry);
    if (buffer.length > 200) buffer = buffer.slice(-200);
    if (!timer) timer = setTimeout(flush, level === 'error' ? 50 : 700);
  }

  async function flush() {
    timer = null;
    if (!buffer.length) return;
    const batch = buffer;
    buffer = [];
    try {
      if (sink) await sink(batch);
      else if (AJP.send && AJP.api) await AJP.send('log', { entries: batch });
    } catch (_) {
      /* never let logging break the app */
    }
  }

  AJP.LOG_LEVELS = Object.keys(LEVELS);
  AJP.setLogSink = (fn) => (sink = fn);
  AJP.setLogLevel = (lvl) => {
    if (LEVELS[lvl]) minLevel = lvl;
  };
  AJP.flushLogs = flush;
  AJP.redact = redact;
  AJP.logger = (mod) => ({
    debug: (m, d) => emit('debug', mod, m, d),
    info: (m, d) => emit('info', mod, m, d),
    warn: (m, d) => emit('warn', mod, m, d),
    error: (m, d) => emit('error', mod, m, d),
  });
})();
