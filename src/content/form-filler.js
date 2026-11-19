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
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[*✱∗＊]/g, '').trim();
  // A <label> that wraps its control (Lever) must not include the control's own text (a select's options).
  const labelText = (l) => {
    if (!l.querySelector('select, textarea, input, option')) return l.textContent;
    const c = l.cloneNode(true);
    c.querySelectorAll('select, textarea, input, option, button').forEach((n) => n.remove());
    return c.textContent;
  };

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
      const t = clean([...el.labels].map(labelText).join(' '));
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

  // ---- Profile mapping: the shared label → profile rules (src/lib/field-rules.js) ------------------------
  const RULES = AJP.FIELD_RULES;
  const ruleFor = AJP.fieldRules.ruleFor;
  const ruleByKey = AJP.fieldRules.ruleByKey;

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

  // Also tries the site's usual wording: "TX" → "Texas", "USA" → "United States of America", "B.S." → "Bachelor's Degree".
  function fillSelectAny(el, value, key) {
    const tries = AJP.workday ? AJP.workday.candidates(value, key || labelFor(el)) : [value];
    return tries.some((v) => fillSelect(el, v));
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
    if (!resume) return false;
    // One format: applications always get a PDF. Older resumes (no file, or a Word/text file) get one made now.
    const isPdf = (f) => f && f.dataUrl && /pdf/i.test(f.type || f.name || '');
    if (!isPdf(resume.file) && (resume.text || '').trim() && AJP.pdfWriter) {
      try {
        resume = { ...resume, file: AJP.pdfWriter.fileFor(resume).file };
      } catch (e) {
        const x = AJP.toAppError(e);
        log.warn('PDF for upload not created; using the saved file', { code: x.code, details: x.details }, { code: x.code });
      }
    }
    if (!resume.file || !resume.file.dataUrl) return false;
    attachFile.lastName = resume.file.name;
    const blob = await (await fetch(resume.file.dataUrl)).blob(); // local data: URL decode, not a network call
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

  async function fillInner({ profile, answers, resume, root = document }) {
    const t0 = performance.now();
    const report = { filled: [], learned: [], skipped: [], questions: [], unknown: [], notes: [], host: location.hostname };
    const doneGroups = new Set();
    const workday = AJP.workday && AJP.workday.applies(root);
    const site = !workday && AJP.ats ? AJP.ats.detect(root) : null;
    if (site) report.site = site.name;
    const rulefor = (el, label) => {
      const key = site && AJP.ats.ruleKey(el, site);
      return (key && ruleByKey(key)) || ruleFor(label);
    };
    // Repeatable Work experience / Education blocks are filled by entries.js (one block per profile item).
    const entrySecs = !workday && AJP.entries ? AJP.entries.sections(root) : [];
    const fields = [...root.querySelectorAll(FIELD_SEL)]
      .filter((el) => !SKIP_TYPES.test(el.type || '') && !el.disabled && !el.readOnly && visible(el) && !(workday && AJP.workday.owns(el)) && !(AJP.ats && AJP.ats.owns(el)) && !(site && site.location && el.matches(site.location.input)) && !(AJP.entries && AJP.entries.owns(el, entrySecs)))
      // Files first: some sites (Lever) read the uploaded resume and fill fields themselves.
      .sort((a, b) => (b.type === 'file') - (a.type === 'file'));
    let snap = null;
    let waitedForSite = !(site && site.resumeFirst);

    for (const el of fields) {
      if (!el.dataset.ajpId) el.dataset.ajpId = AJP.uid('f');
      const type = (el.type || el.tagName).toLowerCase();
      if (!waitedForSite && type !== 'file') {
        waitedForSite = true;
        if (snap) {
          const changed = await AJP.ats.siteFilled(snap);
          if (changed.length) report.notes.push(`${site.name} filled ${changed.length} field(s) from your resume; your profile values were used where you have them.`);
        }
      }
      try {
        // Radio/checkbox groups
        if (type === 'radio' || type === 'checkbox') {
          const name = el.name || el.dataset.ajpId;
          if (doneGroups.has(name)) continue;
          doneGroups.add(name);
          const group = el.name ? [...root.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)] : [el];
          if (group.some((r) => r.checked)) continue;
          const q = groupQuestion(el);
          const rule = rulefor(el, q);
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
            if (site && site.resumeFirst && !snap) snap = AJP.ats.snapshot(root);
            if (await attachFile(el, resume)) {
              report.filled.push('Resume file');
              report.attached = attachFile.lastName;
              mark(el, 'profile');
            } else report.skipped.push('Resume file (no file saved in Admin → Resumes)');
          }
          continue;
        }

        // Never overwrite user input (a value the SITE guessed from the resume may be replaced; see Lever).
        if (el.value && el.value.trim() && el.tagName !== 'SELECT' && !el.dataset.ajpSiteFilled) continue;
        if (el.tagName === 'SELECT' && el.selectedIndex > 0) continue;

        const isLongText = el.tagName === 'TEXTAREA';
        // "Paste your resume" boxes: the resume text, never an AI question. Skipped when the file went in.
        if (isLongText && (/^(resume|cv)\b|resume\s*\/\s*cv|paste (your )?resume/i.test(label) || (site && site.resumeText && /resume/i.test(el.name || el.id || '') && site.resumeText.test(el.name || el.id || '')))) {
          if (!report.attached && resume && (resume.text || '').trim()) {
            setNativeValue(el, resume.text);
            el.dataset.ajpValue = el.value;
            mark(el, 'profile');
            report.filled.push('Resume (pasted text)');
          }
          continue;
        }
        const rule = rulefor(el, label);
        let value = rule && (!isLongText || rule.textarea) ? rule.v(profile) : '';
        let how = 'profile';
        if (!value) {
          const l = findLearned(answers, label);
          if (l) (value = l.value), (how = 'learned');
        }

        if (!value && el.dataset.ajpSiteFilled) continue; // keep what the site read from the resume
        if (!value) {
          if (isLongText || (label.length > 30 && /\?|describe|explain|why|tell us/i.test(label))) {
            report.questions.push({ ajpId: el.dataset.ajpId, label: label.slice(0, 300), maxLength: el.maxLength > 0 ? el.maxLength : null });
          } else if (label) report.unknown.push(label);
          continue;
        }

        const ok = el.tagName === 'SELECT' ? fillSelectAny(el, value, rule && rule.key) : (setNativeValue(el, String(value)), true);
        if (ok) {
          mark(el, how);
          el.dataset.ajpValue = el.value;
          report[how === 'learned' ? 'learned' : 'filled'].push(label);
        } else report.unknown.push(label);
      } catch (e) {
        log.warn('Field fill failed', { label: labelFor(el), error: e.message });
      }
    }

    // Site widgets: searchable dropdowns, location autocompletes, Yes/No buttons, hidden selects (Greenhouse,
    // Lever, Ashby, iCIMS, and the same widgets on any other site).
    if (!workday && AJP.ats) {
      try {
        await AJP.ats.fill({ profile, answers, resume, root, report, site });
      } catch (e) {
        const x = AJP.toAppError(e);
        log.error('Site widgets autofill failed', { code: x.code, error: x.message, details: x.details }, { code: x.code });
        report.skipped.push(`Dropdowns and buttons (${x.code})`);
      }
    }

    // Work experience / Education entries (not Workday: its adapter does them).
    if (entrySecs.length) {
      try {
        await AJP.entries.fill({ profile, root, report });
      } catch (e) {
        const x = AJP.toAppError(e);
        log.error('Entries autofill failed', { code: x.code, error: x.message, details: x.details }, { code: x.code });
        report.skipped.push(`Work / education entries (${x.code})`);
      }
    }

    // Workday: custom dropdowns, search prompts, dates and experience/education entries.
    if (workday) {
      try {
        await AJP.workday.fill({ profile, answers, root, report });
      } catch (e) {
        const x = AJP.toAppError(e);
        log.error('Workday autofill failed', { code: x.code, error: x.message, details: x.details }, { code: x.code });
        report.skipped.push(`Workday fields (${x.code})`);
      }
    }

    report.ms = Math.round(performance.now() - t0);
    log.info('Autofill done', { host: report.host, site: site ? site.id : workday ? 'workday' : 'generic', filled: report.filled.length, learned: report.learned.length, questions: report.questions.length, unknown: report.unknown.length, ms: report.ms });
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
    // Searchable dropdowns and Yes/No buttons are not <select>/radios: learn from what the user clicks.
    if (AJP.ats) {
      AJP.ats.learnFromClicks((label, value, kind) => {
        if (filling || NEVER_LEARN.test(label)) return;
        AJP.send('learnAnswer', { label, value, host: location.hostname, kind });
      });
    }
    // Workday dropdowns are buttons + popup lists, not <select>: learn from the option the user clicks.
    if (AJP.workday) {
      AJP.workday.learnFromClicks((label, value) => {
        if (filling || NEVER_LEARN.test(label)) return;
        AJP.send('learnAnswer', { label, value, host: location.hostname, kind: 'select' });
      });
    }
    log.debug('Learning listener on', { host: location.hostname });
  }

  AJP.filler = { fill, fillQuestion, startLearning, labelFor, groupQuestion, ruleFor, ruleByKey, optionScore, fillSelect, fillSelectAny, findLearned, setNativeValue, mark, NEVER_LEARN, RULES };
})();
