/*
 * workday.js — Workday adapter for autofill (custom widgets the generic filler can't set).
 *
 * Workday widgets are found by data-automation-id (stable across Workday tenants, but VERIFY on real pages —
 * all selectors live in SEL below so they are quick to adjust):
 *   dropdown   button[aria-haspopup="listbox"] → popup [role=listbox] → [role=option]
 *   prompt     [data-automation-id="multiSelectContainer"] searchBox → type + Enter → promptOption → selectedItem
 *   date       [data-automation-id="dateInputWrapper"] Month/Day/Year spinbuttons
 *   entries    Work Experience / Education sections: "Add" creates panels workExperience-N / education-N
 * Never clicks "Save and Continue" / "Submit". Follows THE STANDARD: coded errors, logs, no silent failures.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.workday) return;
  const log = AJP.logger('workday');

  const SEL = {
    page: '[data-automation-id="applyFlowPage"], [data-automation-id="applyFlowForm"]',
    progress: '[data-automation-id="progressBar"]',
    activeStep: '[data-automation-id="progressBarActiveStep"]',
    field: '[data-automation-id^="formField-"]',
    dropdown: 'button[aria-haspopup="listbox"]',
    listbox: '[data-automation-id="activeListContainer"] [role="listbox"], [role="listbox"]',
    option: '[role="option"], [data-automation-id="promptOption"]',
    prompt: '[data-automation-id="multiSelectContainer"]',
    promptInput: '[data-automation-id="searchBox"], input',
    promptSelected: '[data-automation-id="selectedItem"]',
    date: '[data-automation-id="dateInputWrapper"]',
    workPanel: '[data-automation-id^="workExperience-"]',
    eduPanel: '[data-automation-id^="education-"]',
    addButton: 'button[data-automation-id="Add"], button[data-automation-id="Add Another"]',
  };
  const PLACEHOLDER = /^\s*(select one|select\.\.\.|select|choose one|-+)\s*$/i;
  const CONFIG = { optionWaitMs: 1500, addWaitMs: 1500, maxEntries: 5 };

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
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\*/g, '').trim();

  // ---- Detection --------------------------------------------------------------------------
  function applies(root = document, host = location.hostname) {
    if (/(^|\.)myworkday(jobs|site)\.com$|(^|\.)workday\.com$/.test(host)) return true;
    return !!(root.querySelector(SEL.progress) && root.querySelector(SEL.field)); // Workday markup on a custom domain
  }
  // Fields handled here, not by the generic filler.
  function owns(el) {
    return !!el.closest(`${SEL.date}, ${SEL.prompt}, ${SEL.workPanel}, ${SEL.eduPanel}`);
  }

  // ---- Labels -------------------------------------------------------------------------------
  function labelOf(el) {
    const wrap = el.closest(SEL.field);
    const lab = wrap && wrap.querySelector('label, legend, [data-automation-id="formLabel"]');
    if (lab) return clean(lab.textContent);
    return AJP.filler.labelFor(el);
  }
  const fieldKey = (el) => {
    const w = el.closest(SEL.field);
    return w ? w.getAttribute('data-automation-id').replace(/^formField-/, '') : el.getAttribute('data-automation-id') || '';
  };

  // ---- Value normalisation (Workday option wording) -------------------------------------------------
  const US_STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia' };
  const COUNTRY_ALIASES = { usa: 'United States of America', us: 'United States of America', 'united states': 'United States of America', uk: 'United Kingdom', 'great britain': 'United Kingdom' };
  const DEGREE_ALIASES = [[/^(b\.?s\.?|b\.?a\.?|bsc|b\.?e\.?|b\.?tech|bachelor)/i, "Bachelor's Degree"], [/^(m\.?s\.?|m\.?a\.?|msc|m\.?tech|mba|master)/i, "Master's Degree"], [/^(ph\.?d|doctor)/i, 'Doctorate'], [/^(a\.?a\.?|a\.?s\.?|associate)/i, "Associate's Degree"]];

  function candidates(value, key) {
    const v = String(value || '').trim();
    const out = [v];
    if (/state|region|province/i.test(key) && US_STATES[v.toUpperCase()]) out.push(US_STATES[v.toUpperCase()]);
    if (/country/i.test(key) && COUNTRY_ALIASES[v.toLowerCase()]) out.push(COUNTRY_ALIASES[v.toLowerCase()]);
    if (/degree/i.test(key)) for (const [re, name] of DEGREE_ALIASES) if (re.test(v)) out.push(name);
    if (/decline|prefer not|not wish/i.test(v)) out.push('I do not wish to answer', 'I do not wish to self-identify');
    // Veteran status is worded many ways: "I am not a protected veteran" ↔ "I am not a veteran" ↔ "No".
    if (/veteran/i.test(key) || /veteran/i.test(v)) {
      if (/\bnot\b/i.test(v)) out.push('I am not a veteran', 'I am not a protected veteran', 'Not a veteran', 'No');
      else if (/identify as|protected veteran|^yes$/i.test(v)) out.push('I identify as one or more of the classifications of protected veteran', 'I am a protected veteran', 'I am a veteran', 'Yes');
    }
    return out;
  }

  function bestOption(options, value, key) {
    let best = null;
    let score = 0;
    for (const o of options) {
      const text = clean(o.getAttribute('data-automation-label') || o.textContent);
      for (const c of candidates(value, key)) {
        const s = AJP.filler.optionScore(text, c);
        if (s > score) (score = s), (best = o);
      }
    }
    return score >= 3 ? best : null;
  }

  function press(el, key) {
    for (const type of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true }));
  }
  function realClick(el) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    el.click();
  }

  // ---- Widgets -----------------------------------------------------------------------------------
  const dropdownEmpty = (btn) => PLACEHOLDER.test(btn.textContent) && !btn.getAttribute('value');

  async function pickDropdown(btn, value, key) {
    if (!dropdownEmpty(btn)) return 'kept';
    realClick(btn);
    const list = await waitFor(() => [...document.querySelectorAll(SEL.listbox)].find((l) => l.querySelector(SEL.option)), CONFIG.optionWaitMs);
    if (!list) throw AJP.err('INTERNAL', { reason: 'Workday list did not open', key });
    const opt = bestOption([...list.querySelectorAll(SEL.option)], value, key);
    if (!opt) {
      press(btn, 'Escape');
      return 'nomatch';
    }
    realClick(opt);
    await waitFor(() => !dropdownEmpty(btn), 800);
    return dropdownEmpty(btn) ? 'nomatch' : 'set';
  }

  async function pickPrompt(box, value, key) {
    if (box.querySelector(SEL.promptSelected)) return 'kept';
    const input = box.querySelector(SEL.promptInput);
    if (!input) return 'nomatch';
    input.focus();
    AJP.filler.setNativeValue(input, String(value));
    press(input, 'Enter');
    const list = await waitFor(() => [...document.querySelectorAll(SEL.listbox)].find((l) => l.querySelector(SEL.option)), CONFIG.optionWaitMs);
    const opt = list && bestOption([...list.querySelectorAll(SEL.option)], value, key);
    if (!opt) {
      press(input, 'Escape');
      AJP.filler.setNativeValue(input, '');
      return 'nomatch';
    }
    realClick(opt);
    await waitFor(() => box.querySelector(SEL.promptSelected), 800);
    return box.querySelector(SEL.promptSelected) ? 'set' : 'nomatch';
  }

  // "06/2019", "2019-06", "June 2019", "2019", "Present" → { month, day, year }
  function parseDate(v) {
    const s = String(v || '').trim();
    if (!s || /present|current|now|immediately|asap/i.test(s)) return null;
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/))) return { year: m[1], month: m[2].padStart(2, '0'), day: m[3] && m[3].padStart(2, '0') };
    if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return { month: m[1].padStart(2, '0'), day: m[2].padStart(2, '0'), year: m[3] };
    if ((m = s.match(/^(\d{1,2})[/.-](\d{4})$/))) return { month: m[1].padStart(2, '0'), year: m[2] };
    if ((m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/i)) && months.includes(m[1].toLowerCase())) return { month: String(months.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0'), year: m[2] };
    if ((m = s.match(/^(\d{4})$/))) return { year: m[1] };
    return null;
  }

  function fillDate(wrap, value) {
    const d = parseDate(value);
    if (!d) return 'nomatch';
    const parts = { Month: d.month, Day: d.day, Year: d.year };
    const inputs = [...wrap.querySelectorAll('input')];
    if (inputs.some((i) => i.value)) return 'kept';
    let set = 0;
    for (const input of inputs) {
      const which = (input.getAttribute('data-automation-id') || input.getAttribute('aria-label') || '').match(/Month|Day|Year/i);
      const v = which && parts[which[0][0].toUpperCase() + which[0].slice(1).toLowerCase()];
      if (!v) continue;
      input.focus();
      AJP.filler.setNativeValue(input, v);
      set++;
    }
    return set ? 'set' : 'nomatch';
  }

  function fillText(el, value) {
    if (el.value && el.value.trim()) return 'kept';
    AJP.filler.setNativeValue(el, String(value));
    el.dataset.ajpValue = el.value;
    return 'set';
  }

  // Fill one Workday field (any widget type) with a value.
  async function fillField(wrap, value, key) {
    if (value == null || value === '') return 'nomatch';
    const btn = wrap.querySelector(SEL.dropdown);
    if (btn) return pickDropdown(btn, value, key);
    const prompt = wrap.querySelector(SEL.prompt);
    if (prompt) return pickPrompt(prompt, value, key);
    const date = wrap.querySelector(SEL.date);
    if (date) return fillDate(date, value);
    const cb = wrap.querySelector('input[type=checkbox]');
    if (cb) {
      const want = value === true || /^y|true/i.test(String(value));
      if (cb.checked !== want) realClick(cb);
      return 'set';
    }
    const input = wrap.querySelector('input:not([type=hidden]), textarea');
    if (input) return fillText(input, value);
    return 'nomatch';
  }

  function markWrap(wrap, how) {
    const target = wrap.querySelector(`${SEL.dropdown}, ${SEL.prompt}, ${SEL.date}, input, textarea`) || wrap;
    target.style.outline = how === 'learned' ? '2px solid #8b5cf6' : '2px solid #10b981';
    target.style.outlineOffset = '1px';
    wrap.dataset.ajpFilled = how;
  }

  // ---- Experience & education entries ---------------------------------------------------------------
  function sectionFor(root, re) {
    return [...root.querySelectorAll('[role="group"], section, [data-automation-id$="Section"]')].find((g) => {
      const h = g.querySelector('h2, h3, h4, legend');
      return h && re.test(h.textContent) && g.querySelector(SEL.addButton + ', ' + SEL.workPanel + ', ' + SEL.eduPanel);
    });
  }

  async function ensurePanels(section, panelSel, need) {
    const panels = () => section.querySelectorAll(panelSel);
    let guard = 0;
    while (panels().length < need && guard++ < CONFIG.maxEntries) {
      const add = section.querySelector(SEL.addButton) || [...section.querySelectorAll('button')].find((b) => /^add( another)?$/i.test(clean(b.textContent)));
      if (!add) break;
      const before = panels().length;
      realClick(add);
      if (!(await waitFor(() => panels().length > before, CONFIG.addWaitMs))) break;
    }
    return [...panels()];
  }

  const WORK_FIELDS = [
    ['jobTitle', (e) => e.title], ['company', (e) => e.company], ['location', (e) => e.location],
    ['currentlyWorkHere', (e) => !!(e.current || /present|current/i.test(e.end || ''))],
    ['startDate', (e) => e.start], ['endDate', (e) => (e.current || /present|current/i.test(e.end || '') ? null : e.end)], ['roleDescription', (e) => e.description],
  ];
  const EDU_FIELDS = [
    ['school', (e) => e.school], ['degree', (e) => e.degree], ['fieldOfStudy', (e) => e.field], ['gradeAverage', (e) => e.gpa],
    ['firstYearAttended', (e) => e.startYear], ['lastYearAttended', (e) => e.endYear],
  ];

  async function fillEntries(root, items, { re, panelSel, fields, name }, report) {
    const list = (items || []).filter((x) => x && Object.values(x).some(Boolean)).slice(0, CONFIG.maxEntries);
    if (!list.length) return;
    const section = sectionFor(root, re);
    if (!section) return;
    const panels = await ensurePanels(section, panelSel, list.length);
    for (let i = 0; i < Math.min(list.length, panels.length); i++) {
      for (const [key, get] of fields) {
        const wrap = panels[i].querySelector(`[data-automation-id="formField-${key}"]`);
        if (!wrap) continue;
        const value = get(list[i]);
        if (value == null || value === '' || (value === false && key === 'currentlyWorkHere')) continue;
        try {
          const r = await fillField(wrap, value, key);
          if (r === 'set') {
            markWrap(wrap, 'profile');
            report.filled.push(`${name} ${i + 1}: ${labelOf(wrap)}`);
          } else if (r === 'nomatch') report.unknown.push(`${name} ${i + 1}: ${labelOf(wrap)}`);
        } catch (e) {
          const x = AJP.toAppError(e);
          log.warn('Workday entry field failed', { key, code: x.code, details: x.details }, { code: x.code });
          report.unknown.push(`${name} ${i + 1}: ${labelOf(wrap)}`);
        }
      }
    }
    if (panels.length < list.length) report.skipped.push(`${name}: only ${panels.length} of ${list.length} entries could be added`);
  }

  // ---- Main --------------------------------------------------------------------------------------------
  async function fill({ profile, answers, root = document, report }) {
    const t0 = performance.now();
    const before = { filled: report.filled.length, learned: report.learned.length, unknown: report.unknown.length };
    // 1) Single fields with custom widgets (outside entry panels): dropdowns, prompts, dates.
    const wraps = [...root.querySelectorAll(SEL.field)].filter((w) => !w.closest(`${SEL.workPanel}, ${SEL.eduPanel}`) && w.querySelector(`${SEL.dropdown}, ${SEL.prompt}, ${SEL.date}`));
    for (const wrap of wraps) {
      const label = labelOf(wrap);
      const key = fieldKey(wrap);
      const rule = AJP.filler.ruleFor(label);
      let value = rule ? rule.v(profile) : '';
      let how = 'profile';
      if (!value && /skills/i.test(label)) value = ''; // skills prompts: many values — left for the user
      if (!value) {
        const l = AJP.filler.findLearned(answers, label);
        if (l) (value = l.value), (how = 'learned');
      }
      if (!value) {
        report.unknown.push(label);
        continue;
      }
      try {
        const r = await fillField(wrap, value, key);
        if (r === 'set') {
          markWrap(wrap, how);
          report[how === 'learned' ? 'learned' : 'filled'].push(label);
        } else if (r === 'nomatch') report.unknown.push(label);
      } catch (e) {
        const x = AJP.toAppError(e);
        log.warn('Workday field failed', { key, code: x.code, details: x.details }, { code: x.code });
        report.unknown.push(label);
      }
    }
    // 2) Repeating entries (My Experience page).
    const aa = profile.autoApply || {};
    await fillEntries(root, aa.experience, { re: /work experience/i, panelSel: SEL.workPanel, fields: WORK_FIELDS, name: 'Work experience' }, report);
    await fillEntries(root, aa.education, { re: /education/i, panelSel: SEL.eduPanel, fields: EDU_FIELDS, name: 'Education' }, report);

    const step = currentStep(root);
    report.workday = { step };
    log.info('Workday fill done', {
      step, filled: report.filled.length - before.filled, learned: report.learned.length - before.learned,
      unknown: report.unknown.length - before.unknown, ms: Math.round(performance.now() - t0),
    });
  }

  function currentStep(root = document) {
    const s = root.querySelector(SEL.activeStep);
    return s ? clean(s.textContent) : '';
  }

  // Learning: when the USER picks an option in a Workday dropdown, remember label → option.
  let lastOpened = null;
  function learnFromClicks(onLearn) {
    document.addEventListener(
      'click',
      (e) => {
        const btn = e.target instanceof Element && e.target.closest(SEL.dropdown);
        if (btn) lastOpened = btn;
        const opt = e.target instanceof Element && e.target.closest(SEL.option);
        if (opt && lastOpened && document.contains(lastOpened)) {
          const label = labelOf(lastOpened);
          const value = clean(opt.getAttribute('data-automation-label') || opt.textContent);
          if (label && value) onLearn(label, value);
        }
      },
      true
    );
  }

  AJP.workday = { SEL, CONFIG, applies, owns, fill, parseDate, candidates, currentStep, learnFromClicks };
})();
