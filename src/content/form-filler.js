/*
 * form-filler.js — scan an application form and fill it from the profile.
 *
 * 1. Label each field (label[for], aria, legend, placeholder, nearby text).
 * 2. Map labels to profile values with RULES (first name, email, sponsorship, EEO...).
 * 3. Unknown fields -> look up the "learned answers" memory.
 * 4. Long free-text questions -> returned to the panel for "Draft with AI".
 * 5. While the user edits the form, record what they type so we learn for next time.
 *
 * It NEVER submits the form. The user always reviews and clicks submit.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.filler) return;
  const log = AJP.logger('filler');

  const FIELD_SEL = 'input, select, textarea';
  const SKIP_TYPES = /^(hidden|submit|button|reset|image|password|search)$/i;
  const NEVER_LEARN = /(ssn|social security|password|passcode|card number|cvv|cvc|bank|routing|account number|date of birth|\bdob\b)/i;

  // ---- Labels -----------------------------------------------------------------
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\*/g, '').trim();

  function byIds(ids) {
    return clean(
      String(ids || '')
        .split(/\s+/)
        .map((id) => {
          const el = id && document.getElementById(id);
          return el ? el.textContent : '';
        })
        .join(' ')
    );
  }

  function nearbyText(el) {
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      const label = node.querySelector(':scope > label, :scope > legend, :scope > [class*="label" i], :scope > [data-automation-id*="label" i]');
      if (label && !label.contains(el)) {
        const t = clean(label.textContent);
        if (t && t.length < 300) return t;
      }
    }
    const prev = el.previousElementSibling;
    if (prev && prev.textContent && prev.textContent.length < 200) return clean(prev.textContent);
    return '';
  }

  function labelFor(el) {
    if (el.labels && el.labels.length && !/^(radio|checkbox)$/i.test(el.type)) {
      const t = clean([...el.labels].map((l) => l.textContent).join(' '));
      if (t) return t;
    }
    const aria = byIds(el.getAttribute('aria-labelledby')) || clean(el.getAttribute('aria-label'));
    if (aria) return aria;
    const near = nearbyText(el);
    if (near) return near;
    return clean(el.placeholder || (el.name || el.id || '').replace(/[_\-[\]]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
  }

  // For radios/checkbox groups: the question, not the option text.
  function groupQuestion(el) {
    const fs = el.closest('fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg) return clean(lg.textContent);
    }
    const group = el.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      const t = byIds(group.getAttribute('aria-labelledby')) || clean(group.getAttribute('aria-label'));
      if (t) return t;
    }
    return nearbyText(el.closest('label') || el) || clean(el.name);
  }

  function optionLabel(el) {
    if (el.labels && el.labels.length) return clean(el.labels[0].textContent);
    return clean(el.getAttribute('aria-label') || el.value);
  }

  // ---- Profile mapping ----------------------------------------------------------
  const yn = (v) => (v === true || /^y/i.test(v) ? 'Yes' : v === false || /^n/i.test(v) ? 'No' : '');
  const first = (arr) => (arr && arr[0]) || {};

  // Order matters: more specific patterns first.
  const RULES = [
    { key: 'firstName', re: /(first|given|preferred)[\s_-]*name|^fname$/i, v: (p) => p.personal.firstName },
    { key: 'lastName', re: /(last|family|sur)[\s_-]*name|^lname$/i, v: (p) => p.personal.lastName },
    { key: 'fullName', re: /^(full[\s_-]*)?name$|your name|legal name|full name/i, v: (p) => [p.personal.firstName, p.personal.lastName].filter(Boolean).join(' ') },
    { key: 'email', re: /e-?mail/i, v: (p) => p.personal.email },
    { key: 'phone', re: /phone|mobile|cell|telephone/i, v: (p) => p.personal.phone },
    { key: 'linkedin', re: /linked\s?in/i, v: (p) => p.personal.linkedin },
    { key: 'github', re: /git\s?hub/i, v: (p) => p.personal.github },
    { key: 'website', re: /website|portfolio|personal (site|url)|^url$/i, v: (p) => p.personal.website },
    { key: 'zip', re: /zip|postal/i, v: (p) => p.personal.zip },
    { key: 'city', re: /\bcity\b|town/i, v: (p) => p.personal.city },
    { key: 'state', re: /\bstate\b|province|region/i, v: (p) => p.personal.state },
    { key: 'country', re: /\bcountry\b/i, v: (p) => p.personal.country },
    { key: 'location', re: /^(current )?location$|where are you (located|based)/i, v: (p) => [p.personal.city, p.personal.state].filter(Boolean).join(', ') },
    { key: 'address', re: /address( line)? ?1?$|street/i, v: (p) => p.personal.address },
    { key: 'currentCompany', re: /current (company|employer)|^company$|employer name/i, v: (p) => p.personal.currentCompany || first(p.autoApply.experience).company },
    { key: 'currentTitle', re: /current (job )?title|^job title$|current (role|position)/i, v: (p) => p.personal.currentTitle || first(p.autoApply.experience).title },
    { key: 'years', re: /years of (professional |relevant |total )?experience|how many years/i, v: (p) => p.personal.yearsExperience },
    { key: 'salary', re: /salary|compensation|pay expectation|desired pay|expected pay/i, v: (p) => p.salary.min ? `${p.salary.min}${p.salary.max ? ' - ' + p.salary.max : ''}` : '' },
    { key: 'sponsorship', re: /sponsor/i, v: (p) => yn(p.autoApply.requireSponsorship) },
    { key: 'workAuth', re: /authori[sz]ed to work|work authori[sz]ation|legally (authori[sz]ed|eligible|able)|eligible to work|right to work/i, v: (p) => yn(p.autoApply.workAuthorized) },
    { key: 'relocate', re: /relocat/i, v: (p) => yn(p.willingToRelocate) },
    { key: 'hispanic', re: /hispanic|latin[oax]/i, v: (p) => p.autoApply.eeo.hispanic },
    { key: 'race', re: /\brace\b|ethnic/i, v: (p) => p.autoApply.eeo.race },
    { key: 'gender', re: /gender|\bsex\b/i, v: (p) => p.autoApply.eeo.gender },
    { key: 'veteran', re: /veteran|military/i, v: (p) => p.autoApply.eeo.veteran },
    { key: 'disability', re: /disabilit/i, v: (p) => p.autoApply.eeo.disability },
    { key: 'pronouns', re: /pronoun/i, v: (p) => p.autoApply.eeo.pronouns },
    { key: 'school', re: /school|university|college|institution/i, v: (p) => first(p.autoApply.education).school },
    { key: 'degree', re: /degree|level of education|highest education/i, v: (p) => first(p.autoApply.education).degree },
    { key: 'major', re: /major|field of study|discipline|area of study/i, v: (p) => first(p.autoApply.education).field },
    { key: 'gradYear', re: /graduat/i, v: (p) => first(p.autoApply.education).endYear },
    { key: 'gpa', re: /\bgpa\b|grade point/i, v: (p) => first(p.autoApply.education).gpa },
    { key: 'notice', re: /notice period/i, v: (p) => p.autoApply.noticePeriod },
    { key: 'startDate', re: /start date|available to start|earliest start|when can you start/i, v: (p) => p.autoApply.earliestStart },
    { key: 'coverLetter', re: /cover letter/i, v: (p) => p.autoApply.coverLetterTemplate, textarea: true },
  ];

  function ruleFor(label) {
    return RULES.find((r) => r.re.test(label));
  }

  // ---- Setting values (works with React/Vue controlled inputs) -------------------
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  const DECLINE = /decline|prefer not|not wish|don'?t wish|choose not|not to (say|disclose|answer)/i;

  function optionScore(optText, value) {
    const o = AJP.norm(optText);
    const v = AJP.norm(value);
    if (!o || !v) return 0;
    if (o === v) return 10;
    if (DECLINE.test(v) && DECLINE.test(o)) return 8;
    if (/^(yes|no)$/.test(v)) return o === v || o.startsWith(v + ' ') || o.startsWith(v + ',') ? 7 : 0;
    if (o.startsWith(v) || v.startsWith(o)) return 6;
    if (o.includes(v) || v.includes(o)) return 4;
    const ow = new Set(o.split(/\W+/).filter((w) => w.length > 2));
    const hits = v.split(/\W+/).filter((w) => w.length > 2 && ow.has(w)).length;
    return hits ? Math.min(3, hits) : 0;
  }

  function fillSelect(el, value) {
    let best = null;
    let bestScore = 0;
    for (const opt of el.options) {
      if (!opt.value && !opt.text.trim()) continue;
      const s = Math.max(optionScore(opt.text, value), optionScore(opt.value, value));
      if (s > bestScore) {
        bestScore = s;
        best = opt;
      }
    }
    if (!best || bestScore < 3) return false;
    setNativeValue(el, best.value);
    return true;
  }

  function fillRadioGroup(radios, value) {
    let best = null;
    let bestScore = 0;
    for (const r of radios) {
      const s = optionScore(optionLabel(r), value);
      if (s > bestScore) {
        bestScore = s;
        best = r;
      }
    }
    if (!best || bestScore < 3) return false;
    if (!best.checked) best.click();
    return true;
  }

  async function attachFile(el, resume) {
    if (!resume || !resume.file || !resume.file.dataUrl) return false;
    const blob = await (await fetch(resume.file.dataUrl)).blob();
    const file = new File([blob], resume.file.name || 'resume.pdf', { type: resume.file.type || blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // ---- Learned answers lookup -----------------------------------------------------
  function tokens(s) {
    return new Set(AJP.normKey(s).split(' ').filter((w) => w.length > 2));
  }

  function findLearned(answers, label) {
    const key = AJP.normKey(label);
    if (answers[key]) return answers[key];
    const a = tokens(label);
    if (a.size < 2) return null;
    let best = null;
    let bestJ = 0;
    for (const [k, v] of Object.entries(answers)) {
      const b = tokens(k);
      const inter = [...a].filter((w) => b.has(w)).length;
      const j = inter / (a.size + b.size - inter);
      if (j > bestJ) {
        bestJ = j;
        best = v;
      }
    }
    return bestJ >= 0.75 ? best : null;
  }

  // ---- Main --------------------------------------------------------------------------
  function visible(el) {
    if (el.type === 'file') return true; // file inputs are often visually hidden behind a button
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function mark(el, how) {
    el.dataset.ajpFilled = how;
    const target = el.type === 'radio' || el.type === 'checkbox' ? el.closest('label') || el : el;
    target.style.outline = how === 'learned' ? '2px solid #8b5cf6' : '2px solid #10b981';
    target.style.outlineOffset = '1px';
  }

  let filling = false; // ignore our own change events while filling

  async function fill(ctx) {
    filling = true;
    try {
      return await fillInner(ctx);
    } finally {
      filling = false;
    }
  }

  async function fillInner({ profile, answers, resume }) {
    const t0 = performance.now();
    const report = { filled: [], learned: [], skipped: [], questions: [], unknown: [], host: location.hostname };
    const doneGroups = new Set();
    const fields = [...document.querySelectorAll(FIELD_SEL)].filter((el) => !SKIP_TYPES.test(el.type || '') && !el.disabled && !el.readOnly && visible(el));

    for (const el of fields) {
      if (!el.dataset.ajpId) el.dataset.ajpId = AJP.uid('f');
      const type = (el.type || el.tagName).toLowerCase();
      try {
        // Radio/checkbox groups
        if (type === 'radio' || type === 'checkbox') {
          const name = el.name || el.dataset.ajpId;
          if (doneGroups.has(name)) continue;
          doneGroups.add(name);
          const group = el.name ? [...document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)] : [el];
          if (group.some((r) => r.checked)) continue;
          const q = groupQuestion(el);
          const rule = ruleFor(q);
          let value = rule ? rule.v(profile) : '';
          let how = 'profile';
          if (!value) {
            const l = findLearned(answers, q);
            if (l) (value = l.value), (how = 'learned');
          }
          if (value && fillRadioGroup(group, value)) {
            group.forEach((r) => r.checked && mark(r, how));
            report[how === 'learned' ? 'learned' : 'filled'].push(q);
          } else report.unknown.push(q);
          continue;
        }

        const label = labelFor(el);
        if (type === 'file') {
          if (/resume|cv\b|curriculum/i.test(label + ' ' + (el.name || '') + ' ' + (el.id || '')) && !el.files.length) {
            if (await attachFile(el, resume)) {
              report.filled.push('Resume file');
              mark(el, 'profile');
            } else report.skipped.push('Resume file (no file saved in Admin → Resumes)');
          }
          continue;
        }

        if (el.value && el.value.trim() && el.tagName !== 'SELECT') continue; // never overwrite user input
        if (el.tagName === 'SELECT' && el.selectedIndex > 0) continue;

        const isLongText = el.tagName === 'TEXTAREA';
        const rule = ruleFor(label);
        let value = rule && (!isLongText || rule.textarea) ? rule.v(profile) : '';
        let how = 'profile';
        if (!value) {
          const l = findLearned(answers, label);
          if (l) (value = l.value), (how = 'learned');
        }

        if (!value) {
          if (isLongText || (label.length > 30 && /\?|describe|explain|why|tell us/i.test(label))) {
            report.questions.push({ ajpId: el.dataset.ajpId, label: label.slice(0, 300), maxLength: el.maxLength > 0 ? el.maxLength : null });
          } else if (label) report.unknown.push(label);
          continue;
        }

        const ok = el.tagName === 'SELECT' ? fillSelect(el, value) : (setNativeValue(el, String(value)), true);
        if (ok) {
          mark(el, how);
          el.dataset.ajpValue = el.value;
          report[how === 'learned' ? 'learned' : 'filled'].push(label);
        } else report.unknown.push(label);
      } catch (e) {
        log.warn('Field fill failed', { label: labelFor(el), error: e.message });
      }
    }

    report.ms = Math.round(performance.now() - t0);
    log.info('Autofill done', { host: report.host, filled: report.filled.length, learned: report.learned.length, questions: report.questions.length, unknown: report.unknown.length, ms: report.ms });
    return report;
  }

  function fillQuestion(ajpId, text) {
    const el = document.querySelector(`[data-ajp-id="${CSS.escape(ajpId)}"]`);
    if (!el) return false;
    el.dataset.ajpValue = text; // AI draft is not a user answer until they edit it
    setNativeValue(el, text);
    mark(el, 'profile');
    return true;
  }

  // ---- Learning: watch what the user enters --------------------------------------------
  let learning = false;
  function startLearning() {
    if (learning) return;
    learning = true;
    document.addEventListener(
      'change',
      (e) => {
        const el = e.target;
        if (filling || !(el instanceof HTMLElement) || !el.matches(FIELD_SEL)) return;
        if (SKIP_TYPES.test(el.type || '') || el.type === 'file') return;
        let label;
        let value;
        if (el.type === 'radio') {
          if (!el.checked) return;
          label = groupQuestion(el);
          value = optionLabel(el);
        } else if (el.type === 'checkbox') {
          label = groupQuestion(el) + ' — ' + optionLabel(el);
          value = el.checked ? 'Yes' : 'No';
        } else if (el.tagName === 'SELECT') {
          label = labelFor(el);
          value = el.selectedOptions[0] ? el.selectedOptions[0].text : el.value;
        } else {
          label = labelFor(el);
          value = el.value;
          if (el.dataset.ajpValue === value) return; // our own fill, unchanged
        }
        if (!label || NEVER_LEARN.test(label) || !String(value).trim()) return;
        AJP.send('learnAnswer', { label, value, host: location.hostname, kind: el.tagName === 'TEXTAREA' ? 'long' : el.type || 'text' });
      },
      true
    );
    log.debug('Learning listener on', { host: location.hostname });
  }

  AJP.filler = { fill, fillQuestion, startLearning, labelFor, ruleFor, optionScore };
})();
