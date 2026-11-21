/*
 * Job Radar core (docs/JOB-FINDER.md §7): the shared job shape, normalize(), text parsing without DOMParser
 * (the MV3 service worker and the JavaScriptCore test runner have none), dates, salary, remote, the quick filter,
 * skip-seen and pruning. Pure functions: no network, no storage. AJP.radar.core
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  AJP.radar = AJP.radar || {};
  if (AJP.radar.core) return;

  const LIMITS = { description: 12000, title: 200, location: 120, locations: 10, jobs: 500, seenDays: 60, dismissedDays: 30 };
  const DAY = 86400000;

  // ---- HTML / XML text -----------------------------------------------------------------------------
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢', times: '×', eacute: 'é', egrave: 'è', aacute: 'á', oacute: 'ó', uacute: 'ú', iacute: 'í', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß', ccedil: 'ç' };
  function decodeEntities(s) {
    return String(s == null ? '' : s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      const v = NAMED[e.toLowerCase()];
      return v == null ? m : v;
    });
  }
  function htmlToText(html) {
    let s = String(html == null ? '' : html);
    // Double-encoded HTML (Greenhouse): "&lt;p&gt;" → "<p>"
    if (!/<[a-z][^>]*>/i.test(s) && /&lt;[a-z/]/i.test(s)) s = decodeEntities(s);
    s = s
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section|article|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    s = decodeEntities(s).replace(/ /g, ' ');
    return s
      .split('\n')
      .map((l) => l.replace(/[ \t\r\f\v]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Inner text of each <tag>…</tag> (tag may carry a namespace prefix, e.g. tt:location).
  function xmlItems(text, tag) {
    const re = new RegExp(`<(?:[\\w-]+:)?${esc(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${esc(tag)}>`, 'gi');
    const out = [];
    let m;
    while ((m = re.exec(String(text || '')))) out.push(m[1]);
    return out;
  }
  const unCdata = (s) => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Values at a/b/c (every match at every step, in document order).
  function xmlValues(item, path) {
    const steps = String(path).split('/');
    let scope = [String(item || '')];
    for (let i = 0; i < steps.length; i++) {
      const next = [];
      for (const s of scope) {
        next.push(...xmlItems(s, steps[i]));
      }
      scope = next;
    }
    return scope.map((v) => decodeEntities(unCdata(v)).trim());
  }
  const xmlValue = (item, path) => xmlValues(item, path)[0] || '';

  // ---- Dates ----------------------------------------------------------------------------------------
  // ISO · ms numbers · "YYYY-MM-DD HH:MM:SS UTC" · RFC 822 · Workday "Posted …" → { iso, exact } | null
  function parseDate(v, now = Date.now()) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
      const n = Number(v);
      const d = new Date(n < 1e12 ? n * 1000 : n);
      return isNaN(d) ? null : { iso: d.toISOString(), exact: true };
    }
    const s = String(v).trim();
    const posted = s.match(/^posted\s+(today|yesterday|(\d+)\+?\s+days?\s+ago)/i);
    if (posted) {
      const days = /today/i.test(posted[1]) ? 0 : /yesterday/i.test(posted[1]) ? 1 : Number(posted[2]);
      return { iso: new Date(now - days * DAY).toISOString(), exact: false };
    }
    const utc = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*UTC$/i);
    const d = new Date(utc ? `${utc[1]}T${utc[2]}Z` : s);
    return isNaN(d) ? null : { iso: d.toISOString(), exact: true };
  }

  // ---- Salary -----------------------------------------------------------------------------------------
  const CUR = { $: 'USD', 'US$': 'USD', USD: 'USD', 'CA$': 'CAD', CAD: 'CAD', 'A$': 'AUD', AUD: 'AUD', '€': 'EUR', EUR: 'EUR', '£': 'GBP', GBP: 'GBP' };
  function periodFrom(s) {
    if (/hour|\/hr\b|per hr|hourly/i.test(s)) return 'hour';
    if (/month|\/mo\b|monthly/i.test(s)) return 'month';
    if (/week/i.test(s)) return 'week';
    return 'year';
  }
  function salaryFromText(text) {
    const s = String(text || '');
    const re = /(US\$|CA\$|A\$|\$|€|£|USD|CAD|AUD|EUR|GBP)\s?(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s?([kK])?\s*(?:-|–|—|to)\s*(?:US\$|CA\$|A\$|\$|€|£|USD|CAD|AUD|EUR|GBP)?\s?(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s?([kK])?/;
    const m = s.match(re);
    if (!m) return null;
    const num = (n, k) => {
      let x = Number(String(n).replace(/[,.](?=\d{3}\b)/g, ''));
      if (k || (x < 1000 && /[kK]/.test(m[3] || m[5] || ''))) x *= 1000;
      return x;
    };
    const min = num(m[2], m[3]);
    const max = num(m[4], m[5]);
    const around = s.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    const period = periodFrom(around);
    if (period === 'year' && max < 10000) return null; // "$50 - $60" with no period: not a yearly salary
    if (period === 'hour' && max > 1000) return null;
    return { min: Math.min(min, max), max: Math.max(min, max), currency: CUR[m[1]] || 'USD', period, source: 'text' };
  }

  // ---- Remote -----------------------------------------------------------------------------------------
  function remoteFrom(raw) {
    const r = raw || {};
    const word = (v) => {
      const s = String(v == null ? '' : v).toLowerCase().replace(/[\s_-]/g, '');
      if (/^(remote|fullyremote|fully)$/.test(s)) return 'remote';
      if (/^hybrid$/.test(s)) return 'hybrid';
      if (/^(onsite|inoffice|office|none)$/.test(s)) return 'onsite';
      return null;
    };
    for (const v of [r.workplaceType, r.remoteStatus, r.workplace, r.location_type]) {
      const w = word(v);
      if (w) return w;
    }
    if (r.isRemote === true || r.telecommuting === true || r.is_remote === true || r.remote === true || (r.location && (r.location.remote === true || r.location.is_remote === true))) return 'remote';
    if (r.hybrid === true || (r.location && r.location.hybrid === true)) return 'hybrid';
    if (r.on_site === true || r.onsite === true) return 'onsite';
    return null;
  }

  // ---- Job shape --------------------------------------------------------------------------------------
  const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  const slug = (s) => String(s || '').trim();
  function normalize(partial, entry = {}) {
    const p = partial || {};
    const board = slug(p.board || entry.board);
    const company = slug(p.company || entry.company);
    const id = slug(p.id);
    const date = p.postedAt && typeof p.postedAt === 'object' ? p.postedAt : parseDate(p.postedAt);
    const description = String(p.description || '').slice(0, LIMITS.description);
    const locations = [...new Set((Array.isArray(p.locations) ? p.locations : [p.locations]).map((l) => clean(l, LIMITS.location)).filter(Boolean))].slice(0, LIMITS.locations);
    return {
      key: `${board}:${company}:${id}`,
      board,
      company,
      companyName: clean(p.companyName || entry.companyName || company, 80),
      title: clean(p.title, LIMITS.title),
      locations,
      remote: ['remote', 'hybrid', 'onsite'].includes(p.remote) ? p.remote : remoteFrom(p.raw) || (locations.some((l) => /\bremote\b/i.test(l)) ? 'remote' : null),
      employmentType: p.employmentType ? clean(p.employmentType, 40) : null,
      department: p.department ? clean(p.department, 80) : null,
      url: String(p.url || ''),
      postedAt: date ? date.iso : null,
      postedAtExact: date ? p.postedAtExact !== false && date.exact !== false : false,
      salary: p.salary && (p.salary.min || p.salary.max) ? { min: p.salary.min || null, max: p.salary.max || null, currency: p.salary.currency || 'USD', period: p.salary.period || 'year', source: p.salary.source || 'field' } : salaryFromText(description),
      description,
      descriptionLevel: description.trim() ? 'full' : 'title',
      score: null,
      bestTrackId: null,
      foundAt: p.foundAt || null,
      status: 'new',
    };
  }

  // ---- Quick filter (before scoring) -----------------------------------------------------------------
  const YEARLY = { hour: 2080, week: 52, month: 12, year: 1 };
  function quickFilter(job, settings = {}, profile = {}) {
    const tracks = AJP.tracks ? AJP.tracks.list(profile) : [];
    const withTitles = tracks.map((t) => ({ ...t, targetTitles: t.targetTitles && t.targetTitles.length ? t.targetTitles : profile.targetRoles || [] })).filter((t) => t.targetTitles.length);
    if (withTitles.length) {
      const fit = Math.max(...withTitles.map((t) => AJP.tracks.titleFit(job.title, t)));
      if (fit < 0.34) return { pass: false, reason: 'title' };
    }
    const want = settings.remote || 'any';
    if (want !== 'any' && job.remote && job.remote !== want && !(want === 'hybrid' && job.remote === 'remote')) return { pass: false, reason: 'remote' };
    const places = (settings.locations || []).map((l) => AJP.normKey(l)).filter(Boolean);
    if (places.length && job.locations.length && job.remote !== 'remote') {
      const hit = job.locations.some((l) => places.some((p) => AJP.normKey(l).includes(p)));
      if (!hit) return { pass: false, reason: 'location' };
    }
    const min = Number(settings.minSalary) || 0;
    if (min && job.salary && job.salary.max) {
      const yearly = job.salary.max * (YEARLY[job.salary.period] || 1);
      if (yearly < min) return { pass: false, reason: 'salary' };
    }
    return { pass: true };
  }

  // ---- Seen + pruning ---------------------------------------------------------------------------------
  function markSeen(seen, keys, now = Date.now()) {
    const out = { ...(seen || {}) };
    const day = new Date(now).toISOString().slice(0, 10);
    for (const k of keys) if (!out[k]) out[k] = day;
    return out;
  }
  function prune({ jobs = [], seen = {} } = {}, now = Date.now()) {
    const keepSeen = Object.fromEntries(Object.entries(seen).filter(([, d]) => now - Date.parse(d) < LIMITS.seenDays * DAY));
    const keepJobs = jobs
      .filter((j) => !(j.status === 'dismissed' && now - Date.parse(j.dismissedAt || j.foundAt || 0) > LIMITS.dismissedDays * DAY))
      .sort((a, b) => String(b.foundAt || '').localeCompare(String(a.foundAt || '')))
      .slice(0, LIMITS.jobs);
    return { jobs: keepJobs, seen: keepSeen };
  }

  AJP.radar.core = { LIMITS, decodeEntities, htmlToText, xmlItems, xmlValue, xmlValues, parseDate, salaryFromText, remoteFrom, normalize, quickFilter, markSeen, prune };
})();
