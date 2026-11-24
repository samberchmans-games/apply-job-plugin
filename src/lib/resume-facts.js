/*
 * resume-facts.js — work history and education read from the resume itself, so autofill uses the resume it applies
 * with (the one tailored for the job, else your base resume) instead of anything typed again by hand.
 *
 *   AJP.resumeFacts.fromText(text) -> { experience: [{ title, company, location, start, end, current }],
 *                                       education:  [{ school, degree, field, startYear, endYear }] }
 *     start / end: "MM/YYYY", or "YYYY" when the resume gives only a year; end is "Present" for a current job.
 *   AJP.resumeFacts.apply(profile, resume) -> a copy of the profile whose Auto-apply experience / education come from
 *     the resume (kept from Admin only when the resume shows none).
 *
 * Pure text rules, no AI and no network: it runs on the job page.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.resumeFacts) return;

  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
  const DATE = `(?:${MONTH}\\s*,?\\s*(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])\\s*[/.-]\\s*(?:19|20)\\d{2}|(?:19|20)\\d{2})`;
  const NOW = 'present|current|now|today|till date|to date|ongoing';
  const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|to|until|till)\\s*(${DATE}|${NOW})`, 'i');
  const HEAD = /^(?:#{1,3}\s*)?([A-Za-z][A-Za-z &/]{2,45}?):?\s*$/;
  const EXP = /^(professional |work |relevant |career )?(experience|employment( history)?|work history|career history)$/i;
  const EDU = /^(education|academic background|academics|education( and| &) (training|certifications?)|qualifications)$/i;
  const OTHER = /^(summary|professional summary|profile|objective|skills|technical skills|core skills|key skills|core competencies|competencies|projects|certifications?|licenses|awards|honors|publications|languages|interests|volunteer( experience)?|references|tools|technologies|achievements|training|courses|contact)$/i;
  const BULLET = /^\s*[-*•●▪■➢✓◦]\s*/;
  const TITLE = /\b(engineer|developer|architect|manager|lead|analyst|scientist|consultant|director|specialist|administrator|designer|intern|associate|officer|head|vp|vice president|president|programmer|tester|coordinator|owner|principal|staff|technician|executive|advisor|strategist|founder|cto|ceo|cfo|dba)\b/i;
  const COMPANY = /\b(inc|llc|llp|ltd|corp|corporation|company|co|group|bank|technologies|technology|solutions|systems|labs|services|consulting|partners|limited|plc|gmbh|holdings|health|healthcare|retail|financial|software|networks|global)\.?$/i; // the last word of a name: "Acme Inc.", not "Software Engineer"
  const STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
  const PLACE = new RegExp(`^(remote|hybrid|(?:${STATES})|usa|us|united states|india|canada|united kingdom|uk)$`, 'i');
  const SCHOOL = /\b(university|college|institute|school|academy|polytechnic|iit|nit|universidad|université)\b/i;
  const DEGREE = /\b(ph\.?\s?d\.?|doctor(?:ate| of [a-z]+)|master(?:'s)?(?: of [a-z]+(?: (?!in\b|at\b|from\b|and\b)[a-z]+)?)?|mba|m\.?\s?b\.?\s?a\.?|m\.?\s?tech|m\.?\s?sc?\.?|m\.?\s?e\.?|m\.?\s?a\.?|mca|bachelor(?:'s)?(?: of [a-z]+(?: (?!in\b|at\b|from\b|and\b)[a-z]+)?)?|b\.?\s?tech|b\.?\s?sc?\.?|b\.?\s?e\.?|b\.?\s?a\.?|bca|associate(?:'s)?(?: of [a-z]+)?(?: degree)?|diploma)(?=[\s,.;:|)(–—-]|$)/i;

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[\s,|–—:;•·-]+|[\s,|–—:;•·(-]+$/g, '').trim();
  const pad = (n) => String(n).padStart(2, '0');
  function dateOf(token) {
    const t = String(token || '').trim();
    if (new RegExp(`^(${NOW})$`, 'i').test(t)) return { now: true };
    const y = (t.match(/(19|20)\d{2}/) || [])[0];
    if (!y) return null;
    const named = t.match(new RegExp(MONTH, 'i'));
    if (named) return { text: `${pad(MON.indexOf(named[0].slice(0, 3).toLowerCase()) + 1)}/${y}` };
    const num = t.match(/^(0?[1-9]|1[0-2])\s*[/.-]/);
    return { text: num ? `${pad(num[1])}/${y}` : y };
  }

  // The resume's sections: heading -> its lines.
  function sections(text) {
    const out = [];
    let cur = null;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      const m = line.match(HEAD);
      const name = m ? m[1].trim() : '';
      const kind = name && (EXP.test(name) ? 'exp' : EDU.test(name) ? 'edu' : OTHER.test(name) ? 'other' : null);
      if (kind && (m[0].startsWith('#') || /^[A-Z][A-Z &/]+:?$/.test(line) || line.split(/\s+/).length <= 4)) {
        out.push((cur = { kind, lines: [] }));
        continue;
      }
      if (cur) cur.lines.push(line);
    }
    return out;
  }

  // "Lead Data Engineer, Northwind Retail" / "Northwind Retail | Jersey City, NJ" / "Engineer at Acme" → parts.
  function splitHeader(lines) {
    const parts = [];
    for (const l of lines) {
      const s = clean(l.replace(/^#{1,4}\s*/, '').replace(/[()]/g, ' '));
      for (const p of s.split(/\s+[|–—•·@]\s+|\s{3,}|\t|,\s*|\s+at\s+/i)) if (clean(p)) parts.push(clean(p));
    }
    // "Jersey City" + "NJ" → one location
    const out = [];
    for (const p of parts) {
      if (PLACE.test(p) && out.length && !TITLE.test(out[out.length - 1].text) && out[out.length - 1].kind !== 'loc' && out.length > 1) {
        const prev = out.pop();
        out.push({ text: `${prev.text}, ${p}`, kind: 'loc' });
      } else out.push({ text: p, kind: PLACE.test(p) ? 'loc' : '' });
    }
    return out;
  }

  function job(headerLines) {
    const all = headerLines.join(' ');
    const r = all.match(RANGE);
    if (!r) return null;
    const start = dateOf(r[1]);
    const end = dateOf(r[2]);
    const parts = splitHeader(headerLines.map((l) => l.replace(RANGE, ' ')));
    const loc = parts.filter((p) => p.kind === 'loc').map((p) => p.text);
    const rest = parts.filter((p) => p.kind !== 'loc').map((p) => p.text);
    let title = rest.find((p) => TITLE.test(p) && !COMPANY.test(p)) || '';
    let company = rest.find((p) => p !== title && COMPANY.test(p)) || '';
    if (!title) title = rest.find((p) => p !== company && TITLE.test(p)) || '';
    if (!company) company = rest.find((p) => p !== title) || '';
    if (!title) title = rest.find((p) => p !== company) || '';
    if (!title && !company) return null;
    return { title, company, location: loc.join(', '), start: start ? start.text || '' : '', end: end && end.now ? 'Present' : (end && end.text) || '', current: !!(end && end.now) };
  }

  function experienceIn(lines) {
    const out = [];
    let header = [];
    let found = null;
    const flush = () => {
      if (header.length) {
        const j = job(header);
        if (j) out.push(j);
      }
      header = [];
      found = null;
    };
    for (const line of lines) {
      if (!line) continue;
      if (BULLET.test(line)) {
        flush();
        continue;
      }
      // A new role starts at a line with a date range, or at a short line before one.
      if (RANGE.test(line)) {
        if (found) flush();
        header.push(line);
        found = true;
      } else if (header.length < 3 && line.length < 120) {
        if (found && header.length >= 2) flush();
        header.push(line);
      } else flush();
    }
    flush();
    return out;
  }

  function educationIn(lines) {
    const out = [];
    let cur = null;
    for (const raw of lines) {
      const line = clean(raw.replace(BULLET, ''));
      if (!line) continue;
      const school = (line.match(new RegExp(`[^,|–—•(;]*${SCHOOL.source}[^,|–—•(;]*`, 'i')) || [])[0];
      const degree = (line.match(DEGREE) || [])[0];
      if (!school && !degree) continue;
      if (!cur || (school && cur.school) || (degree && cur.degree)) out.push((cur = { school: '', degree: '', field: '', startYear: '', endYear: '' }));
      if (school) cur.school = clean(school);
      if (degree) {
        cur.degree = clean(degree);
        let rest = line;
        if (school) rest = rest.replace(school, ' ');
        rest = rest.replace(degree, ' ').replace(/\(?\b(19|20)\d{2}\b\)?/g, ' ').replace(/\b(gpa|cgpa)\b.*$/i, ' ');
        rest = rest.replace(new RegExp(`[|–—•]\\s*(${STATES})\\b.*$`), ' ');
        const field = clean(clean(rest).replace(/^(in|of)\s+/i, '').split(/\s{2,}|\s+[|–—•]\s+|,\s*/)[0]);
        if (field && field.length <= 60 && !PLACE.test(field)) cur.field = field;
      }
      const years = line.match(/\b(19|20)\d{2}\b/g) || [];
      if (years.length >= 2) [cur.startYear, cur.endYear] = [years[0], years[years.length - 1]];
      else if (years.length === 1) cur.endYear = years[0];
    }
    return out.filter((e) => e.school || e.degree);
  }

  function fromText(text) {
    const secs = sections(text);
    const experience = secs.filter((s) => s.kind === 'exp').flatMap((s) => experienceIn(s.lines));
    const education = secs.filter((s) => s.kind === 'edu').flatMap((s) => educationIn(s.lines));
    return { experience: experience.slice(0, 10), education: education.slice(0, 5) };
  }

  function apply(profile, resume) {
    const p = AJP.clone(profile || {});
    if (!resume || !(resume.text || '').trim()) return p;
    const f = fromText(resume.text);
    p.autoApply = { ...(p.autoApply || {}) };
    if (f.experience.length) p.autoApply.experience = f.experience;
    if (f.education.length) p.autoApply.education = f.education;
    p.fromResume = { name: resume.name || '', jobs: f.experience.length, schools: f.education.length };
    return p;
  }

  AJP.resumeFacts = { fromText, apply };
})();
