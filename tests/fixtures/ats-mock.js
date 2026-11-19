/*
 * ats-mock.js — emulations of Greenhouse, Lever, Ashby and iCIMS application forms, for tests, videos and manual
 * checks. They reproduce the DOM shapes and behaviours the adapters rely on:
 *   greenhouse          new job boards: React-Select comboboxes (role=combobox → menu → option → single-value),
 *                       async "Location (City)" search, hidden resume file input, EEO comboboxes
 *   greenhouse-classic  #application_form, select2 (hidden <select> + visible proxy that follows "change"),
 *                       "or enter manually" resume_text box
 *   lever               .application-question cards, name/org/urls[…] names, location input with its own results,
 *                       resume upload that PARSES the resume and fills fields itself, EEO <select>s, radio cards
 *   ashby               _systemfield_* names, Yes/No button pairs, location combobox, EEO radios
 *   icims / icims-login PersonProfileFields.* names, hidden <select> behind a custom dropdown; a sign-in page
 * NOT the vendors' code — verify the adapters on real pages too (Tester Guide 4.15–4.19).
 *
 *   AtsMock.mount(container, site)
 */
(function () {
  'use strict';
  let uid = 0;
  const h = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CITIES = ['Austin, Texas, United States', 'Austin, Minnesota, United States', 'Boston, Massachusetts, United States', 'Houston, Texas, United States'];
  const searchCities = (q) => (q.trim().length < 2 ? [] : CITIES.filter((c) => c.toLowerCase().includes(q.trim().toLowerCase())));

  // ---- React-Select emulation (Greenhouse job boards) --------------------------------------------------
  function reactSelect(id, label, options, { search = null } = {}) {
    return `<div class="field"><label id="${id}-label" for="${id}">${esc(label)}</label>
      <div class="select__container" data-rs="${id}" data-options='${esc(JSON.stringify(options))}' ${search ? `data-search="${search}"` : ''}>
        <div class="select__control" style="border:1px solid #999;padding:4px;min-height:24px">
          <div class="select__value-container"><div class="select__placeholder">Select...</div>
            <input id="${id}" role="combobox" type="text" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-labelledby="${id}-label" aria-controls="${id}-listbox" style="width:180px;border:0"></div>
        </div><input type="hidden" name="${id}"></div></div>`;
  }
  function wireReactSelect(c) {
    const input = c.querySelector('input[role="combobox"]');
    const id = c.getAttribute('data-rs');
    const opts = JSON.parse(c.getAttribute('data-options'));
    const search = c.getAttribute('data-search');
    let timer = 0;
    const close = () => {
      const m = c.querySelector('.select__menu');
      if (m) m.remove();
      input.setAttribute('aria-expanded', 'false');
    };
    const render = (list) => {
      close();
      const menu = h(`<div class="select__menu" role="listbox" id="${id}-listbox" style="border:1px solid #999;background:#fff">${
        list.length ? list.map((o) => `<div role="option" class="select__option" style="padding:3px 6px;cursor:pointer">${esc(o)}</div>`).join('') : `<div class="select__menu-notice">${search ? 'Type to search' : 'No options'}</div>`}</div>`);
      menu.addEventListener('click', (e) => {
        const o = e.target.closest('[role="option"]');
        if (!o) return;
        const v = o.textContent;
        const vc = c.querySelector('.select__value-container');
        const old = vc.querySelector('.select__placeholder, .select__single-value');
        old.replaceWith(h(`<div class="select__single-value">${esc(v)}</div>`));
        c.querySelector('input[type="hidden"]').value = v;
        input.value = '';
        close();
        c.dispatchEvent(new Event('change', { bubbles: true }));
      });
      c.appendChild(menu);
      input.setAttribute('aria-expanded', 'true');
    };
    const open = () => {
      const q = input.value.toLowerCase();
      if (search) {
        clearTimeout(timer);
        timer = setTimeout(() => render(searchCities(input.value)), 60); // async search, like Google Places
      } else render(opts.filter((o) => !q || o.toLowerCase().includes(q)));
    };
    input.addEventListener('mousedown', open);
    input.addEventListener('input', open);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowDown' && !c.querySelector('.select__menu')) open();
    });
  }

  // ---- select2 emulation (Greenhouse classic, many others) ------------------------------------------------
  function select2(id, name, label, options, hiddenStyle = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)') {
    return `<div class="field"><label for="${id}">${esc(label)}</label>
      <select id="${id}" name="${name}" class="select2-hidden-accessible" style="${hiddenStyle}"><option value="">Please select</option>${options.map((o, i) => `<option value="${i + 1}">${esc(o)}</option>`).join('')}</select>
      <span class="select2 select2-container" style="display:inline-block;border:1px solid #999;padding:3px 8px;min-width:200px"><span class="select2-selection__rendered">Please select</span></span></div>`;
  }
  function wireSelect2(root) {
    root.querySelectorAll('select.select2-hidden-accessible, select[data-proxied]').forEach((sel) => {
      const proxy = sel.nextElementSibling;
      sel.addEventListener('change', () => {
        const t = sel.selectedOptions[0] ? sel.selectedOptions[0].text : '';
        (proxy.querySelector('.select2-selection__rendered, .dropdown-text') || proxy).textContent = t;
      });
    });
  }

  // ---- Pages ------------------------------------------------------------------------------------------------
  const text = (id, label, type = 'text', name = id) => `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" name="${name}" type="${type}"></div>`;

  const PAGES = {
    greenhouse: () => `<div id="grnhse_app" data-ats="greenhouse"><h2>Apply for this job</h2><form id="application-form">
      ${text('first_name', 'First Name')}${text('last_name', 'Last Name')}${text('email', 'Email', 'email')}${text('phone', 'Phone', 'tel')}
      ${reactSelect('candidate-location', 'Location (City)', [], { search: 'cities' })}
      <div class="field"><label for="resume">Resume/CV</label><input id="resume" name="resume" type="file" class="visually-hidden" style="position:absolute;width:1px;height:1px;opacity:0"><button type="button">Attach</button></div>
      ${text('question_1', 'LinkedIn Profile')}
      ${reactSelect('question_2', 'Are you legally authorized to work in the United States?', ['Yes', 'No'])}
      ${reactSelect('question_3', 'Will you now or in the future require sponsorship for employment visa status?', ['Yes', 'No'])}
      ${reactSelect('question_4', 'How did you hear about this job?', ['LinkedIn', 'Indeed', 'Employee Referral', 'Other'])}
      <div class="field"><label for="question_5">Why do you want to work at Initech?</label><textarea id="question_5" name="question_5" rows="3"></textarea></div>
      <h3>Voluntary Self-Identification</h3>
      ${reactSelect('gender', 'Gender', ['Male', 'Female', 'Decline To Self Identify'])}
      ${reactSelect('hispanic_ethnicity', 'Are you Hispanic/Latino?', ['Yes', 'No', 'Decline To Self Identify'])}
      ${reactSelect('veteran_status', 'Veteran Status', ['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', "I don't wish to answer"])}
      ${reactSelect('disability_status', 'Disability Status', ['Yes, I have a disability (or previously had a disability)', 'No, I do not have a disability and have not had one in the past', 'I do not want to answer'])}
      <button type="submit">Submit application</button></form></div>`,

    'greenhouse-classic': () => `<form id="application_form" action="https://boards.greenhouse.io/initech/jobs/1/applications" data-ats="greenhouse">
      ${text('first_name', 'First Name', 'text', 'job_application[first_name]')}${text('last_name', 'Last Name', 'text', 'job_application[last_name]')}
      ${text('email', 'Email', 'email', 'job_application[email]')}${text('phone', 'Phone', 'tel', 'job_application[phone]')}
      <div class="field"><label for="resume">Resume/CV</label><input id="resume" name="job_application[resume]" type="file"></div>
      <div class="field"><label for="resume_text">Resume/CV (or enter manually)</label><textarea id="resume_text" name="job_application[resume_text]" rows="3"></textarea></div>
      ${select2('job_application_answers_attributes_0', 'job_application[answers_attributes][0][boolean_value]', 'Will you now or in the future require sponsorship for employment visa status?', ['Yes', 'No'])}
      ${select2('job_application_answers_attributes_1', 'job_application[answers_attributes][1][text_value]', 'How did you hear about this job?', ['LinkedIn', 'Indeed', 'Glassdoor', 'Other'])}
      ${select2('job_application_gender', 'job_application[gender]', 'Gender', ['Male', 'Female', 'Decline To Self Identify'])}
      ${select2('job_application_veteran_status', 'job_application[veteran_status]', 'Veteran Status', ['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', "I don't wish to answer"])}
      <input type="submit" value="Submit Application"></form>`,

    lever: () => {
      const q = (label, field, extra = '') => `<li class="application-question ${extra}"><label><div class="application-label">${esc(label)}<span class="required">✱</span></div><div class="application-field">${field}</div></label></li>`;
      const sel = (name, opts) => `<select name="${name}"><option value="">Select ...</option>${opts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
      return `<div class="application-page" data-ats="lever"><form id="application-form" class="application-form" action="https://jobs.lever.co/initech/1/apply"><ul>
        ${q('Resume/CV', '<input type="file" name="resume" id="resume-upload-input">')}
        ${q('Full name', '<input type="text" name="name">')}${q('Email', '<input type="email" name="email">')}${q('Phone', '<input type="text" name="phone">')}
        ${q('Current location', '<input type="text" name="location" id="location-input" autocomplete="off"><div class="dropdown-results"></div><input type="hidden" name="selectedLocation">')}
        ${q('Current company', '<input type="text" name="org">')}
        ${q('LinkedIn URL', '<input type="text" name="urls[LinkedIn]">')}${q('GitHub URL', '<input type="text" name="urls[GitHub]">')}${q('Portfolio URL', '<input type="text" name="urls[Portfolio]">')}
        <li class="application-question custom-question"><div class="application-label">Are you legally authorized to work in the United States?</div><div class="application-field"><ul data-qa="multiple-choice">
          <li><label><input type="radio" name="cards[c1][field0]" value="Yes"><span class="application-answer-alternative">Yes</span></label></li>
          <li><label><input type="radio" name="cards[c1][field0]" value="No"><span class="application-answer-alternative">No</span></label></li></ul></div></li>
        ${q('Additional information', '<textarea name="comments" rows="3"></textarea>')}
        ${q('Gender', sel('eeo[gender]', ['Male', 'Female', 'Decline to self-identify']))}
        ${q('Race', sel('eeo[race]', ['Asian', 'Black or African American', 'White', 'Decline to self-identify']))}
        ${q('Veteran status', sel('eeo[veteran]', ['I am a veteran', 'I am not a veteran', 'Decline to self-identify']))}
      </ul><button type="submit" data-qa="btn-submit">Submit application</button></form></div>`;
    },

    ashby: () => {
      const entry = (inner) => `<div class="ashby-application-form-field-entry" style="margin:8px 0">${inner}</div>`;
      const title = (id, t) => `<label class="ashby-application-form-question-title" for="${id}">${esc(t)}</label>`;
      const yesno = (t) => entry(`<label class="ashby-application-form-question-title">${esc(t)}</label><div class="_yesno_1x"><button type="button" class="_option_">Yes</button><button type="button" class="_option_">No</button></div>`);
      const combo = (id, t, opts, search) => entry(`${title(id, t)}<div class="_combo_wrap"><input id="${id}" name="${id}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list" type="text" autocomplete="off" data-opts='${esc(JSON.stringify(opts))}' ${search ? 'data-search="1"' : ''}></div>`);
      return `<div class="ashby-application-form-container" data-ats="ashby"><form>
        ${entry(`${title('_systemfield_name', 'Name')}<input id="_systemfield_name" name="_systemfield_name" type="text">`)}
        ${entry(`${title('_systemfield_email', 'Email')}<input id="_systemfield_email" name="_systemfield_email" type="email">`)}
        ${entry(`${title('q3f1c', 'Phone number')}<input id="q3f1c" name="q3f1c" type="tel">`)}
        ${entry(`${title('_systemfield_resume', 'Resume')}<input id="_systemfield_resume" name="_systemfield_resume" type="file" style="display:none"><button type="button">Upload File</button>`)}
        ${combo('_systemfield_location', 'Location', [], true)}
        ${entry(`${title('q9a2b', 'LinkedIn Profile')}<input id="q9a2b" name="q9a2b" type="text">`)}
        ${yesno('Are you legally authorized to work in the United States?')}
        ${yesno('Will you now or in the future require visa sponsorship?')}
        ${yesno('Have you worked for Initech before?')}
        ${combo('q7d4e', 'How did you hear about us?', ['LinkedIn', 'Referral', 'Company website', 'Other'])}
        ${entry(`${title('q5e6f', 'Why Initech?')}<textarea id="q5e6f" name="q5e6f" rows="3"></textarea>`)}
        <fieldset><legend>Gender</legend><label><input type="radio" name="eeo_gender" value="m"> Male</label><label><input type="radio" name="eeo_gender" value="f"> Female</label><label><input type="radio" name="eeo_gender" value="d"> Decline to self-identify</label></fieldset>
        <button type="submit">Submit Application</button></form></div>`;
    },

    icims: () => {
      const dd = (id, name, label, opts) => `<div class="field"><label for="${id}">${esc(label)}</label>
        <select id="${id}" name="${name}" data-proxied="1" style="display:none"><option value="">— Make a Selection —</option>${opts.map((o, i) => `<option value="${100 + i}">${esc(o)}</option>`).join('')}</select>
        <a href="#" class="dropdown-toggle iCIMS_Dropdown" data-proxy-for="${id}" style="display:inline-block;border:1px solid #999;padding:3px 8px"><span class="dropdown-text">— Make a Selection —</span></a></div>`;
      const t = (field, label, type = 'text') => text(`PersonProfileFields.${field}`, label, type, `PersonProfileFields.${field}`);
      return `<div class="iCIMS_MainWrapper" data-ats="icims"><div id="iCIMS_Content"><form action="https://careers-initech.icims.com/jobs/1/candidate/submit">
        ${t('FirstName', 'First Name')}${t('LastName', 'Last Name')}${t('Email', 'Email Address', 'email')}${t('PhoneNumber', 'Phone Number', 'tel')}
        ${t('AddressStreet1', 'Address')}${t('AddressCity', 'City')}
        ${dd('PersonProfileFields.AddressState', 'PersonProfileFields.AddressState', 'State/Province', ['California', 'New York', 'Texas', 'Washington'])}
        ${t('AddressZip', 'Zip/Postal Code')}
        ${dd('PersonProfileFields.AddressCountry', 'PersonProfileFields.AddressCountry', 'Country', ['Canada', 'India', 'United Kingdom', 'United States'])}
        ${dd('rcf3048', 'rcf3048', 'Are you at least 18 years of age?', ['Yes', 'No'])}
        <input type="submit" value="Submit"></form></div></div>`;
    },

    'icims-login': () => `<div class="iCIMS_MainWrapper" data-ats="icims"><form action="https://careers-initech.icims.com/jobs/login">
      ${text('email', 'Email Address', 'email')}<div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password"></div>
      <button type="submit">Log In</button></form></div>`,
  };

  function wireLever(root) {
    const input = root.querySelector('#location-input');
    const results = root.querySelector('.dropdown-results');
    let timer = 0;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        results.innerHTML = searchCities(input.value).map((c) => `<div class="dropdown-location" style="padding:3px;cursor:pointer">${esc(c)}</div>`).join('');
      }, 40);
    });
    results.addEventListener('click', (e) => {
      const o = e.target.closest('.dropdown-location');
      if (!o) return;
      input.value = o.textContent;
      root.querySelector('[name="selectedLocation"]').value = JSON.stringify({ name: o.textContent });
      results.innerHTML = '';
    });
    // Lever reads the uploaded resume and fills empty fields with what it guessed.
    root.querySelector('#resume-upload-input').addEventListener('change', () => {
      setTimeout(() => {
        const guess = { name: 'ANA M. SILVA', email: 'ana.silva@oldmail.example', org: 'Acme Corporation Inc' };
        for (const [n, v] of Object.entries(guess)) {
          const el = root.querySelector(`[name="${n}"]`);
          if (el && !el.value) el.value = v;
        }
        root.dataset.parsed = '1';
      }, 80);
    });
  }

  function wireAshby(root) {
    root.querySelectorAll('._yesno_1x').forEach((g) => g.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      g.querySelectorAll('button').forEach((x) => x.classList.toggle('_active_', x === b));
    }));
    root.querySelectorAll('input[role="combobox"]').forEach((input) => {
      const opts = JSON.parse(input.getAttribute('data-opts'));
      const search = input.hasAttribute('data-search');
      let timer = 0;
      const close = () => {
        const l = document.getElementById(input.getAttribute('aria-controls'));
        if (l) l.remove();
        input.setAttribute('aria-expanded', 'false');
      };
      const render = (list) => {
        close();
        if (!list.length) return;
        const l = h(`<div role="listbox" id="${input.getAttribute('aria-controls')}" style="border:1px solid #999;background:#fff">${list.map((o) => `<div role="option" style="padding:3px;cursor:pointer">${esc(o)}</div>`).join('')}</div>`);
        l.addEventListener('click', (e) => {
          const o = e.target.closest('[role="option"]');
          if (!o) return;
          input.value = o.textContent;
          close();
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        input.parentElement.appendChild(l);
        input.setAttribute('aria-expanded', 'true');
      };
      const open = () => {
        if (search) {
          clearTimeout(timer);
          timer = setTimeout(() => render(searchCities(input.value)), 50);
        } else render(opts.filter((o) => !input.value || o.toLowerCase().includes(input.value.toLowerCase())));
      };
      input.addEventListener('mousedown', open);
      input.addEventListener('input', open);
      input.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    });
  }

  function wireIcims(root) {
    root.querySelectorAll('select[data-proxied]').forEach((sel) => {
      const proxy = root.querySelector(`[data-proxy-for="${CSS.escape(sel.id)}"]`);
      sel.addEventListener('change', () => (proxy.querySelector('.dropdown-text').textContent = sel.selectedOptions[0].text));
    });
  }

  function mount(container, site) {
    uid++;
    container.innerHTML = PAGES[site]();
    if (site === 'greenhouse') container.querySelectorAll('[data-rs]').forEach(wireReactSelect);
    if (site === 'greenhouse-classic') wireSelect2(container);
    if (site === 'lever') wireLever(container);
    if (site === 'ashby') wireAshby(container);
    if (site === 'icims') wireIcims(container);
    container.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => {
      e.preventDefault();
      container.dataset.submitted = '1';
    }));
    return container;
  }

  globalThis.AtsMock = { mount, SITES: Object.keys(PAGES) };
})();
