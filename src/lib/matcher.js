/*
 * matcher.js — offline job/profile matching. No AI required.
 *
 *   AJP.matcher.analyze({ jdText, profile, resumeText, aiSkills, jobTitle, jobLocation })
 *     -> { score, matched[], missing[], similarCount, fit{workType,salary,location,years,seniority}, jdSkillCount }
 *
 * Scoring: every skill the JD mentions gets a weight
 *   required section = 3, unlabeled = 2, preferred / "nice to have" = 1
 * score = 100 * (weight of skills the user has) / (weight of all JD skills).
 * Synonyms (skills-dictionary.js): a skill implied by one you have counts fully (Next.js → React);
 * a SIMILAR skill gives half credit (Azure for AWS) and the gap says "you have Azure".
 * Years of experience and seniority (experience.js) are fit rows; they never change the score.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.matcher) return;

  const W = { required: 3, neutral: 2, preferred: 1 };
  const SIMILAR_CREDIT = 0.5;
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---- Dictionary compilation (once) --------------------------------------
  let compiled = null; // [{name, res: RegExp[]}]
  let aliasIndex = null; // normalized alias -> canonical

  function aliasRegex(alias) {
    const cs = alias.startsWith('=');
    const a = cs ? alias.slice(1) : alias;
    const body = escapeRe(a).replace(/\s+/g, '[\\s-]+');
    // Boundaries that also respect "+", "#", "." so "c++"/"c#"/".net"/"node.js" work.
    const after = cs ? '(?![A-Za-z0-9+#&/-])' : '(?![a-z0-9+#])';
    return new RegExp('(?<![A-Za-z0-9+#.])' + body + after, cs ? 'g' : 'gi');
  }

  // Short tokens ("Go", "js", "ML") are matched case-sensitively (as written + UPPERCASE)
  // to avoid false hits on ordinary words.
  function regexesFor(alias) {
    if (alias.startsWith('=')) return [aliasRegex(alias)];
    if (alias.length <= 2) {
      const forms = new Set([alias, alias.toUpperCase()]);
      return [...forms].map((f) => aliasRegex('=' + f));
    }
    return [aliasRegex(alias)];
  }

  function compile() {
    if (compiled) return;
    compiled = [];
    aliasIndex = new Map();
    for (const line of AJP.SKILLS || []) {
      const [name, ...aliases] = line.split('|');
      const all = [name, ...aliases];
      compiled.push({ name, res: all.flatMap(regexesFor) });
      for (const a of all) aliasIndex.set(AJP.norm(a.replace(/^=/, '')), name);
    }
  }

  // Map any user-typed skill to its canonical dictionary name (or keep as-is).
  function canonical(skill) {
    compile();
    const n = AJP.norm(skill);
    return aliasIndex.get(n) || String(skill).trim();
  }

  function count(text, re) {
    re.lastIndex = 0;
    let n = 0;
    while (re.exec(text)) {
      n++;
      if (n > 50) break;
    }
    return n;
  }

  // Find dictionary skills (+ optional extra custom skill names) in text.
  // Returns Map<canonicalName, occurrences>.
  function findSkills(text, extra = []) {
    compile();
    const found = new Map();
    if (!text) return found;
    for (const { name, res } of compiled) {
      let n = 0;
      for (const re of res) n += count(text, re);
      if (n) found.set(name, n);
    }
    for (const s of extra) {
      const raw = String(s).trim();
      // Dictionary skills were already scanned above; only scan the user's custom ones.
      if (!raw || aliasIndex.has(AJP.norm(raw))) continue;
      const name = raw;
      let n = 0;
      for (const re of regexesFor(raw)) n += count(text, re);
      if (n) found.set(name, n);
    }
    return found;
  }

  // ---- Synonyms ---------------------------------------------------------------
  // Everything a skill implies, transitively (Next.js → React → JavaScript).
  function impliedBy(skill) {
    const map = AJP.SKILL_IMPLIES || {};
    const out = new Set();
    const todo = [...(map[skill] || [])];
    while (todo.length) {
      const s = todo.shift();
      if (out.has(s) || s === skill) continue;
      out.add(s);
      todo.push(...(map[s] || []));
    }
    return [...out];
  }
  function similarTo(skill) {
    const n = AJP.norm(skill);
    const g = (AJP.SKILL_SIMILAR || []).find((grp) => grp.some((x) => AJP.norm(x) === n));
    return g ? g.filter((x) => AJP.norm(x) !== n) : [];
  }

  // ---- JD sectioning -------------------------------------------------------
  const PREF_HEAD = /(preferred|nice[\s-]to[\s-]have|bonus|pluses|a plus|desired|good to have|not required|extra credit)/i;
  const REQ_HEAD = /(required|requirements|qualifications|must[\s-]have|what you('|’)ll need|what you bring|looking for|you have|who you are|minimum|basic qualifications|skills|experience)/i;
  // "Kafka is a plus", "Go (preferred)", "Terraform preferred." — but not "our preferred vendors".
  const INLINE_PREF = /(\ba plus\b|\b(is|are|strongly) preferred\b|\(preferred\)|\bpreferred[.:;)]?\s*$|nice[\s-]to[\s-]have|\bbonus\b)/i;
  const OTHER_HEAD = /(about (us|the company)|benefits|perks|what we offer|compensation|equal opportunity|eeo|our values|why join)/i;

  function sectionize(jd) {
    const lines = String(jd || '').split(/\r?\n/);
    const out = [];
    let kind = 'neutral';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      // A bullet ("- 3+ years of Go") is content, never a heading, however short.
      const isHeading = line.length < 80 && !/[.;]$/.test(line) && line.split(/\s+/).length <= 9 && !/^[-*•▪●◦·]\s/.test(line);
      if (isHeading) {
        if (PREF_HEAD.test(line)) kind = 'preferred';
        else if (OTHER_HEAD.test(line)) kind = 'other';
        else if (REQ_HEAD.test(line)) kind = 'required';
      }
      let lineKind = kind;
      if (kind !== 'preferred' && !isHeading && INLINE_PREF.test(line)) {
        lineKind = 'preferred';
      }
      out.push({ text: line, kind: lineKind === 'other' ? 'neutral' : lineKind });
    }
    return out;
  }

  // ---- Fit checks ----------------------------------------------------------
  function detectWorkTypes(text) {
    const t = AJP.norm(text);
    const out = [];
    if (/\b(remote|work from home|wfh|distributed team)\b/.test(t) && !/\bnot (a )?remote\b|\bno remote\b/.test(t)) out.push('remote');
    if (/\bhybrid\b/.test(t)) out.push('hybrid');
    if (/\b(on[\s-]?site|in[\s-]office|in the office|office[\s-]based)\b/.test(t)) out.push('onsite');
    return out;
  }

  function toNumber(s) {
    let v = String(s).toLowerCase().replace(/[,\s$]/g, '');
    const k = v.endsWith('k');
    v = parseFloat(v);
    if (isNaN(v)) return null;
    return k ? v * 1000 : v;
  }

  function parseSalary(text) {
    const num = '\\$\\s?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\$\\s?\\d+(?:\\.\\d+)?\\s?[kK]?';
    const re = new RegExp('(' + num + ')\\s*(?:-|–|—|to)\\s*(' + num + '|\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?\\s?[kK]?)', 'g');
    const m = re.exec(text || '');
    if (!m) return null;
    let min = toNumber(m[1]);
    let max = toNumber(m[2]);
    if (min == null || max == null) return null;
    const hourly = max < 500 || /\/\s?(hr|hour)|per hour|hourly/i.test(text.slice(m.index, m.index + m[0].length + 20));
    if (hourly) {
      min *= 2080;
      max *= 2080;
    }
    if (min > max) [min, max] = [max, min];
    return { min: Math.round(min), max: Math.round(max), hourly };
  }

  // ---- Countries: "remote" can still mean "only in these countries" ------------------------------------
  const COUNTRIES = { 'united states': /\b(united states|usa|u\.s\.a?\.?|us)\b/i, canada: /\bcanada\b/i, mexico: /\bmexico\b/i, brazil: /\bbrazil\b/i, 'united kingdom': /\b(united kingdom|uk|england|scotland|london)\b/i, ireland: /\bireland\b/i, germany: /\bgermany\b/i, france: /\bfrance\b/i, spain: /\bspain\b/i, portugal: /\bportugal\b/i, netherlands: /\bnetherlands\b/i, poland: /\bpoland\b/i, india: /\bindia\b/i, singapore: /\bsingapore\b/i, australia: /\baustralia\b/i, japan: /\bjapan\b/i, israel: /\bisrael\b/i, argentina: /\bargentina\b/i, colombia: /\bcolombia\b/i, philippines: /\bphilippines\b/i, romania: /\bromania\b/i, sweden: /\bsweden\b/i, switzerland: /\bswitzerland\b/i, italy: /\bitaly\b/i, emea: /\b(emea|europe|eu)\b/i, apac: /\b(apac|asia)\b/i, latam: /\blatam\b/i };
  const US_CODES = 'AK|AL|AR|AZ|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY';
  const US_STATE = new RegExp(`(?:^|,)\\s*(?:${US_CODES})\\s*(?:$|,|\\d)`);
  const US_NAMES = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;
  const ANYWHERE = /\b(worldwide|anywhere|global|globally)\b/i;
  function countriesIn(list) {
    const out = new Set();
    for (const raw of list || []) {
      const l = String(raw || '').replace(/\b(remote|hybrid|on-?site)\b\s*[-–—:]?\s*/gi, '').trim();
      for (const [c, re] of Object.entries(COUNTRIES)) if (re.test(l)) out.add(c);
      if (US_STATE.test(l) || US_NAMES.test(l)) out.add('united states');
    }
    return out;
  }
  // Where you are: your areas, else your profile's country / state.
  function homeCountries(places, profile) {
    const fromPlaces = countriesIn(places);
    if (fromPlaces.size) return fromPlaces;
    const p = (profile && profile.personal) || {};
    return countriesIn([p.country, p.state]);
  }
  // True only when we know both sides and they don't overlap. Unknown → false: when unsure, show the job.
  function listedAbroad(locations, home) {
    if (!home || !home.size) return false;
    const list = (locations || []).filter(Boolean);
    if (list.some((l) => ANYWHERE.test(l))) return false;
    const there = countriesIn(list);
    return there.size > 0 && ![...there].some((c) => home.has(c));
  }

  function fitChecks(jdText, profile, jobLocation) {
    const wanted = Object.entries(profile.workTypes || {}).filter(([, v]) => v).map(([k]) => k);
    const jobTypes = detectWorkTypes(jdText);
    const workType = {
      job: jobTypes,
      wanted,
      ok: jobTypes.length ? jobTypes.some((t) => wanted.includes(t)) : null,
    };

    const js = parseSalary(jdText);
    const pmin = parseFloat(profile.salary && profile.salary.min) || null;
    const pmax = parseFloat(profile.salary && profile.salary.max) || null;
    let salaryOk = null;
    if (js && (pmin || pmax)) salaryOk = js.max >= (pmin || 0) && (!pmax || js.min <= pmax * 1.5);
    const salary = { job: js, wanted: { min: pmin, max: pmax }, ok: salaryOk };

    const raw = (jobLocation || '') + ' ' + jdText.slice(0, 3000);
    const hay = ` ${AJP.normKey(raw.replace(/\n/g, ' ').slice(0, 3100))} `;
    const areas = (profile.areas || []).filter(Boolean);
    // Whole words only ("NJ" is not in "enjoy"); short codes must match in capitals ("IN" is not "in").
    const hit = areas.find((a) => {
      if (/\bremote\b/i.test(a)) return false; // "Remote - US" is a wish for remote work, not a place
      const city = String(a).split(',')[0].trim();
      if (!city) return false;
      if (city.length <= 3) return new RegExp(`\\b${city.replace(/[^A-Za-z]/g, '')}\\b`).test(raw);
      return hay.includes(` ${AJP.normKey(city)} `);
    });
    const home = homeCountries(areas, profile);
    const abroad = listedAbroad(jobLocation ? [jobLocation] : [], home);
    const remoteOk = workType.job.includes('remote') && workType.wanted.includes('remote');
    const location = {
      job: jobLocation || '',
      matched: abroad ? null : hit || null,
      abroad,
      remote: workType.job.includes('remote'),
      home: abroad ? [...home][0] : null,
      ok: abroad ? false : areas.length ? (hit || remoteOk ? true : false) : null,
    };
    return { workType, salary, location };
  }

  // ---- Main ----------------------------------------------------------------
  function userSkillSet(profile, resumeText) {
    const map = new Map(); // canonical -> source
    for (const s of profile.skills || []) {
      const name = s && (s.name || s);
      if (name) map.set(canonical(name), 'profile');
    }
    for (const name of findSkills(resumeText || '').keys()) if (!map.has(name)) map.set(name, 'resume');
    for (const [name] of [...map]) for (const x of impliedBy(name)) if (!map.has(x)) map.set(x, `implied by ${name}`);
    return map;
  }

  function analyze({ jdText, profile, resumeText = '', aiSkills = null, jobLocation = '', jobTitle = '' }) {
    const t0 = Date.now();
    profile = profile || {};
    const mine = userSkillSet(profile, resumeText);
    const customNames = (profile.skills || []).map((s) => s && (s.name || s)).filter(Boolean);

    const jd = new Map(); // canonical -> {weight, count}
    const bump = (name, kind, n) => {
      const cur = jd.get(name) || { weight: 0, count: 0 };
      cur.weight = Math.max(cur.weight, W[kind] || W.neutral);
      cur.count += n;
      jd.set(name, cur);
    };
    for (const sec of sectionize(jdText)) {
      for (const [name, n] of findSkills(sec.text, customNames)) bump(name, sec.kind, n);
    }
    if (aiSkills) {
      for (const s of aiSkills.required || []) bump(canonical(s), 'required', 1);
      for (const s of aiSkills.preferred || []) bump(canonical(s), 'preferred', 1);
    }

    const matched = [];
    const missing = [];
    let got = 0;
    let total = 0;
    let similarCount = 0;
    const has = (name) => [...mine.keys()].find((k) => AJP.norm(k) === AJP.norm(name));
    for (const [name, info] of jd) {
      // Mentioned many times => slightly more important.
      const weight = info.weight + Math.min(info.count - 1, 2) * 0.25;
      total += weight;
      const key = has(name);
      if (key) {
        got += weight;
        matched.push({ skill: name, weight, source: mine.get(key) });
      } else {
        const sim = similarTo(name).map(has).find(Boolean);
        if (sim) {
          got += weight * SIMILAR_CREDIT;
          similarCount++;
        }
        missing.push({ skill: name, weight, importance: info.weight === 3 ? 'required' : info.weight === 1 ? 'preferred' : 'mentioned', ...(sim ? { similar: sim } : {}) });
      }
    }
    const byWeight = (a, b) => b.weight - a.weight || a.skill.localeCompare(b.skill);
    matched.sort(byWeight);
    missing.sort(byWeight);

    return {
      score: total ? Math.round((100 * got) / total) : null,
      matched,
      missing,
      similarCount,
      jdSkillCount: jd.size,
      userSkillCount: mine.size,
      fit: { ...fitChecks(jdText || '', profile, jobLocation), ...experienceFit({ jdText, jobTitle, profile, resumeText }) },
      ms: Date.now() - t0,
    };
  }

  // Years / seniority rows (experience.js). A failure there must never break the match itself.
  function experienceFit(args) {
    if (!AJP.experience) return { years: null, seniority: null };
    try {
      return AJP.experience.check(args);
    } catch (e) {
      const x = AJP.toAppError ? AJP.toAppError(e) : e;
      if (AJP.logger) AJP.logger('matcher').warn('Experience check failed', { code: x.code, error: x.message }, { code: x.code });
      return { years: null, seniority: null };
    }
  }

  AJP.matcher = { countriesIn, homeCountries, listedAbroad, analyze, findSkills, canonical, sectionize, parseSalary, detectWorkTypes, impliedBy, similarTo, SIMILAR_CREDIT };
})();
