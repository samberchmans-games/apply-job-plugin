(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, beforeEach, afterEach, waitFor, sleep } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const F = AJP.filler;
  const mock = globalThis.browser;

  // ---- Pure mapping rules (also run in the CLI) ---------------------------------
  describe('autofill › label → profile field rules', () => {
    const key = (label) => (F.ruleFor(label) || {}).key || null;
    it('a question about an "institutional client" is not the school field (Coinbase report)', () => {
      eq(key('To your knowledge, were you referred to this position by a senior leader or decision-maker at a current or prospective institutional client, business partner, or vendor of Coinbase?'), 'conflict', 'a screening question (B62), not the school field');
      eq(key('School'), 'school');
      eq(key('Name of the institution you attended'), 'school');
    });
    const cases = [
      ['First Name *', 'firstName'], ['Given name', 'firstName'], ['Preferred name', 'firstName'],
      ['Last Name', 'lastName'], ['Surname', 'lastName'], ['Family name', 'lastName'],
      ['Full name', 'fullName'], ['Name', 'fullName'], ['Full legal name', 'fullName'],
      ['Email', 'email'], ['E-mail address', 'email'],
      ['Phone', 'phone'], ['Mobile number', 'phone'],
      ['LinkedIn Profile', 'linkedin'], ['LinkedIn URL', 'linkedin'], ['GitHub', 'github'],
      ['Website', 'website'], ['Portfolio link', 'website'],
      ['Zip code', 'zip'], ['Postal code', 'zip'], ['City', 'city'], ['State', 'state'], ['Province', 'state'], ['Country', 'country'],
      ['Current location', 'location'], ['Street address', 'address'],
      ['Current company', 'currentCompany'], ['Current job title', 'currentTitle'],
      ['Years of experience', 'years'], ['How many years of experience do you have?', 'years'],
      ['Desired salary', 'salary'], ['Compensation expectations', 'salary'],
      ['Will you now or in the future require sponsorship for employment visa status?', 'sponsorship'],
      ['Are you legally authorized to work in the United States?', 'workAuth'],
      ['Are you willing to relocate?', 'relocate'],
      ['Are you Hispanic/Latino?', 'hispanic'], ['Race', 'race'], ['Ethnicity', 'race'],
      ['Gender', 'gender'], ['Veteran Status', 'veteran'], ['Disability Status', 'disability'], ['Pronouns', 'pronouns'],
      ['School', 'school'], ['University', 'school'], ['Degree', 'degree'], ['Field of study', 'major'],
      ['Graduation year', 'gradYear'], ['GPA', 'gpa'], ['Notice period', 'notice'], ['Earliest start date', 'startDate'],
      ['Cover letter', 'coverLetter'],
    ];
    for (const [label, expected] of cases) it(`"${label}" → ${expected}`, () => eq(key(label), expected));
    it('"Email address" is email, not address', () => eq(key('Email address'), 'email'));
    it('a work-authorization question mentioning "country" is not the country field (bug fix)', () =>
      eq(key('Are you legally authorized to work in the country in which the job is located?'), 'workAuth'));
    it('"Phone Device Type" is the device type, not the phone number (bug fix)', () => {
      eq(key('Phone Device Type'), 'phoneType');
      eq(key('Phone type'), 'phoneType');
      eq(key('Phone'), 'phone');
    });
    it('"United States" does not trigger the state rule', () => eq(key('Do you live in the United States'), null));
    it('unrelated questions have no rule', () => {
      eq(key('Do you enjoy working on weekends?'), null);
      eq(key('Why do you want to work here?'), null);
    });
  });

  describe('autofill › option matching', () => {
    it('exact match scores highest', () => ok(F.optionScore('Yes', 'Yes') > F.optionScore('Yes, I am', 'Yes')));
    it('yes does not match no', () => eq(F.optionScore('No', 'Yes'), 0));
    it('yes matches "Yes, I am authorized"', () => ok(F.optionScore('Yes, I am authorized', 'Yes') >= 3));
    it('decline equivalents match each other', () => {
      ok(F.optionScore("I don't wish to answer", 'Decline to self-identify') >= 8);
      ok(F.optionScore('Prefer not to say', 'Decline to self-identify') >= 8);
    });
    it('"not a protected veteran" prefers the exact option', () => {
      const v = 'I am not a protected veteran';
      ok(F.optionScore('I am not a protected veteran', v) > F.optionScore('I am a protected veteran', v));
    });
    it('empty values score zero', () => eq(F.optionScore('', 'Yes'), 0));
  });

  describe('autofill › learned answers lookup', () => {
    const answers = { 'how did you hear about us': { value: 'LinkedIn' }, 'are you open to contract roles': { value: 'Yes' } };
    it('exact normalized match', () => eq(F.findLearned(answers, 'How did you hear about us?*').value, 'LinkedIn'));
    it('fuzzy match on very similar wording', () => eq(F.findLearned(answers, 'How did you hear about us today').value, 'LinkedIn'));
    it('no match for different questions', () => eq(F.findLearned(answers, 'What is your favourite colour'), null));
    it('sensitive labels are never learned', () => {
      for (const l of ['Social Security Number', 'SSN', 'Password', 'Card number', 'CVV', 'Bank routing number', 'Date of birth'])
        ok(F.NEVER_LEARN.test(l), l);
      notOk(F.NEVER_LEARN.test('Desired salary'));
    });
  });

  // ---- DOM tests ------------------------------------------------------------------
  const sandbox = () => document.getElementById('sandbox');
  const html = (s) => (sandbox().innerHTML = s);
  const $ = (s) => sandbox().querySelector(s);

  function profile() {
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p.personal, { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.com', phone: '555-0100', linkedin: 'https://linkedin.com/in/ana', city: 'Austin', state: 'TX' });
    p.autoApply.workAuthorized = 'Yes';
    p.autoApply.requireSponsorship = 'No';
    p.autoApply.eeo.veteran = 'I am not a protected veteran';
    p.autoApply.eeo.gender = 'Decline to self-identify';
    p.autoApply.education = [{ school: 'UT Austin', degree: "Bachelor's", field: 'Computer Science' }];
    return p;
  }

  describe('autofill › finding labels in real-world markup', () => {
    afterEach(() => html(''));
    it('label[for]', () => {
      html('<label for="a">First Name</label><input id="a">');
      eq(F.labelFor($('#a')), 'First Name');
    });
    it('wrapping label', () => {
      html('<label>Email <input id="a"></label>');
      eq(F.labelFor($('#a')), 'Email');
    });
    it('aria-labelledby (several ids)', () => {
      html('<span id="x">Phone</span><span id="y">number</span><input id="a" aria-labelledby="x y">');
      eq(F.labelFor($('#a')), 'Phone number');
    });
    it('aria-label', () => {
      html('<input id="a" aria-label="City">');
      eq(F.labelFor($('#a')), 'City');
    });
    it('Workday-style sibling label div', () => {
      html('<div><div data-automation-id="formLabel">Postal Code</div><div><input id="a"></div></div>');
      eq(F.labelFor($('#a')), 'Postal Code');
    });
    it('placeholder fallback', () => {
      html('<input id="a" placeholder="Your LinkedIn">');
      eq(F.labelFor($('#a')), 'Your LinkedIn');
    });
    it('name attribute fallback (camelCase / underscores)', () => {
      html('<input id="a" name="job_application[firstName]">');
      eq(F.labelFor($('#a')), 'job application first Name');
    });
    it('strips required-field asterisks', () => {
      html('<label for="a">Email *</label><input id="a">');
      eq(F.labelFor($('#a')), 'Email');
    });
    it('radio group question comes from the fieldset legend', () => {
      html('<fieldset><legend>Require sponsorship?</legend><label><input type="radio" name="s" id="a"> Yes</label></fieldset>');
      eq(F.groupQuestion($('#a')), 'Require sponsorship?');
    });
    it('radio group question from role=radiogroup aria-label', () => {
      html('<div role="radiogroup" aria-label="Willing to relocate?"><input type="radio" name="r" id="a" aria-label="Yes"></div>');
      eq(F.groupQuestion($('#a')), 'Willing to relocate?');
    });
  }, { env: 'browser' });

  const FORM = `
    <form>
      <label for="fn">First Name *</label><input id="fn">
      <label for="ln">Last Name *</label><input id="ln">
      <label for="em">Email</label><input id="em" type="email">
      <label for="ph">Phone</label><input id="ph" type="tel">
      <label for="li">LinkedIn Profile</label><input id="li">
      <label for="auth">Are you legally authorized to work in the United States?</label>
      <select id="auth"><option value="">Select…</option><option value="1">Yes</option><option value="0">No</option></select>
      <fieldset><legend>Will you require visa sponsorship?</legend>
        <label><input type="radio" name="spon" value="y" id="sy"> Yes</label>
        <label><input type="radio" name="spon" value="n" id="sn"> No</label></fieldset>
      <label for="vet">Veteran status</label>
      <select id="vet"><option value="">Select…</option><option>I am a protected veteran</option><option>I am not a protected veteran</option><option>I don't wish to answer</option></select>
      <label for="gen">Gender</label>
      <select id="gen"><option value="">Select…</option><option>Male</option><option>Female</option><option>Prefer not to say</option></select>
      <label for="sch">School</label><input id="sch">
      <label for="hear">How did you hear about us?</label><input id="hear">
      <label for="fav">Favourite snack</label><input id="fav">
      <label for="why">Why do you want to work at Acme?</label><textarea id="why"></textarea>
      <label for="pw">Password</label><input id="pw" type="password">
      <label for="dis">Disabled field email</label><input id="dis" disabled>
      <input type="hidden" id="hid" name="email">
      <label for="res">Resume/CV</label><input id="res" type="file">
      <button>Submit</button>
    </form>`;

  describe('autofill › filling a full application form', () => {
    let submitted;
    beforeEach(async () => {
      await mock.__reset();
      html(FORM);
      submitted = false;
      $('form').addEventListener('submit', (e) => { submitted = true; e.preventDefault(); });
    });
    afterEach(() => html(''));

    const resume = { id: 'r1', text: '', file: { name: 'ana.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' } };
    const run = (extra = {}) => F.fill({ profile: profile(), answers: {}, resume, root: sandbox(), ...extra });

    it('fills text fields from the profile', async () => {
      await run();
      eq([$('#fn').value, $('#ln').value, $('#em').value, $('#ph').value, $('#li').value], ['Ana', 'Silva', 'ana@example.com', '555-0100', 'https://linkedin.com/in/ana']);
      eq($('#sch').value, 'UT Austin');
    });
    it('picks the right <select> option', async () => {
      await run();
      eq($('#auth').selectedOptions[0].text, 'Yes');
      eq($('#vet').value, 'I am not a protected veteran');
    });
    it('maps "Decline to self-identify" to the site\'s wording', async () => {
      await run();
      eq($('#gen').value, 'Prefer not to say');
    });
    it('clicks the right radio button', async () => {
      await run();
      ok($('#sn').checked);
      notOk($('#sy').checked);
    });
    it('attaches the resume file', async () => {
      await run();
      eq($('#res').files.length, 1);
      eq($('#res').files[0].name, 'ana.pdf');
    });
    it('reports when no resume file is saved', async () => {
      const r = await F.fill({ profile: profile(), answers: {}, resume: null, root: sandbox() });
      ok(r.skipped.some((s) => /Resume file/.test(s)));
    });
    it('uses learned answers for unknown questions', async () => {
      const r = await run({ answers: { 'how did you hear about us': { value: 'LinkedIn' } } });
      eq($('#hear').value, 'LinkedIn');
      includes(r.learned, 'How did you hear about us?');
    });
    it('returns free-text questions for AI drafting', async () => {
      const r = await run();
      ok(r.questions.some((q) => q.label === 'Why do you want to work at Acme?' && q.ajpId));
    });
    it('lists fields it could not fill', async () => {
      const r = await run();
      includes(r.unknown, 'Favourite snack');
    });
    it('never touches password, disabled or hidden fields', async () => {
      await run();
      eq($('#pw').value, '');
      eq($('#dis').value, '');
      eq($('#hid').value, '');
    });
    it('never overwrites what the user already typed', async () => {
      $('#fn').value = 'Anna-Maria';
      $('#auth').value = '0';
      await run();
      eq($('#fn').value, 'Anna-Maria');
      eq($('#auth').value, '0');
    });
    it('does not change an already-answered radio group', async () => {
      $('#sy').checked = true;
      await run();
      ok($('#sy').checked);
    });
    it('NEVER submits the form', async () => {
      await run();
      await sleep(20);
      notOk(submitted);
    });
    it('fires input/change events so React/Vue forms register the value', async () => {
      const seen = [];
      $('#fn').addEventListener('input', () => seen.push('input'));
      $('#fn').addEventListener('change', () => seen.push('change'));
      await run();
      includes(seen, 'input');
      includes(seen, 'change');
    });
    it('works with React-style controlled inputs (value setter tracking)', async () => {
      // React tracks the last value via the instance property; the native prototype setter bypasses it.
      let tracked = '';
      Object.defineProperty($('#ln'), 'value', { configurable: true, get: () => tracked, set: (v) => { tracked = 'INSTANCE:' + v; } });
      $('#ln').addEventListener('input', () => {});
      await run();
      ok(!tracked.startsWith('INSTANCE:'), 'used the native setter');
    });
    it('marks filled fields (green outline) and learned ones (purple)', async () => {
      await run({ answers: { 'how did you hear about us': { value: 'LinkedIn' } } });
      eq($('#fn').dataset.ajpFilled, 'profile');
      eq($('#hear').dataset.ajpFilled, 'learned');
    });
    it('report counts add up and timing is recorded', async () => {
      const r = await run();
      ok(r.filled.length >= 10, 'filled ' + r.filled.length);
      ok(typeof r.ms === 'number');
    });
    it('empty profile fills nothing and does not crash', async () => {
      const r = await F.fill({ profile: AJP.clone(AJP.store.DEFAULTS.profile), answers: {}, resume: null, root: sandbox() });
      eq($('#fn').value, '');
      ok(r.unknown.length > 0);
    });
    it('a page with no form returns an empty report', async () => {
      html('<p>No form here</p>');
      const r = await run();
      eq(r.filled.length + r.unknown.length + r.questions.length, 0);
    });
    it('fillQuestion writes an AI draft into the right textarea', async () => {
      const r = await run();
      const q = r.questions[0];
      ok(F.fillQuestion(q.ajpId, 'Because…'));
      eq($('#why').value, 'Because…');
      notOk(F.fillQuestion('missing-id', 'x'));
    });
  }, { env: 'browser' });

  describe('autofill › learning from what the user types', () => {
    beforeEach(async () => {
      await mock.__reset();
      html(FORM);
      F.startLearning();
    });
    afterEach(() => html(''));
    const answers = () => AJP.store.get('answers');
    const type = (el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    it('remembers a typed answer with its question and site', async () => {
      type($('#fav'), 'Almonds');
      const a = await waitFor(async () => (await answers())['favourite snack'], { msg: 'answer saved' });
      eq(a.value, 'Almonds');
      eq(a.count, 1);
      includes(a.hosts, location.hostname);
    });
    it('counts repeated use and keeps the latest value', async () => {
      type($('#fav'), 'Almonds');
      await waitFor(async () => (await answers())['favourite snack']);
      type($('#fav'), 'Cashews');
      const a = await waitFor(async () => { const x = (await answers())['favourite snack']; return x && x.count === 2 && x; });
      eq(a.value, 'Cashews');
    });
    it('remembers select choices by option text', async () => {
      $('#vet').selectedIndex = 3;
      $('#vet').dispatchEvent(new Event('change', { bubbles: true }));
      const a = await waitFor(async () => (await answers())['veteran status']);
      eq(a.value, "I don't wish to answer");
    });
    it('remembers radio choices by option label', async () => {
      $('#sy').click();
      const a = await waitFor(async () => (await answers())['will you require visa sponsorship']);
      eq(a.value, 'Yes');
    });
    it('never learns passwords or sensitive fields', async () => {
      html('<label for="ssn">Social Security Number</label><input id="ssn"><label for="pw">Password</label><input id="pw" type="password"><label for="ok">Snack</label><input id="ok">');
      type($('#ssn'), '123-45-6789');
      type($('#pw'), 'hunter2');
      type($('#ok'), 'Nuts');
      await waitFor(async () => (await answers()).snack);
      const all = JSON.stringify(await answers());
      excludes(all, '123-45-6789');
      excludes(all, 'hunter2');
    });
    it('does not learn the values the extension filled itself', async () => {
      await F.fill({ profile: profile(), answers: {}, resume: null, root: sandbox() });
      await sleep(150);
      eq(Object.keys(await answers()).length, 0);
    });
    it('respects the "learn answers" setting', async () => {
      await AJP.store.update('settings', (s) => void (s.learnAnswers = false));
      type($('#fav'), 'Almonds');
      await sleep(150);
      eq(await answers(), {});
    });
    it('ignores empty values', async () => {
      type($('#fav'), '   ');
      await sleep(150);
      eq(await answers(), {});
    });
  }, { env: 'browser' });
})();
