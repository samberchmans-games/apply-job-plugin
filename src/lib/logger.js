/*
 * logger.js — structured logging shared by every context.
 *
 * Every entry:  { t, lvl, ctx, sid, mod, msg, data?, tid?, code?, pre? }
 *   ctx   where it ran: bg | content | frame | admin | popup
 *   sid   session id: one per page/background lifetime (groups entries from one run)
 *   tid   trace id: follows ONE user action across contexts (page → background → AI → page)
 *   code  error code from errors.js (e.g. AJP-AI-429)
 *   pre   entry was below the log level but kept because an error followed (flight recorder)
 *
 * - Prints to the console as  [AJP][context][module] message
 * - Batches entries; background persists them (other contexts forward via runtime messages).
 * - Redacts secrets / contact details by KEY name and by VALUE pattern (emails, API keys,
 *   bearer tokens, phone numbers, SSNs) so logs are safe to share with support.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.logger) return;

  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
  const SENSITIVE_KEY = /(api[_-]?key|keys|token|password|passwd|secret|authorization|ssn|email|phone|dataurl|eeo|race|veteran|disability|gender)/i;
  const MAX_STR = 1500;
  const VALUE_PATTERNS = [
    [/\b(AIza[0-9A-Za-z_-]{30,}|gsk_[A-Za-z0-9]{16,}|sk-or-v1-[A-Za-z0-9]{16,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|xox[abp]-[A-Za-z0-9-]{10,})\b/g, '[key]'],
    [/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer [key]'],
    [/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s"']+/gi, '$1[key]'],
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
    [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'],
    [/(?<![\w-])(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w-])/g, '[phone]'],
  ];
  const RECORDER_SIZE = 60; // recent below-level entries kept in memory, saved only if an error follows

  let minLevel = 'info';
  let sink = null; // set in background: async (entries) => persist
  let buffer = [];
  let recorder = [];
  let timer = null;

  AJP.newId = (n = 8) => Math.random().toString(36).slice(2, 2 + n).padEnd(n, '0');
  AJP.sessionId = AJP.sessionId || 's' + AJP.newId(7);

  function scrub(s) {
    let out = String(s);
    for (const [re, rep] of VALUE_PATTERNS) out = out.replace(re, rep);
    return out;
  }

  function redact(v, depth = 0) {
    if (v == null) return v;
    if (typeof v === 'string') return scrub(v.length > MAX_STR ? v.slice(0, MAX_STR) + `…[${v.length} chars]` : v);
    if (typeof v !== 'object') return v;
    if (v instanceof Error) {
      const o = { name: v.name, message: scrub(v.message), stack: scrub(String(v.stack || '').split('\n').slice(0, 6).join('\n')) };
      if (v.code) o.code = v.code;
      return o;
    }
    if (depth > 3) return '[…]';
    if (Array.isArray(v)) return v.slice(0, 40).map((x) => redact(x, depth + 1));
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(val, depth + 1);
    return out;
  }

  function schedule(fast) {
    if (timer && !fast) return;
    clearTimeout(timer);
    timer = setTimeout(flush, fast ? 50 : 700);
  }

  function emit(level, mod, msg, data, extra) {
    const entry = { t: new Date().toISOString(), lvl: level, ctx: AJP.logContext || '?', sid: AJP.sessionId, mod, msg: scrub(msg) };
    if (extra && extra.tid) entry.tid = extra.tid;
    const code = (extra && extra.code) || (data && data.code);
    if (code) entry.code = code;
    if (data !== undefined) entry.data = redact(data);

    if (LEVELS[level] < LEVELS[minLevel]) {
      recorder.push(entry);
      if (recorder.length > RECORDER_SIZE) recorder.shift();
      return;
    }
    const fn = console[level] || console.log;
    try {
      fn.call(console, `[AJP][${entry.ctx}][${mod}]${entry.code ? '[' + entry.code + ']' : ''} ${entry.msg}`, data === undefined ? '' : entry.data);
    } catch (_) {}
    if (level === 'error' && recorder.length) {
      // Flight recorder: keep the details that led up to the error.
      buffer.push(...recorder.map((e) => ({ ...e, pre: true })));
      recorder = [];
    }
    buffer.push(entry);
    if (buffer.length > 300) buffer = buffer.slice(-300);
    schedule(level === 'error');
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (!buffer.length) return;
    const batch = buffer;
    buffer = [];
    try {
      if (sink) await sink(batch);
      else if (AJP.api && AJP.api.runtime) await AJP.api.runtime.sendMessage({ type: 'log', entries: batch });
    } catch (_) {
      /* never let logging break the app */
    }
  }

  function logger(mod, bound = {}) {
    const x = (lvl) => (m, d, extra) => emit(lvl, mod, m, d, { ...bound, ...(extra || {}) });
    return { debug: x('debug'), info: x('info'), warn: x('warn'), error: x('error'), tid: bound.tid || null };
  }

  /*
   * Trace one user action:
   *   const tr = AJP.startTrace('autofill', { mod: 'content' });
   *   AJP.send('x', payload, tr)        // background logs with the same tid
   *   tr.end({ filled: 12 })            // logs "autofill done" with duration (warns if slow)
   *   tr.fail(e)                        // logs "autofill failed" with error code; returns the AppError
   */
  function startTrace(name, { mod = 'trace', slowMs = 3000, tid, data } = {}) {
    const id = tid || 't' + AJP.newId(7);
    const t0 = Date.now();
    const log = logger(mod, { tid: id });
    log.debug(`${name} start`, data);
    let done = false;
    return {
      id,
      name,
      log,
      ms: () => Date.now() - t0,
      end(extra) {
        if (done) return;
        done = true;
        const ms = Date.now() - t0;
        if (ms > slowMs) log.warn(`${name} slow`, { ms, slowMs, ...(extra || {}) });
        else log.info(`${name} done`, { ms, ...(extra || {}) });
        return ms;
      },
      fail(e, extra) {
        done = true;
        const x = AJP.toAppError ? AJP.toAppError(e) : e;
        log.error(`${name} failed`, { ms: Date.now() - t0, code: x.code, error: x.message, details: x.details, ...(extra || {}) }, { code: x.code });
        return x;
      },
    };
  }

  AJP.LOG_LEVELS = Object.keys(LEVELS);
  AJP.setLogSink = (fn) => (sink = fn);
  AJP.getLogSink = () => sink;
  AJP.setLogLevel = (lvl) => {
    if (LEVELS[lvl]) minLevel = lvl;
  };
  AJP.getLogLevel = () => minLevel;
  AJP.flushLogs = flush;
  AJP.redact = redact;
  AJP.scrub = scrub;
  AJP.logger = logger;
  AJP.startTrace = startTrace;
})();
