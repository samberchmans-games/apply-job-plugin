/*
 * issue-report.js — report problems as GitHub issues (option A; see docs/ISSUE-REPORTING.md). Pure logic.
 *
 *   buildIssueUrl(bundle)        pre-filled "Problem report" form URL (summary only: never logs, URLs, personal data)
 *   similarSearchUrl(codes)      public GitHub search for open issues with the same error code
 *   statusSearchUrl(reportId)    public GitHub search for the issue carrying a report id
 *   statusFromIssue(issue)       received / fixing / fixed (vX) / duplicate / wont-fix / closed
 *   shouldPrompt(state, entry)   crash prompt rules (ask, never auto-send)
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.issues) return;

  const REPO = 'samberchmans-games/apply-job-plugin';
  const MAX_URL = 7500;
  const DAY = 86400000;

  // Problems the user can fix themselves: shown with a hint, never a "report it?" prompt.
  const USER_FIXABLE = new Set(['AJP-AI-OFF', 'AJP-AI-KEY', 'AJP-AI-401', 'AJP-AI-429', 'AJP-AI-404', 'AJP-AI-NET', 'AJP-JD-NONE', 'AJP-RES-NONE',
    'AJP-RES-STRUCT', 'AJP-FILE-SIZE', 'AJP-BACKUP', 'AJP-PAGE-ACCESS', 'AJP-RES-CHANGED', 'AJP-RES-DRAFT', 'AJP-TAB']);
  const ALWAYS_PROMPT = new Set(['AJP-INTERNAL', 'AJP-STORE']);

  // Public text: mask contact details/keys (logger.scrub) and drop links (job URLs reveal a person's search).
  const publicText = (s) => (AJP.scrub ? AJP.scrub(String(s || '')) : String(s || '')).replace(/https?:\/\/\S+/gi, '[link]');

  function topCodes(bundle) {
    return Object.entries((bundle.errors && bundle.errors.byCode) || {}).filter(([c]) => c !== 'uncoded').sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }

  const BROWSERS = { Chrome: 'Chrome', Edge: 'Edge', Firefox: 'Firefox', Safari: 'Safari' };

  function issueFields(bundle, { code } = {}) {
    const codes = code ? [code, ...topCodes(bundle).filter((c) => c !== code)] : topCodes(bundle);
    const desc = publicText(bundle.description || '').trim();
    const firstLine = (desc.split('\n')[0] || 'Problem report').slice(0, 70);
    const last = bundle.errors && bundle.errors.last && bundle.errors.last[bundle.errors.last.length - 1];
    const env = bundle.environment || {};
    const set = bundle.settings || {};
    const counts = (bundle.errors && bundle.errors.byCode) || {};
    return {
      title: `[${codes[0] || 'report'}] ${firstLine} (${bundle.reportId})`,
      report_id: bundle.reportId,
      codes: codes.join(', '),
      what_happened: (desc || '(no description)') + (last ? `\n\nLast error: [${last.code || 'uncoded'}] ${publicText(last.msg)}` : ''),
      version: 'v' + (env.extensionVersion || ''),
      browser: BROWSERS[env.browser && env.browser.name] || 'Other',
      environment: [
        `Browser: ${(env.browser && env.browser.name) || '?'} ${(env.browser && env.browser.version) || ''}`.trim(),
        `OS: ${env.platform || '?'}`,
        `AI: ${set.aiProvider || 'none'}${set.aiProvider && set.aiProvider !== 'none' ? ' / ' + (set.aiModel || 'default') : ''}`,
        `Log level: ${set.logLevel || '?'}`,
        `Tracks: ${(bundle.data && bundle.data.tracks) || 0}`,
        `Errors: ${Object.entries(counts).map(([c, n]) => `${c} ×${n}`).join(', ') || 'none'}`,
        `Background: ${bundle.health && bundle.health.background && bundle.health.background.ok ? 'ok' : 'not responding'}`,
      ].join('\n'),
    };
  }

  function encode(fields) {
    const q = Object.entries({ template: 'bug_report.yml', ...fields }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return `https://github.com/${REPO}/issues/new?${q}`;
  }

  // Never longer than MAX_URL; trims the description, then the environment — never the report id or title.
  function buildIssueUrl(bundle, opts = {}) {
    const f = issueFields(bundle, opts);
    let url = encode(f);
    while (url.length > MAX_URL && f.what_happened.length > 200) {
      f.what_happened = f.what_happened.slice(0, Math.floor(f.what_happened.length * 0.8)) + '…';
      url = encode(f);
    }
    if (url.length > MAX_URL) {
      f.environment = f.environment.slice(0, 300) + '…';
      url = encode(f);
    }
    return { url, fields: f };
  }

  const API = 'https://api.github.com/search/issues?per_page=5&q=';
  function similarSearchUrl(codes) {
    const c = (codes || []).filter(Boolean)[0];
    if (!c) return null;
    return API + encodeURIComponent(`repo:${REPO} is:issue is:open "${c}" in:title`);
  }
  const statusSearchUrl = (reportId) => API + encodeURIComponent(`repo:${REPO} is:issue "${reportId}" in:title`);

  // GitHub issue → what the user sees in "My reports".
  function statusFromIssue(issue) {
    if (!issue) return { status: 'not-submitted' };
    const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
    const base = { number: issue.number, url: issue.html_url };
    if (issue.state === 'closed') {
      const fixed = labels.find((l) => /^fixed-in:/.test(l));
      if (fixed) return { ...base, status: 'fixed', version: fixed.slice(9) };
      if (labels.includes('duplicate')) return { ...base, status: 'duplicate' };
      if (labels.includes('wont-fix')) return { ...base, status: 'wont-fix' };
      return { ...base, status: 'closed' };
    }
    if (labels.includes('confirmed') || labels.includes('in-progress')) return { ...base, status: 'fixing' };
    if (labels.includes('needs-info')) return { ...base, status: 'needs-info' };
    return { ...base, status: 'received' };
  }

  const STATUS_TEXT = {
    'not-submitted': '⏳ Not submitted yet',
    received: '✅ Received',
    'needs-info': '💬 Needs more info',
    fixing: '🔧 Being fixed',
    fixed: '🎉 Fixed',
    duplicate: '↩ Closed: duplicate',
    'wont-fix': '↩ Closed: won\'t fix',
    closed: '↩ Closed',
    unknown: '❔ Couldn\'t check',
  };

  /*
   * shouldPrompt(state, entry, { now, enabled }) -> { prompt: bool, state }
   *   state = { recent: {code:[ts]}, last: {code:ts}, never: {code:true} }
   *   Prompts for AJP-INTERNAL / AJP-STORE, or the same (non user-fixable) code 3× in 10 min; once per code per day.
   */
  function shouldPrompt(state, entry, { now = Date.now(), enabled = true } = {}) {
    const st = { recent: {}, last: {}, never: {}, ...(state || {}) };
    const code = entry && entry.lvl === 'error' && entry.code;
    if (!code || !enabled || USER_FIXABLE.has(code) || st.never[code]) return { prompt: false, state: st };
    const recent = (st.recent[code] || []).filter((t) => now - t < 10 * 60000).concat(now).slice(-10);
    st.recent = { ...st.recent, [code]: recent };
    if (st.last[code] && now - st.last[code] < DAY) return { prompt: false, state: st };
    const prompt = ALWAYS_PROMPT.has(code) || recent.length >= 3;
    if (prompt) st.last = { ...st.last, [code]: now };
    return { prompt, state: st };
  }

  AJP.issues = { REPO, MAX_URL, USER_FIXABLE, buildIssueUrl, issueFields, similarSearchUrl, statusSearchUrl, statusFromIssue, STATUS_TEXT, shouldPrompt, publicText };
})();
