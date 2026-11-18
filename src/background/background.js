/*
 * background.js — the hub.
 *  - Chrome/Edge: runs as an MV3 service worker and loads libs via importScripts.
 *  - Firefox/Safari: runs as a background script; libs are listed in manifest "scripts".
 *
 * Owns: AI calls (keys stay here), log persistence, learned answers,
 * application history, injecting the content scripts on demand.
 */
/* global importScripts */
if (typeof importScripts === 'function' && !(globalThis.AJP && globalThis.AJP.ai)) {
  importScripts('../lib/core.js', '../lib/logger.js', '../lib/storage.js', '../lib/skills-dictionary.js', '../lib/matcher.js', '../lib/ai.js');
}

(function () {
  'use strict';
  const AJP = globalThis.AJP;
  const api = AJP.api;
  AJP.logContext = 'bg';
  const log = AJP.logger('background');

  const MAX_LOGS = 3000;
  const CONTENT_FILES = [
    'src/lib/core.js', 'src/lib/logger.js', 'src/lib/storage.js', 'src/lib/skills-dictionary.js',
    'src/lib/matcher.js', 'src/content/jd-extractor.js', 'src/content/form-filler.js',
    'src/content/panel.js', 'src/content/content.js',
  ];

  // ---- Logging: background is the single writer of the `logs` key ---------
  const serialLogs = AJP.serial();
  AJP.setLogSink((entries) =>
    serialLogs(async () => {
      const cur = await AJP.store.get('logs');
      const next = cur.concat(entries);
      await AJP.store.set('logs', next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next);
    })
  );
  AJP.store.get('settings').then((s) => AJP.setLogLevel(s.logLevel));
  api.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings && c.settings.newValue) AJP.setLogLevel(c.settings.newValue.logLevel || 'info');
  });

  self.addEventListener('error', (e) => log.error('Uncaught error', { message: e.message, file: e.filename, line: e.lineno }));
  self.addEventListener('unhandledrejection', (e) => log.error('Unhandled rejection', { reason: String(e.reason && (e.reason.stack || e.reason)) }));

  const serialData = AJP.serial();

  // ---- Helpers --------------------------------------------------------------
  async function ensureInjected(tabId) {
    try {
      const [probe] = await api.scripting.executeScript({ target: { tabId }, func: () => !!window.__AJP_CONTENT__ });
      if (probe && probe.result) return;
    } catch (e) {
      throw new Error('This page cannot be accessed by extensions (browser pages, stores, PDFs). ' + e.message);
    }
    await api.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
    log.info('Injected content scripts', { tabId });
  }

  async function aiContext() {
    const [profile, resume] = await Promise.all([AJP.store.get('profile'), AJP.store.activeResume()]);
    return { profile, resumeText: (resume && resume.text) || '', resume };
  }

  // ---- Message handlers ------------------------------------------------------
  const handlers = {
    async log({ entries }) {
      if (Array.isArray(entries) && entries.length) {
        await serialLogs(async () => {
          const cur = await AJP.store.get('logs');
          const next = cur.concat(entries.slice(-200));
          await AJP.store.set('logs', next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next);
        });
      }
      return {};
    },

    async 'ai.extractSkills'({ jd }) {
      return { result: await AJP.ai.tasks.extractSkills({ jd }) };
    },

    async 'ai.tailorResume'({ jd, missing, job }) {
      const ctx = await aiContext();
      if (!ctx.resumeText) throw new Error('No resume text found. Add your resume in Admin → Resumes first.');
      const out = await AJP.ai.tasks.tailorResume({ jd, missing, job, ...ctx });
      const [resumeMd, gaps = ''] = out.split(/^-{3}GAPS-{3}\s*$/m);
      const item = {
        id: AJP.uid('res'),
        name: `Tailored — ${(job && job.company) || 'Company'} — ${(job && job.title) || 'Role'}`.slice(0, 120),
        text: resumeMd.trim(),
        gaps: gaps.trim(),
        basedOn: ctx.resume && ctx.resume.id,
        job: job || null,
        createdAt: new Date().toISOString(),
      };
      await serialData(() => AJP.store.update('resumes', (r) => void r.items.unshift(item)));
      log.info('Saved tailored resume', { id: item.id, chars: item.text.length });
      return { resume: item };
    },

    async 'ai.draftAnswer'({ question, jd, job, maxWords }) {
      const ctx = await aiContext();
      return { text: await AJP.ai.tasks.draftAnswer({ question, jd, job, maxWords, ...ctx }) };
    },

    async 'ai.test'() {
      return { text: await AJP.ai.tasks.test() };
    },

    async learnAnswer({ label, value, host, kind }) {
      const settings = await AJP.store.get('settings');
      if (!settings.learnAnswers) return {};
      const key = AJP.normKey(label);
      if (!key || key.length < 2 || value == null || String(value).trim() === '') return {};
      await serialData(() =>
        AJP.store.update('answers', (a) => {
          const cur = a[key] || { label: String(label).slice(0, 200), count: 0, hosts: [] };
          cur.value = String(value).slice(0, 5000);
          cur.kind = kind || cur.kind || 'text';
          cur.count += 1;
          cur.lastUsed = new Date().toISOString();
          if (host && !cur.hosts.includes(host)) cur.hosts = cur.hosts.concat(host).slice(-10);
          a[key] = cur;
        })
      );
      log.debug('Learned answer', { key, host });
      return {};
    },

    async recordApplication({ app }) {
      let saved;
      await serialData(() =>
        AJP.store.update('applications', (list) => {
          const i = list.findIndex((x) => x.url === app.url);
          saved = { ...(i >= 0 ? list[i] : { id: AJP.uid('app'), date: new Date().toISOString() }), ...app, updatedAt: new Date().toISOString() };
          if (i >= 0) list[i] = saved;
          else list.unshift(saved);
          return list.slice(0, 2000);
        })
      );
      log.info('Application recorded', { company: saved.company, status: saved.status });
      return { app: saved };
    },

    // From popup or context menu: make sure scripts are present, then open the panel.
    async analyzeTab({ tabId, jdText }) {
      await ensureInjected(tabId);
      await api.tabs.sendMessage(tabId, { type: 'openPanel', jdText: jdText || null }, { frameId: 0 });
      return {};
    },

    // Fill every frame of the tab (Greenhouse/Lever forms are often in iframes).
    async autofillTab({ tabId }, sender) {
      const id = tabId || (sender.tab && sender.tab.id);
      if (!id) throw new Error('No tab');
      await ensureInjected(id);
      await api.tabs.sendMessage(id, { type: 'doAutofill' }); // all frames
      return {};
    },

    // A frame finished filling -> forward the report to the top frame's panel.
    async autofillReport({ report }, sender) {
      if (sender.tab) {
        api.tabs.sendMessage(sender.tab.id, { type: 'autofillReport', report, frameId: sender.frameId }, { frameId: 0 }).catch(() => {});
      }
      return {};
    },

    async fillQuestion({ ajpId, text }, sender) {
      if (sender.tab) await api.tabs.sendMessage(sender.tab.id, { type: 'fillQuestion', ajpId, text });
      return {};
    },

    async openAdmin({ hash }) {
      const url = api.runtime.getURL('src/admin/admin.html') + (hash ? '#' + hash : '');
      await api.tabs.create({ url });
      return {};
    },
  };

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const h = msg && handlers[msg.type];
    if (!h) return false;
    const t0 = Date.now();
    Promise.resolve()
      .then(() => h(msg, sender))
      .then((r) => {
        if (msg.type !== 'log') log.debug(`msg ${msg.type} ok (${Date.now() - t0}ms)`);
        sendResponse({ ok: true, ...(r || {}) });
      })
      .catch((e) => {
        log.error(`msg ${msg.type} failed`, { error: e.message });
        sendResponse({ ok: false, error: e.message });
      });
    return true; // async response
  });

  // ---- Context menu: analyze any selected text as a JD ------------------------
  const MENU_ID = 'ajp-analyze-selection';
  api.runtime.onInstalled.addListener((details) => {
    log.info('Installed/updated', { reason: details.reason, version: AJP.VERSION });
    Promise.resolve()
      .then(() => api.contextMenus.removeAll())
      .then(() => api.contextMenus.create({ id: MENU_ID, title: 'Apply Job: analyze selection as job description', contexts: ['selection'] }))
      .catch((e) => log.warn('Context menu unavailable', { error: e.message }));
    if (details.reason === 'install') handlers.openAdmin({ hash: 'profile' });
  });

  if (api.contextMenus && api.contextMenus.onClicked) {
    api.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId !== MENU_ID || !tab) return;
      handlers.analyzeTab({ tabId: tab.id, jdText: info.selectionText }).catch((e) => log.error('Analyze selection failed', { error: e.message }));
    });
  }

  log.info('Background ready', { version: AJP.VERSION });
})();
