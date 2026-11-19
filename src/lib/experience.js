/*
 * experience.js — years-of-experience and seniority checks (offline, no AI).
 *
 *   AJP.experience.required(jdText)            -> { overall: {min, max, preferred, quote} | null, skills: [{skills[], min, anyOf, preferred, quote}] }
 *   AJP.experience.candidate(profile, resume)  -> { years, source, roles: [{start, end, text}], skillYears(name) }
 *   AJP.experience.jobLevel(title, reqYears)   -> { n, id, label, source } | null
 *   AJP.experience.myLevel(profile, years)     -> { n, id, label, source } | null
 *   AJP.experience.check({ jdText, jobTitle, profile, resumeText }) -> { years, seniority }   (the two fit rows)
 *
 * Rules worth knowing:
 *  - Only "N years" phrases about experience count ("5+ years of experience", "3+ years with Kafka"); company
 *    history ("founded 20 years ago", "for over 10 years we…"), ages and "4 year degree" are ignored.
 *  - The candidate's total comes from Admin → Profile "Total years of experience" when filled, else from the
 *    dates in Auto-apply → Work experience, else from the date ranges in the resume's Experience section
 *    (overlapping jobs are counted once). Education dates never count.
 *  - Years with a skill = the merged date ranges of the roles whose text mentions that skill (or a skill that
 *    implies it, e.g. Spring → Java).
 *  - These checks are shown as fit rows; they never change the skill match %.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.experience) return;

  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20 };
  const NUM = '(\\d{1,2}(?:\\.\\d)?|' + Object.keys(WORDS).join('|') + ')';
  const toNum = (s) => (s == null ? null : WORDS[String(s).toLowerCase()] != null ? WORDS[String(s).toLowerCase()] : parseFloat(s));
  // "at least 5", "5+", "5 plus", "3-5", "3 to 5", "5 or more" … followed by "years"/"yrs".
  const YEARS_RE = new RegExp(
    '(?:(at least|minimum(?: of)?|min\\.?|over|more than)\\s+)?' + NUM + '\\s*(\\+|plus)?\\s*(?:(?:-|–|—|to)\\s*' + NUM + '\\s*\\+?\\s*)?(?:or more\\s+)?(?:years?|yrs?)\\b[\'’]?',
    'gi');
  const BEFORE_NO = /(founded|for over|for more than|over the (past|last)|in the (past|last)|the (past|last|next)|within|every|in business|anniversary|warranty|up to|under|less than|aged?|than)\s*$/i;
  const AFTER_NO = /^\s*(old|of age|ago|in business|degree|college|university|program|bachelor|contract|warranty|anniversary)/i;
  const CONTEXT = /\b(experience|expertise|background|industry|professional|relevant|hands[- ]on|track record|working|work|engineering|development|developing|building|programming|coding|leading|managing|management|in (a|an) [a-z -]{0,30}role)\b/i;
  const GENERIC = /^\s*(?:of\s+)?(?:[a-z/-]+\s+){0,4}?(?:experience|expertise|background)\b/i;
  const SKILL_LEAD = /^\s*(?:of|with|in|using|on|programming in|developing (?:in|with)|working (?:with|in))\b/i;
  const PREF = /\b(preferred|ideally|a plus|nice[\s-]to[\s-]have|bonus|desired)\b/i;

  /*
   * What the job asks for. Uses matcher.sectionize so lines under "Nice to have" count as preferred.
   */
  function required(jdText) {
    const out = { overall: null, skills: [] };
    const lines = AJP.matcher.sectionize(jdText || '');
    const overall = [];
    for (const { text, kind } of lines) {
      YEARS_RE.lastIndex = 0;
      const hits = [];
      let m;
      while ((m = YEARS_RE.exec(text))) hits.push({ m, start: m.index, end: m.index + m[0].length });
      hits.forEach((h, i) => {
        const before = text.slice(Math.max(0, h.start - 30), h.start);
        let after = text.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : undefined);
        after = after.split(/[.;]\s|[.;]$|\(|\bincluding\b/i)[0].slice(0, 110);
        if (BEFORE_NO.test(before) || AFTER_NO.test(after)) return;
        const lo = toNum(h.m[2]);
        const hi = toNum(h.m[4]);
        if (!(lo > 0) || lo > 30) return;
        const min = lo;
        const max = hi && hi > lo ? hi : null;
        const preferred = kind === 'preferred' || PREF.test(text);
        const quote = text.slice(h.start, Math.min(text.length, h.end + after.length)).trim().slice(0, 140);
        const skillReq = (txt) => {
          const skills = [...AJP.matcher.findSkills(txt).keys()];
          if (skills.length) out.skills.push({ skills, min, max, anyOf: skills.length > 1 && /\bor\b|\//i.test(txt), preferred, quote });
          return skills.length;
        };
        const g = after.match(GENERIC);
        if (g && skillReq(g[0])) {
          // "5 years of Java experience" → about that skill only
        } else if (g) {
          // "5+ years of (professional) experience [with Java]" → overall, and per skill when named right after.
          overall.push({ min, max, preferred, quote });
          const rest = after.slice(g[0].length);
          if (/^\s*(with|in|using|on|building|developing)\b/i.test(rest)) skillReq(rest.slice(0, 70));
        } else if (SKILL_LEAD.test(after) && skillReq(after)) {
          // "3+ years with Kafka", "5 years of Java or Python"
        } else if (CONTEXT.test(after) || /\bexperience\b/i.test(before)) {
          overall.push({ min, max, preferred, quote });
        }
      });
    }
    // The job's overall requirement: the highest required one; preferred ones only if nothing is required.
    const req = overall.filter((o) => !o.preferred);
    const pool = req.length ? req : overall;
    if (pool.length) out.overall = pool.reduce((a, b) => (b.min > a.min ? b : a));
    // Skill-specific asks: keep the strongest per skill set.
    const seen = new Map();
    for (const s of out.skills) {
      const k = s.skills.join('|');
      if (!seen.has(k) || seen.get(k).min < s.min) seen.set(k, s);
    }
    out.skills = [...seen.values()];
    return out;
  }

  // ---- Dates --------------------------------------------------------------------------------------
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  // "Present" and its many spellings ("Till date" / "To date" are common in Indian and UK resumes).
  const PRESENT_WORDS = 'present|current|currently|now|today|ongoing|till date|till now|tilldate|to date|todate|to present|date';
  const PRESENT = new RegExp(`^(${PRESENT_WORDS})$`, 'i');
  const now = () => {
    const d = new Date();
    return d.getFullYear() * 12 + d.getMonth();
  };
  // One date → months since year 0 (start of that month). end=true → a bare year means its December.
  function monthIndex(s, end = false) {
    const t = String(s || '').trim().replace(/\.$/, '');
    if (!t) return null;
    if (PRESENT.test(t)) return now();
    let m;
    if ((m = t.match(/^(\d{1,2})[/.-](\d{4})$/))) return +m[2] * 12 + Math.min(11, Math.max(0, +m[1] - 1));
    if ((m = t.match(/^(\d{4})[/.-](\d{1,2})(?:[/.-]\d{1,2})?$/))) return +m[1] * 12 + Math.min(11, Math.max(0, +m[2] - 1));
    if ((m = t.match(/^([a-z]{3,9})\.?,?[\s'’-]*(\d{4})$/i))) {
      const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      if (mi >= 0) return +m[2] * 12 + mi;
    }
    // "Jun'19" / "Jun ’19"
    if ((m = t.match(/^([a-z]{3,9})\.?\s*['’](\d{2})$/i))) {
      const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      const yy = +m[2];
      if (mi >= 0) return (yy > 50 ? 1900 + yy : 2000 + yy) * 12 + mi;
    }
    if ((m = t.match(/^(\d{4})$/))) return +m[1] * 12 + (end ? 11 : 0);
    return null;
  }
  // Only REAL month names before a year ("Jan 2019", "September 2019") — never a company name ("Acme 2019").
  const MON = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b';
  // "Jan 2019", "January, 2019", "Jun-2019", "06/2019", "06-2019", "2019-06", "2019", "Jun'19"
  const DATE = '(?:\\b' + MON + '\\.?\\s*[\'’]\\d{2}\\b|(?:\\b' + MON + '\\.?,?[\\s-]+)?(?:\\d{1,2}[/.-])?(?:19|20)\\d{2}(?:[/.-]\\d{1,2})?)';
  const RANGE_RE = new RegExp('(' + DATE + ')\\s*(?:-|–|—|to|until|till)\\s*(' + DATE + '|' + PRESENT_WORDS.replace(/ /g, '\\s+') + ')', 'i');
  function rangeIn(line) {
    const m = String(line).match(RANGE_RE);
    if (!m) return null;
    const start = monthIndex(m[1]);
    const end = monthIndex(m[2], true);
    if (start == null || end == null || end < start || start < 1950 * 12) return null;
    return { start, end: Math.min(end, now()) };
  }
  // Merge overlapping ranges → total months (a month counted once).
  function totalMonths(ranges) {
    const rs = ranges.filter(Boolean).map((r) => [r.start, r.end + 1]).sort((a, b) => a[0] - b[0]);
    let sum = 0;
    let cur = null;
    for (const r of rs) {
      if (!cur || r[0] > cur[1]) {
        if (cur) sum += cur[1] - cur[0];
        cur = r.slice();
      } else cur[1] = Math.max(cur[1], r[1]);
    }
    if (cur) sum += cur[1] - cur[0];
    return sum;
  }
  const years = (months) => Math.round((months / 12) * 10) / 10;

  // ---- The candidate ------------------------------------------------------------------------------
  const EXP_HEAD = /(experience|employment|work history|career|professional background)/i;
  const OTHER_HEAD = /(education|skills|projects|certifications?|awards|publications|volunteer|languages|interests|summary|profile|courses|training)/i;

  // Roles with date ranges from the resume's Experience section (all text when the resume has no headings).
  function resumeRoles(text) {
    const lines = String(text || '').split(/\r?\n/);
    // Headings: "## Experience", "EXPERIENCE", or a short plain line like "Professional Experience" / "Education:".
    const plainHead = (l) => {
      const t = l.replace(/:$/, '').trim();
      return t.length <= 40 && t.split(/\s+/).length <= 4 && !/[\d.,;|•]/.test(t) && !/^[-*]/.test(t) && (EXP_HEAD.test(t) || OTHER_HEAD.test(t));
    };
    const headOf = (l) => (l.match(/^#{1,2}\s+(.+)/) || [])[1] || (/^[A-Z][A-Z &/]{3,40}$/.test(l) ? l : plainHead(l) ? l.replace(/:$/, '') : null);
    const hasHeads = lines.some((l) => headOf(l.trim()));
    let inExp = !hasHeads;
    const roles = [];
    let cur = null;
    let prev = '';
    for (const raw of lines) {
      const line = raw.trim();
      const head = headOf(line);
      if (head) {
        inExp = EXP_HEAD.test(head) && !OTHER_HEAD.test(head.replace(/experience/i, ''));
        cur = null;
        prev = '';
        continue;
      }
      if (!inExp || !line) continue;
      const r = rangeIn(line);
      if (r) {
        cur = { ...r, text: (prev && !/^[-*•]/.test(prev) ? prev + '\n' : '') + line };
        roles.push(cur);
      } else if (cur) cur.text += '\n' + line;
      prev = line;
    }
    if (!roles.length && hasHeads) return datedLinesAnywhere(lines);
    return roles;
  }

  // Fallback when no Experience heading was recognised (unusual headings, two-column PDFs): every dated line starts
  // a job, except education lines (a degree, school or GPA on the same or the previous line).
  const EDU_LINE = /\b(university|college|school|institute|academy|bachelor|master|b\.?\s?s\.?c?|m\.?\s?s\.?c?|b\.?\s?tech|m\.?\s?tech|b\.?\s?e\.?|mba|ph\.?\s?d|degree|diploma|gpa|cgpa|graduat)/i;
  function datedLinesAnywhere(lines) {
    const roles = [];
    let cur = null;
    let prev = '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const r = rangeIn(line);
      if (r && !EDU_LINE.test(line) && !EDU_LINE.test(prev)) {
        cur = { ...r, text: (prev && !/^[-*•]/.test(prev) ? prev + '\n' : '') + line };
        roles.push(cur);
      } else if (r) cur = null; // an education entry: its lines are not job text
      else if (cur) cur.text += '\n' + line;
      prev = line;
    }
    return roles;
  }

  function historyRoles(profile) {
    const ex = (profile && profile.autoApply && profile.autoApply.experience) || [];
    return ex.map((e) => {
      const start = monthIndex(e.start);
      const end = e.current ? now() : monthIndex(e.end || (e.start ? 'present' : ''), true);
      if (start == null || end == null || end < start) return null;
      return { start, end: Math.min(end, now()), text: [e.title, e.company, e.description].filter(Boolean).join('\n') };
    }).filter(Boolean);
  }

  // Skills mentioned in a role, plus the skills they imply (Spring → Java).
  function roleSkills(text) {
    const set = new Set(AJP.matcher.findSkills(text).keys());
    for (const s of [...set]) for (const x of AJP.matcher.impliedBy(s)) set.add(x);
    return set;
  }

  function candidate(profile, resumeText) {
    const fromProfile = parseFloat(profile && profile.personal && profile.personal.yearsExperience);
    const hist = historyRoles(profile);
    const res = resumeRoles(resumeText);
    const roles = hist.concat(res).map((r) => ({ ...r, skills: roleSkills(r.text) }));
    let total = null;
    let source = null;
    if (fromProfile >= 0 && !isNaN(fromProfile)) {
      total = fromProfile;
      source = 'profile';
    } else if (hist.length) {
      total = years(totalMonths(hist));
      source = 'work history';
    } else if (res.length) {
      total = years(totalMonths(res));
      source = 'resume';
    }
    const skillYears = (name) => {
      const n = AJP.norm(name);
      const rs = roles.filter((r) => [...r.skills].some((s) => AJP.norm(s) === n));
      return rs.length ? years(totalMonths(rs)) : null;
    };
    return { years: total, source, roles, skillYears };
  }

  // ---- Seniority ----------------------------------------------------------------------------------
  const LEVELS = [
    { n: 6, id: 'executive', label: 'Executive', re: /\b(vp|svp|evp|vice president|chief [a-z]+ officer|cto|cio|ciso|ceo|cfo|coo)\b/i },
    { n: 5, id: 'director', label: 'Director', re: /\b(director|head of)\b/i },
    { n: 4, id: 'lead', label: 'Staff / Lead / Principal', re: /\b(staff|lead|principal|architect|distinguished|fellow)\b|\b(engineer|developer|scientist) (iv|v)\b/i },
    { n: 4, id: 'manager', label: 'Manager', re: /\bmanager\b(?! of one)/i },
    { n: 3, id: 'senior', label: 'Senior', re: /\b(senior|sr\.?)(?=\s|$)|\b(engineer|developer|analyst|scientist) iii\b/i },
    { n: 2, id: 'mid', label: 'Mid-level', re: /\b(mid[- ]level|intermediate)\b|\b(engineer|developer|analyst|scientist) ii\b/i },
    { n: 1, id: 'junior', label: 'Junior / Entry', re: /\b(junior|jr\.?|entry[- ]level|graduate|new grad|trainee)\b|\b(engineer|developer|analyst|scientist) i\b/i },
    { n: 0, id: 'intern', label: 'Intern', re: /\b(intern|internship|co-?op|apprentice)\b/i },
  ];
  const byN = (n) => LEVELS.find((l) => l.n === n && l.id !== 'manager');
  function fromTitle(title) {
    const t = String(title || '');
    // "Product Manager" is a role, not a people-manager level, unless the title says so.
    const hit = LEVELS.find((l) => l.re.test(t) && !(l.id === 'manager' && /\b(product|project|program|account|marketing|community|office|case)\s+manager\b/i.test(t)));
    return hit ? { n: hit.n, id: hit.id, label: hit.label } : null;
  }
  function fromYears(y) {
    if (y == null || isNaN(y)) return null;
    const n = y < 2 ? 1 : y < 5 ? 2 : y < 8 ? 3 : 4;
    return { ...byN(n), n };
  }
  function jobLevel(title, reqYears) {
    const t = fromTitle(title);
    if (t) return { ...t, source: 'title' };
    const y = reqYears != null ? fromYears(reqYears) : null;
    return y ? { n: y.n, id: y.id, label: y.label, source: 'years asked' } : null;
  }
  function myLevel(profile, yrs) {
    const t = fromTitle(profile && profile.personal && profile.personal.currentTitle);
    if (t) return { ...t, source: 'your title' };
    const y = fromYears(yrs);
    return y ? { n: y.n, id: y.id, label: y.label, source: 'your years' } : null;
  }

  /*
   * The two fit rows for the panel.
   *   years:     { asked, have, source, ok: true|false|null, close, skills: [{skill, asked, have, ok, preferred}] }
   *   seniority: { job, mine, diff, ok, note }
   */
  function check({ jdText, jobTitle, profile, resumeText }) {
    const req = required(jdText);
    const me = candidate(profile || {}, resumeText);
    const asked = req.overall;
    let ok = null;
    let close = false;
    if (asked && me.years != null) {
      ok = me.years >= asked.min;
      close = !ok && me.years >= asked.min - 1;
    }
    const skills = [];
    for (const s of req.skills) {
      const per = s.skills.map((k) => ({ skill: k, have: me.skillYears(k) }));
      const best = per.reduce((a, b) => ((b.have || 0) > (a.have || 0) ? b : a), per[0]);
      const list = s.anyOf ? [best] : per;
      for (const p of list) {
        skills.push({ skill: s.anyOf ? s.skills.join(' or ') : p.skill, asked: s.min, have: p.have, ok: p.have == null ? null : p.have >= s.min, preferred: s.preferred, quote: s.quote });
      }
    }
    const yearsRow = { asked: asked ? asked.min : null, askedMax: asked ? asked.max : null, preferred: asked ? asked.preferred : false, quote: asked ? asked.quote : '', have: me.years, source: me.source, ok, close, skills };

    const job = jobLevel(jobTitle, asked ? asked.min : null);
    const mine = myLevel(profile, me.years);
    let sOk = null;
    let note = '';
    let diff = null;
    if (job && mine) {
      diff = job.n - mine.n;
      sOk = Math.abs(diff) <= 1;
      note = diff === 0 ? 'same level' : diff === 1 ? 'a step up' : diff === -1 ? 'a step down' : diff > 1 ? 'a big step up (stretch)' : 'below your level';
    }
    return { years: yearsRow, seniority: { job, mine, diff, ok: sOk, note } };
  }

  AJP.experience = { required, candidate, resumeRoles, monthIndex, totalMonths, jobLevel, myLevel, fromTitle, check };
})();
