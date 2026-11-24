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

  const DB_MODE = (() => {
    try {
      return new URLSearchParams(window.top.location.search).get('db') === '1';
    } catch (_) {
      return false;
    }
  })();
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

  const tabCreated = [];
  const tabRemoved = [];
  const alarmListeners = [];
  const mock = {
    __data: data,
    __badge: { text: '', color: '' },
    __alarms: {},
    async __fireTabCreated(tab) {
      await Promise.all(tabCreated.map((fn) => fn(tab)));
    },
    async __fireTabRemoved(tabId) {
      await Promise.all(tabRemoved.map((fn) => fn(tabId)));
    },
    async __fireAlarm(name) {
      await Promise.all(alarmListeners.map((fn) => fn({ name })));
    },
    __sent: [],
    __tabMsgs: [],
    __created: [],
    __injected: [],
    __tabId: 1, // the tab id the page pretends to be in (tests switch it to simulate new tabs)
    async __reset() {
      mock.__tabId = 1;
      await local.clear();
      if (DB_MODE && globalThis.AJP && globalThis.AJP.store && globalThis.AJP.store._clearDb) await globalThis.AJP.store._clearDb();
      mock.__sent.length = 0;
      mock.__tabMsgs.length = 0;
      mock.__created.length = 0;
      mock.__injected.length = 0;
      mock.__notes.length = 0;
      mock.__granted.clear();
      mock.__refuse = false;
      mock.__senderUrl = '';
    },
    runtime: {
      id: 'test-extension',
      // ?db=1: every test page counts as an extension page, so the whole suite also runs on the extension database.
      getURL: (p) => (DB_MODE ? location.origin + '/' : 'moz-extension://test/') + p,
      async sendMessage(msg) {
        mock.__sent.push(clone(msg));
        // __senderUrl: a job-site page's address, to act as a content script (unset: an extension page)
        return dispatch(true, msg, { tab: { id: mock.__tabId, url: location.href, title: document.title }, frameId: 0, ...(mock.__senderUrl ? { url: mock.__senderUrl } : {}) });
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
      onCreated: { addListener: (fn) => tabCreated.push(fn) },
      onRemoved: { addListener: (fn) => tabRemoved.push(fn) },
    },
    alarms: {
      create: (name, info) => (mock.__alarms[name] = info),
      onAlarm: { addListener: (fn) => alarmListeners.push(fn) },
    },
    action: {
      async setBadgeText({ text }) {
        mock.__badge.text = text;
      },
      async setBadgeBackgroundColor({ color }) {
        mock.__badge.color = color;
      },
    },
    scripting: {
      async executeScript({ func, files }) {
        mock.__injected.push(files || 'func');
        return [{ result: func ? func() : undefined }];
      },
      __registered: [],
      async getRegisteredContentScripts({ ids = [] } = {}) {
        return mock.scripting.__registered.filter((x) => ids.includes(x.id));
      },
      async registerContentScripts(list) {
        mock.scripting.__registered.push(...list);
      },
      async unregisterContentScripts({ ids = [] } = {}) {
        mock.scripting.__registered = mock.scripting.__registered.filter((x) => !ids.includes(x.id));
      },
    },
    contextMenus: { removeAll: async () => {}, create() {}, onClicked: { addListener() {} } },
    // Optional host permissions: tests grant / refuse with __granted / __refuse.
    __granted: new Set(),
    __refuse: false,
    permissions: {
      async contains({ origins = [] }) {
        return origins.every((o) => mock.__granted.has(o));
      },
      async request({ origins = [] }) {
        if (mock.__refuse) return false;
        origins.forEach((o) => mock.__granted.add(o));
        return true;
      },
    },
    __notes: [],
    notifications: {
      async create(id, opts) {
        mock.__notes.push({ id, ...clone(opts) });
        return id;
      },
      async clear() {
        return true;
      },
      onClicked: { addListener: (fn) => (mock.__noteClick = fn) },
    },
  };

  globalThis.browser = mock;
})();
