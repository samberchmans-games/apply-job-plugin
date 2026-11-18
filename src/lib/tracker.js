/*
 * tracker.js — application tracker logic (pure functions; no DOM, no storage).
 * Used by background (saving), content (duplicate warning, apply detection), admin (board, stats, CSV).
 *
 * Application record:
 *   { id, jobKey, url, title, company, location, score, status, date, appliedAt, updatedAt,
 *     statusHistory:[{status,at}], snapshot:{jd,salary,workTypes,location,source,savedAt},
 *     resumeId, resumeName, notes, recruiter, interviewAt, nextStep, lastFollowUpAt,
 *     detectedBy: 'manual'|'confirmation'|'url', host }
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.tracker) return;

  const STATUSES = ['in progress', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'];
  // Automatic updates may only move an application forward, never back.
  const RANK = { 'in progress': 0, applied: 1, interviewing: 2, offer: 3, rejected: 3, withdrawn: 3 };
  const SUBMITTED = new Set(['applied', 'interviewing', 'offer', 'rejected']);
  const RESPONDED = new Set(['interviewing', 'offer', 'rejected']);
  const INTERVIEWED = new Set(['interviewing', 'offer']);
  const DAY = 86400000;

  // Job boards / ATS hosts where apply detection is trusted even without prior context.
  const JOB_HOSTS = /(^|\.)(linkedin\.com|indeed\.[a-z.]+|greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|glassdoor\.[a-z.]+|ziprecruiter\.com|ashbyhq\.com|smartrecruiters\.com|icims\.com|workable\.com)$/i;
  const isJobHost = (host) => JOB_HOSTS.test(String(host || '').replace(/^www\./, ''));

  // ---- Stable job identity ----------------------------------------------------
  // The same job is reachable via many URLs (search page, view page, /apply, tracking params).
  function jobKey(url) {
    let u;
    try {
      u = new URL(url);
    } catch (_) {
      return '';
    }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const p = u.pathname;
    const q = u.searchParams;
    let m;
    if (/linkedin\.com$/.test(host)) {
      if (q.get('currentJobId')) return 'linkedin:' + q.get('currentJobId');
      if ((m = p.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{5,})/))) return 'linkedin:' + m[1];
    }
    if (/indeed\./.test(host) && (q.get('jk') || q.get('vjk'))) return 'indeed:' + (q.get('jk') || q.get('vjk'));
    if (q.get('gh_jid')) return 'greenhouse:' + q.get('gh_jid'); // also company sites embedding Greenhouse
    if (/greenhouse\.io$/.test(host) && (m = p.match(/\/jobs\/(\d+)/))) return 'greenhouse:' + m[1];
    if (/lever\.co$/.test(host) && (m = p.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i))) return 'lever:' + m[1].toLowerCase();
    if (/ashbyhq\.com$/.test(host) && (m = p.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i))) return 'ashby:' + m[1].toLowerCase();
    if (/myworkday(jobs|site)\.com$/.test(host) && (m = p.match(/\/job\/[^?#]*?_([A-Za-z]*-?\d[\w-]*?)(?:-\d+)?(?:\/|$)/))) return 'workday:' + host.split('.')[0] + ':' + m[1].toUpperCase();
    if (/smartrecruiters\.com$/.test(host) && (m = p.match(/\/(\d{6,})/))) return 'smartrecruiters:' + m[1];
    if (/glassdoor\./.test(host) && (q.get('jl') || q.get('jobListingId'))) return 'glassdoor:' + (q.get('jl') || q.get('jobListingId'));
    const path = p.replace(/\/(apply|application|applications\/new)\/?$/i, '').replace(/\/+$/, '').toLowerCase();
    return 'url:' + host + path;
  }

  // ---- Duplicate detection ------------------------------------------------------
  const STOP = new Set(['and', 'the', 'for', 'with', 'of', 'a', 'an', 'to', 'in', 'at', 'remote', 'hybrid', 'onsite']);
  const tokens = (s) => new Set(AJP.normKey(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
  function titleSimilarity(a, b) {
    const A = tokens(a);
    const B = tokens(b);
    if (!A.size || !B.size) return 0;
    const inter = [...A].filter((w) => B.has(w)).length;
    return inter / (A.size + B.size - inter);
  }
  const normCompany = (s) => AJP.normKey(s).replace(/\b(inc|llc|ltd|corp|corporation|co|gmbh|plc)\b/g, '').replace(/\s+/g, ' ').trim();

  // Returns { app, how: 'same job' | 'similar job' } or null.
  function findDuplicate(apps, job) {
    if (!job) return null;
    const key = job.jobKey || jobKey(job.url);
    if (key) {
      const same = apps.find((a) => (a.jobKey || jobKey(a.url)) === key);
      if (same) return { app: same, how: 'same job' };
    }
    const c = normCompany(job.company);
    if (c && job.title) {
      const sim = apps.find((a) => normCompany(a.company) === c && titleSimilarity(a.title, job.title) >= 0.8);
      if (sim) return { app: sim, how: 'similar job' };
    }
    return null;
  }

  // ---- Saving (merge rules) -------------------------------------------------------
  function clean(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '') out[k] = v;
    return out;
  }

  // Insert or update `app` in `list` (mutates and returns {list, app, created, changed}).
  //   app.auto = true  -> automatic update: never moves status backwards, never clears data.
  function upsert(list, app, now = new Date().toISOString()) {
    const key = app.jobKey || jobKey(app.url);
    let i = app.id ? list.findIndex((x) => x.id === app.id) : -1;
    if (i < 0 && key) i = list.findIndex((x) => (x.jobKey || jobKey(x.url)) === key);
    const prev = i >= 0 ? list[i] : null;
    const { auto, ...fields } = app;
    const next = {
      ...(prev || { id: AJP.uid('app'), date: now, status: 'in progress', statusHistory: [] }),
      ...clean(fields),
      jobKey: key || (prev && prev.jobKey) || '',
      updatedAt: now,
    };
    if (!STATUSES.includes(next.status)) next.status = prev ? prev.status : 'in progress';
    if (prev && auto && RANK[prev.status] >= RANK[next.status]) next.status = prev.status;
    const changed = !prev || prev.status !== next.status;
    if (changed) next.statusHistory = (prev ? prev.statusHistory || [] : []).concat({ status: next.status, at: now }).slice(-30);
    if (SUBMITTED.has(next.status) && !next.appliedAt) next.appliedAt = now;
    if (prev && prev.snapshot && !(fields.snapshot && fields.snapshot.jd)) next.snapshot = prev.snapshot;
    if (i >= 0) list[i] = next;
    else list.unshift(next);
    if (list.length > 2000) list.length = 2000;
    return { list, app: next, created: !prev, changed };
  }

  // Revert the most recent status change (the "Undo" button).
  // If the application was just created by that change, remove it entirely.
  // Returns { app, removed } or null when the id is unknown.
  function undoStatus(list, id, now = new Date().toISOString()) {
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const a = list[i];
    if (!a.statusHistory || a.statusHistory.length < 2) {
      list.splice(i, 1);
      return { app: a, removed: true };
    }
    a.statusHistory = a.statusHistory.slice(0, -1);
    a.status = a.statusHistory[a.statusHistory.length - 1].status;
    if (!SUBMITTED.has(a.status)) delete a.appliedAt;
    a.updatedAt = now;
    return { app: a, removed: false };
  }

  // ---- Apply detection (text/URL patterns) -----------------------------------------
  const CONFIRM_RE = /(thank(s| you) for (applying|your application|submitting)|application (has been |was )?(successfully )?(submitted|received|sent|completed?)\b|we('|’)ve received your application|we have received your application|your application (was|has been) (successfully )?(sent|submitted|received)|you('|’)ve (successfully )?applied|successfully (applied|submitted))/i;
  const CONFIRM_URL_RE = /\/(confirmation|thanks|thank[-_]?you|application[-_]?(submitted|complete|received)|submitted|success)(\/|$)/i;
  const SUBMIT_RE = /^(submit|submit (my |your )?application|apply|apply now|send( my)? application|complete( my)? application|finish( application)?|review and submit)$/i;
  // Instructions that merely *mention* submitting ("Once your application has been submitted, ...").
  const NOT_CONFIRM_RE = /\b(once|after|when|if|before|until|unless)\b[^.!]{0,40}\b(application|applying|apply)\b|\bnot (been )?(submitted|received)\b|\b(could not|couldn't|failed to|unable to)\b/i;
  const isConfirmationText = (t) => !!t && t.length < 300 && CONFIRM_RE.test(t) && !NOT_CONFIRM_RE.test(t);
  const isConfirmationUrl = (url) => {
    try {
      return CONFIRM_URL_RE.test(new URL(url).pathname);
    } catch (_) {
      return false;
    }
  };
  const isSubmitLabel = (t) => SUBMIT_RE.test(String(t || '').replace(/\s+/g, ' ').trim());

  // ---- Follow-ups & reminders ---------------------------------------------------------
  // Due: 'applied' with no activity for `days`, or an interview in the next 48h.
  function dueFollowUps(apps, now = Date.now(), days = 7) {
    const out = [];
    for (const a of apps) {
      if (a.interviewAt && (a.status === 'interviewing' || a.status === 'applied')) {
        const t = Date.parse(a.interviewAt);
        if (t >= now - 3600000 && t - now <= 2 * DAY) {
          out.push({ app: a, reason: 'interview', at: a.interviewAt });
          continue;
        }
      }
      if (a.status !== 'applied') continue;
      const last = Math.max(Date.parse(a.appliedAt || a.date) || 0, Date.parse(a.lastFollowUpAt || 0) || 0);
      const idle = Math.floor((now - last) / DAY);
      if (last && idle >= days) out.push({ app: a, reason: 'followup', days: idle });
    }
    return out;
  }

  // ---- Stats -------------------------------------------------------------------------
  const reached = (a, set) => set.has(a.status) || (a.statusHistory || []).some((h) => set.has(h.status));
  const avg = (xs) => {
    const v = xs.filter((x) => typeof x === 'number');
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
  };

  function stats(apps, now = Date.now(), weeks = 8) {
    const submitted = apps.filter((a) => a.appliedAt || SUBMITTED.has(a.status));
    const responded = submitted.filter((a) => reached(a, RESPONDED));
    const interviewed = submitted.filter((a) => reached(a, INTERVIEWED));
    const notInterviewed = submitted.filter((a) => !reached(a, INTERVIEWED));
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const a of apps) if (a.status in byStatus) byStatus[a.status]++;
    const perWeek = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const end = now - w * 7 * DAY;
      const start = end - 7 * DAY;
      perWeek.push({
        weekStart: new Date(start).toISOString().slice(0, 10),
        count: submitted.filter((a) => {
          const t = Date.parse(a.appliedAt || a.date);
          return t > start && t <= end;
        }).length,
      });
    }
    return {
      total: apps.length,
      submitted: submitted.length,
      byStatus,
      responseRate: submitted.length ? Math.round((100 * responded.length) / submitted.length) : null,
      interviewRate: submitted.length ? Math.round((100 * interviewed.length) / submitted.length) : null,
      avgScoreInterviewed: avg(interviewed.map((a) => a.score)),
      avgScoreNotInterviewed: avg(notInterviewed.map((a) => a.score)),
      thisWeek: perWeek[perWeek.length - 1].count,
      perWeek,
    };
  }

  // ---- CSV export (opens in Excel / Google Sheets) -----------------------------------------
  const CSV_COLUMNS = [
    ['Date applied', (a) => (a.appliedAt || '').slice(0, 10)],
    ['Company', (a) => a.company],
    ['Title', (a) => a.title],
    ['Status', (a) => a.status],
    ['Match %', (a) => (a.score == null ? '' : a.score)],
    ['Location', (a) => a.location || (a.snapshot && a.snapshot.location)],
    ['Salary', (a) => {
      const s = a.snapshot && a.snapshot.salary;
      return s ? `${s.min}-${s.max}` : '';
    }],
    ['Resume used', (a) => a.resumeName],
    ['Recruiter', (a) => a.recruiter],
    ['Interview', (a) => a.interviewAt],
    ['Next step', (a) => a.nextStep],
    ['Notes', (a) => a.notes],
    ['URL', (a) => a.url],
    ['First seen', (a) => (a.date || '').slice(0, 10)],
  ];
  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // block spreadsheet formula injection from job pages
    return /[",\n\r]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(apps) {
    const rows = [CSV_COLUMNS.map((c) => c[0])].concat(apps.map((a) => CSV_COLUMNS.map((c) => c[1](a))));
    return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  AJP.tracker = {
    STATUSES, RANK, jobKey, isJobHost, titleSimilarity, findDuplicate, upsert, undoStatus,
    isConfirmationText, isConfirmationUrl, isSubmitLabel, dueFollowUps, stats, toCSV, csvCell,
  };
})();
