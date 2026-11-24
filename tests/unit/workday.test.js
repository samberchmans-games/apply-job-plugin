/*
 * Workday adapter against the Workday emulation (tests/fixtures/workday-mock.js).
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const W = AJP.workday;

  describe('workday › dates and option wording (pure)', () => {
    for (const [input, out] of [
      ['06/2019', { month: '06', year: '2019' }], ['2019-06', { year: '2019', month: '06', day: undefined }], ['6/2019', { month: '06', year: '2019' }],
      ['June 2019', { month: '06', year: '2019' }], ['Sep. 2021', { month: '09', year: '2021' }], ['2015', { year: '2015' }], ['12/01/2026', { month: '12', day: '01', year: '2026' }],
    ]) it(`parses "${input}"`, () => eq(W.parseDate(input), out));
    for (const v of ['Present', 'current', 'Immediately', '', 'soon']) it(`"${v}" is not a date`, () => eq(W.parseDate(v), null));
    it('US state codes → Workday state names', () => includes(W.candidates('TX', 'addressSection_countryRegion'), 'Texas'));
    it('USA / US / UK → Workday country names', () => {
      includes(W.candidates('USA', 'countryDropdown'), 'United States of America');
      includes(W.candidates('uk', 'country'), 'United Kingdom');
    });
    it('degree abbreviations → Workday degree names', () => {
      includes(W.candidates('B.S.', 'degree'), "Bachelor's Degree");
      includes(W.candidates('MBA', 'degree'), "Master's Degree");
      includes(W.candidates('PhD', 'degree'), 'Doctorate');
    });
    it('"decline" answers map to Workday\'s wording', () => includes(W.candidates('Decline to self-identify', 'gender'), 'I do not wish to answer'));
  });

  // ---- Against the emulated Workday form -----------------------------------------------------------
  const sandbox = () => document.getElementById('sandbox');
  const $ = (s) => sandbox().querySelector(s);
  const btnText = (key) => $(`button[data-automation-id="${key}"]`).textContent.trim();
  function profile() {
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p.personal, { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.com', phone: '512-555-0100', address: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'USA' });
    p.autoApply.workAuthorized = 'Yes';
    p.autoApply.requireSponsorship = 'No';
    p.autoApply.experience = [
      { title: 'Senior Engineer', company: 'Acme Corp', location: 'Austin, TX', start: '06/2019', end: 'Present', description: 'Led data platform migration to AWS.' },
      { title: 'Engineer', company: 'Globex', location: 'Dallas, TX', start: '2015-01', end: '2019-05', description: 'Built Python ETL jobs.' },
    ];
    p.autoApply.education = [{ school: 'University of Texas at Austin', degree: 'B.S.', field: 'Computer Science', gpa: '3.7', startYear: '2011', endYear: '2015' }];
    p.autoApply.eeo = { gender: 'Decline to self-identify', race: '', hispanic: 'No', veteran: 'I am not a protected veteran', disability: '', pronouns: '' };
    return p;
  }
  const answers = { 'how did you hear about us': { label: 'How did you hear about us?', value: 'LinkedIn', count: 2 } };
  const fill = (extra = {}) => AJP.filler.fill({ profile: profile(), answers, resume: null, root: sandbox(), ...extra });

  describe('workday › My Information page', () => {
    beforeEach(() => WorkdayMock.mount(sandbox(), { page: 'info' }));
    afterEach(() => {
      WorkdayMock.closePopups(document);
      sandbox().innerHTML = '';
    });

    it('detects Workday markup (also on a company\'s own domain)', () => {
      ok(W.applies(sandbox(), 'localhost'));
      ok(W.applies(document.createElement('div'), 'acme.wd5.myworkdayjobs.com'));
      notOk(W.applies(document.createElement('div'), 'example.com'));
    });
    it('fills text fields via the normal rules', async () => {
      await fill();
      eq([$('[data-automation-id="legalNameSection_firstName"]').value, $('[data-automation-id="legalNameSection_lastName"]').value, $('[data-automation-id="email"]').value], ['Ana', 'Silva', 'ana@example.com']);
      eq($('[data-automation-id="addressSection_postalCode"]').value, '78701');
    });
    it('picks dropdown options from pop-up lists (Country "USA" → United States of America, State "TX" → Texas)', async () => {
      await fill();
      eq(btnText('countryDropdown'), 'United States of America');
      eq(btnText('addressSection_countryRegion'), 'Texas');
      eq(btnText('phone-device-type'), 'Mobile');
    });
    it('answers work authorization and sponsorship dropdowns', async () => {
      await fill();
      eq([btnText('eligibleToWork'), btnText('visaSponsorship')], ['Yes', 'No']);
    });
    it('uses learned answers in search prompts ("How did you hear about us?" → LinkedIn)', async () => {
      const r = await fill();
      eq($('[data-automation-id="formField-source"] [data-automation-id="selectedItem"]').title, 'LinkedIn');
      includes(r.learned, 'How Did You Hear About Us?');
    });
    it('"previously worked for Acme?" is answered from your work history (Acme Corp is there)', async () => {
      const r = await fill();
      notOk(r.unknown.includes('Have you previously worked for Acme?'));
      eq(btnText('previousWorker'), 'Yes');
    });
    it('never overwrites a choice the user already made', async () => {
      $('button[data-automation-id="countryDropdown"]').click();
      await waitFor(() => document.querySelector('[data-automation-label="Canada"]'));
      document.querySelector('[data-automation-label="Canada"]').click();
      await fill();
      eq(btnText('countryDropdown'), 'Canada');
    });
    it('leaves no pop-up open and never clicks Save and Continue', async () => {
      await fill();
      eq(document.querySelectorAll('[data-automation-id="activeListContainer"]').length, 0);
      notOk(sandbox().dataset.nextClicked);
    });
    it('a dropdown that never opens is reported, and the rest is still filled', async () => {
      const wait = W.CONFIG.optionWaitMs;
      W.CONFIG.optionWaitMs = 80;
      const dead = $('button[data-automation-id="countryDropdown"]');
      dead.removeAttribute('data-options');
      dead.replaceWith(dead.cloneNode(true)); // drop the mock's click behaviour
      sandbox().querySelector('[data-automation-id="formField-countryDropdown"] button').setAttribute('aria-haspopup', 'listbox');
      try {
        const r = await fill();
        includes(r.unknown, 'Country');
        eq(btnText('addressSection_countryRegion'), 'Texas');
      } finally {
        W.CONFIG.optionWaitMs = wait;
      }
    });
    it('learns from options the user picks in Workday dropdowns', async () => {
      await globalThis.browser.__reset();
      AJP.filler.startLearning();
      $('button[data-automation-id="previousWorker"]').click();
      await waitFor(() => document.querySelector('[data-automation-label="No"]'));
      document.querySelector('[data-automation-label="No"]').click();
      const a = await waitFor(async () => (await AJP.store.get('answers'))['have you previously worked for acme'], { msg: 'learned' });
      eq(a.value, 'No');
    });
  }, { env: 'browser' });

  describe('workday › My Experience page (entries)', () => {
    beforeEach(() => WorkdayMock.mount(sandbox(), { page: 'experience' }));
    afterEach(() => {
      WorkdayMock.closePopups(document);
      sandbox().innerHTML = '';
    });
    const panel = (kind, n) => $(`[data-automation-id="${kind}-${n}"]`);
    const val = (p, key) => p.querySelector(`[data-automation-id="formField-${key}"] input, [data-automation-id="formField-${key}"] textarea`).value;
    const date = (p, key) => [...p.querySelectorAll(`[data-automation-id="formField-${key}"] input`)].map((i) => i.value).join('/');

    it('clicks "Add" to create one entry per job and fills each', async () => {
      const r = await fill();
      ok(panel('workExperience', 1) && panel('workExperience', 2), 'two entries');
      notOk(panel('workExperience', 3));
      eq([val(panel('workExperience', 1), 'jobTitle'), val(panel('workExperience', 1), 'company')], ['Senior Engineer', 'Acme Corp']);
      eq([val(panel('workExperience', 2), 'jobTitle'), val(panel('workExperience', 2), 'company')], ['Engineer', 'Globex']);
      includes(r.filled, 'Work experience 1: Job Title');
    });
    it('dates go into the Month/Year boxes; a current job ticks "I currently work here" and has no end date', async () => {
      await fill();
      const p1 = panel('workExperience', 1);
      eq(date(p1, 'startDate'), '06/2019');
      eq(date(p1, 'endDate'), '/');
      ok(p1.querySelector('[data-automation-id="currentlyWorkHere"]').checked);
      const p2 = panel('workExperience', 2);
      eq([date(p2, 'startDate'), date(p2, 'endDate')], ['01/2015', '05/2019']);
      notOk(p2.querySelector('[data-automation-id="currentlyWorkHere"]').checked);
      eq(val(p2, 'roleDescription'), 'Built Python ETL jobs.');
    });
    it('education: school and field picked from search prompts, degree from the dropdown ("B.S." → Bachelor\'s Degree)', async () => {
      await fill();
      const e = panel('education', 1);
      eq(e.querySelector('[data-automation-id="formField-school"] [data-automation-id="selectedItem"]').title, 'University of Texas at Austin');
      eq(e.querySelector('[data-automation-id="formField-fieldOfStudy"] [data-automation-id="selectedItem"]').title, 'Computer Science');
      eq(e.querySelector('button[data-automation-id="degree"]').textContent.trim(), "Bachelor's Degree");
      eq([val(e, 'gradeAverage'), date(e, 'firstYearAttended'), date(e, 'lastYearAttended')], ['3.7', '2011', '2015']);
    });
    it('keeps entries the user already started and only adds what is missing', async () => {
      $('[data-automation-id="workExperienceSection"] [data-automation-id="Add"]').click();
      await waitFor(() => panel('workExperience', 1));
      const t = panel('workExperience', 1).querySelector('[data-automation-id="jobTitle"]');
      AJP.filler.setNativeValue(t, 'Principal Engineer');
      await fill();
      eq(t.value, 'Principal Engineer', 'kept');
      ok(panel('workExperience', 2));
      notOk(panel('workExperience', 3));
    });
    it('no experience in the profile → no entries added', async () => {
      const p = profile();
      p.autoApply.experience = [];
      await AJP.filler.fill({ profile: p, answers: {}, resume: null, root: sandbox() });
      notOk(panel('workExperience', 1));
    });
  }, { env: 'browser' });

  describe('workday › Voluntary Disclosures page', () => {
    beforeEach(() => WorkdayMock.mount(sandbox(), { page: 'eeo' }));
    afterEach(() => {
      WorkdayMock.closePopups(document);
      sandbox().innerHTML = '';
    });
    it('EEO answers use Workday\'s wording; empty answers stay unanswered', async () => {
      const r = await fill();
      eq(btnText('gender'), 'I do not wish to answer');
      eq(btnText('veteranStatus'), 'I am not a protected veteran');
      eq(btnText('hispanicOrLatino'), 'No');
      eq(btnText('ethnicityDropdown'), 'Select One');
      includes(r.unknown, 'Race/Ethnicity');
    });
    it('the last page\'s Submit button is never clicked', async () => {
      await fill();
      notOk(sandbox().dataset.nextClicked);
    });
  }, { env: 'browser' });

  describe('workday › multi-page flow in the panel', () => {
    beforeEach(async () => {
      await globalThis.browser.__reset();
      await AJP.store.update('profile', (p) => Object.assign(p, profile()));
      WorkdayMock.mount(sandbox(), { page: 'info' });
    });
    afterEach(() => {
      AJP.panel.remove();
      WorkdayMock.closePopups(document);
      sandbox().innerHTML = '';
    });
    it('after Autofill, moving to the next Workday page offers "Autofill this page", which fills it', async () => {
      await AJP.send('analyzeTab', { tabId: 1, jdText: 'Requirements\nJava' });
      const sh = await waitFor(() => document.querySelector('ajp-panel') && document.querySelector('ajp-panel').shadowRoot.querySelector('[data-act="autofill"]') && document.querySelector('ajp-panel').shadowRoot);
      sh.querySelector('[data-act="autofill"]').click();
      await waitFor(() => btnText('countryDropdown') === 'United States of America', { msg: 'page 1 filled', timeout: 5000 });
      WorkdayMock.goTo(sandbox(), 'experience'); // the user clicked Save and Continue
      await waitFor(() => /New Workday page: My Experience/.test(sh.textContent), { msg: 'offer shown', timeout: 3000 });
      sh.querySelector('.msg [data-act="autofill"]').click();
      await waitFor(() => $('[data-automation-id="workExperience-2"] [data-automation-id="jobTitle"]') && $('[data-automation-id="workExperience-2"] [data-automation-id="jobTitle"]').value === 'Engineer', { msg: 'page 2 filled', timeout: 6000 });
    });
  }, { env: 'browser' });
})();
