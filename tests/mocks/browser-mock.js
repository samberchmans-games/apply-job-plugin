/*
 * browser-mock.js — an in-memory fake of the WebExtension APIs the extension uses.
 * Load it BEFORE src/lib/core.js; core picks up globalThis.browser.
 *
 * Message routing mirrors the real browser:
 *   runtime.sendMessage  -> listeners registered by the background (logContext 'bg')
 *   tabs.sendMessage     -> listeners registered by content scripts
 *
 * Inspect from tests:  browser.__data, __sent, __tabMsgs, __created, __injected; reset with __reset().
 */
(function () {
  'use strict';
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const data = {};
  const changeListeners = [];
  const msgListeners = []; // { ctx, fn }

  function fire(changes) {
    for (const l of changeListeners) {
      try {
        l(changes, 'local');
      } catch (_) {}
    }
  }

  const local = {
    async get(keys) {
      if (keys == null) return clone(data);
      const ks = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of ks) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    async set(obj) {
      const ch = {};
      for (const [k, v] of Object.entries(obj)) {
        ch[k] = { oldValue: clone(data[k]), newValue: clone(v) };
        data[k] = clone(v);
      }
      fire(ch);
    },
    async remove(keys) {
      const ch = {};
      for (const k of [].concat(keys)) {
        ch[k] = { oldValue: clone(data[k]) };
        delete data[k];
      }
      fire(ch);
    },
    async clear() {
      const ch = {};
      for (const k of Object.keys(data)) {
        ch[k] = { oldValue: clone(data[k]) };
        delete data[k];
      }
      fire(ch);
    },
  };

  function dispatch(toBackground, msg, sender) {
    return new Promise((resolve) => {
      let isAsync = false;
      let done = false;
      const respond = (r) => {
        if (!done) {
          done = true;
          resolve(clone(r));
        }
      };
      for (const l of msgListeners) {
        if ((l.ctx === 'bg') !== toBackground) continue;
        const ret = l.fn(clone(msg), sender, respond);
        if (ret === true) isAsync = true;
      }
      if (!isAsync) respond(undefined);
    });
  }

  const mock = {
    __data: data,
    __sent: [],
    __tabMsgs: [],
    __created: [],
    __injected: [],
    async __reset() {
      await local.clear();
      mock.__sent.length = 0;
      mock.__tabMsgs.length = 0;
      mock.__created.length = 0;
      mock.__injected.length = 0;
    },
    runtime: {
      id: 'test-extension',
      getURL: (p) => 'moz-extension://test/' + p,
      async sendMessage(msg) {
        mock.__sent.push(clone(msg));
        return dispatch(true, msg, { tab: { id: 1, url: location.href }, frameId: 0 });
      },
      onMessage: {
        addListener(fn) {
          msgListeners.push({ ctx: (globalThis.AJP && globalThis.AJP.logContext) || '?', fn });
        },
      },
      onInstalled: { addListener: (fn) => (mock.__onInstalled = fn) },
    },
    storage: { local, onChanged: { addListener: (fn) => changeListeners.push(fn) } },
    tabs: {
      async sendMessage(tabId, msg, opts) {
        mock.__tabMsgs.push({ tabId, msg: clone(msg), opts: opts || null });
        return dispatch(false, msg, { id: 'background' });
      },
      async create(o) {
        mock.__created.push(clone(o));
        return { id: 2 };
      },
      async query() {
        return [{ id: 1 }];
      },
    },
    scripting: {
      async executeScript({ func, files }) {
        mock.__injected.push(files || 'func');
        return [{ result: func ? func() : undefined }];
      },
    },
    contextMenus: { removeAll: async () => {}, create() {}, onClicked: { addListener() {} } },
  };

  globalThis.browser = mock;
})();
