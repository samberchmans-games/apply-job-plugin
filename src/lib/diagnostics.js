/*
 * diagnostics.js — builds the "Report an issue" bundle users send to support.
 *
 * The bundle contains: a report id, the user's description, environment (browser, version,
 * language, time zone), a settings summary (never keys), data COUNTS (never content),
 * health checks, an error summary by code, and the recent (already redacted) logs.
 * A final scrub pass masks any email / phone / API-key pattern that slipped through.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.diagnostics) return;

  function parseBrowser(ua) {
    ua = String(ua || '');
    let m;
    if ((m = ua.match(/Edg\/([\d.]+)/))) return { name: 'Edge', version: m[1] };
    if ((m = ua.match(/Firefox\/([\d.]+)/))) return { name: 'Firefox', version: m[1] };
    if ((m = ua.match(/OPR\/([\d.]+)/))) return { name: 'Opera', version: m[1] };
    if ((m = ua.match(/Chrome\/([\d.]+)/))) return { name: 'Chrome', version: m[1] };
    if ((m = ua.match(/Version\/([\d.]+).*Safari/))) return { name: 'Safari', version: m[1] };
    return { name: 'Unknown', version: '' };
  }

  function reportId(now = new Date()) {
    return 'R-' + now.toISOString().slice(0, 10).replace(/-/g, '') + '-' + AJP.newId(5).toUpperCase();
  }

  const filled = (v) => !!(v && String(v).trim());

  function summarizeSettings(settings) {
    const ai = settings.ai || {};
    return {
      aiProvider: ai.provider,
      aiModel: ai.model || 'default',
      hasKey: Object.fromEntries(Object.entries(ai.keys || {}).map(([k, v]) => [k, filled(v)])),
      ollamaUrlIsLocal: /^https?:\/\/(localhost|127\.0\.0\.1)/.test(ai.ollamaUrl || ''),
      logLevel: settings.logLevel,
      autoAnalyze: settings.autoAnalyze,
      learnAnswers: settings.learnAnswers,
      tracker: settings.tracker,
    };
  }

  function summarizeData({ profile, resumes, answers, applications, enhancements = [] }) {
    const p = profile.personal || {};
    const active = resumes.items.find((r) => r.id === resumes.activeId) || resumes.items[0] || null;
    const byStatus = {};
    for (const a of applications) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    return {
      profileFilled: Object.fromEntries(['firstName', 'lastName', 'email', 'phone', 'city', 'linkedin', 'currentTitle', 'yearsExperience'].map((k) => [k, filled(p[k])])),
      skills: (profile.skills || []).length,
      tracks: (profile.tracks || []).length,
      targetRoles: (profile.targetRoles || []).length,
      areas: (profile.areas || []).length,
      workTypes: profile.workTypes,
      salarySet: filled(profile.salary && profile.salary.min),
      education: (profile.autoApply.education || []).length,
      experience: (profile.autoApply.experience || []).length,
      resumes: {
        count: resumes.items.length,
        active: !!active,
        activeTextChars: active ? (active.text || '').length : 0,
        activeHasFile: !!(active && active.file),
        activeFileType: active && active.file ? active.file.type : null,
        tailored: resumes.items.filter((r) => r.enhancementId || r.gaps != null).length,
      },
      tailoringDrafts: enhancements.length,
      learnedAnswers: Object.keys(answers).length,
      applications: { total: applications.length, byStatus },
    };
  }

  function errorSummary(logs) {
    const errors = logs.filter((l) => l.lvl === 'error');
    const counts = {};
    for (const e of errors) counts[e.code || 'uncoded'] = (counts[e.code || 'uncoded'] || 0) + 1;
    const warnings = logs.filter((l) => l.lvl === 'warn').length;
    return { total: errors.length, warnings, byCode: counts, last: errors.slice(-20) };
  }

  function sessions(logs) {
    const map = {};
    for (const l of logs) {
      if (!l.sid) continue;
      const s = (map[l.sid] = map[l.sid] || { sid: l.sid, ctx: l.ctx, first: l.t, last: l.t, entries: 0, errors: 0 });
      s.last = l.t;
      s.entries++;
      if (l.lvl === 'error') s.errors++;
    }
    return Object.values(map).slice(-30);
  }

  // Last safety net: mask contact details and keys anywhere in the bundle.
  const finalScrub = (bundle) => JSON.parse(AJP.scrub(JSON.stringify(bundle)));

  async function storageHealth() {
    const out = { ok: false };
    try {
      await AJP.api.storage.local.set({ __ajp_healthcheck: Date.now() });
      await AJP.api.storage.local.remove('__ajp_healthcheck');
      out.ok = true;
      if (AJP.api.storage.local.getBytesInUse) out.bytesInUse = await AJP.api.storage.local.getBytesInUse(null);
    } catch (e) {
      out.error = e.message;
    }
    return out;
  }

  async function collect({ description = '', includeLogs = true, maxLogs = 2000, nav = globalThis.navigator } = {}) {
    await AJP.flushLogs();
    const [profile, settings, resumes, answers, applications, logs, ping, storage, enhancements] = await Promise.all([
      AJP.store.get('profile'), AJP.store.get('settings'), AJP.store.get('resumes'), AJP.store.get('answers'),
      AJP.store.get('applications'), AJP.store.get('logs'), AJP.send('ping'), storageHealth(), AJP.store.get('enhancements'),
    ]);
    const ua = (nav && nav.userAgent) || '';
    const bundle = {
      app: 'apply-job-plugin',
      kind: 'issue-report',
      reportId: reportId(),
      createdAt: new Date().toISOString(),
      description: String(description || '').slice(0, 4000),
      environment: {
        extensionVersion: AJP.VERSION,
        browser: parseBrowser(ua),
        userAgent: ua,
        platform: (nav && (nav.userAgentData ? nav.userAgentData.platform : nav.platform)) || '',
        language: (nav && nav.language) || '',
        timeZone: (() => {
          try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
          } catch (_) {
            return '';
          }
        })(),
        reportedFrom: AJP.logContext,
      },
      settings: summarizeSettings(settings),
      data: summarizeData({ profile, resumes, answers, applications, enhancements }),
      health: {
        background: ping.ok ? { ok: true, version: ping.version, sessionId: ping.sessionId, uptimeSec: ping.uptimeSec, logLevel: ping.logLevel } : { ok: false, error: ping.error },
        storage,
        logEntries: logs.length,
      },
      errors: errorSummary(logs),
      sessions: sessions(logs),
      logs: includeLogs ? logs.slice(-maxLogs) : [],
    };
    return finalScrub(bundle);
  }

  // Short text for an email / chat message; the JSON file has the details.
  function summaryText(b) {
    const codes = Object.entries(b.errors.byCode).sort((x, y) => y[1] - x[1]).map(([c, n]) => `${c} ×${n}`).join(', ') || 'none';
    return [
      `Apply Job issue report ${b.reportId}`,
      `Version ${b.environment.extensionVersion} · ${b.environment.browser.name} ${b.environment.browser.version} · ${b.environment.platform}`,
      `AI: ${b.settings.aiProvider}${b.settings.aiProvider !== 'none' ? ' / ' + b.settings.aiModel : ''} · Log level: ${b.settings.logLevel}`,
      `Errors: ${b.errors.total} (${codes}) · Warnings: ${b.errors.warnings}`,
      b.errors.last.length ? `Last error: [${b.errors.last[b.errors.last.length - 1].code || 'uncoded'}] ${b.errors.last[b.errors.last.length - 1].msg}` : '',
      b.description ? `What happened: ${b.description.slice(0, 500)}` : '',
      'Please attach the downloaded file: apply-job-report-' + b.reportId + '.json',
    ].filter(Boolean).join('\n');
  }

  AJP.diagnostics = { collect, summaryText, parseBrowser, reportId, finalScrub, errorSummary, summarizeSettings, summarizeData };

  // Catch uncaught errors on extension pages (admin, popup, resume view).
  AJP.captureErrors = function captureErrors(mod = 'page') {
    const log = AJP.logger(mod);
    globalThis.addEventListener('error', (e) => log.error('Uncaught error', { message: e.message, file: String(e.filename || '').split('/').pop(), line: e.lineno }, { code: 'AJP-INTERNAL' }));
    globalThis.addEventListener('unhandledrejection', (e) => {
      const x = AJP.toAppError(e.reason);
      log.error('Unhandled promise rejection', { code: x.code, error: x.message, details: x.details }, { code: x.code });
    });
  };
})();
