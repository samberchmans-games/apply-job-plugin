/*
 * workday-mock.js — an emulation of Workday's application form widgets, for tests, videos and manual checks.
 * It reproduces the DOM shapes and behaviours the Workday adapter relies on (data-automation-id names):
 *   formField-<id> wrappers with <label> · text inputs · dropdown BUTTONS (aria-haspopup=listbox) that open a
 *   popup listbox (activeListContainer) · multi-select prompts (type + Enter → promptOption list → selectedItem)
 *   · dateInputWrapper with Month/Day/Year spinbuttons · Work Experience / Education sections with "Add" buttons
 *   · a progress bar + "Save and Continue" between pages.
 * NOT Workday's code — verify the adapter on real Workday pages too (Tester Guide 4.9–4.12).
 *
 *   WorkdayMock.mount(container, { page: 'info' | 'experience' | 'eeo' })
 */
(function () {
  'use strict';
  const COUNTRIES = ['Canada', 'India', 'Mexico', 'United Kingdom', 'United States of America'];
  const STATES = ['California', 'New York', 'Texas', 'Washington'];
  const SOURCES = ['Company Website', 'Employee Referral', 'Indeed', 'LinkedIn', 'Other'];
  const SCHOOLS = ['Texas A&M University', 'University of Texas at Austin', 'University of Washington'];
  const FIELDS = ['Computer Engineering', 'Computer Science', 'Data Science', 'Information Systems'];
  const DEGREES = ["Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Doctorate'];

  let uid = 0;
  const id = (p) => `${p}-${++uid}`;
  const h = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };

  function closePopups(doc) {
    doc.querySelectorAll('[data-automation-id="activeListContainer"]').forEach((p) => p.remove());
    doc.querySelectorAll('[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }

  function openList(doc, anchor, options, onPick) {
    closePopups(doc);
    const pop = h(`<div data-automation-id="activeListContainer" style="position:absolute;z-index:50;background:#fff;border:1px solid #888;max-height:220px;overflow:auto">
      <ul role="listbox">${options.map((o) => `<li role="option" data-automation-id="promptOption" data-automation-label="${o}" tabindex="-1" style="padding:4px 8px;cursor:pointer"><div>${o}</div></li>`).join('')}</ul></div>`);
    const r = anchor.getBoundingClientRect();
    pop.style.left = r.left + window.scrollX + 'px';
    pop.style.top = r.bottom + window.scrollY + 'px';
    pop.addEventListener('click', (e) => {
      const li = e.target.closest('[role="option"]');
      if (!li) return;
      onPick(li.getAttribute('data-automation-label'));
      pop.remove();
    });
    doc.body.appendChild(pop);
    return pop;
  }

  // ---- widgets -----------------------------------------------------------------------------
  const field = (key, label, inner, required = true) =>
    `<div data-automation-id="formField-${key}" style="margin:10px 0"><label id="${key}-lbl-${uid}" for="${key}-in-${uid}">${label}${required ? '<abbr title="required">*</abbr>' : ''}</label><div>${inner}</div></div>`;
  const text = (key, label, type = 'text') => field(key, label, `<input type="${type}" id="${key}-in-${uid}" data-automation-id="${key}">`);
  const area = (key, label) => field(key, label, `<textarea id="${key}-in-${uid}" data-automation-id="${key}" rows="3"></textarea>`, false);
  const dropdown = (key, label, options) =>
    field(key, label, `<button type="button" aria-haspopup="listbox" aria-expanded="false" data-automation-id="${key}" data-options='${JSON.stringify(options).replace(/'/g, '&#39;')}' value="">Select One</button>`);
  const prompt = (key, label, options) =>
    field(key, label, `<div data-automation-id="multiSelectContainer" data-key="${key}" data-options='${JSON.stringify(options).replace(/'/g, '&#39;')}'><div data-automation-id="selectedItemList"></div><input data-automation-id="searchBox" placeholder="Search" aria-label="${label}"></div>`);
  const date = (key, label, parts = ['Month', 'Year']) =>
    field(key, label, `<div data-automation-id="dateInputWrapper">${parts.map((p) => `<input role="spinbutton" data-automation-id="dateSection${p}-input" aria-label="${p}" size="4" placeholder="${p === 'Year' ? 'YYYY' : p === 'Month' ? 'MM' : 'DD'}">`).join(' / ')}</div>`);
  const check = (key, label) => field(key, label, `<input type="checkbox" data-automation-id="${key}" id="${key}-in-${uid}">`, false);

  function workPanel(n) {
    return h(`<div data-automation-id="workExperience-${n}" style="border:1px solid #ccc;padding:8px;margin:8px 0"><h4>Work Experience ${n}</h4>
      ${text('jobTitle', 'Job Title')}${text('company', 'Company')}${text('location', 'Location')}${check('currentlyWorkHere', 'I currently work here')}
      ${date('startDate', 'From')}${date('endDate', 'To')}${area('roleDescription', 'Role Description')}</div>`);
  }
  function eduPanel(n) {
    return h(`<div data-automation-id="education-${n}" style="border:1px solid #ccc;padding:8px;margin:8px 0"><h4>Education ${n}</h4>
      ${prompt('school', 'School or University', SCHOOLS)}${dropdown('degree', 'Degree', DEGREES)}${prompt('fieldOfStudy', 'Field of Study', FIELDS)}
      ${text('gradeAverage', 'Overall Result (GPA)')}${date('firstYearAttended', 'From', ['Year'])}${date('lastYearAttended', 'To (Actual or Expected)', ['Year'])}</div>`);
  }
  function section(kind, title, makePanel) {
    const sec = h(`<div role="group" aria-labelledby="${kind}-section" data-automation-id="${kind}Section"><h3 id="${kind}-section">${title}</h3><div class="panels"></div>
      <button type="button" data-automation-id="Add">Add</button></div>`);
    let n = 0;
    sec.querySelector('[data-automation-id="Add"]').addEventListener('click', (e) => {
      // Workday renders the new entry asynchronously and relabels the button "Add Another".
      setTimeout(() => {
        sec.querySelector('.panels').appendChild(makePanel(++n));
        e.target.textContent = 'Add Another';
        e.target.setAttribute('data-automation-id', 'Add Another');
      }, 30);
    });
    return sec;
  }

  const PAGES = {
    info: () =>
      `<h2 data-automation-id="pageHeader">My Information</h2>
       ${dropdown('countryDropdown', 'Country', COUNTRIES)}
       ${text('legalNameSection_firstName', 'Given Name(s)')}${text('legalNameSection_lastName', 'Family Name')}
       ${text('addressSection_addressLine1', 'Address Line 1')}${text('addressSection_city', 'City')}
       ${dropdown('addressSection_countryRegion', 'State', STATES)}${text('addressSection_postalCode', 'Postal Code')}
       ${text('email', 'Email Address', 'email')}${dropdown('phone-device-type', 'Phone Device Type', ['Home', 'Mobile', 'Work'])}${text('phone-number', 'Phone Number', 'tel')}
       ${prompt('source', 'How Did You Hear About Us?', SOURCES)}
       ${dropdown('previousWorker', 'Have you previously worked for Acme?', ['Yes', 'No'])}
       ${dropdown('eligibleToWork', 'Are you legally authorized to work in the country in which the job is located?', ['Yes', 'No'])}
       ${dropdown('visaSponsorship', 'Will you now or in the future require sponsorship for employment visa status?', ['Yes', 'No'])}`,
    experience: () => `<h2 data-automation-id="pageHeader">My Experience</h2><div data-slot="work"></div><div data-slot="edu"></div>
       ${prompt('skills', 'Skills', ['AWS', 'Docker', 'Java', 'Kubernetes', 'Python', 'SQL'])}${text('linkedinQuestion', 'LinkedIn Profile')}`,
    eeo: () =>
      `<h2 data-automation-id="pageHeader">Voluntary Disclosures</h2>
       ${dropdown('gender', 'Gender', ['Male', 'Female', 'I do not wish to answer'])}
       ${dropdown('hispanicOrLatino', 'Are you Hispanic or Latino?', ['Yes', 'No', 'I do not wish to answer'])}
       ${dropdown('ethnicityDropdown', 'Race/Ethnicity', ['Asian (United States of America)', 'Black or African American (United States of America)', 'White (United States of America)', 'Two or More Races (United States of America)', 'I do not wish to answer'])}
       ${dropdown('veteranStatus', 'Veteran Status', ['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', 'I do not wish to self-identify'])}`,
  };
  const ORDER = [['info', 'My Information'], ['experience', 'My Experience'], ['eeo', 'Voluntary Disclosures'], ['review', 'Review']];

  function wire(root, doc) {
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('button[aria-haspopup="listbox"]');
      if (btn) {
        const opts = JSON.parse(btn.getAttribute('data-options'));
        btn.setAttribute('aria-expanded', 'true');
        openList(doc, btn, opts, (v) => {
          btn.textContent = v;
          btn.setAttribute('value', v);
          btn.setAttribute('aria-expanded', 'false');
          btn.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
    });
    root.addEventListener('keydown', (e) => {
      const input = e.target.closest('[data-automation-id="multiSelectContainer"] [data-automation-id="searchBox"]');
      if (input && e.key === 'Enter') {
        e.preventDefault();
        const box = input.closest('[data-automation-id="multiSelectContainer"]');
        const q = input.value.trim().toLowerCase();
        const opts = JSON.parse(box.getAttribute('data-options')).filter((o) => !q || o.toLowerCase().includes(q) || q.split(/\s+/).some((w) => w.length > 2 && o.toLowerCase().includes(w)));
        setTimeout(() => openList(doc, input, opts.length ? opts : ['No Items.'], (v) => {
          if (v === 'No Items.') return;
          box.querySelector('[data-automation-id="selectedItemList"]').appendChild(h(`<div data-automation-id="selectedItem" title="${v}">${v} ✕</div>`));
          input.value = '';
          box.dispatchEvent(new Event('change', { bubbles: true }));
        }), 20);
      }
      if (e.key === 'Escape') closePopups(doc);
    });
  }

  function mount(container, { page = 'info' } = {}) {
    const doc = container.ownerDocument;
    const step = ORDER.findIndex((o) => o[0] === page);
    container.innerHTML = `<div data-automation-id="applyFlowPage">
      <div data-automation-id="progressBar">${ORDER.map((o, i) => `<span data-automation-id="${i === step ? 'progressBarActiveStep' : 'progressBarInactiveStep'}">${o[1]}</span>`).join(' › ')}</div>
      <div data-automation-id="applyFlowForm">${PAGES[page] ? PAGES[page]() : '<h2>Review</h2>'}</div>
      <button type="button" data-automation-id="bottom-navigation-next-button">${page === 'eeo' ? 'Submit' : 'Save and Continue'}</button></div>`;
    if (page === 'experience') {
      container.querySelector('[data-slot="work"]').replaceWith(section('workExperience', 'Work Experience', workPanel));
      container.querySelector('[data-slot="edu"]').replaceWith(section('education', 'Education', eduPanel));
    }
    wire(container, doc);
    container.querySelector('[data-automation-id="bottom-navigation-next-button"]').addEventListener('click', () => {
      container.dataset.nextClicked = String(Number(container.dataset.nextClicked || 0) + 1);
    });
    return container;
  }

  // Go to another step in place (Workday is a single-page app: the URL often stays the same).
  function goTo(container, page) {
    closePopups(container.ownerDocument);
    return mount(container, { page });
  }

  globalThis.WorkdayMock = { mount, goTo, closePopups };
})();
