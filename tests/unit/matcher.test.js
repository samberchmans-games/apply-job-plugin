(function () {
  const { describe, it, eq, ok, includes, excludes } = globalThis.AJPTest;
  const M = globalThis.AJP.matcher;
  const keys = (m) => [...m.keys()];

  describe('matcher › skill detection', () => {
    it('finds tokens with special characters (C++, C#, .NET, Node.js, CI/CD)', () => {
      const f = keys(M.findSkills('We use C++, C#, .NET Core, Node.js, k8s and CI/CD on AWS.'));
      for (const k of ['C++', 'C#', '.NET', 'Node.js', 'Kubernetes', 'CI/CD', 'AWS']) includes(f, k);
    });
    it('no false positives on ordinary words ("go", "rest", "R&D")', () => {
      const f = keys(M.findSkills('Let us go to the rest of the team. Javascript only. R&D budget. html page'));
      excludes(f, 'Go');
      excludes(f, 'REST APIs');
      excludes(f, 'R');
      excludes(f, 'Java');
      includes(f, 'JavaScript');
      includes(f, 'HTML');
    });
    it('JavaScript does not also count as Java', () => excludes(keys(M.findSkills('Strong JavaScript and TypeScript')), 'Java'));
    it('Go is matched when written as a language', () => includes(keys(M.findSkills('Experience with Go and Python')), 'Go'));
    it('golang alias maps to Go', () => includes(keys(M.findSkills('golang microservices')), 'Go'));
    it('multi-word skills tolerate hyphens', () => includes(keys(M.findSkills('machine-learning pipelines')), 'Machine learning'));
    it('is case-insensitive for normal skills', () => includes(keys(M.findSkills('POSTGRESQL and kubernetes')), 'Kubernetes'));
    it('counts occurrences', () => eq(M.findSkills('Python. More Python. python3!').get('Python'), 3));
    it('empty text returns empty map', () => eq(M.findSkills('').size, 0));
    it('custom user skills are found even if not in the dictionary', () =>
      includes(keys(M.findSkills('Salesforce CPQ admin', ['Salesforce CPQ'])), 'Salesforce CPQ'));
    it('short custom skills are case-sensitive', () => {
      excludes(keys(M.findSkills('we go far', ['GO'])), 'GO');
    });
  });

  describe('matcher › canonical names', () => {
    it('maps aliases', () => {
      eq(M.canonical('k8s'), 'Kubernetes');
      eq(M.canonical('reactjs'), 'React');
      eq(M.canonical('Postgres'), 'PostgreSQL');
      eq(M.canonical('  PYTHON '), 'Python');
    });
    it('keeps unknown skills as typed (trimmed)', () => eq(M.canonical('  Underwater Basket Weaving '), 'Underwater Basket Weaving'));
  });

  describe('matcher › JD sections', () => {
    const sec = (jd) => M.sectionize(jd).map((s) => s.kind);
    it('detects required and preferred headings', () => {
      eq(sec('Requirements\nPython\nNice to have\nKafka'), ['required', 'required', 'preferred', 'preferred']);
    });
    it('"Preferred qualifications" is preferred, not required', () => eq(sec('Preferred Qualifications\nKafka'), ['preferred', 'preferred']));
    it('inline "a plus" marks a single line preferred', () => eq(sec('Requirements\nPython\nKafka is a plus.')[2], 'preferred'));
    it('inline "(preferred)" and "X preferred." are preferred', () => {
      eq(sec('Requirements\nGo (preferred)')[1], 'preferred');
      eq(sec('Requirements\nExperience with Terraform preferred.')[1], 'preferred');
    });
    it('benefits section is neutral', () => eq(sec('Benefits\nHealth insurance')[1], 'neutral'));
    it('long sentences are not treated as headings', () =>
      eq(sec('Requirements\nYou will work with our preferred vendors to build tools for the team every day.')[1], 'required'));
  });

  describe('matcher › salary & work type', () => {
    it('parses $120,000 - $150,000', () => eq(M.parseSalary('Pay: $120,000 - $150,000 per year'), { min: 120000, max: 150000, hourly: false }));
    it('parses $140k–$180k', () => eq(M.parseSalary('$140k–$180k'), { min: 140000, max: 180000, hourly: false }));
    it('parses "to"', () => eq(M.parseSalary('$90,000 to $110,000').max, 110000));
    it('converts hourly to annual', () => {
      const s = M.parseSalary('$50 - $60 per hour');
      eq([s.min, s.max, s.hourly], [104000, 124800, true]);
    });
    it('returns null when no salary', () => eq(M.parseSalary('Competitive pay'), null));
    it('detects hybrid + onsite', () => eq(M.detectWorkTypes('This is a hybrid role, 3 days in office'), ['hybrid', 'onsite']));
    it('detects remote', () => eq(M.detectWorkTypes('Fully remote, work from home'), ['remote']));
    it('"not remote" is not remote', () => eq(M.detectWorkTypes('This position is not remote. On-site only.'), ['onsite']));
  });

  const JD = [
    'Senior Backend Engineer', 'Remote (US) · $150,000 - $190,000',
    'Requirements', '- 5+ years of Python', '- Kubernetes and Docker', '- PostgreSQL', '- Strong communication',
    'Nice to have', '- Terraform', '- Kafka',
    'Benefits', '- Health insurance',
  ].join('\n');
  const profile = () => ({
    skills: [{ name: 'python' }, { name: 'docker' }, { name: 'Postgres' }, { name: 'Salesforce CPQ' }],
    workTypes: { remote: true, hybrid: false, onsite: false },
    salary: { min: 160000 },
    areas: ['Austin, TX'],
  });

  describe('matcher › analyze', () => {
    it('matched / missing / importance / score', () => {
      const a = M.analyze({ jdText: JD, profile: profile(), resumeText: 'Led Terraform migrations.' });
      eq(a.matched.map((x) => x.skill).sort(), ['Docker', 'PostgreSQL', 'Python', 'Terraform']);
      const miss = Object.fromEntries(a.missing.map((x) => [x.skill, x.importance]));
      eq(miss.Kubernetes, 'required');
      eq(miss.Kafka, 'preferred');
      ok(a.score > 50 && a.score < 80, 'score ' + a.score);
    });
    it('marks where a matched skill came from (profile vs resume)', () => {
      const a = M.analyze({ jdText: JD, profile: profile(), resumeText: 'Terraform' });
      eq(a.matched.find((x) => x.skill === 'Terraform').source, 'resume');
      eq(a.matched.find((x) => x.skill === 'Python').source, 'profile');
    });
    it('missing list is sorted with required first', () => {
      const a = M.analyze({ jdText: JD, profile: profile() });
      eq(a.missing[a.missing.length - 1].importance, 'preferred');
    });
    it('100% when the user has every skill', () => {
      const a = M.analyze({ jdText: 'Requirements\nPython and Docker', profile: { skills: [{ name: 'Python' }, { name: 'Docker' }] } });
      eq(a.score, 100);
    });
    it('0% when the user has none', () => eq(M.analyze({ jdText: 'Requirements\nKafka, Rust', profile: { skills: [] } }).score, 0));
    it('null score when the JD has no recognizable skills', () => eq(M.analyze({ jdText: 'Hello world', profile: profile() }).score, null));
    it('missing required skills cost more than missing preferred skills', () => {
      const p = { skills: [{ name: 'Python' }] };
      const reqMissing = M.analyze({ jdText: 'Requirements\nPython\nKafka\nNice to have\nTerraform', profile: { skills: [{ name: 'Python' }, { name: 'Terraform' }] } }).score;
      const prefMissing = M.analyze({ jdText: 'Requirements\nPython\nKafka\nNice to have\nTerraform', profile: { skills: [{ name: 'Python' }, { name: 'Kafka' }] } }).score;
      ok(prefMissing > reqMissing, `${prefMissing} > ${reqMissing}`);
      ok(p);
    });
    it('custom user skills match', () => {
      const a = M.analyze({ jdText: 'Must have Salesforce CPQ experience and Apex.', profile: profile() });
      includes(a.matched.map((x) => x.skill), 'Salesforce CPQ');
    });
    it('skill names given as plain strings also work', () => {
      const a = M.analyze({ jdText: 'Python required', profile: { skills: ['python'] } });
      eq(a.matched.length, 1);
    });
    it('AI-extracted skills are merged and canonicalized', () => {
      const a = M.analyze({ jdText: JD, profile: profile(), aiSkills: { required: ['Golang'], preferred: [] } });
      ok(a.missing.some((x) => x.skill === 'Go' && x.importance === 'required'));
    });
    it('survives a missing / empty profile', () => {
      const a = M.analyze({ jdText: JD, profile: null });
      eq(a.score, 0);
    });
    it('is fast on a large JD (< 150ms)', () => {
      const big = JD.repeat(40);
      const a = M.analyze({ jdText: big, profile: profile() });
      ok(a.ms < 150, a.ms + 'ms');
    });
  });

  describe('matcher › fit checks', () => {
    it('work type ok when job is remote and user wants remote', () => eq(M.analyze({ jdText: JD, profile: profile() }).fit.workType.ok, true));
    it('work type not ok when job is onsite and user only wants remote', () =>
      eq(M.analyze({ jdText: 'On-site role. Python.', profile: profile() }).fit.workType.ok, false));
    it('work type unknown when JD does not say', () => eq(M.analyze({ jdText: 'Python role', profile: profile() }).fit.workType.ok, null));
    it('salary ok when ranges overlap', () => eq(M.analyze({ jdText: JD, profile: profile() }).fit.salary.ok, true));
    it('salary not ok when job max below user min', () =>
      eq(M.analyze({ jdText: 'Python. $80,000 - $100,000', profile: profile() }).fit.salary.ok, false));
    it('salary unknown when user has no salary set', () =>
      eq(M.analyze({ jdText: JD, profile: { ...profile(), salary: {} } }).fit.salary.ok, null));
    it('location ok when city appears', () =>
      eq(M.analyze({ jdText: 'Python role in Austin', profile: { ...profile(), workTypes: {} } }).fit.location.ok, true));
    it('location ok for remote job when user accepts remote', () => eq(M.analyze({ jdText: JD, profile: profile() }).fit.location.ok, true));
    it('location not ok when city differs and not remote', () =>
      eq(M.analyze({ jdText: 'Python role in Boston. On-site.', profile: profile() }).fit.location.ok, false));
    it('location unknown when user has no areas', () =>
      eq(M.analyze({ jdText: JD, profile: { ...profile(), areas: [] } }).fit.location.ok, null));
  });
})();
