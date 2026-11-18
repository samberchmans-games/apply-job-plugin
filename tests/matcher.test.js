/* Matcher tests. Run: ./tests/run-tests.sh  (uses Node if installed, else macOS JavaScriptCore). */
(function () {
  const AJP = globalThis.AJP;
  const results = [];
  const test = (name, fn) => {
    try { fn(); results.push('PASS ' + name); } catch (e) { results.push('FAIL ' + name + ' :: ' + e.message); }
  };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
  const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy'); };
  const has = (map, k) => ok(map.has(k), 'missing ' + k + ' in ' + JSON.stringify([...map.keys()]));
  const not = (map, k) => ok(!map.has(k), 'unexpected ' + k + ' in ' + JSON.stringify([...map.keys()]));

  test('finds tricky tokens', () => {
    const f = AJP.matcher.findSkills('We use C++, C#, .NET Core, Node.js, k8s and CI/CD on AWS.');
    ['C++', 'C#', '.NET', 'Node.js', 'Kubernetes', 'CI/CD', 'AWS'].forEach((k) => has(f, k));
  });
  test('no false positives on common words', () => {
    const f = AJP.matcher.findSkills('Let us go to the rest of the team. Javascript only. R&D budget. html page');
    not(f, 'Go'); not(f, 'REST APIs'); not(f, 'R'); ok(f.has('JavaScript')); not(f, 'Java');
  });
  test('Go matched when capitalized', () => has(AJP.matcher.findSkills('Experience with Go and Python'), 'Go'));
  test('canonical aliases', () => { eq(AJP.matcher.canonical('k8s'), 'Kubernetes'); eq(AJP.matcher.canonical('reactjs'), 'React'); eq(AJP.matcher.canonical('Underwater Basket Weaving'), 'Underwater Basket Weaving'); });
  test('salary parse', () => {
    eq(AJP.matcher.parseSalary('Pay: $120,000 - $150,000 per year'), { min: 120000, max: 150000, hourly: false });
    eq(AJP.matcher.parseSalary('$140k–$180k'), { min: 140000, max: 180000, hourly: false });
    eq(AJP.matcher.parseSalary('$50 - $60 per hour').min, 104000);
  });
  test('work type detection', () => eq(AJP.matcher.detectWorkTypes('This is a hybrid role, 3 days in office'), ['hybrid', 'onsite']));

  const JD = [
    'Senior Backend Engineer', 'Remote (US) · $150,000 - $190,000',
    'Requirements', '- 5+ years of Python', '- Kubernetes and Docker', '- PostgreSQL', '- Strong communication',
    'Nice to have', '- Terraform', '- Kafka',
    'Benefits', '- Health insurance'
  ].join('\n');
  const profile = { skills: [{ name: 'python' }, { name: 'docker' }, { name: 'Postgres' }, { name: 'Salesforce CPQ' }], workTypes: { remote: true }, salary: { min: 160000 }, areas: ['Austin, TX'] };

  test('analyze: score, matched, missing, weights', () => {
    const a = AJP.matcher.analyze({ jdText: JD, profile, resumeText: 'Led Terraform migrations.' });
    const m = a.matched.map((x) => x.skill).sort();
    eq(m, ['Docker', 'PostgreSQL', 'Python', 'Terraform']);
    const miss = Object.fromEntries(a.missing.map((x) => [x.skill, x.importance]));
    eq(miss['Kubernetes'], 'required'); eq(miss['Kafka'], 'preferred');
    ok(a.score > 50 && a.score < 80, 'score ' + a.score);
    eq(a.fit.workType.ok, true); eq(a.fit.salary.ok, true); eq(a.fit.location.ok, true);
    eq(a.matched.find((x) => x.skill === 'Terraform').source, 'resume');
  });
  test('analyze: custom user skills match', () => {
    const a = AJP.matcher.analyze({ jdText: 'Must have Salesforce CPQ experience and Apex.', profile });
    ok(a.matched.some((x) => x.skill === 'Salesforce CPQ'), JSON.stringify(a.matched));
  });
  test('analyze: AI skills merged', () => {
    const a = AJP.matcher.analyze({ jdText: JD, profile, aiSkills: { required: ['Golang'], preferred: [] } });
    ok(a.missing.some((x) => x.skill === 'Go' && x.importance === 'required'));
  });
  test('analyze: empty JD -> null score', () => eq(AJP.matcher.analyze({ jdText: 'Hello world', profile }).score, null));
  test('normKey', () => eq(AJP.normKey('  Are you legally authorized to work in the US? *'), 'are you legally authorized to work in the us'));

  globalThis.__TEST_RESULTS__ = results;
})();
