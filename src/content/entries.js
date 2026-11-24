/*
 * entries.js — repeatable Work experience / Education entries on any site (Workday has its own adapter).
 *
 * Many application forms have an "Employment" / "Experience" and an "Education" section with an
 * "Add" / "Add another" button that creates one block of fields per job or school (Greenhouse job boards,
 * SmartRecruiters, iCIMS, Workable, company sites). This fills them from Admin → Auto-apply details:
 *
 *   1. Find the sections: a heading ("Employment", "Work experience", "Education"…) whose block has an anchor field
 *      (Company / Employer for jobs; School / University for education) or an Add button.
 *   2. One entry = the block around one anchor field. Click Add until there is one entry per profile item (max 5).
 *   3. Fill each EMPTY entry's fields by their labels: title, company, location, start/end dates (month + year
 *      fields, a "MM/YYYY" box, or a month input), "I currently work here", description; school, degree, field of
 *      study, GPA, start/end year. Entries that already have a value are kept (never overwritten).
 *
 *   AJP.entries.sections(root)          -> [{ kind: 'work'|'edu', el }]   (the generic loop skips fields inside)
 *   AJP.entries.fill({ profile, root, report })
 * Never clicks submit. Follows THE STANDARD: each field isolated, coded errors logged, no silent failures.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.entries) return;
  const log = AJP.logger('entries');
  const CONFIG = { addWaitMs: 1500, maxEntries: 5, redrawWaitMs: 3000 };

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[*✱]/g, '').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(25);
    }
  }
  const shown = (el) => {
    if (el.getAttribute('aria-hidden') === 'true' && el.tabIndex < 0) return false; // React-Select's hidden "required" twin
    const r = el.getBoundingClientRect();
    return (r.width > 0 && r.height > 0) || el.type === 'file';
  };

  const KINDS = {
    work: { head: /^(work |professional |employment )?(experience|employment( history)?|work history|positions?|jobs?)\b/i, anchor: /\b(company|employer|organi[sz]ation)( name)?\b/i, add: /experience|employment|position|job|work/i },
    edu: { head: /^education\b|^academic|^schools?\b/i, anchor: /\b(school|university|college|institution)( name)?\b/i, add: /education|school|degree/i },
  };
  const PERSONAL = /\b(e-?mail|phone|mobile|first name|last name|full name|given name|family name|linkedin)\b/i;
  const ADD_RE = /^\+?\s*add(\s+another)?(\s+(more|new|a|an))?(\s+[a-z ]{0,20})?$/i;
  const FIELD_SEL = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]), select, textarea';

  // ---- Sections and entries ----------------------------------------------------------------------
  function labelOf(el) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      const l = (el.labels && el.labels[0]) || el.closest('label');
      if (l && clean(l.textContent)) return clean(l.textContent);
    }
    return clean(AJP.filler.labelFor(el));
  }
  function sections(root = document) {
    const out = [];
    const seen = new Set();
    // Titles are headings on most sites; the live Greenhouse job boards use a short <p> ("Employment") instead.
    for (const h of root.querySelectorAll('h1, h2, h3, h4, h5, legend, [role="heading"], .section-title, [class*="section-header"], p, [class*="header"] > span, [class*="header"] > div')) {
      const t = clean(h.textContent);
      if (!t || t.length > 50) continue;
      if (!/^H\d$|^LEGEND$/.test(h.tagName) && !h.matches('[role="heading"], .section-title, [class*="section-header"]') && (t.length > 30 || t.split(' ').length > 3 || h.querySelector(FIELD_SEL))) continue;
      const kind = Object.keys(KINDS).find((k) => KINDS[k].head.test(t));
      if (!kind) continue;
      // The section: the nearest ancestor that holds an anchor field or an Add button for this kind.
      let el = h.parentElement;
      for (let i = 0; i < 3 && el && el !== root.parentElement; i++, el = el.parentElement) {
        if (anchors(el, kind).length || addButton(el, kind)) break;
      }
      if (!el || (!anchors(el, kind).length && !addButton(el, kind))) continue;
      // The title can sit inside the first entry, with "Add another" outside it: widen to the block that has the button.
      for (let up = el.parentElement, i = 0; !addButton(el, kind) && up && up !== root.parentElement && i < 2; up = up.parentElement, i++) {
        const other = kind === 'work' ? 'edu' : 'work';
        if (anchors(up, other).length || [...up.querySelectorAll(FIELD_SEL)].some((f) => PERSONAL.test(labelOf(f)))) break;
        if (addButton(up, kind)) el = up;
      }
      if (seen.has(el)) continue;
      // Never a whole form: a real entries section has no name / email / phone fields.
      if ([...el.querySelectorAll(FIELD_SEL)].some((f) => PERSONAL.test(labelOf(f)))) continue;
      if (el.closest('[data-automation-id="applyFlowPage"]') || el.querySelector('[data-automation-id="applyFlowPage"]')) continue; // Workday has its own adapter
      seen.add(el);
      out.push({ kind, el });
    }
    // A section must not swallow the other kind's section (a whole form under one heading).
    return out.filter((s) => !out.some((o) => o !== s && s.el.contains(o.el) && o.kind !== s.kind) || anchors(s.el, s.kind).length);
  }
  function anchors(el, kind) {
    // "Current company" / "Most recent employer" are single profile questions, not entries.
    return [...el.querySelectorAll(FIELD_SEL)].filter((f) => shown(f) && f.type !== 'checkbox' && f.type !== 'radio' && KINDS[kind].anchor.test(labelOf(f)) && !/\b(current|present|most recent|previous(ly)?)\b/i.test(labelOf(f)));
  }
  function addButton(el, kind) {
    return [...el.querySelectorAll('button, a, [role="button"]')].find((b) => {
      const t = clean(b.textContent);
      return shown(b) && ADD_RE.test(t) && (!/\s[a-z]/i.test(t.replace(/^\+?\s*add(\s+another)?/i, '')) || KINDS[kind].add.test(t));
    });
  }
  // One entry per anchor field; its block = the largest ancestor that holds no other anchor. (Blocks are recomputed
  // after each Add, so entries are identified by their anchor, not by the block element.)
  function entryBlocks(sec, kind) {
    const list = anchors(sec, kind);
    return list.map((anchor) => {
      let box = anchor;
      while (box.parentElement && box.parentElement !== sec && list.filter((x) => box.parentElement.contains(x)).length === 1) box = box.parentElement;
      return { anchor, box };
    });
  }
  async function ensureEntries(sec, kind, need) {
    let guard = 0;
    while (entryBlocks(sec, kind).length < need && guard++ < CONFIG.maxEntries) {
      const add = addButton(sec, kind);
      if (!add) break;
      const before = entryBlocks(sec, kind).length;
      add.click();
      if (!(await waitFor(() => entryBlocks(sec, kind).length > before, CONFIG.addWaitMs))) break;
    }
    return entryBlocks(sec, kind);
  }

  // ---- Values -----------------------------------------------------------------------------------------
  const isCurrent = (e) => !!(e.current || /present|current|now/i.test(e.end || ''));
  // Order matters: description and the checkbox before title ("Role description", "Current role").
  const WORK = [
    { re: /description|responsibilit|summary|achievements|details/i, v: (e) => e.description },
    { re: /currently work|current(ly)? (job|role|position|employer)|i work here|present/i, v: (e) => isCurrent(e), check: true },
    { re: /\b(start|from|begin)/i, v: (e) => e.start, date: true },
    { re: /\b(end|to|until|finish)\b/i, v: (e) => (isCurrent(e) ? null : e.end), date: true },
    { re: /\b(company|employer|organi[sz]ation)\b/i, v: (e) => e.company },
    { re: /\b(job |position |role )?title\b|\bposition\b|\brole\b/i, v: (e) => e.title },
    { re: /\blocation\b|\bcity\b/i, v: (e) => e.location },
  ];
  const EDU = [
    { re: /\b(school|university|college|institution)\b/i, v: (e) => e.school },
    { re: /\bdegree\b|qualification|level of education/i, v: (e) => e.degree },
    { re: /field of study|\bmajor\b|discipline|area of study|subject|specializ/i, v: (e) => e.field },
    { re: /\bgpa\b|grade|result/i, v: (e) => e.gpa },
    { re: /\b(start|from|begin)/i, v: (e) => (e.startYear ? String(e.startYear) : e.start), date: true },
    { re: /\b(end|to|until|graduat|finish|completion)/i, v: (e) => (e.endYear ? String(e.endYear) : e.end), date: true },
  ];

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // A date into whatever the field wants: month select / month box / year box / month input / "MM/YYYY" box.
  function dateValue(el, label, value) {
    const d = AJP.workday ? AJP.workday.parseDate(value) : null;
    if (!d) return null;
    const isMonth = /\bmonth\b/i.test(label) || (el.tagName === 'SELECT' && [...el.options].some((o) => /^(jan|feb|mar)/i.test(o.text)));
    const isYear = /\byear\b/i.test(label) || (el.tagName === 'SELECT' && [...el.options].some((o) => /^(19|20)\d\d$/.test(o.text.trim())));
    if (isMonth && !isYear) return d.month ? { select: MONTHS[+d.month - 1], text: d.month } : { skip: true }; // only a year known
    if (isYear && !isMonth) return { select: d.year, text: d.year };
    if (el.type === 'month') return d.month ? { text: `${d.year}-${d.month}` } : null;
    if (el.type === 'date') return { text: `${d.year}-${d.month || '01'}-${d.day || '01'}` };
    return { text: d.month ? `${d.month}/${d.year}` : d.year, select: d.year };
  }

  async function setField(el, label, rule, value) {
    if (rule.check) {
      if (el.type !== 'checkbox') return 'skip';
      if (!!value !== el.checked) el.click();
      return value ? 'set' : 'skip';
    }
    if (value == null || value === '') return 'skip';
    let v = value;
    if (rule.date) {
      const dv = dateValue(el, label, value);
      if (!dv) return 'nomatch';
      if (dv.skip) return 'skip';
      const combo = el.matches('input[role="combobox"], input[aria-autocomplete="list"]');
      v = el.tagName === 'SELECT' || combo ? dv.select || dv.text : dv.text; // a month picker wants "January", not "01"
    }
    if (el.matches('input[role="combobox"], input[aria-autocomplete="list"]') && AJP.ats) {
      const key = /school|university|college|institution/i.test(label) ? 'school' : /degree/i.test(label) ? 'degree' : /discipline|field of study|major/i.test(label) ? 'major' : '';
      const r = await AJP.ats.pickCombo(el, String(v), key);
      if (r === 'other') {
        setField.others.push(`${label} "${v}"`);
        return 'set';
      }
      return r === 'kept' ? 'skip' : r;
    }
    if (el.tagName === 'SELECT') {
      if (el.selectedIndex > 0) return 'skip';
      return AJP.filler.fillSelectAny(el, String(v), /degree/i.test(label) ? 'degree' : label) ? 'set' : 'nomatch';
    }
    if (el.value && el.value.trim()) return 'skip';
    AJP.filler.setNativeValue(el, String(v));
    el.dataset.ajpValue = el.value;
    return 'set';
  }

  async function fillEntry(box, item, rules, name, report) {
    const fields = [...box.querySelectorAll(FIELD_SEL)].filter((f) => shown(f) && !f.disabled && !f.readOnly);
    // Checkboxes last: "I currently work here" often hides the end date.
    fields.sort((a, b) => (a.type === 'checkbox') - (b.type === 'checkbox'));
    for (let el of fields) {
      // Sites redraw a block when one field changes (Greenhouse: picking a school redraws Degree and Discipline):
      // find the field again by its id instead of filling a box that is no longer on the page.
      if (!el.isConnected && el.id) {
        const id = el.id;
        el = (await waitFor(() => document.getElementById(id), CONFIG.redrawWaitMs)) || el;
      }
      if (!el.isConnected) continue;
      const label = labelOf(el);
      const rule = rules.find((r) => r.re.test(label) && (!r.check || el.type === 'checkbox'));
      if (!rule) continue;
      try {
        const r = await setField(el, label, rule, rule.v(item));
        log.debug('Entry field', { name, label, id: el.id || null, result: r });
        if (r === 'set') {
          AJP.filler.mark(el, 'profile');
          report.filled.push(`${name}: ${label}`);
        } else if (r === 'nomatch') report.unknown.push(`${name}: ${label}`);
      } catch (e) {
        const x = AJP.toAppError(e);
        log.warn('Entry field failed', { label, code: x.code, details: x.details }, { code: x.code });
        report.unknown.push(`${name}: ${label}`);
      }
    }
  }

  async function fillKind(sec, kind, items, report) {
    const list = (items || []).filter((x) => x && Object.values(x).some(Boolean)).slice(0, CONFIG.maxEntries);
    const label = kind === 'work' ? 'Work experience' : 'Education';
    if (!list.length) {
      report.skipped.push(`${label}: no ${kind === 'work' ? 'jobs with dates' : 'schools'} found in your resume, so this section was left for you`);
      return;
    }
    const valueOf = (a) => clean(a.tagName === 'SELECT' ? (a.selectedIndex > 0 ? a.selectedOptions[0].text : '') : a.value);
    const comboValue = (a) => {
      const r = a.closest('.select__control, [class*="select__control"]');
      const v = r && r.querySelector('.select__single-value, [class*="singleValue"]');
      return v ? clean(v.textContent) : '';
    };
    const current = () => entryBlocks(sec.el, kind).map((e) => ({ ...e, value: valueOf(e.anchor) || comboValue(e.anchor) }));
    // Entries that already have a value are the user's: keep them, and skip profile items they already cover.
    const existing = current().filter((e) => e.value);
    const name = (it) => (kind === 'work' ? it.company : it.school) || '';
    const todo = list.filter((it) => !existing.some((e) => AJP.norm(e.value) === AJP.norm(name(it))));
    if (!todo.length) return;
    await ensureEntries(sec.el, kind, existing.length + todo.length);
    const empty = current().filter((e) => !e.value && !existing.some((x) => x.anchor === e.anchor));
    for (let i = 0; i < Math.min(todo.length, empty.length); i++) {
      await fillEntry(empty[i].box, todo[i], kind === 'work' ? WORK : EDU, `${label} ${existing.length + i + 1}`, report);
    }
    if (empty.length < todo.length) report.skipped.push(`${label}: only ${existing.length + empty.length} of ${existing.length + todo.length} entries could be added`);
  }

  async function fill({ profile, root = document, report }) {
    const t0 = performance.now();
    const before = report.filled.length;
    setField.others = [];
    const aa = (profile && profile.autoApply) || {};
    for (const sec of sections(root)) {
      try {
        await fillKind(sec, sec.kind, sec.kind === 'work' ? aa.experience : aa.education, report);
      } catch (e) {
        const x = AJP.toAppError(e);
        log.error('Entries section failed', { kind: sec.kind, code: x.code, details: x.details }, { code: x.code });
        report.skipped.push(`${sec.kind === 'work' ? 'Work experience' : 'Education'} entries (${x.code})`);
      }
    }
    if (setField.others.length) report.notes.push(`Not in this site's list, so "Other" was picked: ${setField.others.join(', ')}. Check them before you submit.`);
    if (report.filled.length > before) log.info('Entries filled', { filled: report.filled.length - before, ms: Math.round(performance.now() - t0) });
  }

  // Fields the generic loop must leave to this file (inside a detected section).
  function owns(el, secs) {
    return secs.some((s) => s.el.contains(el));
  }

  AJP.entries = { CONFIG, sections, entryBlocks, fill, owns, dateValue };
})();
