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
  /*
   * Quick filter (before scoring), per career track (up to 3): the job must fit one track's TITLES first, then THAT
   * track's location and work-type preferences (the track's own, else the profile's). Job Radar settings can narrow
   * further (locations, work type, minimum salary). Unknown values pass: better to show a job than to hide a good one.
   *   → { pass, reason?, trackId? }
   */
  // A job title fits a target title when most of its words are there: all of a 2-word title, 2 of 3, 3 of 4…
  // ("Data Engineer" ≠ "Senior Software Engineer"). Word forms count ("engineer" ~ "engineering", "sr" = "senior").
  const STOP = new Set(['and', 'the', 'of', 'for', 'remote', 'hybrid', 'a', 'an', 'to', 'in', 'at', 'with']);
  // Phrases that only look like data work: "Data Center ... Engineer" is a facility job, "Data Entry" is clerical.
  const PHRASES = [[/\bdata\s*cent(?:er|re)s?\b/gi, 'datacenter'], [/\bdata\s*entry\b/gi, 'dataentry']];
  const words = (s) => {
    let t = String(s || '').replace(/\bsr\b\.?/gi, 'senior').replace(/\bjr\b\.?/gi, 'junior');
    for (const [re, w] of PHRASES) t = t.replace(re, w);
    return AJP.normKey(t).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  };
  // Level words say how senior, not what the job is: "Senior Data Engineer" must match on Data + Engineer.
  const LEVEL = new Set(['senior', 'junior', 'lead', 'staff', 'principal', 'chief', 'head', 'associate', 'intern', 'entry', 'mid', 'level', 'ii', 'iii', 'iv', 'vp', 'svp', 'avp', 'director', 'distinguished', 'fellow']);
  const core = (ws) => {
    const c = ws.filter((w) => !LEVEL.has(w));
    return c.length ? c : ws;
  };
  const same = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));
  function titleFits(jobTitle, titles) {
    const J = words(jobTitle);
    return (titles || []).some((t) => {
      const T = [...new Set(core(words(t)))];
      if (!T.length) return false;
      const hit = T.filter((w) => J.some((j) => same(w, j))).length;
      return hit >= Math.ceil(T.length * 0.6);
    });
  }
  // Countries / regions named in locations (remote jobs are often limited to one: "Remote Canada", "Remote - EMEA").
  const COUNTRIES = { 'united states': /\b(united states|usa|u\.s\.a?\.?|us)\b/i, canada: /\bcanada\b/i, mexico: /\bmexico\b/i, brazil: /\bbrazil\b/i, 'united kingdom': /\b(united kingdom|uk|england|scotland|london)\b/i, ireland: /\bireland\b/i, germany: /\bgermany\b/i, france: /\bfrance\b/i, spain: /\bspain\b/i, portugal: /\bportugal\b/i, netherlands: /\bnetherlands\b/i, poland: /\bpoland\b/i, india: /\bindia\b/i, singapore: /\bsingapore\b/i, australia: /\baustralia\b/i, japan: /\bjapan\b/i, israel: /\bisrael\b/i, argentina: /\bargentina\b/i, colombia: /\bcolombia\b/i, philippines: /\bphilippines\b/i, romania: /\bromania\b/i, sweden: /\bsweden\b/i, switzerland: /\bswitzerland\b/i, italy: /\bitaly\b/i, emea: /\b(emea|europe|eu)\b/i, apac: /\b(apac|asia)\b/i, latam: /\blatam\b/i };
  const US_STATE = /,\s*(A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/;
  const countriesIn = (list) => {
    const out = new Set();
    for (const l of list || []) {
      for (const [c, re] of Object.entries(COUNTRIES)) if (re.test(l)) out.add(c);
      if (US_STATE.test(l)) out.add('united states');
    }
    return out;
  };
  // A remote job limited to other countries does not fit (when your places tell which country you are in).
  function remoteCountryFits(job, places) {
    const mine = countriesIn(places);
    if (!mine.size) return true;
    const theirs = countriesIn(job.locations);
    return !theirs.size || [...theirs].some((c) => mine.has(c));
  }
  const placeKey = (s) => AJP.normKey(String(s || '').replace(/\b(remote|hybrid|on-?site)\b/gi, ' '));
  function placeFits(job, areas) {
    const places = (areas || []).map((a) => String(a)).filter(Boolean);
    if (!places.length || !job.locations.length) return true;
    if (job.remote === 'remote' && places.some((p) => /remote/i.test(p))) return true;
    const locs = job.locations.map((l) => ` ${AJP.normKey(l)} `);
    // "Remote - US" is a wish for remote work (handled by remoteCountryFits), not a place for on-site jobs.
    const onsite = places.filter((p) => !/\bremote\b/i.test(p));
    if (!onsite.length) return job.remote !== 'onsite' && job.remote !== 'hybrid' ? true : false;
    // Whole words only ("us" is not in "austin").
    const has = (l, k) => k && l.includes(` ${k} `);
    return onsite.some((p) => {
      const city = placeKey(p.split(',')[0]);
      const full = placeKey(p);
      return locs.some((l) => has(l, city) || has(l, full));
    });
  }
  function workTypeFits(job, wt) {
    if (!job.remote || !wt || !Object.values(wt).some(Boolean)) return true;
    return wt[job.remote] !== false;
  }
  /*
   * Level near your experience (titles) and people management only by choice:
   *  - Manager / Director / Head of / VP titles fit only a track whose own titles are management ones
   *    (add a "Data Engineering Manager" track to see those).
   *  - With your years known: 8+ → Senior, Lead, Staff, Principal (not Junior / Mid / "Engineer I-II" / Intern);
   *    5-8 → Mid to Lead; 2-5 → Junior to Senior; under 2 → Intern to Mid. Titles without a level pass
   *    (the years the description asks for are checked after scoring: experienceFits).
   */
  const MGMT = new Set(['manager', 'director', 'executive']);
  function levelFits(jobTitle, trackTitles, years) {
    const X = AJP.experience;
    if (!X) return true;
    const jl = X.fromTitle(jobTitle);
    if (!jl) return true;
    if (MGMT.has(jl.id) && (trackTitles || []).length) return trackTitles.some((t) => { // no titles at all: no preference
      const tl = X.fromTitle(t);
      return tl && MGMT.has(tl.id);
    });
    if (years == null || isNaN(years)) return true;
    const [lo, hi] = years >= 8 ? [3, 4] : years >= 5 ? [2, 4] : years >= 2 ? [1, 3] : [0, 2];
    return jl.n >= lo && jl.n <= hi;
  }
  // Years the description asks for, near yours: not far more (asked > yours + 2), not a junior role (asked ≤ 5 and
  // under half of yours). 15 years: "10+", "12+", "8+" fit; "3+" or "20+" don't. Unknown → fits.
  // A JD can ask for two things: "10+ years of experience" AND "4+ years leading / managing a team". The leadership
  // years say nothing about how senior the job is, so they never make a job "too junior" (only the general years do).
  const LEADING = /\b(lead|leads|leading|led|leader|leadership|manag\w*|people|direct reports|mentor\w*|supervis\w*|team)\b/i;
  const isLeadershipYears = (quote) => LEADING.test(String(quote || ''));
  function experienceFits(job) {
    const asked = job && job.yearsAsked;
    const have = job && job.yearsHave;
    if (asked == null || have == null) return true;
    if (asked > have + 2) return false;
    if (asked <= 5 && asked < have / 2 && !isLeadershipYears(job.yearsQuote)) return false;
    return true;
  }
  // Your total years (Admin → Profile, else work history, else the resume): used for the level rule.
  function userYears(profile, resumes) {
    if (!AJP.experience) return null;
    const items = (resumes && resumes.items) || [];
    const r = items.find((x) => x.id === (resumes && resumes.activeId)) || items[0];
    return AJP.experience.candidate(profile, r ? r.text : '').years;
  }

  function quickFilter(job, settings = {}, profile = {}, ctx = {}) {
    const tracks = AJP.tracks ? AJP.tracks.list(profile) : [];
    const views = tracks.map((t) => ({ id: t.id, titles: t.targetTitles && t.targetTitles.length ? t.targetTitles : profile.targetRoles || [], areas: t.areas && t.areas.length ? t.areas : profile.areas || [], workTypes: t.workTypes && Object.values(t.workTypes).some(Boolean) ? t.workTypes : profile.workTypes }));
    const titled = views.filter((v) => v.titles.length);
    // 1. Role: fits the titles of at least one track (no titles anywhere → every job goes on to scoring)
    const byTitle = titled.length ? titled.filter((v) => titleFits(job.title, v.titles)) : views;
    if (!byTitle.length) return { pass: false, reason: 'title' };
    // 1b. Level: near your experience; management titles only for management tracks
    const fitting = byTitle.filter((v) => levelFits(job.title, v.titles, ctx.years));
    if (!fitting.length) return { pass: false, reason: 'level' };
    // 2. Location + work type: Job Radar settings when set, else the track's (or profile's) preferences
    const want = settings.remote || 'any';
    const custom = (settings.locations || []).filter(Boolean);
    const placed = fitting.filter((v) => {
      const wtOk = want !== 'any' ? !job.remote || job.remote === want || (want === 'hybrid' && job.remote === 'remote') : workTypeFits(job, v.workTypes);
      if (!wtOk) return false;
      if (job.remote === 'remote') return remoteCountryFits(job, custom.length ? custom : v.areas); // remote: any place in your country
      return placeFits(job, custom.length ? custom : v.areas);
    });
    if (!placed.length) return { pass: false, reason: want !== 'any' || fitting.every((v) => !workTypeFits(job, v.workTypes)) ? 'remote' : 'location' };
    // 3. Minimum salary (jobs without a salary pass)
    const min = Number(settings.minSalary) || 0;
    if (min && job.salary && job.salary.max) {
      const yearly = job.salary.max * (YEARLY[job.salary.period] || 1);
      if (yearly < min) return { pass: false, reason: 'salary' };
    }
    return { pass: true, trackId: placed[0].id };
  }

  /*
   * Eligibility: what the job text says about visas, citizenship and clearance, against your Auto-apply details.
   * Never hides a job: 'blocked' jobs are shown apart with the reason and left out of alerts and the badge;
   * 'check' means it may matter (you decide); nothing found → 'ok'.
   */
  const RX = {
    noSponsor: /\b(?:no|not|unable to|cannot|can['’]?t|won['’]?t|will not|do not|does not|don['’]?t|are not able to|is not able to)\s+(?:currently\s+)?(?:provide|offer|support|able to)?\s*(?:visa\s+|h-?1b\s+|employment\s+)?sponsor(?:ship)?\b|\bsponsorship\s+(?:is\s+)?(?:not|unavailable)\b|\bwithout\s+(?:the\s+need\s+for\s+)?(?:current\s+or\s+future\s+|any\s+)?(?:visa\s+|employer\s+|employment\s+)?sponsorship\b|\bnot\s+eligible\s+for\s+(?:visa\s+)?sponsorship\b|\bno\s+(?:visa|h-?1b)\s+(?:sponsorship|transfers?)\b/i,
    sponsors: /\b(?:visa|h-?1b|immigration)\s+sponsorship\s+(?:is\s+)?(?:available|provided|offered|possible)\b|\b(?:we|will|can|able to)\s+(?:offer|provide|support)\s+(?:visa\s+|h-?1b\s+)?sponsorship\b|\bsponsorship\s+(?:is\s+)?available\b/i,
    citizen: /\bmust\s+be\s+(?:a\s+)?(?:u\.?\s?s\.?|united\s+states)\s+citizen|\b(?:u\.?\s?s\.?|united\s+states)\s+citizen(?:ship)?\s+(?:is\s+)?(?:required|only|mandatory)|\bcitizenship\s+(?:is\s+)?required|\b(?:u\.?\s?s\.?\s+)?citizens?\s+only\b|\bgreen\s+card\s+holders?\s+only|\b(?:itar|export[-\s]control(?:led)?)\b/i,
    clearance: /\b(?:active\s+)?(?:security|secret|top\s+secret|ts\/sci|public\s+trust)\s+clearance\b|\bclearance\s+(?:is\s+)?required\b|\bts\/sci\b/i,
  };
  function eligibility(text, profile = {}) {
    const t = String(text || '');
    const aa = (profile && profile.autoApply) || {};
    const needs = /^y/i.test(aa.requireSponsorship || '');
    const citizen = /^y/i.test(aa.citizen || '') ? true : /^n/i.test(aa.citizen || '') || needs ? false : null;
    const flags = { noSponsor: RX.noSponsor.test(t), sponsors: false, citizen: RX.citizen.test(t), clearance: RX.clearance.test(t) };
    flags.sponsors = !flags.noSponsor && RX.sponsors.test(t);
    const reasons = [];
    let status = 'ok';
    const block = (r) => ((status = 'blocked'), reasons.push(r));
    const check = (r) => (status === 'ok' && (status = 'check'), reasons.push(r));
    if (flags.noSponsor) needs ? block('Says it can’t sponsor visas, and you need sponsorship') : aa.requireSponsorship ? null : check('Says it can’t sponsor visas');
    if (flags.citizen) citizen === false ? block('Requires U.S. citizenship (or a green card / export-control status)') : citizen === null ? check('May require U.S. citizenship') : null;
    if (flags.clearance) citizen === false ? block('Requires a security clearance (U.S. citizens only)') : check('Mentions a security clearance');
    return { status, reasons, flags };
  }

  // How fresh a posting is: applying early helps. today (< 24 h) · week (< 7 days) · older · unknown
  function freshness(job, now = Date.now()) {
    if (!job || !job.postedAt) return 'unknown';
    const h = (now - Date.parse(job.postedAt)) / 3600000;
    return h < 24 ? 'today' : h < 24 * 7 ? 'week' : 'older';
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

  // Bumped when the filter rules change: the background re-checks the listed jobs once with the new rules.
  const RULES_VERSION = 7;

  /*
   * Relevance: a job with a description must share at least MIN_TECH_SKILLS technical skills with you (soft skills like
   * communication or leadership don't count). A title can say "Data Engineer" while the job is physical security of
   * data center sites: the description decides. Fewer than 2 technical skills in your profile → that many.
   */
  const MIN_TECH_SKILLS = 2;
  const SOFT = new Set(['leadership', 'people management', 'mentoring', 'communication', 'cross-functional collaboration', 'problem solving', 'presentation skills', 'negotiation', 'customer service', 'stakeholder management', 'requirements gathering', 'agile', 'jira', 'confluence', 'project management', 'program management', 'roadmapping'].map((s) => AJP.normKey(s)));
  const isSoft = (name) => SOFT.has(AJP.normKey(name));
  const techMatches = (analysis) => ((analysis && analysis.matched) || []).filter((m) => !isSoft(m.skill)).length;
  function relevant(job, profile) {
    if (!experienceFits(job)) return false;
    if (job.descriptionLevel !== 'full' || job.techMatched == null) return true; // not judged yet (title only): keep
    const mineTech = ((profile && profile.skills) || []).filter((s) => !isSoft(s.name || s)).length;
    if (!mineTech) return true; // no technical skills in your profile yet: nothing to compare
    return job.techMatched >= Math.min(MIN_TECH_SKILLS, Math.max(1, mineTech));
  }

  AJP.radar.core = { RULES_VERSION, MIN_TECH_SKILLS, isSoft, techMatches, relevant, levelFits, experienceFits, isLeadershipYears, userYears, LIMITS, decodeEntities, htmlToText, xmlItems, xmlValue, xmlValues, parseDate, salaryFromText, remoteFrom, normalize, quickFilter, titleFits, remoteCountryFits, eligibility, freshness, markSeen, prune };
})();
