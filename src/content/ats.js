/*
 * ats.js — per-site adapters for Greenhouse, Lever, Ashby and iCIMS (+ the custom widgets they use, which
 * also appear on many other sites). The generic filler (form-filler.js) does labels → rules → values; this file
 * adds what it can't do on its own:
 *
 *   names      each site's own field names (Lever "org", "urls[LinkedIn]"; Ashby "_systemfield_*";
 *              iCIMS "PersonProfileFields.*"; Greenhouse "first_name") → the right profile value, even with odd labels
 *   combobox   searchable dropdowns (React-Select on Greenhouse's new boards, Ashby): open → (type) → click option
 *   location   "Location (City)" autocompletes: type the city, pick the suggestion with your city (and state)
 *   yes/no     Ashby's Yes / No button pairs
 *   proxy      a hidden native <select> behind a custom dropdown (select2 on Greenhouse classic boards, iCIMS)
 *   resume     Lever reads the uploaded resume and fills fields itself: the resume is attached first, then your
 *              profile values replace what Lever guessed (your typed answers are never touched)
 *   iCIMS      a sign-in / create-account page → a clear note (the extension never handles passwords)
 *
 * All selectors live in SITES / SEL so they are quick to adjust after checking real pages.
 * Never clicks submit. Follows THE STANDARD: coded errors, logs, no silent failures.
 *
 *   AJP.ats.detect(root, host)   -> site config or null
 *   AJP.ats.ruleKey(el, site)    -> profile rule key for this field's name/id, or null
 *   AJP.ats.owns(el)             -> true for inputs the generic loop must leave to this file (combobox inputs)
 *   AJP.ats.fill({ profile, answers, resume, root, report, site })   -> widgets pass (after the generic loop)
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.ats) return;
  const log = AJP.logger('ats');

  const SITES = {
    greenhouse: {
      id: 'greenhouse', name: 'Greenhouse',
      host: /(^|\.)greenhouse\.io$/,
      dom: '#application_form, #grnhse_app, form[action*="greenhouse.io"], [data-ats="greenhouse"], .application--form, #application-form[data-provides="greenhouse"]',
      names: [
        [/^(job_application\[)?first_name\]?$/, 'firstName'], [/^(job_application\[)?last_name\]?$/, 'lastName'], [/^(job_application\[)?email\]?$/, 'email'],
        [/^(job_application\[)?phone\]?$/, 'phone'], [/^(candidate[-_])?location$|job_application\[location\]/, 'location'],
        [/^preferred_name$/, 'firstName'],
      ],
      // Greenhouse's "or enter manually" boxes: pasted text, not questions for the AI.
      resumeText: /resume_text|cover_letter_text/,
    },
    lever: {
      id: 'lever', name: 'Lever',
      host: /(^|\.)lever\.co$/,
      dom: 'form[action*="lever.co"], .application-page .application-form, [data-ats="lever"], form#application-form .application-question',
      names: [
        [/^name$/, 'fullName'], [/^email$/, 'email'], [/^phone$/, 'phone'], [/^org$/, 'currentCompany'], [/^location$/, 'location'],
        [/^urls\[linkedin\]$/i, 'linkedin'], [/^urls\[github\]$/i, 'github'], [/^urls\[(portfolio|website|other)\]$/i, 'website'],
        [/^eeo\[gender\]$/, 'gender'], [/^eeo\[race\]$/, 'race'], [/^eeo\[veteran\]$/, 'veteran'], [/^eeo\[disability\]$/, 'disability'],
      ],
      resumeFirst: true,
      location: { input: '#location-input, input[name="location"]', option: '.dropdown-location, .dropdown-results [role="option"], .dropdown-results li' },
    },
    ashby: {
      id: 'ashby', name: 'Ashby',
      host: /(^|\.)ashbyhq\.com$/,
      dom: '.ashby-application-form-container, [class*="ashby-application-form"], [data-ats="ashby"]',
      names: [
        [/^_systemfield_name$/, 'fullName'], [/^_systemfield_email$/, 'email'], [/^_systemfield_phone$/, 'phone'], [/^_systemfield_location$/, 'location'],
        [/^_systemfield_linkedin/, 'linkedin'], [/^_systemfield_github/, 'github'], [/^_systemfield_website/, 'website'],
      ],
    },
    icims: {
      id: 'icims', name: 'iCIMS',
      host: /(^|\.)icims\.com$/,
      dom: '.iCIMS_MainWrapper, #iCIMS_Content, .iCIMS_Forms, form[action*="icims"], [data-ats="icims"]',
      names: [
        [/(^|\.)FirstName$/i, 'firstName'], [/(^|\.)LastName$/i, 'lastName'], [/(^|\.)(Email|EmailAddress)$/i, 'email'],
        [/(^|\.)(PhoneNumber|Phone|HomePhone|MobilePhone)$/i, 'phone'], [/(^|\.)AddressStreet1$/i, 'address'], [/(^|\.)AddressCity$/i, 'city'],
        [/(^|\.)AddressState$/i, 'state'], [/(^|\.)(AddressZip|PostalCode)$/i, 'zip'], [/(^|\.)AddressCountry$/i, 'country'],
        [/(^|\.)LinkedIn(Url|Profile)?$/i, 'linkedin'],
      ],
      signIn: 'input[type="password"]',
    },
  };

  const SEL = {
    combobox: 'input[role="combobox"], input[aria-autocomplete="list"], input[aria-autocomplete="both"]',
    option: '[role="option"], .select__option, [class*="select__option"]',
    listbox: '[role="listbox"], .select__menu, [class*="select__menu"]',
    hasValue: '.select__single-value, [class*="singleValue"], [class*="single-value"], [class*="selectedValue"], .select__multi-value',
    placeholder: '.select__placeholder, [class*="placeholder"]',
    proxy: '.select2-container, .select2, .chosen-container, .iCIMS_Dropdown, [class*="dropdown-toggle"], [data-proxy-for]',
  };
  const CONFIG = { optionWaitMs: 1500, searchWaitMs: 4000, firstLookMs: 250, parseWaitMs: 1500, settleMs: 400 };

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
  const shown = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  function realClick(el) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    el.click();
  }
  function press(el, key) {
    for (const type of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true }));
  }
  // Typing into a search box: input events only (a change/blur would close React-Select's menu).
  function type(el, text) {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    desc.set.call(el, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  }

  // ---- Detection ---------------------------------------------------------------------------------
  function detect(root = document, host = location.hostname) {
    for (const s of Object.values(SITES)) if (s.host.test(host)) return s;
    for (const s of Object.values(SITES)) if (root.querySelector && root.querySelector(s.dom)) return s;
    return null;
  }

  function ruleKey(el, site) {
    if (!site) return null;
    const names = [el.getAttribute('name'), el.id].filter(Boolean);
    for (const [re, key] of site.names) if (names.some((n) => re.test(n))) return key;
    return null;
  }

  const isCombo = (el) => el.matches && el.matches(SEL.combobox) && el.tagName === 'INPUT';
  function owns(el) {
    return isCombo(el) || !!el.closest('.select2-search, .chosen-search');
  }

  // ---- Values -----------------------------------------------------------------------------------
  // The value for a field: site field name → rule; else label → rule; else a learned answer.
  function valueFor({ el, label, profile, answers, site }) {
    const key = el ? ruleKey(el, site) : null;
    const rule = (key && AJP.filler.ruleByKey(key)) || AJP.filler.ruleFor(label);
    const v = rule ? rule.v(profile) : '';
    if (v) return { value: String(v), how: 'profile', key: rule.key };
    const l = AJP.filler.findLearned(answers, label);
    return l ? { value: String(l.value), how: 'learned', key: rule ? rule.key : '' } : null;
  }

  const candidatesFor = (value, key) => (AJP.workday ? AJP.workday.candidates(value, key) : [value]);
  function scoreOption(text, value, key) {
    if (key === 'location' || key === 'city') {
      // "Austin, TX" vs "Austin, Texas, United States": the city must be there; the state helps.
      const [city, state] = String(value).split(',').map((x) => AJP.norm(x));
      const t = AJP.norm(text);
      if (!city || !t.includes(city)) return 0;
      const full = state && AJP.workday ? AJP.norm(candidatesFor(state.toUpperCase(), 'state').slice(-1)[0]) : '';
      return 5 + (state && (t.includes(' ' + state) || (full && t.includes(full))) ? 2 : 0);
    }
    return Math.max(...candidatesFor(value, key).map((c) => AJP.filler.optionScore(text, c)));
  }
  function best(options, value, key) {
    let pick = null;
    let top = 0;
    for (const o of options) {
      const s = scoreOption(clean(o.textContent), value, key);
      if (s > top) (top = s), (pick = o);
    }
    return top >= 3 ? pick : null;
  }

  // ---- Comboboxes (React-Select & friends) ---------------------------------------------------------
  function comboRoot(input) {
    const r = input.closest('.select__control, [class*="select__control"], [class*="-control"], [class*="combobox" i], [class*="select" i]');
    // Never a big wrapper holding other dropdowns (its "selected value" would belong to another field).
    return r && r.querySelectorAll(SEL.combobox).length === 1 ? r : input.parentElement;
  }
  function comboHasValue(input) {
    const r = comboRoot(input);
    const v = r && r.querySelector(SEL.hasValue);
    if (v && clean(v.textContent)) return clean(v.textContent);
    // Plain autocompletes keep the picked text in the input itself.
    if (input.value.trim() && input.getAttribute('aria-expanded') !== 'true' && input.dataset.ajpPicked) return input.value.trim();
    return '';
  }
  function optionsFor(input) {
    const id = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
    const box = id && document.getElementById(id);
    const lists = box ? [box] : [...document.querySelectorAll(SEL.listbox)].filter(shown);
    return lists.flatMap((l) => [...l.querySelectorAll(SEL.option)]).filter((o) => shown(o) && !/no options|loading/i.test(o.textContent));
  }

  async function pickCombo(input, value, key) {
    if (comboHasValue(input)) return 'kept';
    input.focus();
    realClick(input);
    press(input, 'ArrowDown');
    const isLocation = key === 'location' || key === 'city';
    let opt = null;
    if (!isLocation) {
      // Short lists open with every option: pick without typing (typing can filter away "I don't wish to answer").
      await waitFor(() => optionsFor(input).length, CONFIG.firstLookMs);
      opt = best(optionsFor(input), value, key);
    }
    if (!opt) {
      type(input, isLocation ? String(value).split(',')[0].trim() : String(value).split(/[,(]/)[0].trim());
      opt = await waitFor(() => best(optionsFor(input), value, key), key === 'school' ? CONFIG.searchWaitMs : CONFIG.optionWaitMs);
    }
    // School, degree and field lists rarely have every name: "Other" is the honest answer there.
    let other = false;
    if (!opt && OTHER_OK.has(key)) {
      type(input, 'Other');
      opt = await waitFor(() => optionsFor(input).find((o) => /^other\b/i.test(clean(o.textContent))), CONFIG.optionWaitMs);
      other = !!opt;
    }
    if (!opt) {
      type(input, '');
      press(input, 'Escape');
      input.blur();
      return 'nomatch';
    }
    realClick(opt);
    input.dataset.ajpPicked = '1';
    const ok = await waitFor(() => comboHasValue(input), 800);
    return ok ? (other ? 'other' : 'set') : 'nomatch';
  }
  const OTHER_OK = new Set(['school', 'degree', 'major']);

  // Lever's location box is a plain input with its own results list (not ARIA).
  async function pickLocation(input, value, site) {
    if (input.value.trim()) return 'kept';
    input.focus();
    type(input, String(value).split(',')[0].trim());
    const opt = await waitFor(() => best([...document.querySelectorAll(site.location.option)].filter(shown), value, 'location'), CONFIG.optionWaitMs);
    if (!opt) {
      // No suggestions: keep the typed text (the site accepts it), and say so.
      AJP.filler.setNativeValue(input, String(value));
      return 'typed';
    }
    realClick(opt);
    await waitFor(() => input.value.trim(), 800);
    return input.value.trim() ? 'set' : 'typed';
  }

  // ---- Yes / No button pairs (Ashby) --------------------------------------------------------------
  function yesNoGroups(root) {
    const out = new Set();
    for (const b of root.querySelectorAll('button')) {
      if (!/^(yes|no)$/i.test(clean(b.textContent))) continue;
      const g = b.parentElement;
      const btns = g ? [...g.querySelectorAll(':scope > button')] : [];
      if (btns.length >= 2 && btns.length <= 3 && btns.every((x) => /^(yes|no|n\/a|prefer not to say)$/i.test(clean(x.textContent)))) out.add(g);
    }
    return [...out];
  }
  function questionOf(node) {
    let n = node;
    for (let i = 0; i < 4 && n; i++) {
      n = n.parentElement;
      if (!n) break;
      const lab = [...n.querySelectorAll('label, legend, [class*="question-title"], [class*="title"], [class*="label"]')].find((l) => !l.contains(node) && clean(l.textContent));
      if (lab) return clean(lab.textContent);
    }
    return '';
  }
  const chosen = (btn) => btn.getAttribute('aria-pressed') === 'true' || btn.getAttribute('aria-checked') === 'true' || /(^|[\s_-])(active|selected|checked)/i.test(btn.className);

  // ---- Hidden <select> behind a custom dropdown (select2, iCIMS) -----------------------------------------
  function proxiedSelects(root) {
    return [...root.querySelectorAll('select')].filter((s) => !s.disabled && !shown(s) && s.selectedIndex <= 0 && s.options.length > 1 && proxyOf(s));
  }
  function proxyOf(sel) {
    const byAttr = sel.id && document.querySelector(`[data-proxy-for="${CSS.escape(sel.id)}"]`);
    if (byAttr) return byAttr;
    const sib = sel.nextElementSibling;
    if (sib && sib.matches(SEL.proxy) && shown(sib)) return sib;
    const near = sel.parentElement && [...sel.parentElement.querySelectorAll(SEL.proxy)].find(shown);
    return near || null;
  }

  function markEl(el, how) {
    el.style.outline = how === 'learned' ? '2px solid #8b5cf6' : '2px solid #10b981';
    el.style.outlineOffset = '1px';
    el.dataset.ajpFilled = how;
  }
  const push = (report, how, label) => report[how === 'learned' ? 'learned' : 'filled'].push(label);

  // ---- Main: the widgets pass ----------------------------------------------------------------------------
  async function fill({ profile, answers, root = document, report, site }) {
    const t0 = performance.now();
    const before = report.filled.length + report.learned.length;
    const notes = (report.notes = report.notes || []);
    if (site && site.signIn && root.querySelector(site.signIn)) {
      notes.push(`${site.name} asks you to sign in or create an account first. Do that yourself (the extension never handles passwords), then click Autofill again.`);
    }

    // 1) Location autocompletes with their own result lists (Lever).
    if (site && site.location) {
      const input = root.querySelector(site.location.input);
      if (input && shown(input)) {
        const label = AJP.filler.labelFor(input);
        const v = valueFor({ el: input, label, profile, answers, site });
        if (v) {
          try {
            const r = await pickLocation(input, v.value, site);
            if (r === 'set' || r === 'typed') {
              markEl(input, v.how);
              input.dataset.ajpValue = input.value;
              push(report, v.how, label);
              if (r === 'typed') notes.push(`${label}: no suggestion matched "${v.value}", so it was typed as is. Pick from the list if the site insists.`);
            }
          } catch (e) {
            fail(report, label, e);
          }
        }
      }
    }

    // 2) Comboboxes (not inside Work experience / Education entries: entries.js fills those per entry).
    const entrySecs = AJP.entries ? AJP.entries.sections(root) : [];
    const inEntries = (el) => entrySecs.some((s) => s.el.contains(el));
    for (const input of [...root.querySelectorAll(SEL.combobox)].filter((i) => shown(i) && !i.disabled && !inEntries(i) && !(site && site.location && i.matches(site.location.input)))) {
      if (AJP.workday && AJP.workday.owns && AJP.workday.owns(input)) continue;
      const label = AJP.filler.labelFor(input);
      if (!label) continue;
      await each(report, label, async () => {
        const v = valueFor({ el: input, label, profile, answers, site });
        if (!v) return comboHasValue(input) ? 'kept' : 'nomatch';
        const r = await pickCombo(input, v.value, v.key || ruleKey(input, site) || '');
        if (r === 'set') {
          markEl(comboRoot(input), v.how);
          push(report, v.how, label);
        }
        return r;
      });
    }

    // 3) Yes / No button pairs.
    for (const g of yesNoGroups(root)) {
      const btns = [...g.querySelectorAll(':scope > button')];
      if (btns.some(chosen)) continue;
      const label = questionOf(g);
      if (!label) continue;
      await each(report, label, async () => {
        const v = valueFor({ el: null, label, profile, answers, site });
        const pick = v && best(btns, v.value, v.key);
        if (!pick) return 'nomatch';
        realClick(pick);
        markEl(pick, v.how);
        push(report, v.how, label);
        return 'set';
      });
    }

    // 4) Hidden selects behind custom dropdowns.
    for (const sel of proxiedSelects(root).filter((x) => !inEntries(x))) {
      const label = AJP.filler.labelFor(sel);
      await each(report, label, async () => {
        const v = valueFor({ el: sel, label, profile, answers, site });
        if (!v || !AJP.filler.fillSelectAny(sel, v.value, v.key)) return 'nomatch';
        // jQuery plugins (select2) listen for "change" on the select; some proxies only re-read on their own event.
        sel.dispatchEvent(new Event('select2:select', { bubbles: true }));
        markEl(proxyOf(sel) || sel, v.how);
        sel.dataset.ajpValue = sel.value;
        push(report, v.how, label);
        return 'set';
      });
    }

    log.info('Site widgets done', { site: site ? site.id : 'generic', filled: report.filled.length + report.learned.length - before, ms: Math.round(performance.now() - t0) });
  }

  // One widget: a failure is logged with its code and listed, and never stops the others.
  async function each(report, label, fn) {
    try {
      const r = await fn();
      if (r === 'nomatch') report.unknown.push(label);
    } catch (e) {
      fail(report, label, e);
    }
  }

  function fail(report, label, e) {
    const x = AJP.toAppError(e);
    log.warn('Site widget fill failed', { label, code: x.code, details: x.details }, { code: x.code });
    report.unknown.push(label);
  }

  // ---- Lever: resume first, then replace what the site guessed -------------------------------------------
  // snapshot() before attaching, siteFilled(snap) after: fields the SITE filled in the meantime (never the user).
  function snapshot(root) {
    return [...root.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type]), textarea')].filter((el) => !el.value.trim());
  }
  async function siteFilled(snap) {
    await waitFor(() => snap.some((el) => el.value.trim()), CONFIG.parseWaitMs);
    await sleep(CONFIG.settleMs);
    const changed = snap.filter((el) => el.value.trim());
    changed.forEach((el) => (el.dataset.ajpSiteFilled = '1'));
    return changed;
  }

  // ---- Learning: the user's picks in comboboxes and Yes/No buttons ---------------------------------------
  let lastCombo = null;
  function learnFromClicks(onLearn) {
    document.addEventListener('focusin', (e) => {
      if (e.target instanceof Element && isCombo(e.target)) lastCombo = e.target;
    }, true);
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target instanceof Element ? e.target : null;
        if (!t) return;
        const opt = t.closest(SEL.option);
        if (opt && lastCombo && document.contains(lastCombo) && !(AJP.workday && AJP.workday.applies())) {
          const label = AJP.filler.labelFor(lastCombo);
          const value = clean(opt.textContent);
          if (label && value) onLearn(label, value, 'select');
          return;
        }
        const btn = t.closest('button');
        if (btn && /^(yes|no)$/i.test(clean(btn.textContent)) && yesNoGroups(btn.parentElement.parentElement || document).includes(btn.parentElement)) {
          const label = questionOf(btn.parentElement);
          if (label) onLearn(label, clean(btn.textContent), 'radio');
        }
      },
      true
    );
  }

  AJP.ats = { SITES, SEL, CONFIG, detect, ruleKey, owns, fill, snapshot, siteFilled, learnFromClicks, scoreOption, pickCombo };
})();
