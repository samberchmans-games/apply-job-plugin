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
  importScripts('../lib/core.js', '../lib/logger.js', '../lib/errors.js', '../lib/storage.js', '../lib/skills-dictionary.js', '../lib/matcher.js', '../lib/experience.js', '../lib/ai-wire.js', '../lib/ai.js', '../lib/tracker.js', '../lib/resume-engine.js', '../lib/ai-check.js', '../lib/tracks.js', '../lib/issue-report.js', '../lib/pdf-writer.js', '../lib/radar-core.js', '../lib/radar-detect.js', '../lib/radar-boards.js', '../lib/radar-scan.js', '../lib/radar-directory.js');
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
    'src/lib/matcher.js', 'src/lib/experience.js', 'src/lib/tracker.js', 'src/lib/tracks.js', 'src/lib/pdf-writer.js', 'src/content/jd-extractor.js', 'src/lib/field-rules.js', 'src/content/form-filler.js', 'src/content/workday.js', 'src/content/ats.js', 'src/content/entries.js',
    'src/content/apply-detector.js', 'src/lib/radar-detect.js', 'src/content/panel.js', 'src/content/content.js',
  ];

  // ---- Logging: background is the single writer of the `logs` key ---------
  const serialLogs = AJP.serial();
  AJP.setLogSink((entries) => {
    watchErrors(entries, null);
    return serialLogs(async () => {
      const cur = await AJP.store.get('logs');
      const next = cur.concat(entries);
      await AJP.store.set('logs', next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next);
    });
  });

  // ---- Crash prompt: notice failures the user may not see, and ASK to report them (docs/ISSUE-REPORTING.md §4) ----
  const serialPrompt = AJP.serial();
  function watchErrors(entries, tabId) {
    const errs = (entries || []).filter((e) => e && e.lvl === 'error' && e.code && !e.pre);
    if (!errs.length) return Promise.resolve();
    return serialPrompt(async () => {
      const settings = await AJP.store.get('settings');
      let st = await AJP.store.get('promptState');
      let fire = null;
      for (const e of errs) {
        const r = AJP.issues.shouldPrompt(st, e, { enabled: settings.support.crashPrompt });
        st = r.state;
        if (r.prompt) fire = e;
      }
      if (fire) st.pending = { code: fire.code, msg: String(fire.msg || '').slice(0, 200), at: Date.now(), tid: fire.tid || null };
      await AJP.store.set('promptState', st);
      if (!fire) return;
      AJP.logger('background').info('Crash prompt raised', { code: fire.code });
      refreshBadgeSoon();
      if (tabId != null) api.tabs.sendMessage(tabId, { type: 'crashPrompt', code: fire.code, msg: st.pending.msg }, { frameId: 0 }).catch(() => {});
    });
  }
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

  // Profile + resume as seen by one career track (core + track skills, the track's own resume).
  async function aiContext(trackId) {
    const [raw, resumes] = await Promise.all([AJP.store.get('profile'), AJP.store.get('resumes')]);
    const track = AJP.tracks.list(raw).find((t) => t.id === trackId) || AJP.tracks.list(raw)[0];
    const resume = AJP.tracks.resumeFor(track, resumes);
    return { profile: AJP.tracks.effectiveProfile(raw, track), resumeText: (resume && resume.text) || '', resume, track };
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
  const pickJob = (j) => ({ url: j.url, title: j.title, company: j.company, location: j.location, score: j.score, jobKey: j.jobKey, trackId: j.trackId, trackName: j.trackName });

  async function getTabJob(tabId) {
    if (tabId == null) return null;
    const all = await AJP.store.get('tabJobs');
    return all[tabId] || null;
  }
  // An application is held in its tab for 1 hour after the last activity (each page of the site's steps counts).
  // Past that it is dropped and the user is told; once applied it is offboarded (only an "applied" marker stays,
  // so the "Did you submit?" question isn't asked twice). Applications keep the record.
  const HOLD_MS = 60 * 60 * 1000;
  async function offboardJob(jobKey) {
    if (!jobKey) return;
    await serialData(() =>
      AJP.store.update('tabJobs', (all) => {
        for (const [id, j] of Object.entries(all)) if (j && j.jobKey === jobKey && id !== '__pending') all[id] = { jobKey, appliedAt: j.appliedAt || Date.now(), at: Date.now() };
        if (all.__pending && all.__pending.job && all.__pending.job.jobKey === jobKey) delete all.__pending;
      })
    );
    log.info('Applied: job tracking offboarded from tab memory');
  }
  // "Apply" clicked on a job page: a tab opened in the next 20 s without an opener link still gets the job.
  const PENDING_MS = 20 * 1000;

  function setTabJob(tabId, job) {
    if (tabId == null) return Promise.resolve();
    return serialData(() =>
      AJP.store.update('tabJobs', (all) => {
        all[tabId] = { ...job, at: Date.now() };
        const ids = Object.keys(all).filter((k) => k !== '__pending').sort((a, b) => all[b].at - all[a].at);
        for (const id of ids.slice(MAX_TAB_JOBS)) delete all[id];
      })
    );
  }

  // Merge, attach snapshot (job description etc.) and the resume used, then save.
  async function saveApplication(app, tabJob) {
    const [profileRaw, resumes] = await Promise.all([AJP.store.get('profile'), AJP.store.get('resumes')]);
    const track = app.trackId ? AJP.tracks.list(profileRaw).find((t) => t.id === app.trackId) : null;
    const resume = AJP.tracks.resumeFor(track, resumes);
    const enriched = { ...app };
    if (track && !enriched.trackName) enriched.trackName = track.name;
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
    if (result.app.status === 'applied') await offboardJob(result.app.jobKey);
    return result.app;
  }

  // ---- Follow-up reminders: badge on the toolbar icon -------------------------------
  async function refreshBadge() {
    try {
      const [apps, settings, promptState, reports] = await Promise.all([AJP.store.get('applications'), AJP.store.get('settings'), AJP.store.get('promptState'), AJP.store.get('reports')]);
      const due = AJP.tracker.dueFollowUps(apps, Date.now(), Number(settings.tracker.followUpDays) || 7);
      // Priority: a problem to report (!) → a report that got fixed (✓) → new Job Radar matches (blue) → follow-ups due (amber).
      if (promptState.pending) {
        await api.action.setBadgeText({ text: '!' });
        await api.action.setBadgeBackgroundColor({ color: '#dc2626' });
        return due.length;
      }
      if (reports.some((r) => r.status === 'fixed' && r.seen === false)) {
        await api.action.setBadgeText({ text: '✓' });
        await api.action.setBadgeBackgroundColor({ color: '#059669' });
        return due.length;
      }
      const radarNew = await radarNewCount();
      if (radarNew) {
        await api.action.setBadgeText({ text: String(radarNew) });
        await api.action.setBadgeBackgroundColor({ color: '#2563eb' });
        return due.length;
      }
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
  // History retention (Admin → Backup & privacy): an application is kept N days from the day you APPLIED (long enough to
  // avoid applying twice and to re-read the saved job description), then removed with job history, tailoring drafts
  // and logs older than N days. Default 30; the user can keep it longer, or 0 = keep everything.
  async function pruneHistory() {
    const settings = await AJP.store.get('settings');
    const days = Number(settings.retentionDays);
    if (!(days > 0)) return { removed: 0 };
    const cut = Date.now() - days * 86400000;
    const old = (iso) => iso && Date.parse(iso) < cut;
    let removed = 0;
    const keep = (list, when) => list.filter((x) => (old(when(x)) ? (removed++, false) : true));
    await serialData(async () => {
      await AJP.store.update('applications', (l) => keep(l, (a) => a.appliedAt || a.date || a.updatedAt));
      await AJP.store.update('evaluations', (l) => keep(l, (e) => e.at));
      await AJP.store.update('enhancements', (l) => keep(l, (d) => d.createdAt));
    });
    await AJP.store.update('logs', (l) => l.filter((e) => !old(e.t)));
    if (removed) log.info('Old history removed', { days, removed });
    return { removed };
  }
  pruneHistory().catch((e) => log.warn('History cleanup failed', { error: e.message }));
  if (api.alarms) {
    try {
      api.alarms.create('ajp-retention', { periodInMinutes: 24 * 60 });
      api.alarms.onAlarm.addListener((a) => a.name === 'ajp-retention' && pruneHistory());
    } catch (e) {
      log.warn('Retention alarm unavailable', { error: e.message });
    }
  }
  // Job Radar: an hourly tick; radar-scan only scans companies whose interval (default 3 h) has passed.
  if (api.alarms) {
    try {
      api.alarms.create('ajp-radar', { periodInMinutes: 60, delayInMinutes: 1 });
      api.alarms.onAlarm.addListener((a) => a.name === 'ajp-radar' && radarScan().catch((e) => log[AJP.toAppError(e).code === 'AJP-RADAR-BUSY' ? 'debug' : 'warn']('Radar scan failed', { code: AJP.toAppError(e).code })));
    } catch (e) {
      log.warn('Radar alarm unavailable', { error: e.message });
    }
  }
  if (api.notifications && api.notifications.onClicked) {
    api.notifications.onClicked.addListener((id) => {
      if (id !== 'ajp-radar') return;
      handlers.openAdmin({ hash: 'radar' }).catch((e) => log.warn('Could not open Job Radar', { error: e.message }));
    });
  }
  AJP.radarScan = radarScan; // tests
  AJP.radarAlert = radarAlert;
  // AI model manager (ai.js): re-check each provider's current models once a day (model lists only, no AI usage),
  // so retired or renamed models are replaced before anyone hits them.
  async function refreshModelsIfStale() {
    const h = await AJP.store.get('modelHealth');
    const s = (await AJP.store.get('settings')).ai;
    const stale = [s.provider, s.tailorProvider].filter(Boolean).some((k) => !(h[k] && h[k].at > Date.now() - 24 * 3600 * 1000 && h[k].rankV === AJP.ai.models.RANK_VERSION));
    if (stale) await AJP.ai.models.refreshAll();
  }
  refreshModelsIfStale().catch((e) => log.warn('Model check failed', { error: e.message }));
  if (api.alarms) {
    try {
      api.alarms.create('ajp-models', { periodInMinutes: 24 * 60 });
      api.alarms.onAlarm.addListener((a) => a.name === 'ajp-models' && AJP.ai.models.refreshAll().catch((e) => log.warn('Model check failed', { error: e.message })));
    } catch (e) {
      log.warn('Model check alarm unavailable', { error: e.message });
    }
  }
  if (api.alarms) {
    try {
      api.alarms.create('ajp-followups', { periodInMinutes: 60 });
      api.alarms.onAlarm.addListener((a) => a.name === 'ajp-followups' && refreshBadge());
    } catch (e) {
      log.warn('Alarms unavailable', { error: e.message });
    }
  }
  api.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && (c.applications || c.settings || c.reports || c.promptState)) refreshBadgeSoon();
  });
  if (api.alarms) {
    try {
      api.alarms.create('ajp-reports', { periodInMinutes: 24 * 60 });
      api.alarms.onAlarm.addListener((a) => a.name === 'ajp-reports' && handlers['github.status']({}));
    } catch (e) {
      log.warn('Report status alarm unavailable', { error: e.message });
    }
  }
  refreshBadge();

  // A job opened in a new tab (e.g. LinkedIn "Apply" -> company Workday) keeps its context.
  if (api.tabs.onCreated) {
    api.tabs.onCreated.addListener(async (tab) => {
      if (tab.openerTabId == null) {
        const all = await AJP.store.get('tabJobs');
        const p = all.__pending;
        if (p && Date.now() - p.at < PENDING_MS) {
          await setTabJob(tab.id, { ...p.job, submittedAt: undefined, appliedAt: undefined });
          await serialData(() => AJP.store.update('tabJobs', (x) => void delete x.__pending));
          log.info('Job context passed to new tab (Apply click, no opener)', { to: tab.id });
        }
        return;
      }
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

  // ---- Tailoring helpers: what the resume alone shows for a job, and which skills could be added ----------------
  // Resume-only match % (what a recruiter / ATS sees): profile skills are NOT counted here.
  function resumeScore(jd, text, extraSkills = []) {
    const a = AJP.matcher.analyze({ jdText: jd, profile: { skills: extraSkills.map((name) => ({ name })) }, resumeText: text });
    return a.score;
  }
  function skillOptions(jd, text, profile) {
    const a = AJP.matcher.analyze({ jdText: jd, profile: { skills: [] }, resumeText: text });
    const mine = new Set((profile.skills || []).map((s) => AJP.norm(AJP.matcher.canonical(s.name || s))));
    const rank = { required: 0, mentioned: 1, preferred: 2 };
    return a.missing
      .slice()
      .sort((x, y) => rank[x.importance] - rank[y.importance] || y.weight - x.weight)
      .slice(0, 10)
      .map((m) => ({ skill: m.skill, importance: m.importance, inProfile: mine.has(AJP.norm(m.skill)) }));
  }

  // ---- Job Radar (docs/JOB-FINDER.md) -----------------------------------------
  // New matches since the user last looked at the list: the blue badge count.
  async function radarNewCount() {
    const [jobs, rs] = await Promise.all([AJP.store.get('radarJobs'), AJP.store.get('radarSettings')]);
    const thr = Number(rs.threshold) || 60;
    return jobs.filter((j) => j.status === 'new' && j.score != null && j.score >= thr && !(j.eligibility && j.eligibility.status === 'blocked') && (!rs.lastViewedAt || String(j.foundAt) > rs.lastViewedAt)).length;
  }
  // Host permissions a watchlist entry needs (optional_host_permissions, asked for in Admin on the first company).
  const radarHosts = (entry) => AJP.radar.boards.hostsFor(entry);
  async function radarAllowed(entry) {
    const origins = radarHosts(entry);
    if (!origins.length || !api.permissions || !api.permissions.contains) return true;
    try {
      return await api.permissions.contains({ origins });
    } catch (e) {
      log.warn('Permission check failed', { board: entry.board, error: e.message });
      return false;
    }
  }
  const serialRadar = AJP.serial();
  async function radarAdd(input, { fetchImpl } = {}) {
    const found = input.url ? AJP.radar.detect.fromUrl(input.url) : input.board && input.company ? { board: input.board, company: input.company, ...(input.site ? { site: input.site } : {}), ...(input.region ? { region: input.region } : {}), ...(input.wd ? { wd: input.wd } : {}), ...(input.domain ? { domain: input.domain } : {}) } : null;
    if (!found || !AJP.radar.boards.get(found.board)) throw AJP.err('RADAR_UNSUPPORTED', { url: input.url ? String(input.url).slice(0, 200) : undefined, board: found && found.board });
    if (!(await radarAllowed(found))) throw AJP.err('RADAR_PERMISSION', { board: found.board, origins: radarHosts(found) });
    const key = AJP.radar.detect.keyOf(found);
    const existing = (await AJP.store.get('radarWatchlist')).find((w) => w.key === key);
    if (existing) return { entry: existing, exists: true };
    const probe = await AJP.radar.scan.probe(found, { fetchImpl });
    const entry = { key, ...probe.entry, companyName: probe.companyName || found.company, paused: false, addedAt: new Date().toISOString(), lastScanAt: null, lastError: null, failuresInRow: 0, openJobs: probe.openJobs };
    await serialRadar(() => AJP.store.update('radarWatchlist', (l) => (l.some((w) => w.key === key) ? l : [...l, entry])));
    log.info('Radar company added', { board: entry.board, company: entry.company, openJobs: entry.openJobs });
    return { entry, exists: false };
  }
  // Alert: per scan, or one daily summary (radarSettings.notify). Matches are announced once (notifiedAt).
  async function radarAlert(now = Date.now()) {
    const [rs, jobs] = await Promise.all([AJP.store.get('radarSettings'), AJP.store.get('radarJobs')]);
    const thr = Number(rs.threshold) || 60;
    const pending = jobs.filter((j) => j.status === 'new' && j.score != null && j.score >= thr && !j.notifiedAt && !(j.eligibility && j.eligibility.status === 'blocked'));
    refreshBadgeSoon();
    if (!pending.length) return null;
    if (rs.notify === 'digest' && rs.lastDigestAt && now - Date.parse(rs.lastDigestAt) < 24 * 3600 * 1000) return null;
    const companies = [...new Set(pending.map((j) => j.companyName))];
    const title = `${pending.length} new job${pending.length === 1 ? '' : 's'} at ${thr}%+ match`;
    const message = `${companies.slice(0, 3).join(', ')}${companies.length > 3 ? ` and ${companies.length - 3} more` : ''}`;
    const keys = new Set(pending.map((j) => j.key));
    await serialRadar(async () => {
      await AJP.store.update('radarJobs', (l) => l.map((j) => (keys.has(j.key) ? { ...j, notifiedAt: new Date(now).toISOString() } : j)));
      await AJP.store.update('radarSettings', (s) => void (s.lastDigestAt = new Date(now).toISOString()));
    });
    if (api.notifications && api.notifications.create) {
      try {
        await api.notifications.create('ajp-radar', { type: 'basic', iconUrl: api.runtime.getURL('icons/icon-128.png'), title, message });
      } catch (e) {
        log.warn('Notification failed; the badge and lists still show the jobs', { error: e.message });
      }
    }
    log.info('Radar alert', { jobs: pending.length, companies: companies.length, mode: rs.notify });
    return { title, message, count: pending.length };
  }
  // Preferences changed (titles, places, work types, tracks, work authorization, Job Radar filters): re-check the jobs
  // already listed with them (local, instant), and remember it so Admin can offer "Restart search".
  const radarPrefsSig = (p, rs) => JSON.stringify([p.personal && p.personal.yearsExperience, (p.skills || []).map((s) => s.name), p.targetRoles, p.areas, p.workTypes, (p.tracks || []).map((t) => [t.id, t.targetTitles, t.areas, t.workTypes]), p.autoApply && [p.autoApply.requireSponsorship, p.autoApply.citizen], rs.locations, rs.remote, rs.minSalary]);
  async function radarRefilter() {
    const [profile, rs, resumes] = await Promise.all([AJP.store.get('profile'), AJP.store.get('radarSettings'), AJP.store.get('resumes')]);
    const C = AJP.radar.core;
    const years = C.userYears(profile, resumes);
    const now = Date.now();
    let removed = 0;
    let returned = 0;
    await serialRadar(async () => {
      const [list, parked] = await Promise.all([AJP.store.get('radarJobs'), AJP.store.get('radarFiltered')]);
      const keep = [];
      const out = [];
      const relist = new Set(); // fits now but its description wasn't kept: the next scan reads it again
      // Matched: score again with your current skills and tracks (same numbers as a job page), then the filters.
      for (const j of list) {
        if (j.status !== 'new') { keep.push(j); continue; }
        const scored = { ...j, ...AJP.radar.scan.score(j, profile, resumes), eligibility: j.override ? j.eligibility : C.eligibility(j.description, profile) };
        if (j.override) { keep.push(scored); continue; } // you moved it back yourself
        const v = C.evaluate(scored, rs, profile, { years });
        if (v.pass) keep.push({ ...scored, remoteNote: v.note || null });
        else { removed++; out.push(C.toFiltered(scored, v.reason, v.detail, now, true)); }
      }
      // Filtered: anything that fits your preferences now comes back.
      const have = new Set(keep.map((j) => j.key));
      const still = [];
      for (const f of parked) {
        if (have.has(f.key)) continue;
        const { reason, detail, filteredAt, ...job } = f;
        const scored = job.description ? { ...job, ...AJP.radar.scan.score(job, profile, resumes) } : job;
        const v = C.evaluate(scored, rs, profile, { years });
        if (!v.pass) { still.push({ ...f, ...(job.description ? scored : {}), reason: v.reason, detail: v.detail || '' }); continue; }
        returned++;
        if (job.description) keep.unshift({ ...scored, status: 'new', remoteNote: v.note || null, eligibility: C.eligibility(job.description, profile) });
        else relist.add(f.key);
      }
      await AJP.store.set('radarJobs', keep);
      await AJP.store.set('radarFiltered', C.mergeFiltered(still, out, now));
      if (relist.size) await AJP.store.update('radarSeen', (seen) => Object.fromEntries(Object.entries(seen).filter(([k]) => !relist.has(k))));
    });
    await AJP.store.update('radarScanState', (s) => void ((s.prefsSig = radarPrefsSig(profile, rs)), (s.prefsChangedAt = Date.now())));
    refreshBadgeSoon();
    log.info('Radar list re-checked with your preferences', { removed, returned });
    return { removed, returned };
  }
  const radarRefilterSoon = AJP.debounce(() => radarRefilter().catch((e) => log.warn('Radar re-check failed', { error: e.message })), 800);
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.profile || changes.radarSettings)) return;
    Promise.all([AJP.store.get('profile'), AJP.store.get('radarSettings'), AJP.store.get('radarScanState')])
      .then(([p, rs, st]) => {
        const sig = radarPrefsSig(p, rs);
        if (st.prefsSig !== sig) (st.prefsSig ? radarRefilterSoon() : AJP.store.update('radarScanState', (s) => void (s.prefsSig = sig)));
      })
      .catch((e) => log.warn('Radar preference check failed', { error: e.message }));
  });
  // A company's own careers site, allowed by you from Job Radar: the assistant runs in that section only.
  const siteScriptId = (pattern) => `ajp-site-${hashText(pattern).replace(':', '-')}`;
  async function registerJobSite(pattern) {
    const id = siteScriptId(pattern);
    const have = await api.scripting.getRegisteredContentScripts({ ids: [id] });
    if (!have.length) await api.scripting.registerContentScripts([{ id, matches: [pattern], js: CONTENT_FILES, runAt: 'document_idle', allFrames: true, persistAcrossSessions: true }]);
  }
  async function allowJobSite(scope) {
    if (!api.scripting.registerContentScripts || !(await api.permissions.contains({ origins: [scope.origin] }))) return false;
    await registerJobSite(scope.pattern);
    await AJP.store.update('radarSites', (l) => (l.includes(scope.pattern) ? l : [...l, scope.pattern]));
    log.info('Company careers site allowed');
    return true;
  }
  // Keep the list true to the browser: access you removed in browser settings removes the site here too.
  async function syncJobSites() {
    if (!api.scripting.registerContentScripts) return;
    const keep = [];
    const sites = await AJP.store.get('radarSites');
    for (const p of sites) {
      const scope = AJP.radar.detect.siteScope(p.slice(0, -1));
      if (scope && (await api.permissions.contains({ origins: [scope.origin] }))) {
        await registerJobSite(p);
        keep.push(p);
      } else {
        await api.scripting.unregisterContentScripts({ ids: [siteScriptId(p)] }).catch(() => {});
      }
    }
    if (keep.length !== sites.length) await AJP.store.set('radarSites', keep);
  }
  syncJobSites().catch((e) => log.warn('Allowed career sites could not be restored', { error: e.message }));
  AJP.radarRefilter = radarRefilter; // tests
  // Filter rules changed in an update: re-check the listed jobs once with the new rules.
  AJP.store
    .get('radarScanState')
    .then(async (st) => {
      if (st.rulesVersion === AJP.radar.core.RULES_VERSION) return;
      await radarRefilter();
      await AJP.store.update('radarScanState', (s) => void ((s.rulesVersion = AJP.radar.core.RULES_VERSION), (s.prefsChangedAt = Date.now())));
    })
    .catch((e) => log.warn('Radar rules re-check failed', { error: e.message }));

  async function radarScan(opts = {}) {
    const rs = await AJP.store.get('radarSettings');
    if (!rs.enabled && !opts.force && !opts.onlyKey) return { skipped: 'disabled' };
    // Directory companies are only scanned on boards the browser already allows (Admin → "Allow all 11 job boards").
    const allowedBoards = new Set();
    for (const a of AJP.radar.boards.all()) if (await radarAllowed({ board: a.id })) allowedBoards.add(a.id);
    const summary = await AJP.radar.scan.run({ allowedBoards, ...opts });
    summary.alert = await radarAlert();
    return summary;
  }

  // ---- Message handlers ------------------------------------------------------
  const handlers = {
    async log({ entries }, sender) {
      if (Array.isArray(entries) && entries.length) {
        watchErrors(entries.slice(-200), sender && sender.tab ? sender.tab.id : null);
        await serialLogs(async () => {
          const cur = await AJP.store.get('logs');
          const next = cur.concat(entries.slice(-200));
          await AJP.store.set('logs', next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next);
        });
      }
      return {};
    },

    async 'ai.extractSkills'({ jd }, sender, { tid }) {
      const result = await AJP.ai.tasks.extractSkills({ jd, tid });
      return { result, ai: AJP.ai.last && AJP.ai.last.label };
    },

    // Resume enhancement v2 — see src/lib/resume-engine.js for the rules.
    async 'resume.enhance'({ jd, job, trackId, score, via }, sender, { tid, log: mlog }) {
      const E = AJP.resumeEngine;
      // Tailoring is for close matches only: a small honest lift, never a rewrite to chase a far-off job.
      const lim = E.limits(await AJP.store.get('settings'));
      if (score != null && Number(score) < lim.minMatch) throw AJP.err('TAILOR_LOW_MATCH', { score: Number(score), min: lim.minMatch });
      const ctx = await aiContext(trackId);
      if (!ctx.resumeText) throw AJP.err('NO_RESUME');
      const doc = E.parse(ctx.resumeText);
      if (!doc.bullets.length) throw AJP.err('RESUME_STRUCTURE', { lines: doc.lines.length });

      // 1) requirements + evidence (AI) → 2) verify quotes (code)
      const analysis = await AJP.ai.tasks.analyzeForResume({ jd, resumeText: ctx.resumeText, tid, via });
      const { requirements, droppedQuotes } = E.verifyRequirements(analysis.requirements, ctx.resumeText);
      const ats = (Array.isArray(analysis.ats_keywords) ? analysis.ats_keywords : []).map(String).slice(0, 20);
      const skills = (ctx.profile.skills || []).map((x) => x.name || x);

      // 3) targeted edits (AI) → 4) validate every edit (code)
      const proposal = await AJP.ai.tasks.proposeResumeEdits({ doc, requirements, atsKeywords: ats, skills, job, maxEdits: lim.maxEdits, tid, via });
      const vctx = { doc, resumeText: ctx.resumeText, jdText: jd, allowedSkills: E.allowedSkills(doc, ctx.resumeText, ctx.profile.skills) };
      const seen = new Set();
      const proposed = (Array.isArray(proposal.edits) ? proposal.edits : []).slice(0, 20).map((e, i) => {
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
      // Only the most important rewrites stay selected (limit); the rest are shown as unselected ideas.
      const edits = E.limitEdits(proposed, requirements, lim.maxEdits);
      const valid = edits.filter((e) => e.ok && e.accepted);
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
        trackId: ctx.track && !ctx.track.implicit ? ctx.track.id : null,
        trackName: ctx.track && !ctx.track.implicit ? ctx.track.name : null,
        baseHash: hashText(ctx.resumeText),
        seniority: String(analysis.seniority || '').slice(0, 40),
        roleSummary: String(analysis.summary || '').slice(0, 300),
        requirements,
        atsKeywords: ats,
        edits,
        gaps,
        coverage: { evidence: E.evidenceCoverage(requirements), atsBefore: atsBefore && atsBefore.pct, atsAfter: atsAfter && atsAfter.pct, atsMissingAfter: atsAfter ? atsAfter.missing : [] },
        stats: { requirements: requirements.length, strong: count('strong'), partial: count('partial'), none: count('none'), edits: edits.length, blocked: edits.filter((e) => !e.ok).length, limited: edits.filter((e) => e.limited).length, needsMetric: valid.filter((e) => e.needsMetric).length, droppedQuotes },
        // Skills the job asks for that the RESUME doesn't show (what a recruiter / ATS reads). Never pre-selected:
        // the user ticks only what they really have, and picks the job where it goes.
        limits: lim,
        matchScore: score != null ? Number(score) : null,
        resumeScore: resumeScore(jd, ctx.resumeText),
        roles: E.roles(doc).map((r) => ({ key: r.key, label: r.label })),
        skillOptions: skillOptions(jd, ctx.resumeText, ctx.profile),
        skillPicks: [],
        confirmedSkills: [],
        ai: AJP.ai.last ? { provider: AJP.ai.last.provider, model: AJP.ai.last.model, label: AJP.ai.last.label } : null, // who tailored it
        via: via || '', // the provider picked for this job: adding skills in the review stays with it
      };
      await serialData(() => AJP.store.update('enhancements', (list) => [draft, ...list].slice(0, 20)));
      const blockedBy = {};
      for (const e of edits) for (const v of e.violations) blockedBy[v.code] = (blockedBy[v.code] || 0) + 1;
      mlog.info('Resume enhancement drafted', { ...draft.stats, atsBefore: draft.coverage.atsBefore, atsAfter: draft.coverage.atsAfter, blockedBy });
      return { draft };
    },

    // The user reviewed a draft: build the new resume from the original + accepted, re-validated edits.
    // The user ticked skills they really have and chose the job for each: write each into one line of that job.
    async 'resume.addSkills'({ id, picks = [] }, sender, { tid, log: mlog }) {
      const E = AJP.resumeEngine;
      const drafts = await AJP.store.get('enhancements');
      const d = drafts.find((x) => x.id === id);
      if (!d) throw AJP.err('ENHANCEMENT_MISSING', { id });
      const resumes = await AJP.store.get('resumes');
      const base = resumes.items.find((r) => r.id === d.resumeId);
      if (!base) throw AJP.err('ENHANCEMENT_MISSING', { reason: 'original resume deleted' });
      if (hashText(base.text || '') !== d.baseHash) throw AJP.err('RESUME_CHANGED');
      const lim = d.limits || E.limits(await AJP.store.get('settings'));
      const doc = E.parse(base.text);
      const roleList = E.roles(doc);
      const offered = new Map((d.skillOptions || []).map((o) => [AJP.norm(o.skill), o.skill]));
      // Valid picks only: offered skills, existing jobs, no duplicates, at most maxSkills…
      const clean = [];
      for (const p of picks) {
        const skill = offered.get(AJP.norm(p && p.skill));
        const role = roleList.find((r) => r.key === (p && p.role)) || roleList[0];
        if (skill && role && !clean.some((c) => c.skill === skill)) clean.push({ skill, role: role.key });
      }
      const skipped = [];
      let list = clean.slice(0, lim.maxSkills);
      clean.slice(lim.maxSkills).forEach((p) => skipped.push({ skill: p.skill, reason: 'limit' }));
      // …and within the lift limit (never turn a close match into keyword stuffing).
      // Above your match + maxLift is allowed but flagged (the review shows a warning); maxSkills is the hard limit.
      const overCeiling = resumeScore(d.jd, base.text, list.map((p) => p.skill)) > E.liftCeiling(d, lim);

      // Lines already changed by an accepted rewrite are not reused.
      const taken = new Set(d.edits.filter((e) => e.accepted && e.source !== 'skill' && e.kind === 'bullet').map((e) => e.target));
      const linesOf = (roleKey) => doc.bullets.filter((b) => b.role === roleKey && !taken.has(b.id));
      let ai = [];
      if (list.length) {
        try {
          const r = await AJP.ai.tasks.weaveSkills({ picks: list.map((p) => ({ ...p, lines: linesOf(p.role).map((b) => ({ id: b.id, text: b.text })) })), job: d.job, tid, via: d.via || '' });
          ai = Array.isArray(r && r.edits) ? r.edits : [];
        } catch (e) {
          const x = AJP.toAppError(e);
          mlog.info('Skill wording: AI not used, simple wording instead', { code: x.code }, { code: x.code });
        }
      }
      const allowed = E.allowedSkills(doc, base.text, (await AJP.store.get('profile')).skills);
      list.forEach((p) => allowed.add(AJP.matcher.canonical(p.skill).toLowerCase()));
      const vctx = { doc, resumeText: base.text, jdText: d.jd, allowedSkills: allowed };
      const has = (text, skill) => AJP.matcher.findSkills(text, [skill]).has(skill) || String(text).toLowerCase().includes(skill.toLowerCase());
      const out = [];
      for (const p of list) {
        const lines = linesOf(p.role).filter((b) => !out.some((o) => o.target === b.id));
        if (!lines.length) {
          skipped.push({ skill: p.skill, reason: 'no free line in that job' });
          continue;
        }
        const cand = ai.find((e) => e && String(e.skill || '').toLowerCase() === p.skill.toLowerCase() && lines.some((b) => b.id === e.target));
        let target = cand ? cand.target : lines[0].id;
        let after = cand ? String(cand.after || '') : '';
        let v = after && has(after, p.skill) ? E.validateEdit({ target, after, evidence: [lines.find((b) => b.id === target).text] }, vctx) : { ok: false };
        let wording = 'ai';
        if (!v.ok) {
          // Simple wording the user can edit: the AI was off, failed, or broke a rule.
          target = (cand && lines.some((b) => b.id === cand.target) ? lines.find((b) => b.id === cand.target) : lines[0]).id;
          const line = lines.find((b) => b.id === target);
          after = E.weaveFallback(line.text, p.skill);
          v = E.validateEdit({ target, after, evidence: [line.text] }, vctx);
          wording = 'simple';
        }
        const line = doc.bullets.find((b) => b.id === target);
        out.push({
          id: 's' + (out.length + 1), target, kind: 'bullet', role: line.role, before: line.text, after: v.after || after,
          reason: `Shows ${p.skill} in the job where you used it (you confirmed it)`, requirementIds: [], evidence: [line.text],
          ok: v.ok, violations: v.violations || [], warnings: [], needsMetric: false, accepted: !!v.ok, source: 'skill', skill: p.skill, wording,
        });
      }
      d.edits = d.edits.filter((e) => e.source !== 'skill').concat(out);
      d.skillPicks = list;
      d.confirmedSkills = list.map((p) => p.skill);
      const chosen = d.edits.filter((e) => e.accepted && e.ok && e.kind === 'bullet').map((e) => ({ target: e.target, after: e.after }));
      d.coverage.resumeAfter = resumeScore(d.jd, E.assemble(base.text, chosen), d.confirmedSkills);
      await serialData(() => AJP.store.update('enhancements', (all) => all.map((x) => (x.id === d.id ? d : x))));
      mlog.info('Skills added to tailoring draft', { added: out.length, skipped: skipped.length, ai: out.filter((x) => x.wording === 'ai').length });
      return { draft: d, added: out.map((o) => ({ skill: o.skill, role: o.role, wording: o.wording })), skipped, overCeiling };
    },

    async 'resume.applyEnhancement'({ id, decisions = [], makeActive = false }, sender, { log: mlog }) {
      const E = AJP.resumeEngine;
      const drafts = await AJP.store.get('enhancements');
      const d = drafts.find((x) => x.id === id);
      if (!d) throw AJP.err('ENHANCEMENT_MISSING', { id });
      const resumes = await AJP.store.get('resumes');
      const base = resumes.items.find((r) => r.id === d.resumeId);
      if (!base) throw AJP.err('ENHANCEMENT_MISSING', { reason: 'original resume deleted' });
      if (hashText(base.text || '') !== d.baseHash) throw AJP.err('RESUME_CHANGED');

      const profileRaw = await AJP.store.get('profile');
      const track = d.trackId ? AJP.tracks.list(profileRaw).find((t) => t.id === d.trackId) : null;
      const profile = AJP.tracks.effectiveProfile(profileRaw, track);
      const doc = E.parse(base.text);
      const allowed = E.allowedSkills(doc, base.text, profile.skills);
      (d.confirmedSkills || []).forEach((sk) => allowed.add(AJP.matcher.canonical(sk).toLowerCase())); // skills the user confirmed
      const vctx = { doc, resumeText: base.text, jdText: d.jd, allowedSkills: allowed };
      const lim = d.limits || E.limits(await AJP.store.get('settings'));
      const chosen = [];
      const skipped = [];
      let rewrites = 0;
      for (const e of d.edits) {
        const dec = decisions.find((x) => x.editId === e.id);
        const accepted = dec ? !!dec.accepted : e.accepted;
        if (!accepted) continue;
        // Never more than maxEdits rewrites (skill lines and the skills order are counted separately).
        if (e.kind !== 'skills' && e.source !== 'skill' && ++rewrites > lim.maxEdits) {
          skipped.push({ editId: e.id, codes: ['LIMIT'] });
          continue;
        }
        const userText = dec && dec.after != null && dec.after !== e.after ? dec.after : null;
        // Text the USER typed is their own claim (e.g. their real result); AI text must pass every rule.
        const v = E.validateEdit({ target: e.target, after: userText != null ? userText : e.after, evidence: e.evidence, userEdited: userText != null }, vctx);
        if (!v.ok) {
          skipped.push({ editId: e.id, codes: v.violations.map((x) => x.code) });
          continue;
        }
        chosen.push({ target: e.target, after: e.kind === 'skills' ? v.after.split(/\s*,\s*/) : v.after });
      }
      const appliedCount = chosen.length;
      // Confirmed skills also go into the Skills line (added at the end of the list).
      if ((d.confirmedSkills || []).length && doc.skills.length) {
        const sk = chosen.find((c) => c.target === 'skills');
        if (sk) sk.after = sk.after.concat(d.confirmedSkills);
        else chosen.push({ target: 'skills', after: d.confirmedSkills });
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
        trackId: d.trackId || null,
        job: d.job,
        coverage: d.coverage,
        matchBefore: d.matchScore != null ? d.matchScore : null,
        createdAt: new Date().toISOString(),
      };
      // One format: every tailored resume gets its PDF now, so Autofill can upload it to this job. The job is in the
      // file name ("… - Resume - Initech - Senior Data Engineer.pdf").
      try {
        item.file = AJP.pdfWriter.fileFor(item, { company: d.job && d.job.company, title: d.job && d.job.title }).file;
      } catch (e) {
        const x = AJP.toAppError(e);
        mlog.warn('Tailored resume PDF not created', { code: x.code, details: x.details }, { code: x.code });
      }
      // One tailored resume per job: tailoring the same job again REPLACES its resume (no pile of copies).
      const key = d.job && d.job.url ? AJP.tracker.jobKey(d.job.url) : null;
      let replaced = false;
      await serialData(() =>
        AJP.store.update('resumes', (r) => {
          const i = key ? r.items.findIndex((x) => x.enhancementId && x.job && x.job.url && AJP.tracker.jobKey(x.job.url) === key) : -1;
          if (i >= 0) {
            item.id = r.items[i].id;
            item.createdAt = r.items[i].createdAt;
            item.updatedAt = new Date().toISOString();
            r.items[i] = item;
            replaced = true;
          } else r.items.unshift(item);
          if (makeActive && !d.trackId) r.activeId = item.id;
        })
      );
      // For a career track, "make it active" means: this track's resume from now on.
      if (makeActive && d.trackId) {
        await serialData(() => AJP.store.update('profile', (pr) => void (pr.tracks || []).forEach((t) => t.id === d.trackId && (t.resumeId = item.id))));
      }
      await serialData(() => AJP.store.update('enhancements', (list) => void list.forEach((x) => x.id === id && (x.appliedResumeId = item.id))));
      mlog.info('Tailored resume created', { edits: chosen.length, skipped: skipped.length, makeActive: !!makeActive });
      return { resume: item, applied: appliedCount, skipped, replaced };
    },

    async 'ai.draftAnswer'({ question, jd, job, maxWords, trackId }, sender, { tid }) {
      const ctx = await aiContext(trackId);
      const text = await AJP.ai.tasks.draftAnswer({ question, jd, job, maxWords, tid, ...ctx });
      return { text, ai: AJP.ai.last && AJP.ai.last.label };
    },

    async 'ai.test'(msg, sender, { tid }) {
      const text = await AJP.ai.tasks.test({ tid, group: (msg && msg.group) || '' });
      return { text, ai: AJP.ai.last && AJP.ai.last.label, model: AJP.ai.last && AJP.ai.last.model, provider: AJP.ai.last && AJP.ai.last.provider };
    },

    // Chrome built-in AI as the background sees it (that's where AI calls run).
    // "Check my AI setup": one provider per message, so each stays well under Chrome's 5-minute limit per request.
    async 'ai.check'({ provider } = {}) {
      return { result: await AJP.aiCheck.run(provider) };
    },
    async 'ai.check.report'({ results = [] } = {}) {
      return { text: AJP.aiCheck.report(results) };
    },
    async 'ai.alternatives'({ exclude } = {}) {
      return AJP.ai.alternatives(exclude);
    },

    async 'ai.localStatus'() {
      return AJP.ai.local.status();
    },

    // One analyzed job with its score per career track (feeds track insights / compare).
    async recordEvaluation({ ev }) {
      if (!ev || !ev.jobKey) return {};
      await serialData(() => AJP.store.update('evaluations', (list) => AJP.tracks.addEvaluation(list, { ...ev, at: new Date().toISOString() })));
      return {};
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

    // The job held for this tab (application on another page: sign-up, login, form), if still fresh.
    async 'tabJob.get'(msg, sender) {
      const tabId = sender && sender.tab ? sender.tab.id : null;
      let tj = await getTabJob(tabId);
      // The same job opened in another tab (no Apply click, no link back): recognise it by its job identity.
      if (!tj && tabId != null) {
        const key = AJP.tracker.jobKey((msg && msg.url) || (sender.tab && sender.tab.url) || '');
        const all = await AJP.store.get('tabJobs');
        const same = Object.entries(all).find(([id, j]) => id !== '__pending' && j && j.title && !j.appliedAt && j.jobKey === key && Date.now() - (j.at || 0) < HOLD_MS);
        if (same) {
          tj = same[1];
          log.info('Same job recognised in a new tab', { from: same[0], to: tabId });
        }
      }
      if (!tj || tj.appliedAt || !tj.title) return { job: null };
      if (Date.now() - (tj.at || 0) >= HOLD_MS) {
        await serialData(() => AJP.store.update('tabJobs', (all) => void delete all[tabId]));
        log.info('Held application expired (over 1 hour without activity)');
        return { job: null, expired: { title: tj.title, company: tj.company } };
      }
      await setTabJob(tabId, tj); // activity: the hold lasts another hour
      return { job: tj };
    },
    async 'tabJob.forget'(msg, sender) {
      if (sender && sender.tab) await serialData(() => AJP.store.update('tabJobs', (all) => void delete all[sender.tab.id]));
      log.info('Held application dropped by the user');
      return {};
    },
    // The user clicked an Apply button on a job page: remember the job briefly for a tab that opens without a link back.
    async applyClicked({ job }, sender) {
      if (!job) return {};
      await serialData(() => AJP.store.update('tabJobs', (all) => void (all.__pending = { job: { ...job, jobKey: AJP.tracker.jobKey(job.url) }, at: Date.now() })));
      return {};
    },

    // ---- Job Radar messages (docs/JOB-FINDER.md §13) ----
    async 'radar.status'() {
      const [rs, st, list] = await Promise.all([AJP.store.get('radarSettings'), AJP.store.get('radarScanState'), AJP.store.get('radarWatchlist')]);
      return { prefsChangedAt: st.prefsChangedAt || null, enabled: !!rs.enabled, running: AJP.radar.scan.isActive() || !!(st.lockedAt && Date.now() - st.lockedAt < AJP.radar.scan.CONFIG.lockStaleMs), lastSummary: st.lastSummary || null, newCount: await radarNewCount(), companies: list.length };
    },
    async 'radar.detect'({ url, html } = {}) {
      const hit = (url && AJP.radar.detect.fromUrl(url)) || (html && AJP.radar.detect.fromHtml(html, url));
      if (!hit || !AJP.radar.boards.get(hit.board)) throw AJP.err('RADAR_UNSUPPORTED', { url: url ? String(url).slice(0, 200) : undefined, board: hit && hit.board });
      const key = AJP.radar.detect.keyOf(hit);
      const watched = (await AJP.store.get('radarWatchlist')).some((w) => w.key === key);
      return { entry: hit, key, watched, hosts: radarHosts(hit), label: AJP.radar.boards.get(hit.board).label };
    },
    async 'radar.watch.add'(msg = {}) {
      return radarAdd(msg);
    },
    async 'radar.watch.addList'({ text = '' } = {}) {
      const lines = [...new Set(String(text).split(/[\r\n,;]+/).map((l) => l.trim().replace(/^["']|["']$/g, '')).filter((l) => l && !/^#/.test(l)))].slice(0, 300);
      const added = [];
      const skipped = [];
      for (const line of lines) {
        try {
          const r = await radarAdd({ url: line });
          (r.exists ? skipped : added).push(r.exists ? { line, reason: 'Already in the watchlist' } : { line, entry: r.entry });
        } catch (e) {
          const d = AJP.describeError(e);
          skipped.push({ line, reason: d.message, code: d.code });
        }
      }
      if (skipped.length) log.info('Radar list: some lines skipped', { added: added.length, skipped: skipped.length, codes: [...new Set(skipped.map((s) => s.code).filter(Boolean))] });
      return { added, skipped };
    },
    async 'radar.watch.update'({ key, paused, companyName } = {}) {
      let out = null;
      await serialRadar(() =>
        AJP.store.update('radarWatchlist', (l) =>
          l.map((w) => {
            if (w.key !== key) return w;
            out = { ...w, ...(paused != null ? { paused: !!paused } : {}), ...(paused === false ? { failuresInRow: 0, lastError: null } : {}), ...(companyName ? { companyName: String(companyName).slice(0, 80) } : {}) };
            return out;
          })
        )
      );
      return { entry: out };
    },
    async 'radar.watch.remove'({ key } = {}) {
      await serialRadar(async () => {
        await AJP.store.update('radarWatchlist', (l) => l.filter((w) => w.key !== key));
        await AJP.store.update('radarJobs', (l) => l.filter((j) => !(j.status === 'new' && `${j.board}:${j.company}` === key.split(':').slice(0, 2).join(':'))));
        await AJP.store.update('radarFiltered', (l) => l.filter((j) => `${j.board}:${j.company}` !== key.split(':').slice(0, 2).join(':')));
      });
      refreshBadgeSoon();
      return {};
    },
    async 'radar.watch.list'() {
      return { entries: await AJP.store.get('radarWatchlist') };
    },
    // Stop the running scan (the request in flight finishes; nothing resumes).
    async 'radar.stop'() {
      AJP.radar.scan.cancel();
      for (let i = 0; i < 50 && AJP.radar.scan.isActive(); i++) await new Promise((r) => setTimeout(r, 100));
      // No scan running here any more: a lock still set was left by a stopped worker. Clear it.
      const cleared = await AJP.radar.scan.clearStaleLock();
      log.info('Radar scan stopped by you', { cleared });
      return { stopped: !AJP.radar.scan.isActive() };
    },
    // Restart with the current preferences: stop, re-check the list, forget which jobs were seen (so every company's
    // jobs are judged again), start a fresh scan (your companies + a directory slice).
    async 'radar.restart'() {
      await handlers['radar.stop']();
      const r = await radarRefilter();
      await serialRadar(async () => {
        const keep = new Set((await AJP.store.get('radarJobs')).map((j) => j.key));
        await AJP.store.update('radarSeen', (seen) => Object.fromEntries(Object.entries(seen).filter(([k]) => keep.has(k))));
        await AJP.store.update('radarScanState', (s) => void Object.assign(s, { dirAt: null, queue: [], done: [], prefsChangedAt: null }));
      });
      radarScan({ force: true }).catch((e) => log.warn('Radar restart scan failed', { code: AJP.toAppError(e).code }));
      return { removed: r.removed, restarted: true };
    },
    async 'radar.scanNow'({ key } = {}) {
      return { summary: await radarScan({ force: true, onlyKey: key || null }) };
    },
    async 'radar.jobs'({ status = 'new', limit = 200, sort = 'match', eligible } = {}) {
      const blocked = (j) => !!(j.eligibility && j.eligibility.status === 'blocked');
      const jobs = (await AJP.store.get('radarJobs')).filter((j) => (status === 'all' || j.status === status) && (eligible == null || blocked(j) !== !!eligible));
      const posted = (j) => Date.parse(j.postedAt || j.foundAt) || 0;
      const sc = (j) => (j.score == null ? -1 : j.score);
      jobs.sort((a, b) => (sort === 'newest' ? posted(b) - posted(a) || sc(b) - sc(a) : sc(b) - sc(a) || posted(b) - posted(a)));
      return { jobs: jobs.slice(0, limit) };
    },
    async 'radar.viewed'() {
      await serialRadar(() => AJP.store.update('radarSettings', (s) => void (s.lastViewedAt = new Date().toISOString())));
      await refreshBadge();
      return {};
    },
    // Job Radar → Filtered: every job left out, with its reason (a page at a time).
    async 'radar.filtered'({ reason = 'all', offset = 0, limit = 25, sort = 'newest' } = {}) {
      const [parked, list] = await Promise.all([AJP.store.get('radarFiltered'), AJP.store.get('radarJobs')]);
      const blocked = list
        .filter((j) => j.status === 'new' && j.eligibility && j.eligibility.status === 'blocked')
        .map((j) => ({ ...j, reason: 'authorization', detail: (j.eligibility.reasons || []).join('; '), filteredAt: j.foundAt }));
      const all = [...blocked, ...parked];
      const counts = {};
      for (const j of all) counts[j.reason] = (counts[j.reason] || 0) + 1;
      const rows = reason === 'all' ? all : all.filter((j) => j.reason === reason);
      const when = (j) => Date.parse(j.postedAt || j.filteredAt) || 0;
      rows.sort((a, b) => (sort === 'match' ? (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score) : 0) || when(b) - when(a));
      return { jobs: rows.slice(offset, offset + limit).map(({ description, ...j }) => j), total: rows.length, all: all.length, counts };
    },
    // "Move to Matched": your call overrides the filter, and later re-checks respect it.
    async 'radar.filtered.restore'({ key } = {}) {
      let moved = false;
      await serialRadar(async () => {
        const parked = await AJP.store.get('radarFiltered');
        const f = parked.find((j) => j.key === key);
        if (f) {
          const { reason, detail, filteredAt, ...job } = f;
          await AJP.store.set('radarFiltered', parked.filter((j) => j.key !== key));
          await AJP.store.update('radarJobs', (l) => (l.some((j) => j.key === key) ? l : [{ ...job, status: 'new', override: true, remoteNote: reason === 'restricted' ? detail : job.remoteNote || null }, ...l]));
          moved = true;
          return;
        }
        await AJP.store.update('radarJobs', (l) => l.map((j) => {
          if (j.key !== key || !j.eligibility || j.eligibility.status !== 'blocked') return j;
          moved = true;
          return { ...j, override: true, eligibility: { ...j.eligibility, status: 'check' } };
        }));
      });
      refreshBadgeSoon();
      log.info('Radar job moved back to Matched', { moved });
      return { moved };
    },
    // Open a job on a company's own site; `panel` says whether the assistant will appear there.
    async 'radar.job.open'({ url } = {}) {
      const scope = AJP.radar.detect.siteScope(url);
      if (!scope) throw AJP.err('INTERNAL', { original: 'job link is not https' });
      let panel = false;
      try {
        panel = await allowJobSite(scope);
      } catch (e) {
        log.warn('Could not enable the assistant on this careers site', { error: e.message });
      }
      await api.tabs.create({ url });
      return { panel };
    },
    async 'radar.job.update'({ key, status } = {}) {
      if (!['new', 'saved', 'dismissed'].includes(status)) throw AJP.err('INTERNAL', { original: 'bad status ' + status });
      let job = null;
      await serialRadar(() => AJP.store.update('radarJobs', (l) => l.map((j) => (j.key === key ? (job = { ...j, status, ...(status === 'dismissed' ? { dismissedAt: new Date().toISOString() } : {}) }) : j))));
      if (!job) return { job: null };
      let app = null;
      if (status === 'saved') {
        app = await saveApplication({ url: job.url, company: job.companyName, title: job.title, location: job.locations.join('; '), score: job.score, trackId: job.bestTrackId, status: 'in progress', source: 'Job Radar', snapshot: { jd: job.description, salary: job.salary, location: job.locations.join('; '), source: 'Job Radar', savedAt: new Date().toISOString() } }, null);
        log.info('Radar job saved to Applications', { board: job.board });
      }
      refreshBadgeSoon();
      return { job, app };
    },
    // Hide a company (directory or not): its new jobs go, and it is never scanned from the directory again.
    async 'radar.company.hide'({ board, company } = {}) {
      const key = AJP.radar.detect.keyOf({ board, company });
      await serialRadar(async () => {
        await AJP.store.update('radarSettings', (s) => void (s.excluded = [...new Set([...(s.excluded || []), key])]));
        await AJP.store.update('radarJobs', (l) => l.filter((j) => !(j.status === 'new' && j.board === board && j.company === company)));
        await AJP.store.update('radarFiltered', (l) => l.filter((j) => !(j.board === board && j.company === company)));
      });
      refreshBadgeSoon();
      log.info('Radar company hidden', { board });
      return { key };
    },
    async 'radar.company.unhide'({ key } = {}) {
      await serialRadar(() => AJP.store.update('radarSettings', (s) => void (s.excluded = (s.excluded || []).filter((k) => k !== key))));
      return {};
    },
    async 'radar.directory'() {
      const [rs, st] = await Promise.all([AJP.store.get('radarSettings'), AJP.store.get('radarScanState')]);
      const dir = AJP.radar.directory || [];
      const byBoard = {};
      for (const [b] of dir) byBoard[b] = (byBoard[b] || 0) + 1;
      const allowed = [];
      for (const b of Object.keys(byBoard)) if (await radarAllowed({ board: b })) allowed.push(b);
      return { on: rs.directory !== false, total: dir.length, byBoard, allowed, hidden: (rs.excluded || []).length, failing: Object.values(st.dirFail || {}).filter((n) => n >= AJP.radar.scan.CONFIG.directoryFailSkip).length, lastAt: st.dirAt || null };
    },
    async 'radar.settings.get'() {
      return { settings: await AJP.store.get('radarSettings') };
    },
    async 'radar.settings.save'({ settings = {} } = {}) {
      const allowed = ['enabled', 'intervalHours', 'threshold', 'locations', 'remote', 'minSalary', 'notify', 'directory'];
      let out = null;
      await serialRadar(() =>
        AJP.store.update('radarSettings', (s) => {
          for (const k of allowed) if (k in settings) s[k] = settings[k];
          s.intervalHours = Math.max(AJP.radar.scan.CONFIG.minIntervalHours, Math.min(48, Number(s.intervalHours) || 3));
          s.threshold = Math.max(0, Math.min(100, Number(s.threshold) || 60));
          s.locations = (Array.isArray(s.locations) ? s.locations : String(s.locations || '').split(/[;\n]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
          if (!['any', 'remote', 'hybrid', 'onsite'].includes(s.remote)) s.remote = 'any';
          if (!['perScan', 'digest'].includes(s.notify)) s.notify = 'digest';
          out = { ...s };
        })
      );
      refreshBadgeSoon();
      return { settings: out };
    },

    // Admin → AI settings → "Re-check models now": forget remembered / set-aside models, read the current lists.
    async 'ai.refreshModels'() {
      return { models: await AJP.ai.models.refreshAll({ reset: true }) };
    },

    async pruneHistory() {
      return pruneHistory();
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
        await setTabJob(tabId, { jobKey: job.jobKey, appliedAt: now }); // offboarded: only the "applied" marker stays
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
    async autofillTab({ tabId, trackId, resumeId }, sender, { tid }) {
      const id = tabId || (sender.tab && sender.tab.id);
      if (!id) throw AJP.err('NO_TAB');
      await ensureInjected(id);
      await api.tabs.sendMessage(id, { type: 'doAutofill', tid, trackId, resumeId }); // all frames: trace id, track, resume to attach
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

    // ---- Problem reports on GitHub (option A) ------------------------------------------
    async crashPromptAction({ code, action }) {
      await serialPrompt(() =>
        AJP.store.update('promptState', (st) => {
          if (action === 'never') st.never = { ...(st.never || {}), [code]: true };
          if (st.pending && st.pending.code === code) delete st.pending;
        })
      );
      log.info('Crash prompt answered', { code, action });
      refreshBadgeSoon();
      if (action === 'report') await handlers.openAdmin({ hash: 'logs?report=1&code=' + encodeURIComponent(code) });
      return {};
    },

    // Open issues with the same error code (public search, no login). Never throws: [] + note on failure.
    async 'github.similar'({ codes }) {
      const url = AJP.issues.similarSearchUrl(codes);
      if (!url) return { items: [] };
      try {
        const data = await AJP.http(url, { headers: { Accept: 'application/vnd.github+json' } }, { timeoutMs: 10000, tries: 2, label: 'github similar', log });
        return { items: (data.items || []).slice(0, 5).map((i) => ({ number: i.number, title: i.title, url: i.html_url, state: i.state })) };
      } catch (e) {
        log.warn('Similar reports lookup failed', { error: e.message });
        return { items: [], unavailable: true };
      }
    },

    async 'report.saved'({ report }) {
      if (!report || !report.reportId) return {};
      await serialData(() =>
        AJP.store.update('reports', (list) => [{ status: 'not-submitted', ...report, createdAt: report.createdAt || new Date().toISOString() }, ...list.filter((r) => r.reportId !== report.reportId)].slice(0, 50))
      );
      log.info('Problem report opened on GitHub', { reportId: report.reportId, codes: report.codes });
      return {};
    },

    // Find each report's issue by its report id and map labels/state to a status. Max 5 lookups per run.
    async 'github.status'({ force = false } = {}) {
      const FINAL = new Set(['fixed', 'duplicate', 'wont-fix', 'closed']);
      const now = Date.now();
      const reports = await AJP.store.get('reports');
      const due = reports.filter((r) => !FINAL.has(r.status) && (force || !r.checkedAt || now - Date.parse(r.checkedAt) > 10 * 60000))
        .sort((a, b) => (Date.parse(a.checkedAt || 0) || 0) - (Date.parse(b.checkedAt || 0) || 0)).slice(0, 5);
      const updates = {};
      for (const r of due) {
        try {
          const data = await AJP.http(AJP.issues.statusSearchUrl(r.reportId), { headers: { Accept: 'application/vnd.github+json' } }, { timeoutMs: 10000, tries: 2, label: 'github status', log });
          updates[r.reportId] = { ...AJP.issues.statusFromIssue((data.items || [])[0]), checkedAt: new Date().toISOString() };
        } catch (e) {
          updates[r.reportId] = { status: r.status === 'not-submitted' || !r.status ? 'unknown' : r.status, checkedAt: new Date().toISOString(), checkFailed: true };
          log.warn('Report status lookup failed', { reportId: r.reportId, error: e.message });
        }
      }
      let list = reports;
      if (due.length) {
        await serialData(() =>
          AJP.store.update('reports', (l) =>
            (list = l.map((r) => {
              const u = updates[r.reportId];
              if (!u) return r;
              const becameFixed = u.status === 'fixed' && r.status !== 'fixed';
              return { ...r, ...u, seen: becameFixed ? false : r.seen };
            }))
          )
        );
        refreshBadgeSoon();
      }
      return { reports: list, checked: due.length };
    },

    async 'reports.seen'() {
      await serialData(() => AJP.store.update('reports', (l) => l.map((r) => (r.status === 'fixed' ? { ...r, seen: true } : r))));
      refreshBadgeSoon();
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

  // What scripts on job-site pages may ask for (src/content/* and the libraries they load). Everything else —
  // settings, keys, Job Radar control, AI checks, reports — only from the extension's own pages (Admin, popup).
  const PAGE_MESSAGES = new Set([
    'log', 'ai.alternatives', 'ai.draftAnswer', 'ai.extractSkills', 'applicationSignal', 'applyClicked', 'askApplied', 'autofillReport',
    'autofillTab', 'crashPromptAction', 'fillQuestion', 'learnAnswer', 'openAdmin', 'radar.detect', 'radar.watch.add', 'recordApplication',
    'recordEvaluation', 'resume.enhance', 'setTabJob', 'tabJob.forget', 'tabJob.get', 'undoStatus',
  ]);
  const fromPage = (sender) => !!(sender && sender.url) && !String(sender.url).startsWith(api.runtime.getURL(''));
  AJP.PAGE_MESSAGES = PAGE_MESSAGES; // tests

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const h = msg && handlers[msg.type];
    if (!h) return false;
    if (fromPage(sender) && !PAGE_MESSAGES.has(msg.type)) {
      const x = AJP.err('MSG_DENIED', { type: msg.type });
      log.warn('Message from a web page refused', { type: msg.type, host: hostOf(sender.url) }, { code: x.code });
      sendResponse({ ok: false, error: x.message, hint: x.hint, code: x.code });
      return false;
    }
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
