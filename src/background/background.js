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
  importScripts('../lib/core.js', '../lib/logger.js', '../lib/storage.js', '../lib/skills-dictionary.js', '../lib/matcher.js', '../lib/ai.js', '../lib/tracker.js');
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
    'src/lib/matcher.js', 'src/lib/tracker.js', 'src/content/jd-extractor.js', 'src/content/form-filler.js',
    'src/content/apply-detector.js', 'src/content/panel.js', 'src/content/content.js',
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

  // ---- Application tracking helpers --------------------------------------------
  const MAX_TAB_JOBS = 30;
  const pickJob = (j) => ({ url: j.url, title: j.title, company: j.company, location: j.location, score: j.score, jobKey: j.jobKey });

  async function getTabJob(tabId) {
    if (tabId == null) return null;
    const all = await AJP.store.get('tabJobs');
    return all[tabId] || null;
  }

  function setTabJob(tabId, job) {
    if (tabId == null) return Promise.resolve();
    return serialData(() =>
      AJP.store.update('tabJobs', (all) => {
        all[tabId] = { ...job, at: Date.now() };
        const ids = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
        for (const id of ids.slice(MAX_TAB_JOBS)) delete all[id];
      })
    );
  }

  // Merge, attach snapshot (job description etc.) and the resume used, then save.
  async function saveApplication(app, tabJob) {
    const resume = await AJP.store.activeResume();
    const enriched = { ...app };
    if (!enriched.snapshot && tabJob && tabJob.snapshot && (!app.url || AJP.tracker.jobKey(app.url) === tabJob.jobKey)) {
      enriched.snapshot = tabJob.snapshot;
    }
    if (resume && !enriched.resumeId && (app.status === 'applied' || app.status === 'in progress')) {
      enriched.resumeId = resume.id;
      enriched.resumeName = resume.name;
    }
    let result;
    await serialData(() => AJP.store.update('applications', (list) => void (result = AJP.tracker.upsert(list, enriched))));
    log.info(result.created ? 'Application added' : 'Application updated', {
      status: result.app.status, changed: result.changed, auto: !!app.auto, key: result.app.jobKey,
    });
    return result.app;
  }

  // ---- Follow-up reminders: badge on the toolbar icon -------------------------------
  async function refreshBadge() {
    try {
      const [apps, settings] = await Promise.all([AJP.store.get('applications'), AJP.store.get('settings')]);
      const due = AJP.tracker.dueFollowUps(apps, Date.now(), Number(settings.tracker.followUpDays) || 7);
      await api.action.setBadgeText({ text: due.length ? String(due.length) : '' });
      await api.action.setBadgeBackgroundColor({ color: '#d97706' });
      if (due.length) log.debug('Follow-ups due', { count: due.length });
      return due.length;
    } catch (e) {
      log.warn('Badge update failed', { error: e.message });
      return 0;
    }
  }
  AJP.refreshBadge = refreshBadge;
  const refreshBadgeSoon = AJP.debounce(refreshBadge, 500);
  if (api.alarms) {
    try {
      api.alarms.create('ajp-followups', { periodInMinutes: 60 });
      api.alarms.onAlarm.addListener((a) => a.name === 'ajp-followups' && refreshBadge());
    } catch (e) {
      log.warn('Alarms unavailable', { error: e.message });
    }
  }
  api.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && (c.applications || c.settings)) refreshBadgeSoon();
  });
  refreshBadge();

  // A job opened in a new tab (e.g. LinkedIn "Apply" -> company Workday) keeps its context.
  if (api.tabs.onCreated) {
    api.tabs.onCreated.addListener(async (tab) => {
      if (tab.openerTabId == null) return;
      const parent = await getTabJob(tab.openerTabId);
      if (parent) {
        await setTabJob(tab.id, { ...parent, submittedAt: undefined, appliedAt: undefined });
        log.debug('Job context passed to new tab', { from: tab.openerTabId, to: tab.id });
      }
    });
  }
  if (api.tabs.onRemoved) {
    api.tabs.onRemoved.addListener((tabId) => serialData(() => AJP.store.update('tabJobs', (all) => void delete all[tabId])));
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

    // Save or update an application (dedupes by job identity, see tracker.jobKey).
    async recordApplication({ app }, sender) {
      const tabId = sender && sender.tab && sender.tab.id;
      const tj = tabId != null ? await getTabJob(tabId) : null;
      return { app: await saveApplication(app, tj) };
    },

    async undoStatus({ id }) {
      let res = null;
      await serialData(() => AJP.store.update('applications', (list) => void (res = AJP.tracker.undoStatus(list, id))));
      log.info('Application status undone', { id, removed: !!(res && res.removed), status: res && !res.removed ? res.app.status : null });
      return res || { app: null, removed: false };
    },

    // Content (top frame) tells us which job this tab is looking at.
    async setTabJob({ job }, sender) {
      if (!sender.tab || !job) return {};
      await setTabJob(sender.tab.id, { ...job, jobKey: AJP.tracker.jobKey(job.url) });
      return {};
    },

    // Apply detection signals from any frame: 'submit' | 'confirm' | 'check'.
    async applicationSignal({ signal, how, url, title, host }, sender) {
      const tabId = sender.tab && sender.tab.id;
      const settings = await AJP.store.get('settings');
      if (!settings.tracker.autoDetect) return { ignored: 'auto-detect off' };
      const tj = await getTabJob(tabId);
      const now = Date.now();

      if (signal === 'submit') {
        await setTabJob(tabId, { ...(tj || { url, title, jobKey: AJP.tracker.jobKey(url) }), submittedAt: now });
        log.info('Submit seen', { host, hasJob: !!tj });
        return {};
      }
      if (signal === 'check') return { applied: !!(tj && tj.appliedAt && tj.appliedAt >= (tj.submittedAt || 0)), job: tj };

      if (signal === 'confirm') {
        const recentSubmit = !!(tj && tj.submittedAt && now - tj.submittedAt < 30 * 60000);
        if (!tj && !AJP.tracker.isJobHost(host)) {
          log.info('Confirmation ignored (no job context, unknown site)', { host });
          return { ignored: 'no context' };
        }
        const job = tj || { url, title, jobKey: AJP.tracker.jobKey(url) };
        const app = await saveApplication({ ...pickJob(job), status: 'applied', auto: true, detectedBy: how, host }, job);
        await setTabJob(tabId, { ...job, appliedAt: now });
        log.info('Application auto-detected as applied', { how, host, confidence: recentSubmit ? 'high' : 'medium', company: app.company });
        api.tabs.sendMessage(tabId, { type: 'appliedDetected', app }, { frameId: 0 }).catch(() => {});
        return { app };
      }
      return {};
    },

    // A frame saw Submit but no confirmation followed: ask the user in the top frame's panel.
    async askApplied({ job }, sender) {
      if (sender.tab) api.tabs.sendMessage(sender.tab.id, { type: 'askApplied', job }, { frameId: 0 }).catch(() => {});
      return {};
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
