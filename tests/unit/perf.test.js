/*
 * Performance changes (B66–B68) keep the same results: Job Radar saves several companies at once; (more below).
 * Speed itself is measured with tests/run-bench.sh, not here.
 */
(function () {
  const { describe, it, eq, ok, beforeEach, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;

  describe('perf › matching scans blocks, with the same result as line by line (B67)', () => {
    const M = () => AJP.matcher;
    const W = { required: 3, neutral: 2, preferred: 1 };
    // The old way, as the reference: every line on its own.
    function lineByLine(jdText, custom) {
      const jd = new Map();
      for (const sec of M().sectionize(jdText)) {
        for (const [name, n] of M().findSkills(sec.text, custom)) {
          const cur = jd.get(name) || { weight: 0, count: 0 };
          cur.weight = Math.max(cur.weight, W[sec.kind] || W.neutral);
          cur.count += n;
          jd.set(name, cur);
        }
      }
      return [...jd].map(([name, i]) => `${name}=${i.weight + Math.min(i.count - 1, 2) * 0.25}`).sort();
    }
    const JDS = [
      'Requirements\n- 5+ years with Python and SQL\n- Machine\nLearning in production\n- C++\nC# and .NET\nNice to have\n- Go is a plus\n- Kubernetes',
      'About us\nWe use Node.js\nReact and TypeScript.\nWhat you bring\n- AWS (S3, Glue)\n- Terraform\n- Data modeling\nBonus\n- Spark\n- Spark\n- Spark\n- Spark',
      'Responsibilities\nBuild pipelines with Airflow, dbt and Snowflake.\nQualifications\nPython\nSQL\nKafka is preferred.\nExperience with Machine Learning.\n' + 'We value communication and ownership. '.repeat(30),
      'Senior Data Engineer\nYou will work with Go, JS and ML teams.\nMust have\n- Java\n- Scala\n- Apache Spark\nPreferred qualifications\n- Flink\n- Databricks\n- Delta Lake',
      'Plain text with no headings at all. Python, SQL, AWS, GCP and Azure; Docker and Kubernetes; CI/CD; Git.\nMore lines.\nNode.js\n.NET Core\nC++',
    ];
    const profile = { skills: [{ name: 'Python' }, { name: 'SQL' }, { name: 'Snowflake' }, { name: 'MyInternalTool' }] };
    it('same skills, weights and score on varied job descriptions', () => {
      for (const jdText of JDS) {
        const a = M().analyze({ jdText, profile });
        const got = [...a.matched, ...a.missing].map((x) => `${x.skill}=${x.weight}`).sort();
        eq(got, lineByLine(jdText, ['Python', 'SQL', 'Snowflake', 'MyInternalTool']), jdText.slice(0, 40));
      }
    });
    it('a skill split over two lines is not joined ("Machine" / "Learning")', () => {
      const a = M().analyze({ jdText: 'Requirements\n- Machine\nLearning teams', profile: { skills: [] } });
      ok(![...a.matched, ...a.missing].some((x) => x.skill === 'Machine Learning'));
    });
    it('a job description scanned for 3 career tracks gives the same result each time (remembered scan)', () => {
      const jdText = JDS[2];
      const runs = [1, 2, 3].map(() => M().analyze({ jdText, profile }));
      eq(runs.map((r) => r.score), [runs[0].score, runs[0].score, runs[0].score]);
      eq(runs[2].missing.map((x) => x.skill), runs[0].missing.map((x) => x.skill));
    });
  });

  describe('perf › small cleanups keep the same answers (B68)', () => {
    it('learned answers: a close question still matches; a new answers list sees its new answers', () => {
      const answers = { [AJP.normKey('Are you willing to work night shifts?')]: { label: 'Are you willing to work night shifts?', value: 'No' } };
      eq(AJP.filler.findLearned(answers, 'Are you willing to work the night shifts').value, 'No');
      eq(AJP.filler.findLearned(answers, 'Do you have a car for commuting'), null);
      const more = { ...answers, [AJP.normKey('Do you have a car for commuting?')]: { label: 'Do you have a car for commuting?', value: 'Yes' } };
      eq(AJP.filler.findLearned(more, 'Do you have a car for commuting').value, 'Yes');
    });
    it('Applications stats: weekly counts are unchanged', () => {
      const now = Date.parse('2026-11-27T12:00:00Z');
      const day = 86400000;
      const apps = [1, 2, 8, 9, 10, 30].map((d, i) => ({ id: 'a' + i, status: 'applied', appliedAt: new Date(now - d * day).toISOString() }));
      const s = AJP.tracker.stats(apps, now, 8);
      // The old way: every application's date read again for each week.
      const old = [];
      for (let w = 7; w >= 0; w--) {
        const end = now - w * 7 * day;
        old.push(apps.filter((a) => Date.parse(a.appliedAt) > end - 7 * day && Date.parse(a.appliedAt) <= end).length);
      }
      eq(s.perWeek.map((w) => w.count), old);
      eq(old, [0, 0, 0, 1, 0, 0, 3, 2]);
      eq(s.thisWeek, 2);
    });
  });

  describe('perf › Job Radar saves companies in batches', () => {
    const N = 23;
    const res = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
    let realFetch;
    let saved;
    let writes;
    let realSet;
    beforeEach(async () => {
      await mock.__reset();
      realFetch = globalThis.fetch;
      saved = { ...AJP.radar.scan.CONFIG };
      Object.assign(AJP.radar.scan.CONFIG, { hostGapMs: 0, retryWaitMaxMs: 5 });
      globalThis.fetch = async (url) => {
        const m = String(url).match(/boards\/(co\d+)\/jobs(\/\d+)?/);
        if (m && m[2]) return res({ content: '&lt;p&gt;Python, SQL and Airflow.&lt;/p&gt;' });
        return res({ jobs: ['Data Engineer', 'Office Manager'].map((title, i) => ({ id: i + 1, title, location: { name: 'Remote' }, absolute_url: `https://boards.greenhouse.io/${m[1]}/jobs/${i + 1}`, content: '&lt;p&gt;Python, SQL and Airflow.&lt;/p&gt;' })) });
      };
      const p = AJP.clone(AJP.store.DEFAULTS.profile);
      Object.assign(p, { targetRoles: ['Data Engineer'], skills: [{ name: 'Python' }, { name: 'SQL' }, { name: 'Airflow' }], workTypes: { remote: true, hybrid: true, onsite: true } });
      await AJP.store.set('profile', p);
      await AJP.store.update('radarSettings', (s) => void (s.directory = false));
      await AJP.store.set('radarWatchlist', Array.from({ length: N }, (_, c) => ({ key: 'greenhouse:co' + c, board: 'greenhouse', company: 'co' + c, companyName: 'Co ' + c })));
      writes = {};
      realSet = AJP.store.set;
      AJP.store.set = function (k, v) {
        writes[k] = (writes[k] || 0) + 1;
        return realSet.call(this, k, v);
      };
    });
    afterEach(() => {
      AJP.store.set = realSet;
      globalThis.fetch = realFetch;
      Object.assign(AJP.radar.scan.CONFIG, saved);
    });
    it('every company is saved, with the big lists written once per 10 companies (not once per company)', async () => {
      const s = await AJP.radar.scan.run({ force: true });
      eq(s.companies, N);
      const jobs = await AJP.store.get('radarJobs');
      eq(jobs.filter((j) => j.title === 'Data Engineer').length, N, 'one listed job per company');
      eq((await AJP.store.get('radarFiltered')).filter((j) => j.title === 'Office Manager').length, N);
      eq(Object.keys(await AJP.store.get('radarSeen')).length, 2 * N);
      // 23 companies → saves after 10, 20 and at the end (3), + the clean-up at the end of the scan (1).
      eq(writes.radarJobs, 4);
      eq(writes.radarSeen, 4);
      ok(writes.radarWatchlist >= N, 'each company row is still saved at once');
      eq((await AJP.store.get('radarScanState')).done, [], 'a finished scan clears its done list');
    });
    it('a company counts as done only once its jobs are saved', async () => {
      Object.assign(AJP.radar.scan.CONFIG, { saveEvery: 100 });
      let doneEarly = null;
      const realUpdate = AJP.store.update;
      AJP.store.update = async function (k, fn) {
        if (k === 'radarWatchlist' && doneEarly === null) doneEarly = ((await AJP.store.get('radarScanState')).done || []).length;
        return realUpdate.call(this, k, fn);
      };
      try {
        await AJP.radar.scan.run({ force: true });
      } finally {
        AJP.store.update = realUpdate;
      }
      eq(doneEarly, 0, 'nothing marked done before the batch was saved');
      eq((await AJP.store.get('radarJobs')).length, N);
    });
  }, { env: 'browser' });
})();
