/*
 * Repeatable Work experience / Education entries on non-Workday sites (entries.js), against emulated
 * Greenhouse job-board blocks and SmartRecruiters-style "+ Add" forms (tests/fixtures/ats-mock.js).
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const sandbox = () => document.getElementById('sandbox');
  const $ = (s) => sandbox().querySelector(s);
  const $$ = (s) => [...sandbox().querySelectorAll(s)];
  function profile() {
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p.personal, { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.com' });
    p.autoApply.experience = [
      { title: 'Senior Engineer', company: 'Acme Corp', location: 'Austin, TX', start: '06/2019', end: 'Present', description: 'Led data platform migration to AWS.' },
      { title: 'Engineer', company: 'Globex', location: 'Dallas, TX', start: '01/2015', end: '05/2019', description: 'Built Python ETL jobs.' },
    ];
    p.autoApply.education = [
      { school: 'University of Texas at Austin', degree: 'B.S.', field: 'Computer Science', startYear: '2011', endYear: '2015' },
      { school: 'University of Washington', degree: 'M.S.', field: 'Data Science', startYear: '2015', endYear: '2016' },
    ];
    return p;
  }
  const fill = (p = profile()) => AJP.filler.fill({ profile: p, answers: {}, resume: null, root: sandbox() });
  const rs = (box, idPrefix) => {
    const v = box.querySelector(`[data-rs^="${idPrefix}"] .select__single-value`);
    return v ? v.textContent : '';
  };
  const cleanup = () => {
    sandbox().innerHTML = '';
    document.querySelectorAll('.select__menu').forEach((m) => m.remove());
  };

  describe('entries › dates (pure)', () => {
    const el = (tag, type = 'text', opts = []) => ({ tagName: tag, type, options: opts.map((t) => ({ text: t })) });
    it('month select gets the month name, year box the year', () => {
      eq(AJP.entries.dateValue(el('SELECT', 'select-one', ['Month', 'January', 'February']), 'Start date month', '06/2019').select, 'June');
      eq(AJP.entries.dateValue(el('INPUT'), 'Start date year', '06/2019').text, '2019');
    });
    it('a month input gets YYYY-MM; a plain box gets MM/YYYY', () => {
      eq(AJP.entries.dateValue(el('INPUT', 'month'), 'From', '06/2019').text, '2019-06');
      eq(AJP.entries.dateValue(el('INPUT'), 'Start date', 'June 2019').text, '06/2019');
    });
    it('"Present" is not a date', () => eq(AJP.entries.dateValue(el('INPUT'), 'End date', 'Present'), null));
    it('only a year known → a month box is left alone (not reported as missed)', () => eq(AJP.entries.dateValue(el('SELECT', 'select-one', ['Month', 'January']), 'Start date month', '2011'), { skip: true }));
  });

  describe('entries › Greenhouse education & employment blocks', () => {
    afterEach(cleanup);
    const edu = () => $$('.education--form');
    const jobs = () => $$('.employment--form');

    it('clicks "+ Add another" until there is one block per school / job', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-entries');
      await fill();
      eq([edu().length, jobs().length], [2, 2]);
    });
    it('education: searchable school / degree / discipline, start and end years', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-entries');
      await fill();
      const [a, b] = edu();
      eq([rs(a, 'school'), rs(a, 'degree'), rs(a, 'discipline')], ['University of Texas at Austin', "Bachelor's Degree", 'Computer Science']);
      eq([a.querySelector('[id^="edu-start-year"]').value, a.querySelector('[id^="edu-end-year"]').value], ['2011', '2015']);
      eq([rs(b, 'school'), rs(b, 'degree')], ['University of Washington', "Master's Degree"]);
    });
    it('employment: company, title, month + year dates; "Current role" ticked and no end date for the current job', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-entries');
      await fill();
      const [a, b] = jobs();
      const v = (box, sel) => box.querySelector(sel).value;
      eq([v(a, '[id^="company-name"]'), v(a, '[id^="job-title"]'), v(a, '[id^="job-start-month"]'), v(a, '[id^="job-start-year"]')], ['Acme Corp', 'Senior Engineer', '6', '2019']);
      ok(a.querySelector('[id^="current-role"]').checked);
      eq(v(a, '[id^="job-end-year"]'), '');
      eq([v(b, '[id^="company-name"]'), v(b, '[id^="job-end-month"]'), v(b, '[id^="job-end-year"]')], ['Globex', '5', '2019']);
      notOk(b.querySelector('[id^="current-role"]').checked);
    });
    it('the report lists the entry fields', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-entries');
      const r = await fill();
      includes(r.filled, 'Work experience 1: Company name');
      includes(r.filled, 'Education 2: School');
      ok(!r.unknown.some((u) => /Education \d: (Start|End) date month/.test(u)), 'year-only education: month boxes not reported');
    });
    it('an entry the user already filled is kept; the next profile item goes into a new block', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-entries');
      $('[id^="company-name"]').value = 'My Own Startup';
      await fill();
      const names = jobs().map((b) => b.querySelector('[id^="company-name"]').value);
      eq(names, ['My Own Startup', 'Acme Corp', 'Globex']);
    });
    it('no profile entries → nothing added', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-entries');
      const p = profile();
      p.autoApply.experience = [];
      p.autoApply.education = [];
      await fill(p);
      eq([edu().length, jobs().length], [1, 1]);
      eq(jobs()[0].querySelector('[id^="company-name"]').value, '');
    });
    it('the normal fields above still fill (name, email)', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-entries');
      await fill();
      eq([$('#first_name').value, $('#email').value], ['Ana', 'ana@example.com']);
    });
  }, { env: 'browser' });

  describe('entries › SmartRecruiters-style "+ Add" forms', () => {
    afterEach(cleanup);
    const sec = (k) => $(`.sr-section[data-kind="${k}"]`);

    it('opens one form per job and fills it (title, company, location, month inputs, current, description)', async () => {
      AtsMock.mount(sandbox(), 'smartrecruiters');
      await fill();
      const forms = [...sec('exp').querySelectorAll('.entry')];
      eq(forms.length, 2);
      const v = (f, sel) => f.querySelector(sel).value;
      eq([v(forms[0], '[id^="sr-title"]'), v(forms[0], '[id^="sr-company"]'), v(forms[0], '[id^="sr-location"]'), v(forms[0], '[id^="sr-from"]')], ['Senior Engineer', 'Acme Corp', 'Austin, TX', '2019-06']);
      ok(forms[0].querySelector('[id^="sr-current"]').checked);
      includes(v(forms[0], '[id^="sr-desc"]'), 'migration');
      eq(v(forms[1], '[id^="sr-to"]'), '2019-05');
    });
    it('education forms: institution, major, degree select (B.S. → Bachelor\'s Degree), years', async () => {
      AtsMock.mount(sandbox(), 'smartrecruiters');
      await fill();
      const f = sec('edu').querySelectorAll('.entry')[0];
      eq([f.querySelector('[id^="sr-school"]').value, f.querySelector('[id^="sr-major"]').value, f.querySelector('[id^="sr-degree"]').value], ['University of Texas at Austin', 'Computer Science', "Bachelor's Degree"]);
    });
    it('when the site\'s Add button does not work → says how many could be added', async () => {
      AtsMock.mount(sandbox(), 'smartrecruiters');
      // The site's Add button for education stops working (replaced by a copy without its handler).
      const btn = sec('edu').querySelector(':scope > button');
      btn.replaceWith(btn.cloneNode(true));
      const saved = AJP.entries.CONFIG.addWaitMs;
      AJP.entries.CONFIG.addWaitMs = 200;
      try {
        const r = await fill();
        ok(r.skipped.some((s) => /Education: only 0 of 2 entries/.test(s)), JSON.stringify(r.skipped));
        eq(sec('exp').querySelectorAll('.entry').length, 2, 'experience still filled');
      } finally {
        AJP.entries.CONFIG.addWaitMs = saved;
      }
    });
  }, { env: 'browser' });

  describe('entries › never on the wrong things', () => {
    afterEach(cleanup);
    it('a job post\'s "Experience" heading next to a normal form is not an entries section', () => {
      sandbox().innerHTML = '<div><h3>Experience</h3><ul><li>5+ years with Python</li></ul><form><label for="e">Email</label><input id="e"><label for="c">Current company</label><input id="c"></form></div>';
      eq(AJP.entries.sections(sandbox()).length, 0);
    });
    it('the existing site forms are unaffected (Lever "Current company" stays a normal field)', async () => {
      AtsMock.mount(sandbox(), 'lever');
      eq(AJP.entries.sections(sandbox()).length, 0);
    });
    it('Workday pages are left to the Workday adapter', async () => {
      WorkdayMock.mount(sandbox(), { page: 'experience' });
      eq(AJP.entries.sections(sandbox()).length, 0);
      WorkdayMock.closePopups(document);
    });
  }, { env: 'browser' });
  describe('entries › live Greenhouse layout (job-boards, Nov 2026 report)', () => {
    afterEach(cleanup);
    const blocks = (cls) => $$(`.${cls}`);
    it('both sections are found although their titles are plain text, not headings', () => {
      AtsMock.mount(sandbox(), 'greenhouse-remix');
      eq(AJP.entries.sections(sandbox()).map((s) => s.kind).sort(), ['edu', 'work']);
    });
    it('every job and school from Auto-apply details: added with "Add another", then filled', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-remix');
      await fill();
      eq(blocks('employment-form').map((b) => b.querySelector('input[id^="company-name-"]').value), ['Acme Corp', 'Globex']);
      eq(blocks('employment-form').map((b) => b.querySelector('input[id^="title-"]').value), ['Senior Engineer', 'Engineer']);
      eq(rs(blocks('employment-form')[1], 'start-date-month-'), 'January');
      eq(blocks('employment-form')[1].querySelector('input[id^="start-date-year-"]').value, '2015');
      ok(blocks('employment-form')[0].querySelector('input[type=checkbox]').checked, 'current role');
      eq(blocks('education--form').map((b) => rs(b, 'school--')), ['University of Texas - Austin', 'University of Washington']);
    });
    it('Country next to Phone is picked from your profile', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-remix');
      const p = profile();
      p.personal.country = 'United States';
      await fill(p);
      eq(rs(sandbox(), 'country'), 'United States +1');
    });
    it('jobs and schools come from the resume being sent, with nothing typed in Admin', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-remix');
      const p = profile();
      p.autoApply.experience = [];
      p.autoApply.education = [];
      const text = 'EXPERIENCE\nGlobex | Dallas, TX | Feb 2016 – Present\nStaff Engineer\n• Built pipelines\nInitech, Austin, TX   03/2012 - 01/2016\nSoftware Engineer\n• Wrote services\nEDUCATION\nB.S. Computer Science, University of Texas at Austin (2008 - 2012)';
      const r = await AJP.filler.fill({ profile: p, answers: {}, resume: { name: 'Tailored for Globex', text }, root: sandbox() });
      eq($$('.employment-form').map((b) => b.querySelector('input[id^="company-name-"]').value), ['Globex', 'Initech']);
      eq($$('.employment-form').map((b) => b.querySelector('input[id^="title-"]').value), ['Staff Engineer', 'Software Engineer']);
      eq(rs($$('.employment-form')[0], 'start-date-month-'), 'February');
      eq(rs($$('.education--form')[0], 'school--'), 'University of Texas - Austin');
      ok(r.notes.some((n) => /taken from your resume "Tailored for Globex": 2 jobs, 1 school/.test(n)), JSON.stringify(r.notes));
    });
    const eduOnly = (edu) => {
      const p = profile();
      p.autoApply.experience = [];
      p.autoApply.education = [edu];
      return p;
    };
    it('lists that load from the server: degree "B.Tech" → Bachelor\'s, a long field → its short name, a school by its own name', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-remix');
      await AJP.filler.fill({ profile: eduOnly({ school: 'Example University', degree: 'B.Tech', field: 'Electronics and Communication Engineering', endYear: '2011' }), answers: {}, resume: null, root: sandbox() });
      const edu = $$('.education--form')[0];
      eq([rs(edu, 'school--'), rs(edu, 'degree--'), rs(edu, 'discipline--')], ['Example Institute of Technology and Sciences', "Bachelor's Degree", 'Electronics']);
    });
    it('a school that is not in the list: Greenhouse\'s "0 - Other", and the panel says so', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-remix');
      const r = await AJP.filler.fill({ profile: eduOnly({ school: 'Nowhere Academy', degree: 'M.S.', field: 'Data Science' }), answers: {}, resume: null, root: sandbox() });
      const edu = $$('.education--form')[0];
      eq([rs(edu, 'school--'), rs(edu, 'degree--'), rs(edu, 'discipline--')], ['0 - Other', "Master's Degree", 'Data Science']);
      ok(r.notes.some((n) => /not in this site's list.*School "Nowhere Academy"/i.test(n)), JSON.stringify(r.notes));
    });
    it('no jobs saved in Auto-apply details: says so instead of leaving the section silently', async () => {
      AtsMock.mount(sandbox(), 'greenhouse-remix');
      const p = profile();
      p.autoApply.experience = [];
      const r = await fill(p);
      ok(r.skipped.some((x) => /Work experience: no jobs with dates found in your resume/.test(x)), JSON.stringify(r.skipped));
    });
  }, { env: 'browser' });
})();
