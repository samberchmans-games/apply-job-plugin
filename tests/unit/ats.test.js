/*
 * Per-site adapters (ats.js) against emulated Greenhouse, Lever, Ashby and iCIMS forms (tests/fixtures/ats-mock.js).
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, beforeEach, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const A = AJP.ats;
  const noDom = { querySelector: () => null };
  const fakeEl = (name, id = '') => ({ getAttribute: (k) => (k === 'name' ? name : null), id });

  describe('sites › detection and field names (pure)', () => {
    for (const [host, id] of [['boards.greenhouse.io', 'greenhouse'], ['job-boards.greenhouse.io', 'greenhouse'], ['jobs.lever.co', 'lever'], ['jobs.ashbyhq.com', 'ashby'], ['careers-initech.icims.com', 'icims']])
      it(`${host} → ${id}`, () => eq(A.detect(noDom, host).id, id));
    it('look-alike hosts are not detected', () => {
      eq(A.detect(noDom, 'greenhouse.io.evil.example'), null);
      eq(A.detect(noDom, 'notlever.co'), null);
      eq(A.detect(noDom, 'example.com'), null);
    });
    it('a site embedded on a company domain is found by its markup', () => eq(A.detect({ querySelector: (s) => (/ashby-application-form/.test(s) ? {} : null) }, 'careers.initech.example').id, 'ashby'));
    for (const [site, name, key] of [
      ['lever', 'name', 'fullName'], ['lever', 'org', 'currentCompany'], ['lever', 'urls[LinkedIn]', 'linkedin'], ['lever', 'urls[GitHub]', 'github'], ['lever', 'eeo[veteran]', 'veteran'],
      ['ashby', '_systemfield_name', 'fullName'], ['ashby', '_systemfield_location', 'location'],
      ['icims', 'PersonProfileFields.FirstName', 'firstName'], ['icims', 'PersonProfileFields.AddressState', 'state'], ['icims', 'PersonProfileFields.PhoneNumber', 'phone'],
      ['greenhouse', 'job_application[first_name]', 'firstName'], ['greenhouse', 'first_name', 'firstName'],
    ]) it(`${site}: "${name}" → ${key}`, () => eq(A.ruleKey(fakeEl(name), A.SITES[site]), key));
    it('unknown names → null (the label decides)', () => eq(A.ruleKey(fakeEl('cards[x][field0]'), A.SITES.lever), null));
    it('location suggestions: your city is required, your state helps', () => {
      ok(A.scoreOption('Austin, Texas, United States', 'Austin, TX', 'location') > A.scoreOption('Austin, Minnesota, United States', 'Austin, TX', 'location'));
      eq(A.scoreOption('Boston, Massachusetts, United States', 'Austin, TX', 'location'), 0);
    });
  });

  // ---- Browser: emulated forms ------------------------------------------------------------------------
  const sandbox = () => document.getElementById('sandbox');
  const $ = (s) => sandbox().querySelector(s);
  function profile() {
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p.personal, { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.com', phone: '512-555-0100', address: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'USA',
      linkedin: 'https://linkedin.com/in/ana', github: 'https://github.com/ana', website: 'https://ana.dev', currentCompany: 'Acme Corp', currentTitle: 'Senior Engineer' });
    p.autoApply.workAuthorized = 'Yes';
    p.autoApply.requireSponsorship = 'No';
    p.autoApply.eeo = { gender: 'Decline to self-identify', race: '', hispanic: 'No', veteran: 'I am not a protected veteran', disability: 'No', pronouns: '' };
    return p;
  }
  const RESUME = { id: 'r1', text: '# Ana Silva\n## Experience\n- Built things', file: { name: 'ana.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' } };
  const answers = { 'how did you hear about this job': { label: 'How did you hear about this job?', value: 'LinkedIn', count: 2 }, 'how did you hear about us': { label: 'How did you hear about us?', value: 'LinkedIn', count: 2 } };
  const fill = (extra = {}) => AJP.filler.fill({ profile: profile(), answers, resume: RESUME, root: sandbox(), ...extra });
  const rsValue = (id) => {
    const v = $(`[data-rs="${id}"] .select__single-value`);
    return v ? v.textContent : '';
  };
  let savedWait;
  const cleanup = () => {
    sandbox().innerHTML = '';
    document.querySelectorAll('.select__menu').forEach((m) => m.remove());
  };

  describe('sites › Greenhouse (job boards, React-Select)', () => {
    beforeEach(() => AtsMock.mount(sandbox(), 'greenhouse'));
    afterEach(cleanup);

    it('is detected and named in the report', async () => eq((await fill()).site, 'Greenhouse'));
    it('fills text fields and attaches the resume', async () => {
      const r = await fill();
      eq([$('#first_name').value, $('#last_name').value, $('#email').value, $('#phone').value, $('#question_1').value], ['Ana', 'Silva', 'ana@example.com', '512-555-0100', 'https://linkedin.com/in/ana']);
      eq($('#resume').files[0].name, 'ana.pdf');
      eq(r.attached, 'ana.pdf');
    });
    it('searchable dropdowns: yes/no questions from the profile', async () => {
      await fill();
      eq([rsValue('question_2'), rsValue('question_3')], ['Yes', 'No']);
    });
    it('a learned answer picks the option ("How did you hear…" → LinkedIn)', async () => {
      const r = await fill();
      eq(rsValue('question_4'), 'LinkedIn');
      includes(r.learned, 'How did you hear about this job?');
    });
    it('EEO dropdowns use the site\'s wording', async () => {
      await fill();
      eq([rsValue('gender'), rsValue('hispanic_ethnicity'), rsValue('veteran_status'), rsValue('disability_status')],
        ['Decline To Self Identify', 'No', 'I am not a protected veteran', 'No, I do not have a disability and have not had one in the past']);
    });
    it('"Location (City)" searches your city and picks the suggestion with your state', async () => {
      await fill();
      eq(rsValue('candidate-location'), 'Austin, Texas, United States');
    });
    it('a dropdown the user already chose is kept', async () => {
      $('#question_3').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      [...document.querySelectorAll('#question_3-listbox [role=option]')].find((o) => o.textContent === 'Yes').click();
      await fill();
      eq(rsValue('question_3'), 'Yes');
    });
    it('no value → listed as unknown, and no menu is left open', async () => {
      const p = profile();
      p.autoApply.eeo.gender = '';
      const r = await fill({ profile: p });
      includes(r.unknown, 'Gender');
      eq(document.querySelectorAll('.select__menu').length, 0);
    });
    it('free-text questions go to the panel for an AI draft; nothing is submitted', async () => {
      const r = await fill();
      ok(r.questions.some((q) => /Why do you want/.test(q.label)));
      notOk(sandbox().dataset.submitted);
    });
    it('learns from options the user picks in a searchable dropdown', async () => {
      await globalThis.browser.__reset();
      AJP.filler.startLearning();
      const input = $('#question_4');
      input.focus();
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      [...document.querySelectorAll('#question_4-listbox [role=option]')].find((o) => o.textContent === 'Indeed').click();
      const a = await waitFor(async () => (await AJP.store.get('answers'))['how did you hear about this job'], { msg: 'learned' });
      eq(a.value, 'Indeed');
    });
  }, { env: 'browser' });

  describe('sites › Greenhouse (classic boards, select2)', () => {
    beforeEach(() => AtsMock.mount(sandbox(), 'greenhouse-classic'));
    afterEach(cleanup);
    const proxy = (id) => $(`#${id}`).nextElementSibling.textContent.trim();

    it('select2 dropdowns: the hidden select is set and the visible box shows it', async () => {
      await fill();
      eq(proxy('job_application_answers_attributes_0'), 'No');
      eq(proxy('job_application_answers_attributes_1'), 'LinkedIn');
      eq(proxy('job_application_gender'), 'Decline To Self Identify');
      eq(proxy('job_application_veteran_status'), 'I am not a protected veteran');
    });
    it('the "enter manually" resume box is left empty when the file was attached, and is not an AI question', async () => {
      const r = await fill();
      eq($('#resume_text').value, '');
      notOk(r.questions.some((q) => /Resume/.test(q.label)));
    });
    it('no file upload on the page → the resume text is pasted instead', async () => {
      $('#resume').closest('.field').remove();
      const r = await fill();
      includes($('#resume_text').value, 'Built things');
      includes(r.filled, 'Resume (pasted text)');
    });
  }, { env: 'browser' });

  describe('sites › Lever', () => {
    beforeEach(() => {
      AtsMock.mount(sandbox(), 'lever');
      savedWait = [A.CONFIG.parseWaitMs, A.CONFIG.settleMs];
      A.CONFIG.parseWaitMs = 600;
      A.CONFIG.settleMs = 50;
    });
    afterEach(() => {
      [A.CONFIG.parseWaitMs, A.CONFIG.settleMs] = savedWait;
      cleanup();
    });
    const v = (n) => $(`[name="${n}"]`).value;

    it('attaches the resume FIRST, then replaces what Lever guessed with your profile', async () => {
      const r = await fill();
      eq(sandbox().dataset.parsed, '1', 'Lever parsed the resume');
      eq([v('name'), v('email'), v('org')], ['Ana Silva', 'ana@example.com', 'Acme Corp']);
      ok(r.notes.some((n) => /Lever filled 3 field\(s\) from your resume/.test(n)), JSON.stringify(r.notes));
    });
    it('what YOU typed before Autofill is never replaced', async () => {
      $('[name="email"]').value = 'mine@example.com';
      await fill();
      eq(v('email'), 'mine@example.com');
    });
    it('Lever field names: LinkedIn / GitHub / Portfolio URLs', async () => {
      await fill();
      eq([v('urls[LinkedIn]'), v('urls[GitHub]'), v('urls[Portfolio]')], ['https://linkedin.com/in/ana', 'https://github.com/ana', 'https://ana.dev']);
    });
    it('"Current location" picks Lever\'s suggestion (so the hidden location is set too)', async () => {
      await fill();
      eq(v('location'), 'Austin, Texas, United States');
      includes(v('selectedLocation'), 'Austin, Texas');
    });
    it('question cards (radio) and EEO selects', async () => {
      const r = await fill();
      ok($('input[name="cards[c1][field0]"][value="Yes"]').checked);
      eq($('[name="eeo[gender]"]').value, 'Decline to self-identify');
      eq($('[name="eeo[veteran]"]').value, 'I am not a veteran');
      includes(r.unknown, 'Race');
    });
    it('bug B15: a select inside its label is labelled by the question only (not its options, not "✱")', () => {
      eq(AJP.filler.labelFor($('[name="eeo[race]"]')), 'Race');
      eq(AJP.filler.labelFor($('[name="name"]')), 'Full name');
    });
    it('"Additional information" goes to the panel as a question', async () => ok((await fill()).questions.some((q) => /Additional information/.test(q.label))));
  }, { env: 'browser' });

  describe('sites › Ashby', () => {
    beforeEach(() => AtsMock.mount(sandbox(), 'ashby'));
    afterEach(cleanup);
    const active = (q) => {
      const entry = [...sandbox().querySelectorAll('.ashby-application-form-field-entry')].find((e) => e.textContent.includes(q));
      const b = entry.querySelector('button._active_');
      return b ? b.textContent : '';
    };

    it('system fields, phone, LinkedIn and the resume', async () => {
      await fill();
      eq([$('#_systemfield_name').value, $('#_systemfield_email').value, $('#q3f1c').value, $('#q9a2b').value], ['Ana Silva', 'ana@example.com', '512-555-0100', 'https://linkedin.com/in/ana']);
      eq($('#_systemfield_resume').files.length, 1);
    });
    it('Yes/No buttons answered from the profile', async () => {
      await fill();
      eq([active('legally authorized'), active('visa sponsorship')], ['Yes', 'No']);
    });
    it('a Yes/No question with no answer is listed, and answered from a learned answer next time', async () => {
      const r = await fill();
      includes(r.unknown, 'Have you worked for Initech before?');
      AtsMock.mount(sandbox(), 'ashby');
      await fill({ answers: { ...answers, 'have you worked for initech before': { label: 'Have you worked for Initech before?', value: 'No', count: 1 } } });
      eq(active('worked for Initech'), 'No');
    });
    it('a Yes/No already chosen by the user is kept', async () => {
      [...sandbox().querySelectorAll('button')].filter((b) => b.textContent === 'Yes')[1].click(); // sponsorship → Yes
      await fill();
      eq(active('visa sponsorship'), 'Yes');
    });
    it('location and "How did you hear" comboboxes', async () => {
      await fill();
      eq([$('#_systemfield_location').value, $('#q7d4e').value], ['Austin, Texas, United States', 'LinkedIn']);
    });
    it('EEO radios', async () => {
      await fill();
      ok($('input[name="eeo_gender"][value="d"]').checked);
    });
    it('learns from the Yes/No button the user clicks', async () => {
      await globalThis.browser.__reset();
      AJP.filler.startLearning();
      [...sandbox().querySelectorAll('button')].filter((b) => b.textContent === 'Yes')[2].click(); // worked here before
      const a = await waitFor(async () => (await AJP.store.get('answers'))['have you worked for initech before'], { msg: 'learned' });
      eq(a.value, 'Yes');
    });
  }, { env: 'browser' });

  describe('sites › iCIMS', () => {
    afterEach(cleanup);
    const proxyText = (id) => document.querySelector(`[data-proxy-for="${CSS.escape(id)}"]`).textContent.trim();

    it('PersonProfileFields names and the address', async () => {
      AtsMock.mount(sandbox(), 'icims');
      const r = await fill();
      eq(r.site, 'iCIMS');
      const v = (n) => document.getElementById(`PersonProfileFields.${n}`).value;
      eq([v('FirstName'), v('LastName'), v('Email'), v('PhoneNumber'), v('AddressStreet1'), v('AddressCity'), v('AddressZip')], ['Ana', 'Silva', 'ana@example.com', '512-555-0100', '1 Main St', 'Austin', '78701']);
    });
    it('hidden dropdowns: "TX" → Texas, "USA" → United States, and the visible box shows it', async () => {
      AtsMock.mount(sandbox(), 'icims');
      await fill();
      eq([proxyText('PersonProfileFields.AddressState'), proxyText('PersonProfileFields.AddressCountry')], ['Texas', 'United States']);
    });
    it('a question it has no answer for is listed', async () => {
      AtsMock.mount(sandbox(), 'icims');
      includes((await fill()).unknown, 'Which of the following best describes how you use AI tools today?');
    });
    it('the sign-in page → a clear note; the password box is never touched', async () => {
      AtsMock.mount(sandbox(), 'icims-login');
      const r = await fill();
      ok(r.notes.some((n) => /sign in or create an account/.test(n)));
      eq($('#pw').value, '');
      eq($('#email').value, 'ana@example.com');
    });
  }, { env: 'browser' });

  describe('sites › the panel and other sites', () => {
    afterEach(() => {
      AJP.panel.remove();
      cleanup();
    });
    it('the panel names the site and shows the notes', () => {
      AJP.panel.render({ autofill: { filled: ['a'], learned: [], unknown: [], questions: [], skipped: [], site: 'Lever', notes: ['Lever filled 3 field(s) from your resume; your profile values were used where you have them.'] } }, {});
      const t = document.querySelector('ajp-panel').shadowRoot.textContent;
      includes(t, 'Lever');
      includes(t, 'Lever filled 3 field(s)');
    });
    it('the same widgets work on an unknown site (generic combobox)', async () => {
      AtsMock.mount(sandbox(), 'greenhouse');
      sandbox().querySelector('#grnhse_app').removeAttribute('data-ats');
      sandbox().querySelector('#grnhse_app').id = 'some_app';
      const r = await fill();
      eq(r.site, undefined);
      eq(rsValue('question_3'), 'No');
    });
    it('a broken widget is reported and the rest still fills', async () => {
      AtsMock.mount(sandbox(), 'ashby');
      const real = AJP.filler.findLearned;
      AJP.filler.findLearned = (a, label) => {
        if (/hear about/i.test(label)) throw new TypeError('boom');
        return real(a, label);
      };
      try {
        const r = await fill();
        eq($('#_systemfield_name').value, 'Ana Silva');
        includes(r.unknown, 'How did you hear about us?');
        eq($('#_systemfield_location').value, 'Austin, Texas, United States', 'later widgets still filled');
      } finally {
        AJP.filler.findLearned = real;
      }
    });
  }, { env: 'browser' });
})();
