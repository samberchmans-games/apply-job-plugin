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
  importScripts('../lib/core.js', '../lib/logger.js', '../lib/errors.js', '../lib/storage.js', '../lib/skills-dictionary.js', '../lib/matcher.js', '../lib/ai.js', '../lib/tracker.js', '../lib/resume-engine.js');
}

(function () {
  'use strict';
  const AJP = globalThis.AJP;
  const api = AJP.api;
  AJP.logContext = 'bg';
  const log = AJP.logger('background');

  const MAX_LOGS = 3000;
  const CONTENT_FILES = [
    'src/lib/core.js', 'src/lib/logger.js', 'src/lib/errors.js', 'src/lib/storage.js', 'src/lib/skills-dictionary.js',
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
      throw AJP.err('PAGE_NO_ACCESS', { original: e.message }, e);
    }
    await api.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
    log.info('Injected content scripts', { tabId });
  }

  async function aiContext() {
    const [profile, resume] = await Promise.all([AJP.store.get('profile'), AJP.store.activeResume()]);
    return { profile, resumeText: (resume && resume.text) || '', resume };
  }

  // Detects whether the resume changed between drafting and applying (line ids would shift).
  function hashText(t) {
    let h = 5381;
    const s = String(t || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + ':' + s.length;
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

    async 'ai.extractSkills'({ jd }, sender, { tid }) {
      return { result: await AJP.ai.tasks.extractSkills({ jd, tid }) };
    },

    // Resume enhancement v2 — see src/lib/resume-engine.js for the rules.
    async 'resume.enhance'({ jd, job }, sender, { tid, log: mlog }) {
      const E = AJP.resumeEngine;
      const ctx = await aiContext();
      if (!ctx.resumeText) throw AJP.err('NO_RESUME');
      const doc = E.parse(ctx.resumeText);
      if (!doc.bullets.length) throw AJP.err('RESUME_STRUCTURE', { lines: doc.lines.length });

      // 1) requirements + evidence (AI) → 2) verify quotes (code)
      const analysis = await AJP.ai.tasks.analyzeForResume({ jd, resumeText: ctx.resumeText, tid });
      const { requirements, droppedQuotes } = E.verifyRequirements(analysis.requirements, ctx.resumeText);
      const ats = (Array.isArray(analysis.ats_keywords) ? analysis.ats_keywords : []).map(String).slice(0, 20);
      const skills = (ctx.profile.skills || []).map((x) => x.name || x);

      // 3) targeted edits (AI) → 4) validate every edit (code)
      const proposal = await AJP.ai.tasks.proposeResumeEdits({ doc, requirements, atsKeywords: ats, skills, job, tid });
      const vctx = { doc, resumeText: ctx.resumeText, jdText: jd, allowedSkills: E.allowedSkills(doc, ctx.resumeText, ctx.profile.skills) };
      const seen = new Set();
      const edits = (Array.isArray(proposal.edits) ? proposal.edits : []).slice(0, 20).map((e, i) => {
        const target = String(e.target || '');
        const v = E.validateEdit({ target, after: e.after, evidence: e.evidence }, vctx);
        if (seen.has(target)) {
          v.ok = false;
          v.violations.push({ code: 'DUPLICATE', message: 'A second edit for the same line', detail: target });
        }
        seen.add(target);
        const b = doc.bullets.find((x) => x.id === target);
        return {
          id: 'e' + (i + 1), target, kind: v.kind, role: b ? b.role || b.section : '', before: v.before, after: v.after,
          reason: String(e.reason || '').slice(0, 300), requirementIds: (Array.isArray(e.requirement_ids) ? e.requirement_ids : []).map(String).slice(0, 6),
          evidence: (Array.isArray(e.evidence) ? e.evidence : []).map(String).slice(0, 3),
          ok: v.ok, violations: v.violations, warnings: v.warnings, needsMetric: v.needsMetric, accepted: v.ok,
        };
      });
      const valid = edits.filter((e) => e.ok);
      const advice = new Map((Array.isArray(proposal.gap_advice) ? proposal.gap_advice : []).map((g) => [String(g.requirement_id), String(g.advice || '').slice(0, 400)]));
      const gaps = requirements.filter((r) => r.match === 'none').map((r) => ({ requirementId: r.id, text: r.text, priority: r.priority, advice: advice.get(r.id) || '' }));
      const atsBefore = E.keywordCoverage(ctx.resumeText, ats);
      const atsAfter = E.keywordCoverage(E.assemble(ctx.resumeText, valid), ats);
      const count = (m) => requirements.filter((r) => r.match === m).length;

      const draft = {
        id: AJP.uid('enh'),
        createdAt: new Date().toISOString(),
        job: job || null,
        jd: String(jd || '').slice(0, 12000),
        resumeId: ctx.resume.id,
        resumeName: ctx.resume.name,
        baseHash: hashText(ctx.resumeText),
        seniority: String(analysis.seniority || '').slice(0, 40),
        roleSummary: String(analysis.summary || '').slice(0, 300),
        requirements,
        atsKeywords: ats,
        edits,
        gaps,
        coverage: { evidence: E.evidenceCoverage(requirements), atsBefore: atsBefore && atsBefore.pct, atsAfter: atsAfter && atsAfter.pct, atsMissingAfter: atsAfter ? atsAfter.missing : [] },
        stats: { requirements: requirements.length, strong: count('strong'), partial: count('partial'), none: count('none'), edits: edits.length, blocked: edits.length - valid.length, needsMetric: valid.filter((e) => e.needsMetric).length, droppedQuotes },
      };
      await serialData(() => AJP.store.update('enhancements', (list) => [draft, ...list].slice(0, 20)));
      const blockedBy = {};
      for (const e of edits) for (const v of e.violations) blockedBy[v.code] = (blockedBy[v.code] || 0) + 1;
      mlog.info('Resume enhancement drafted', { ...draft.stats, atsBefore: draft.coverage.atsBefore, atsAfter: draft.coverage.atsAfter, blockedBy });
      return { draft };
    },

    // The user reviewed a draft: build the new resume from the original + accepted, re-validated edits.
    async 'resume.applyEnhancement'({ id, decisions = [], makeActive = false }, sender, { log: mlog }) {
      const E = AJP.resumeEngine;
      const drafts = await AJP.store.get('enhancements');
      const d = drafts.find((x) => x.id === id);
      if (!d) throw AJP.err('ENHANCEMENT_MISSING', { id });
      const resumes = await AJP.store.get('resumes');
      const base = resumes.items.find((r) => r.id === d.resumeId);
      if (!base) throw AJP.err('ENHANCEMENT_MISSING', { reason: 'original resume deleted' });
      if (hashText(base.text || '') !== d.baseHash) throw AJP.err('RESUME_CHANGED');

      const profile = await AJP.store.get('profile');
      const doc = E.parse(base.text);
      const vctx = { doc, resumeText: base.text, jdText: d.jd, allowedSkills: E.allowedSkills(doc, base.text, profile.skills) };
      const chosen = [];
      const skipped = [];
      for (const e of d.edits) {
        const dec = decisions.find((x) => x.editId === e.id);
        const accepted = dec ? !!dec.accepted : e.accepted;
        if (!accepted) continue;
        const userText = dec && dec.after != null && dec.after !== e.after ? dec.after : null;
        // Text the USER typed is their own claim (e.g. their real result); AI text must pass every rule.
        const v = E.validateEdit({ target: e.target, after: userText != null ? userText : e.after, evidence: e.evidence, userEdited: userText != null }, vctx);
        if (!v.ok) {
          skipped.push({ editId: e.id, codes: v.violations.map((x) => x.code) });
          continue;
        }
        chosen.push({ target: e.target, after: e.kind === 'skills' ? v.after.split(/\s*,\s*/) : v.after });
      }
      const text = E.assemble(base.text, chosen);
      const integrity = E.verifyIntegrity(base.text, text);
      if (!integrity.ok) throw AJP.err('INTERNAL', { reason: 'protected resume lines changed', missing: integrity.missing.length });

      const item = {
        id: AJP.uid('res'),
        name: `Tailored — ${(d.job && d.job.company) || 'Company'} — ${(d.job && d.job.title) || 'Role'}`.slice(0, 120),
        text,
        gaps: d.gaps.map((g) => `- ${g.text} (${g.priority})${g.advice ? ': ' + g.advice : ''}`).join('\n'),
        basedOn: base.id,
        enhancementId: d.id,
        job: d.job,
        coverage: d.coverage,
        createdAt: new Date().toISOString(),
      };
      await serialData(() =>
        AJP.store.update('resumes', (r) => {
          r.items.unshift(item);
          if (makeActive) r.activeId = item.id;
        })
      );
      await serialData(() => AJP.store.update('enhancements', (list) => void list.forEach((x) => x.id === id && (x.appliedResumeId = item.id))));
      mlog.info('Tailored resume created', { edits: chosen.length, skipped: skipped.length, makeActive: !!makeActive });
      return { resume: item, applied: chosen.length, skipped };
    },

    async 'ai.draftAnswer'({ question, jd, job, maxWords }, sender, { tid }) {
      const ctx = await aiContext();
      return { text: await AJP.ai.tasks.draftAnswer({ question, jd, job, maxWords, tid, ...ctx }) };
    },

    async 'ai.test'(msg, sender, { tid }) {
      return { text: await AJP.ai.tasks.test({ tid }) };
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
    async autofillTab({ tabId }, sender, { tid }) {
      const id = tabId || (sender.tab && sender.tab.id);
      if (!id) throw AJP.err('NO_TAB');
      await ensureInjected(id);
      await api.tabs.sendMessage(id, { type: 'doAutofill', tid }); // all frames, same trace id
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

    // Health check used by issue reports.
    async ping() {
      return { version: AJP.VERSION, sessionId: AJP.sessionId, uptimeSec: Math.round((Date.now() - bootAt) / 1000), logLevel: AJP.getLogLevel() };
    },

    async openAdmin({ hash }) {
      const url = api.runtime.getURL('src/admin/admin.html') + (hash ? '#' + hash : '');
      await api.tabs.create({ url });
      return {};
    },
  };

  const bootAt = Date.now();
  const hostOf = (url) => {
    try {
      return new URL(url).hostname;
    } catch (_) {
      return '';
    }
  };

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const h = msg && handlers[msg.type];
    if (!h) return false;
    const t0 = Date.now();
    // One trace id per user action: reuse the caller's, or start one here.
    const tid = msg._tid || 't' + AJP.newId(7);
    const mlog = AJP.logger('background', { tid });
    const from = { from: sender.tab ? 'page' : 'extension', host: hostOf(sender.url || (sender.tab && sender.tab.url)), frame: sender.frameId };
    Promise.resolve()
      .then(() => h(msg, sender, { tid, log: mlog }))
      .then((r) => {
        const ms = Date.now() - t0;
        if (msg.type !== 'log') {
          if (ms > 5000) mlog.warn(`msg ${msg.type} slow`, { ms, ...from });
          else mlog.debug(`msg ${msg.type} ok`, { ms, ...from });
        }
        sendResponse({ ok: true, tid, ...(r || {}) });
      })
      .catch((e) => {
        const x = AJP.toAppError(e);
        mlog.error(`msg ${msg.type} failed`, { ms: Date.now() - t0, code: x.code, error: x.message, details: x.details, ...from }, { code: x.code });
        sendResponse({ ok: false, tid, error: x.message, hint: x.hint, code: x.code });
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
