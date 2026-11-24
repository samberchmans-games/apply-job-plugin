/*
 * Screening questions (B62, from a live Coinbase application): age, past employment (the companies named, checked
 * against your work history), how you heard, government official / relative, conflict of interest. Legal
 * acknowledgements and opinion questions are left for you.
 */
(function () {
  const { describe, it, eq, ok, notOk, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const R = () => AJP.fieldRules;
  const profile = (jobs = ['Acme Analytics Inc.', 'Globex']) => {
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    p.autoApply.experience = jobs.map((company) => ({ company, title: 'Engineer', start: '01/2015', end: 'Present' }));
    return p;
  };
  const answer = (q, p = profile()) => {
    const r = R().ruleFor(q);
    return r ? [r.key, r.v(p, { label: q }) || r.dflt || ''] : null;
  };

  describe('screening › rules', () => {
    it('defaults: 18+ yes, government official / relative no, conflict no, heard from a job board', () => {
      eq(answer('Are you at least 18 years of age?'), ['over18', 'Yes']);
      eq(answer('Are you a current government official or were you a government official in the last five years?'), ['govOfficial', 'No']);
      eq(answer('Are you a close relative of a government official (i.e., child/step-child, spouse/partner)?'), ['govRelative', 'No']);
      eq(answer('To your knowledge, do you or a close relative ... maintain a close personal relationship with a senior leader at a company connected to Coinbase that could create an actual or perceived conflict of interest?'), ['conflict', 'No']);
      eq(answer('To your knowledge, were you referred to this position by a senior leader or decision-maker at a current or prospective institutional client, business partner, or vendor of Coinbase?'), ['conflict', 'No']);
      eq(answer('How did you hear about this job?'), ['heardFrom', 'Job board']);
    });
    it('previously employed: every company named is checked against your work history', () => {
      eq(answer('Have you previously been employed by Coinbase in any capacity?'), ['previouslyEmployed', 'No']);
      eq(answer('Have you ever worked for any of the following companies: Coinbase, Globex or Bison Trails?'), ['previouslyEmployed', 'Yes']);
      eq(answer('Were you previously employed by Acme Analytics?'), ['previouslyEmployed', 'Yes'], 'company suffixes ignored');
      eq(R().namedCompanies('Have you ever been an employee of Coinbase, Base or Bison Trails?'), ['Coinbase', 'Base', 'Bison Trails']);
      eq(answer('Have you previously been employed by Coinbase?', profile(['Database Systems Ltd'])), ['previouslyEmployed', 'No'], '"Base" is not part of "Database"');
    });
    it('no answer when it cannot tell: no work history, no company named, or not an employment question', () => {
      eq(answer('Have you previously been employed by Coinbase?', profile([]))[1], '');
      eq(answer('Have you previously worked at a startup?')[1], '');
      notOk(answer('Have you ever worked with Kafka?'));
    });
    it('legal acknowledgements and opinion questions are left for you', () => {
      for (const q of ['Please confirm receipt of the above linked Global Data Privacy Notice and US Arbitration Agreement.', 'I understand that Coinbase may use AI tools to assist in the application and interview process.', 'Which of the following best describes how you use AI tools today?']) notOk(answer(q), q);
    });
    it('your answers in Auto-apply details win over the defaults', () => {
      const p = profile();
      Object.assign(p.autoApply, { govRelative: 'Yes', heardFrom: 'LinkedIn' });
      eq(answer('Are you a close relative of a government official?', p)[1], 'Yes');
      eq(answer('How did you hear about this job?', p)[1], 'LinkedIn');
    });
  });

  describe('screening › a Greenhouse form', () => {
    const sandbox = () => document.getElementById('sandbox');
    const rs = (id) => {
      const v = sandbox().querySelector(`[data-rs="${id}"] .select__single-value`);
      return v ? v.textContent : '';
    };
    afterEach(() => (sandbox().innerHTML = ''));
    it('dropdowns get Yes / No from your answers and work history; "how did you hear" picks the job board', async () => {
      globalThis.AtsMock.mount(sandbox(), 'greenhouse-questions');
      const r = await AJP.filler.fill({ profile: profile(), answers: {}, resume: null, root: sandbox() });
      eq([1, 2, 3, 4, 6, 7, 8, 9].map((i) => rs('question_' + i)), ['Yes', 'No', 'Yes', 'Online Job Board (Indeed, Glassdoor)', 'No', 'No', 'No', 'No']);
      eq(rs('question_5'), '', 'the privacy / arbitration acknowledgement is yours to confirm');
      ok(r.unknown.some((u) => /Global Data Privacy Notice/.test(u)), 'listed as not filled');
    });
  }, { env: 'browser' });
})();
