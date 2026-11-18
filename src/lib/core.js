/*
 * core.js — shared namespace + tiny helpers.
 * Loaded first in every context (background, content, admin, popup).
 * Every lib file is an IIFE that attaches to globalThis.AJP so files can be
 * re-injected safely and work with no build step in all browsers.
 */
(function () {
  'use strict';
  const g = globalThis;
  const AJP = (g.AJP = g.AJP || {});

  AJP.VERSION = '0.1.0';

  // Firefox/Safari expose `browser` (promise based). Chrome/Edge MV3 `chrome.*` also returns promises.
  AJP.api = g.browser && g.browser.runtime ? g.browser : g.chrome;

  AJP.uid = (prefix = 'id') =>
    prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  AJP.norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[\s ]+/g, ' ').trim();

  // Stable key for a question/label, used by the "learned answers" memory.
  AJP.normKey = (s) =>
    AJP.norm(s).replace(/[*:?()]/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);

  AJP.clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

  AJP.isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  // Deep merge `src` over `base` (objects only; arrays are replaced).
  AJP.deepMerge = (base, src) => {
    const out = AJP.clone(base) || {};
    if (!AJP.isPlainObject(src)) return out;
    for (const [k, v] of Object.entries(src)) {
      out[k] = AJP.isPlainObject(v) && AJP.isPlainObject(out[k]) ? AJP.deepMerge(out[k], v) : v;
    }
    return out;
  };

  // Get/set by dotted path, e.g. "personal.firstName".
  AJP.getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  AJP.setPath = (obj, path, value) => {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = AJP.isPlainObject(o[keys[i]]) ? o[keys[i]] : {};
    o[keys[keys.length - 1]] = value;
  };

  // Send a message to the background; never throws (returns {ok:false, error, code, hint}).
  // Pass a trace (from AJP.startTrace) or trace id so background logs share the same id.
  AJP.send = async (type, payload = {}, trace) => {
    const msg = { type, ...payload };
    if (trace) msg._tid = typeof trace === 'string' ? trace : trace.id;
    try {
      const res = await AJP.api.runtime.sendMessage(msg);
      return res || { ok: false, error: 'No response from the extension background.', code: 'AJP-INTERNAL' };
    } catch (e) {
      // e.g. "Extension context invalidated" after the extension was reloaded/updated.
      return { ok: false, error: String((e && e.message) || e), code: 'AJP-INTERNAL', hint: 'Reload this page.' };
    }
  };

  AJP.debounce = (fn, ms) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  // Run async tasks one at a time (avoids read-modify-write races on storage).
  AJP.serial = () => {
    let chain = Promise.resolve();
    return (task) => (chain = chain.then(task, task));
  };
})();
