/*
 * Job Radar detection (docs/JOB-FINDER.md §9): careers URL → { board, company, … }; page HTML → board (links,
 * iframes, scripts). Runs in the background, content scripts, Admin and tests. AJP.radar.detect
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  AJP.radar = AJP.radar || {};
  if (AJP.radar.detect) return;

  const RESERVED = new Set(['', 'embed', 'api', 'v1', 'jobs', 'job', 'careers', 'www', 'app', 'apply', 'posting-api', 'en', 'en-us']);
  const okSlug = (s) => s && !RESERVED.has(s.toLowerCase()) && /^[\w.-]{1,100}$/.test(s);

  // Each rule: (url: URL) → entry | null. Order matters only where hosts overlap (none do).
  const RULES = [
    ['greenhouse', (u) => {
      if (!/(^|\.)greenhouse\.io$/.test(u.hostname)) return null;
      const f = u.searchParams.get('for');
      if (f && okSlug(f)) return { company: f };
      const m = u.pathname.match(/^\/(?:v1\/boards\/)?([^/]+)/);
      return m && okSlug(m[1]) ? { company: m[1] } : null;
    }],
    ['lever', (u) => {
      const m = u.hostname.match(/^(jobs|api)\.(eu\.)?lever\.co$/);
      if (!m) return null;
      const p = u.pathname.match(/^\/(?:v0\/postings\/)?([^/?#]+)/);
      return p && okSlug(p[1]) ? { company: p[1], ...(m[2] ? { region: 'eu' } : {}) } : null;
    }],
    ['ashby', (u) => {
      if (u.hostname === 'jobs.ashbyhq.com') {
        const m = u.pathname.match(/^\/([^/]+)/);
        return m && okSlug(m[1]) ? { company: decodeURIComponent(m[1]) } : null;
      }
      if (u.hostname === 'api.ashbyhq.com') {
        const m = u.pathname.match(/job-board\/([^/]+)/);
        return m && okSlug(m[1]) ? { company: m[1] } : null;
      }
      return null;
    }],
    ['workable', (u) => {
      if (u.hostname !== 'apply.workable.com') return null;
      const m = u.pathname.match(/^\/(?:api\/v1\/widget\/accounts\/)?([^/]+)/);
      return m && okSlug(m[1]) ? { company: m[1] } : null;
    }],
    ['recruitee', (u) => {
      const m = u.hostname.match(/^([\w-]+)\.recruitee\.com$/);
      return m && okSlug(m[1]) ? { company: m[1] } : null;
    }],
    ['personio', (u) => {
      const m = u.hostname.match(/^([\w-]+)\.jobs\.personio\.(de|com)$/);
      return m && okSlug(m[1]) ? { company: m[1], domain: m[2] } : null;
    }],
    ['smartrecruiters', (u) => {
      if (!/^(jobs|careers|api)\.smartrecruiters\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/(?:v1\/companies\/)?([^/]+)/);
      return m && okSlug(m[1]) ? { company: m[1] } : null; // case kept: SmartRecruiters ids are case-sensitive
    }],
    ['workday', (u) => {
      const m = u.hostname.match(/^([\w-]+)\.wd(\d+)\.myworkdayjobs\.com$/);
      if (!m) return null;
      const parts = u.pathname.split('/').filter(Boolean);
      const cxs = parts[0] === 'wday' && parts[1] === 'cxs';
      const rest = cxs ? parts.slice(3) : parts.filter((p) => !/^[a-z]{2}(-[A-Z]{2})?$/.test(p)); // strip /en-US/
      const site = rest[0];
      return site && /^[\w.-]{1,100}$/.test(site) ? { company: m[1], wd: Number(m[2]), site } : null; // "Careers" is a valid site name
    }],
    ['breezy', (u) => {
      const m = u.hostname.match(/^([\w-]+)\.breezy\.hr$/);
      return m && okSlug(m[1]) ? { company: m[1] } : null;
    }],
    ['teamtailor', (u) => {
      const m = u.hostname.match(/^([\w-]+)\.teamtailor\.com$/);
      return m && okSlug(m[1]) ? { company: m[1], domain: u.hostname } : null;
    }],
    ['rippling', (u) => {
      if (u.hostname !== 'ats.rippling.com') return null;
      const m = u.pathname.match(/^\/(?:api\/v2\/board\/)?([^/]+)/);
      return m && okSlug(m[1]) ? { company: m[1] } : null;
    }],
  ];

  function parseUrl(raw) {
    let s = String(raw || '').trim();
    if (!s) return null;
    if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      return /^https?:$/.test(u.protocol) ? u : null;
    } catch (_) {
      return null; // not a URL: the caller reports RADAR_UNSUPPORTED
    }
  }

  // URL → { board, company, … } | null
  function fromUrl(raw) {
    const u = parseUrl(raw);
    if (!u) return null;
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const [board, rule] of RULES) {
      const hit = rule(u);
      if (hit) return { board, ...hit };
    }
    return null;
  }

  // Page HTML → entry: board URLs in links, iframes and scripts; Teamtailor by its assets (custom domain).
  function fromHtml(html, pageUrl = '') {
    const s = String(html || '');
    const urls = s.match(/https?:\/\/[^\s"'<>()\\]+/g) || [];
    for (const raw of urls) {
      const hit = fromUrl(raw.replace(/&amp;/g, '&'));
      if (hit && hit.board !== 'teamtailor') return hit;
    }
    // Greenhouse embed script: boards.greenhouse.io/embed/job_board/js?for=slug (often protocol-relative)
    const gh = s.match(/greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([\w.-]+)/);
    if (gh) return { board: 'greenhouse', company: gh[1] };
    if (/teamtailor-cdn|assets\.teamtailor|\.teamtailor\.com/.test(s)) {
      const tt = s.match(/https?:\/\/([\w-]+)\.teamtailor\.com/);
      const page = parseUrl(pageUrl);
      if (tt) return { board: 'teamtailor', company: tt[1], domain: page && !/teamtailor\.com$/.test(page.hostname) ? page.hostname : `${tt[1]}.teamtailor.com` };
      if (page) return { board: 'teamtailor', company: page.hostname.split('.')[0], domain: page.hostname };
    }
    return null;
  }

  // Stable watchlist key for an entry.
  const keyOf = (e) => [e.board, e.company, e.site].filter(Boolean).join(':');

  AJP.radar.detect = { fromUrl, fromHtml, keyOf, parseUrl };
})();
