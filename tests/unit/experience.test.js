/*
 * Smarter matching: years of experience, seniority, skill synonyms (implied + similar). Pure: runs in CLI too.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const X = AJP.experience;
  const req = (t) => X.required(t);
  const overall = (t) => (req(t).overall ? req(t).overall.min : null);

  describe('experience › years the job asks for', () => {
    for (const [text, n] of [
      ['5+ years of experience in software engineering', 5],
      ['At least 7 years of professional experience', 7],
      ['Minimum of 3 years experience', 3],
      ['3-5 years of relevant experience', 3],
      ['Five or more years of industry experience', 5],
      ['8+ yrs of backend development', 8],
      ['You have 10+ years working on distributed systems.', 10],
    ]) it(`"${text}" → ${n}`, () => eq(overall(text), n));
    it('a range keeps its upper bound', () => eq(req('3-5 years of relevant experience').overall.max, 5));
    for (const text of [
      'Founded 20 years ago, Initech builds payroll software.',
      'For over 15 years we have helped customers.',
      'Over the past 10 years our team has grown.',
      "Bachelor's degree or 4 year degree in Computer Science",
      'Applicants must be at least 18 years old',
      'We have been in business for 25 years',
    ]) it(`ignores "${text}"`, () => eq(req(text).overall, null));
    it('the highest required ask wins; preferred asks do not raise it', () => {
      const r = req('Requirements\n- 5+ years of experience in engineering\n- 2+ years of leadership experience\nNice to have\n- 10+ years of experience in fintech');
      eq([r.overall.min, r.overall.preferred], [5, false]);
    });
    it('only preferred asks → used, marked preferred', () => {
      const r = req('Nice to have\n- 3+ years of professional experience');
      eq([r.overall.min, r.overall.preferred], [3, true]);
    });
    it('"N years with <skill>" is a skill requirement, not the overall one', () => {
      const r = req('Requirements\n- 3+ years with Kafka');
      eq(r.overall, null);
      eq(r.skills.map((s) => [s.skills, s.min]), [[['Kafka'], 3]]);
    });
    it('"N years of Java experience" is about Java', () => {
      const r = req('- 4 years of Java experience');
      eq([r.overall, r.skills[0].skills, r.skills[0].min], [null, ['Java'], 4]);
    });
    it('"N years of experience with Java or Python" → overall AND an either-or skill ask', () => {
      const r = req('- 5+ years of experience with Java or Python');
      eq(r.overall.min, 5);
      eq(r.skills[0].skills.sort(), ['Java', 'Python']);
      ok(r.skills[0].anyOf);
    });
    it('two asks on one line are read separately', () => {
      const r = req('6+ years of software engineering experience, including 2+ years with AWS');
      eq([r.overall.min, r.skills[0].skills, r.skills[0].min], [6, ['AWS'], 2]);
    });
  });

  describe('experience › the candidate\'s years', () => {
    const RES = [
      '# Ana', 'ana@example.com', '',
      '## Experience',
      '### Senior Engineer — Acme (Jan 2019 – Dec 2022)', '- Built Spring services', '- Ran Kafka pipelines on AWS',
      '### Engineer — Globex (2015–2018)', '- Python ETL jobs',
      '### Contractor — Hooli (06/2018 – 03/2019)', '- Java fixes',
      '', '## Education', 'B.S. Computer Science, UT Austin (2011–2015)',
    ].join('\n');
    it('reads date formats', () => {
      eq(X.monthIndex('06/2019'), 2019 * 12 + 5);
      eq(X.monthIndex('2019-06'), 2019 * 12 + 5);
      eq(X.monthIndex('Sept. 2021'), 2021 * 12 + 8);
      eq(X.monthIndex('Present') > 2025 * 12, true);
      eq(X.monthIndex('soon'), null);
    });
    it('month names and bare years', () => {
      eq(X.monthIndex('June 2019'), 2019 * 12 + 5);
      eq(X.monthIndex('Sep 2021'), 2021 * 12 + 8);
      eq(X.monthIndex('2015'), 2015 * 12);
      eq(X.monthIndex('2015', true), 2015 * 12 + 11);
    });
    it('roles come from the Experience section only (education dates ignored)', () => {
      const roles = X.resumeRoles(RES);
      eq(roles.length, 3);
      notOk(roles.some((r) => /UT Austin/.test(r.text)));
    });
    it('overlapping jobs are counted once', () => {
      // 2015–2018 (48 months) + Jun 2018–Mar 2019 + Jan 2019–Dec 2022 → Jan 2015..Dec 2022 = 96 months
      eq(X.candidate({}, RES).years, 8);
      eq(X.candidate({}, RES).source, 'resume');
    });
    it('the total typed in Admin → Profile wins', () => {
      const c = X.candidate({ personal: { yearsExperience: '12' } }, RES);
      eq([c.years, c.source], [12, 'profile']);
    });
    it('Auto-apply work history comes before the resume', () => {
      const c = X.candidate({ autoApply: { experience: [{ start: '01/2020', end: '12/2021', title: 'Dev' }] } }, RES);
      eq([c.years, c.source], [2, 'work history']);
    });
    it('years with a skill = the roles that mention it (or a skill that implies it)', () => {
      const c = X.candidate({}, RES);
      eq(c.skillYears('Kafka'), 4);
      eq(c.skillYears('Java'), 4.6, 'Spring role Jan 2019–Dec 2022 (48 months) + Java contractor role Jun 2018–Mar 2019 (10, of which 3 overlap) = 55 months');
      eq(c.skillYears('Rust'), null);
    });
    it('"Present" counts up to today', () => {
      const y = new Date().getFullYear();
      const c = X.candidate({}, `## Experience\nDev — Co (Jan ${y - 3} – Present)\n- Go services`);
      ok(c.years >= 3 && c.years < 4, String(c.years));
    });
    it('a resume without headings: all date ranges count', () => eq(X.resumeRoles('Dev, Co 2010-2012\n- stuff').length, 1));
    for (const [line, months] of [
      ['Senior Engineer, Acme  06-2019 – 03-2021', 22], ['Engineer | Globex | Jan 2019 - Dec 2020', 24], ['Dev at Hooli, January 2018 – December 2018', 12],
      ['Analyst — Initech (2015 - 2016)', 24], ['Digital Marketing, Initech 2019 – 2020', 24], ['Data Engineer, Sept. 2021 – Present', null], ['Lead, Umbrella  01/2020 to 06/2020', 6], ['Intern, Stark 2014–2014', 12],
    ]) it(`date range in "${line}"`, () => {
      const m = X.totalMonths(X.resumeRoles(`## Experience\n${line}\n- Java`));
      if (months == null) ok(m > 12, String(m)); // "Present": up to today
      else eq(m, months);
    });
    for (const [line, months] of [
      ['Data Architect, Acme  Jun 2018 – Jun 2019', 13], ['Engineer | Globex | Jun-2016 to May-2019', 36], ['Lead, Hooli  Jan’14 – Dec’15', 24],
      ['Dev, Co  Feb, 2012 - Jan, 2014', 24],
    ]) it(`more date styles: "${line}"`, () => eq(X.totalMonths(X.resumeRoles(`## Experience\n${line}\n- Java`)), months));
    for (const line of ['Data Architect, Acme  Jun 2019 – Till Date', 'Consultant  2010 - Till Now', 'Engineer, Initech  Jan 2020 to date']) {
      it(`"Present" spelled differently: "${line}"`, () => ok(X.totalMonths(X.resumeRoles(`## Experience\n${line}\n- Java`)) > 12));
    }
    it('no recognisable Experience heading (e.g. "EXPERIENCE SUMMARY") → dated lines anywhere, education skipped', () => {
      const t = 'SAM B\nSUMMARY\nData architect\nTECHNICAL SKILLS\nPython, Java\nEXPERIENCE SUMMARY\nAcme Corp — Data Architect  Jan 2019 – Dec 2022\n- Built Kafka pipelines in Python\nGlobex — Engineer  Jun 2015 – Dec 2018\n- Java services\nEDUCATION\nB.Tech Computer Science, Anna University  2005 – 2009\n- Python projects';
      const c = X.candidate({}, t);
      eq(c.roles.length, 2);
      eq([c.skillYears('Python'), c.skillYears('Java'), c.skillYears('Kafka')], [4, 3.6, 4]);
    });
    it('plain headings from PDF text ("Professional Experience", "Education:") are understood', () => {
      const t = 'Ana Silva\nProfessional Experience\nSenior Engineer, Acme  Jan 2019 – Dec 2022\n• Built Kafka pipelines\nEducation:\nBS Computer Science 2011 - 2015';
      const roles = X.resumeRoles(t);
      eq(roles.length, 1);
      includes(roles[0].text, 'Kafka');
    });
  });

  describe('experience › seniority', () => {
    for (const [title, id] of [
      ['Senior Data Engineer', 'senior'], ['Sr. Software Engineer', 'senior'], ['Staff Engineer', 'lead'], ['Principal Architect', 'lead'],
      ['Junior Developer', 'junior'], ['Software Engineer II', 'mid'], ['Software Engineer III', 'senior'], ['Engineering Manager', 'manager'],
      ['Director of Engineering', 'director'], ['VP Engineering', 'executive'], ['Software Engineering Intern', 'intern'], ['Data Engineer', null],
    ]) it(`"${title}" → ${id}`, () => eq((X.fromTitle(title) || {}).id || null, id));
    it('"Product Manager" is a role name, not a people-manager level', () => eq(X.fromTitle('Product Manager'), null));
    it('no level in the title → judged from the years asked', () => {
      eq(X.jobLevel('Data Engineer', 6).id, 'senior');
      eq(X.jobLevel('Data Engineer', 6).source, 'years asked');
      eq(X.jobLevel('Data Engineer', null), null);
    });
    it('my level: from my current title, else my years', () => {
      eq(X.myLevel({ personal: { currentTitle: 'Senior Engineer' } }, 3).id, 'senior');
      eq(X.myLevel({ personal: {} }, 1).id, 'junior');
      eq(X.myLevel({ personal: {} }, null), null);
    });
  });

  describe('experience › the fit rows', () => {
    const profile = { personal: { currentTitle: 'Senior Engineer', yearsExperience: '8' } };
    const resume = '## Experience\n### Senior Engineer — Acme (2019–2022)\n- Kafka streams\n### Engineer — Globex (2015–2018)\n- Python ETL';
    it('enough years → ✅; per-skill years too', () => {
      const r = X.check({ jdText: 'Requirements\n- 5+ years of experience\n- 3+ years with Kafka', jobTitle: 'Senior Data Engineer', profile, resumeText: resume });
      eq([r.years.asked, r.years.have, r.years.ok], [5, 8, true]);
      eq(r.years.skills.map((s) => [s.skill, s.asked, s.have, s.ok]), [['Kafka', 3, 4, true]]);
      eq([r.seniority.job.id, r.seniority.mine.id, r.seniority.ok, r.seniority.note], ['senior', 'senior', true, 'same level']);
    });
    it('one year short → not ok but "close"', () => {
      const r = X.check({ jdText: '9+ years of experience', jobTitle: '', profile, resumeText: '' });
      eq([r.years.ok, r.years.close], [false, true]);
    });
    it('far short → not ok, not close', () => {
      const r = X.check({ jdText: '12+ years of experience', jobTitle: '', profile, resumeText: '' });
      eq([r.years.ok, r.years.close], [false, false]);
    });
    it('a skill you have but never in a dated role → unknown, not a failure', () => {
      const r = X.check({ jdText: '- 2+ years with Rust', jobTitle: '', profile, resumeText: resume });
      eq([r.years.skills[0].have, r.years.skills[0].ok], [null, null]);
    });
    it('"either" skill asks use your best one', () => {
      const r = X.check({ jdText: '- 5+ years of experience with Rust or Python', jobTitle: '', profile, resumeText: resume });
      eq(r.years.skills.map((s) => [s.skill.split(' or ').sort().join(' or '), s.have]), [['Python or Rust', 4]]);
    });
    it('Director job for a Senior engineer → a big step up (stretch), not ok', () => {
      const r = X.check({ jdText: '', jobTitle: 'Director of Data', profile, resumeText: '' });
      eq([r.seniority.ok, r.seniority.note], [false, 'a big step up (stretch)']);
    });
    it('Junior job for a Senior engineer → below your level', () => eq(X.check({ jdText: '', jobTitle: 'Junior Developer', profile, resumeText: '' }).seniority.note, 'below your level'));
    it('nothing asked and no title level → rows empty, never a crash', () => {
      const r = X.check({ jdText: 'Python', jobTitle: 'Engineer', profile: {}, resumeText: '' });
      eq([r.years.asked, r.seniority.job], [null, null]);
    });
  });

  describe('matcher › synonyms and the new fit rows', () => {
    const P = (skills, personal = {}) => ({ skills: skills.map((name) => ({ name })), personal });
    const an = (jd, skills, extra = {}) => AJP.matcher.analyze({ jdText: jd, profile: P(skills), ...extra });
    it('implied skills count fully (Next.js → React → JavaScript)', () => {
      const a = an('Requirements\n- React\n- JavaScript', ['Next.js']);
      eq(a.score, 100);
      eq(a.matched.find((m) => m.skill === 'React').source, 'implied by Next.js');
    });
    it('PostgreSQL implies SQL; Spring implies Java', () => {
      eq(an('Requirements\n- SQL', ['PostgreSQL']).score, 100);
      eq(an('Requirements\n- Java', ['Spring Boot']).score, 100);
    });
    it('implication is one-way: React does not give you Next.js', () => eq(an('Requirements\n- Next.js', ['React']).score, 0));
    it('a similar skill gives half credit and names what you have', () => {
      const a = an('Requirements\n- AWS', ['Azure']);
      eq(a.score, 50);
      eq(a.missing[0].similar, 'Azure');
      eq(a.similarCount, 1);
    });
    it('similar never beats the real thing', () => eq(an('Requirements\n- AWS\n- Azure', ['AWS']).score, 75));
    it('more aliases: EKS → Kubernetes + AWS, psql → PostgreSQL, micro services → Microservices', () => {
      const found = [...AJP.matcher.findSkills('We run EKS, psql and micro services').keys()];
      for (const s of ['Kubernetes', 'AWS', 'PostgreSQL', 'Microservices']) includes(found, s);
    });
    it('"Go" as a word is still not the Go language; "ELK" yes, "elk" in prose not counted as different', () => {
      eq(AJP.matcher.findSkills('Ready to go the extra mile').has('Go'), false);
      ok(AJP.matcher.findSkills('Logs in ELK').has('Elasticsearch'));
    });
    it('bug B14: a short bullet containing "experience"/"skills" no longer flips "Nice to have" back to required', () => {
      const a = an('Requirements\n- Python\nNice to have\n- Experience with Snowflake\n- Strong SQL skills', ['Python']);
      eq(a.missing.map((m) => [m.skill, m.importance]).sort(), [['SQL', 'preferred'], ['Snowflake', 'preferred']]);
    });
    it('analyze adds the years and seniority rows; the score ignores them', () => {
      const jd = 'Requirements\n- 10+ years of experience\n- Python';
      const a = an(jd, ['Python'], { jobTitle: 'Principal Engineer' });
      eq(a.score, 100);
      eq([a.fit.years.asked, a.fit.seniority.job.id], [10, 'lead']);
    });
    it('a crash in the experience check never breaks matching', () => {
      const real = AJP.experience.check;
      AJP.experience.check = () => { throw new TypeError('boom'); };
      try {
        const a = an('Requirements\n- Python', ['Python']);
        eq([a.score, a.fit.years, a.fit.seniority], [100, null, null]);
      } finally {
        AJP.experience.check = real;
      }
    });
    it('stays fast on a long job description', () => {
      const jd = ('Requirements\n- 5+ years of experience with Java, Kafka and AWS\n- Senior engineers who mentor\n').repeat(150);
      const t = Date.now();
      an(jd, ['Java', 'Azure'], { jobTitle: 'Senior Engineer', resumeText: '## Experience\nDev — Co (2015–2020)\n- Java' });
      ok(Date.now() - t < 400, `${Date.now() - t}ms`);
    });
  });
})();
