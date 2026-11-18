(function () {
  const { describe, it, eq, ok, notOk, includes } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const T = AJP.tracks;

  const CLOUD = { id: 'cloud', name: 'AWS Cloud Architect', targetTitles: ['Cloud Architect', 'Solutions Architect'], skills: [{ name: 'AWS' }, { name: 'Terraform' }, { name: 'Kubernetes' }, { name: 'Docker' }], resumeId: 'rc' };
  const JAVA = { id: 'java', name: 'Java Architect', targetTitles: ['Java Architect', 'Backend Architect'], skills: [{ name: 'Spring' }, { name: 'Microservices' }, { name: 'Kafka' }, { name: 'REST APIs' }], resumeId: null };
  const profile = (tracks = [CLOUD, JAVA]) => ({ skills: [{ name: 'Java' }, { name: 'Python' }, { name: 'SQL' }], targetRoles: ['Engineer'], salary: { min: '150000' }, workTypes: { remote: true }, areas: ['Austin, TX'], tracks });
  const RESUMES = { activeId: 'r1', items: [{ id: 'r1', name: 'Main', text: 'Built Java services' }, { id: 'rc', name: 'Cloud resume', text: 'Automated AWS with Terraform and CloudFormation' }] };
  const JD_CLOUD = 'AWS Cloud Architect\nRequirements\n- AWS\n- Terraform\n- Kubernetes\n- Docker\n- Python\nNice to have\n- Kafka';
  const JD_JAVA = 'Senior Java Architect\nRequirements\n- Java\n- Spring Boot\n- Microservices\n- Kafka\n- REST APIs\nNice to have\n- AWS';

  describe('tracks › setup', () => {
    it('no tracks → one implicit "General" track (existing profile = first track)', () => {
      const l = T.list(profile([]));
      eq([l.length, l[0].id, l[0].name, l[0].implicit], [1, 'general', 'General', true]);
      eq(l[0].targetTitles, ['Engineer']);
    });
    it('at most 3 tracks; incomplete ones are ignored', () => {
      eq(T.list(profile([CLOUD, JAVA, { id: 'x', name: 'X' }, { id: 'y', name: 'Y' }])).length, 3);
      eq(T.list(profile([{ id: '', name: 'No id' }, CLOUD])).map((t) => t.id), ['cloud']);
    });
    it('normalize: trims, caps, turns skill strings into objects, drops empty overrides', () => {
      const n = T.normalize([{ name: '  Data  ', targetTitles: ['Data Engineer', ' '], skills: ['Spark', ''], salary: { min: '', max: '' }, workTypes: { remote: false } }, {}, {}, {}]);
      eq(n.length, 3);
      eq([n[0].name, n[0].targetTitles, n[0].skills, n[0].salary, n[0].workTypes], ['Data', ['Data Engineer'], [{ name: 'Spark' }], null, null]);
      ok(n[0].id && n[1].name === 'Track 2');
    });
  });

  describe('tracks › profile and resume per track', () => {
    it('core skills + track skills, without duplicates', () => {
      const p = T.effectiveProfile(profile(), { ...CLOUD, skills: [{ name: 'AWS' }, { name: 'java' }] });
      eq(p.skills.map((s) => s.name), ['Java', 'Python', 'SQL', 'AWS']);
    });
    it('track overrides salary / work types / areas only when set', () => {
      const p = T.effectiveProfile(profile(), { ...CLOUD, salary: { min: '200000' }, workTypes: { hybrid: true }, areas: ['Seattle, WA'] });
      eq([p.salary.min, p.workTypes, p.areas], ['200000', { hybrid: true }, ['Seattle, WA']]);
      const q = T.effectiveProfile(profile(), JAVA);
      eq([q.salary.min, q.workTypes, q.areas], ['150000', { remote: true }, ['Austin, TX']]);
    });
    it('target titles come from the track', () => eq(T.effectiveProfile(profile(), JAVA).targetRoles, ['Java Architect', 'Backend Architect']));
    it('a track uses its own resume, else the active one', () => {
      eq(T.resumeFor(CLOUD, RESUMES).id, 'rc');
      eq(T.resumeFor(JAVA, RESUMES).id, 'r1');
      eq(T.resumeFor({ resumeId: 'deleted' }, RESUMES).id, 'r1');
      eq(T.resumeFor(JAVA, { items: [] }), null);
    });
  });

  describe('tracks › scoring every job against every track', () => {
    it('a cloud job scores higher on the Cloud track, which is picked', () => {
      const r = T.analyzeAll({ jdText: JD_CLOUD, jobTitle: 'AWS Cloud Architect', profile: profile(), resumes: RESUMES });
      const by = Object.fromEntries(r.results.map((x) => [x.track.id, x.analysis.score]));
      ok(by.cloud > by.java, JSON.stringify(by));
      eq(r.bestId, 'cloud');
    });
    it('a Java job picks the Java track', () => eq(T.analyzeAll({ jdText: JD_JAVA, jobTitle: 'Senior Java Architect', profile: profile(), resumes: RESUMES }).bestId, 'java'));
    it('each track is scored with its own resume', () => {
      const r = T.analyzeAll({ jdText: JD_CLOUD, profile: profile(), resumes: RESUMES });
      const cloud = r.results.find((x) => x.track.id === 'cloud');
      eq(cloud.resumeId, 'rc');
      eq(cloud.analysis.matched.find((m) => m.skill === 'Terraform').source, 'profile');
    });
    it('the job title breaks a tie between equally-skilled tracks', () => {
      const a = { ...JAVA, id: 'a', name: 'Backend', targetTitles: ['Backend Engineer'] };
      const b = { ...JAVA, id: 'b', name: 'Platform', targetTitles: ['Platform Engineer'] };
      eq(T.analyzeAll({ jdText: JD_JAVA, jobTitle: 'Senior Platform Engineer', profile: profile([a, b]), resumes: RESUMES }).bestId, 'b');
      eq(T.analyzeAll({ jdText: JD_JAVA, jobTitle: 'Backend Engineer II', profile: profile([a, b]), resumes: RESUMES }).bestId, 'a');
    });
    it('the shown score is the real match %, not inflated by the title bonus', () => {
      const r = T.analyzeAll({ jdText: JD_CLOUD, jobTitle: 'Cloud Architect', profile: profile(), resumes: RESUMES });
      const c = r.results.find((x) => x.track.id === 'cloud');
      ok(c.rank > c.analysis.score);
      ok(c.analysis.score <= 100);
    });
    it('with no tracks, the result equals the plain single-profile match', () => {
      const p = profile([]);
      const r = T.analyzeAll({ jdText: JD_JAVA, profile: p, resumes: RESUMES });
      eq(r.results.length, 1);
      eq(r.results[0].analysis.score, AJP.matcher.analyze({ jdText: JD_JAVA, profile: p, resumeText: 'Built Java services' }).score);
    });
    it('title fit: "Sr." = "Senior", extra words ignored', () => {
      eq(T.titleFit('Sr. Cloud Architect (Remote)', CLOUD), 1);
      eq(T.titleFit('Data Analyst', CLOUD), 0);
      eq(T.titleFit('', CLOUD), 0);
    });
  });

  describe('tracks › insights and history', () => {
    const evaluations = [
      { jobKey: 'k1', bestTrackId: 'cloud', scores: { cloud: 80, java: 40 }, gaps: { cloud: ['Kubernetes', 'Kafka'], java: ['AWS'] } },
      { jobKey: 'k2', bestTrackId: 'cloud', scores: { cloud: 60, java: 50 }, gaps: { cloud: ['Kubernetes'], java: ['AWS', 'Kafka'] } },
      { jobKey: 'k3', bestTrackId: 'java', scores: { cloud: 30, java: 90 }, gaps: { cloud: ['Kubernetes', 'Spring'], java: [] } },
    ];
    const applications = [
      { trackId: 'cloud', appliedAt: 'x', status: 'applied' },
      { trackId: 'cloud', appliedAt: 'x', status: 'rejected', statusHistory: [{ status: 'interviewing' }] },
      { trackId: 'java', appliedAt: 'x', status: 'offer' },
      { trackId: 'cloud', status: 'in progress' },
    ];
    it('jobs evaluated, average match, best-for, applied, interviews', () => {
      const c = T.insights('cloud', { evaluations, applications });
      eq([c.evaluated, c.avgScore, c.bestFor, c.applied, c.interviews], [3, 57, 2, 2, 1]);
    });
    it('most frequent gaps = what to learn next for that track', () => {
      eq(T.insights('cloud', { evaluations }).topGaps[0], { skill: 'Kubernetes', count: 3, pct: 100 });
      eq(T.insights('java', { evaluations }).topGaps.map((g) => g.skill), ['AWS', 'Kafka']);
    });
    it('a track with no data gives empty insights', () => eq(T.insights('none', { evaluations, applications }), { evaluated: 0, bestFor: 0, avgScore: null, applied: 0, interviews: 0, topGaps: [] }));
    it('history keeps one entry per job (latest first) and at most 300', () => {
      let l = [];
      for (let i = 0; i < 305; i++) l = T.addEvaluation(l, { jobKey: 'k' + (i % 302) });
      eq(l.length, 300);
      eq(l[0].jobKey, 'k2', 'the job seen last comes first');
      eq(l.filter((x) => x.jobKey === 'k2').length, 1, 'seen twice, kept once');
    });
    it('the CSV export has a Track column', () => {
      const csv = AJP.tracker.toCSV([{ company: 'A', title: 'B', status: 'applied', trackName: 'Java Architect' }]);
      includes(csv.split('\r\n')[0], 'Track');
      includes(csv, 'Java Architect');
    });
    it('implicit General track is never stored as a real track', () => notOk(T.normalize([]).length));
  });
})();
