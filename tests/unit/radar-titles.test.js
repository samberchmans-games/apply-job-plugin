/*
 * Job Radar title search (B60): related titles ("ETL Developer" for "Data Engineer"), other titles kept only when the
 * description strongly matches your skills, and title words you skip.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const C = () => AJP.radar.core;
  const SKILLS = ['Python', 'SQL', 'AWS', 'Snowflake', 'Spark', 'Airflow', 'Kafka', 'dbt', 'Communication'].map((name) => ({ name }));
  const profile = (titles = ['Senior Data Engineer']) => ({ skills: SKILLS, targetRoles: [], areas: [], workTypes: {}, tracks: [{ id: 'a', name: 'Data', targetTitles: titles }] });
  const job = (title, extra = {}) => ({ key: `t:${title}`, title, locations: [], remote: null, ...extra });
  const quick = (title, settings = {}, p = profile()) => C().quickFilter(job(title), settings, p);

  describe('radar titles › related titles', () => {
    it('a data engineering target brings in the other names for the job', () => {
      const rel = C().relatedTitles(['Senior Data Engineer']);
      for (const t of ['ETL Developer', 'Analytics Engineer', 'Big Data Developer', 'DataOps Engineer', 'Databricks Engineer']) includes(rel, t);
      notOk(rel.includes('Data Engineer'), 'your own title is not repeated');
      notOk(rel.includes('Platform Engineer'), 'not another family');
    });
    it('the jobs the old title rule missed now fit as related titles', () => {
      for (const t of ['Analytics Engineer', 'ETL Developer', 'Big Data Developer', 'DataOps Engineer', 'Sr. Databricks Engineer']) {
        const f = quick(t);
        ok(f.pass, t);
        eq(f.titleMatch, 'related', t);
      }
      eq(quick('Senior Data Engineer').titleMatch, 'exact');
    });
    it('a related title needs all its words ("Warehouse Engineer" is not "Data Warehouse Engineer")', () => {
      notOk(C().titleFits('Warehouse Engineer', ['Data Warehouse Engineer'], { all: true }));
      ok(C().titleFits('Senior Data Warehouse Engineer', ['Data Warehouse Engineer'], { all: true }));
      eq(quick('Warehouse Engineer').titleMatch, 'near');
    });
    it('a management target joins only a group with its exact title', () => {
      eq(C().relatedTitles(['Data Engineering Manager']), []);
      includes(C().relatedTitles(['Product Manager']), 'Product Owner');
    });
    it('turned off: only your own titles (and the skills rescue) count', () => {
      eq(quick('ETL Developer', { relatedTitles: false }).reason, 'title');
      eq(quick('Spark Engineer', { relatedTitles: false }).titleMatch, 'near');
      eq(quick('Spark Engineer', { relatedTitles: false, nearTitles: false }).reason, 'title');
    });
    it('no shared word at all is still a different role', () => {
      eq(quick('Account Executive').reason, 'title');
    });
  });

  describe('radar titles › other titles need a strong skill match', () => {
    const near = (extra) => ({ ...job('Spark Engineer'), titleMatch: 'near', descriptionLevel: 'full', score: 72, techMatched: 5, ...extra });
    it('kept with 4+ of your technical skills and a score at your threshold', () => {
      ok(C().postFilter(near(), { threshold: 60 }, profile()).pass);
    });
    it('left out with too few skills, a low score, or no description', () => {
      for (const extra of [{ techMatched: 2 }, { score: 55 }, { descriptionLevel: 'title', score: null }]) {
        const v = C().postFilter(near(extra), { threshold: 60 }, profile());
        notOk(v.pass, JSON.stringify(extra));
        eq(v.reason, 'title');
        ok(/^Other title/.test(v.detail), v.detail);
      }
    });
    it('evaluate passes the kind of title match on (the re-check keeps it)', () => {
      const v = C().evaluate({ ...near(), title: 'Analytics Engineer' }, {}, profile(), {});
      eq(v.titleMatch, 'related');
    });
  });

  describe('radar titles › a scan', () => {
    const mock = globalThis.browser;
    const res = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
    const TITLES = ['Data Engineer', 'Analytics Engineer', 'Streaming Engineer', 'Platform Engineer', 'Office Manager'];
    let realFetch;
    let calls;
    let savedCap;
    beforeEach(async () => {
      await mock.__reset();
      realFetch = globalThis.fetch;
      savedCap = AJP.radar.scan.CONFIG.nearDetailPerCompany;
      Object.assign(AJP.radar.scan.CONFIG, { nearDetailPerCompany: 1 });
      calls = [];
      globalThis.fetch = async (url) => {
        calls.push(String(url));
        const m = String(url).match(/boards\/acme\/jobs(\/\d+)?/);
        if (m && m[1]) return res({ content: '&lt;p&gt;Python, SQL, AWS, Snowflake, Spark, Airflow, Kafka and dbt.&lt;/p&gt;' });
        return res({ jobs: TITLES.map((t, i) => ({ id: i + 1, title: t, location: { name: 'Remote' }, absolute_url: `https://boards.greenhouse.io/acme/jobs/${i + 1}` })) });
      };
      const p = AJP.clone(AJP.store.DEFAULTS.profile);
      Object.assign(p, { targetRoles: ['Data Engineer'], skills: SKILLS, workTypes: { remote: true, hybrid: true, onsite: true } });
      await AJP.store.set('profile', p);
      await AJP.store.update('radarSettings', (s) => void (s.directory = false));
      await AJP.store.set('radarWatchlist', [{ key: 'greenhouse:acme', board: 'greenhouse', company: 'acme', companyName: 'Acme' }]);
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
      AJP.radar.scan.CONFIG.nearDetailPerCompany = savedCap;
    });
    it('related titles are kept; other titles only up to the per-company reading cap, and only with a strong match', async () => {
      await AJP.radar.scan.run({ force: true });
      const jobs = await AJP.store.get('radarJobs');
      const kind = Object.fromEntries(jobs.map((j) => [j.title, j.titleMatch]));
      eq(kind['Data Engineer'], 'exact');
      eq(kind['Analytics Engineer'], 'related');
      eq(jobs.filter((j) => j.titleMatch === 'near').length, 1, 'one other title read (cap 1) and kept for its skills');
      eq(calls.filter((u) => /jobs\/\d+$/.test(u)).length, 3, 'descriptions read: exact, related, one other');
      const filtered = await AJP.store.get('radarFiltered');
      const why = Object.fromEntries(filtered.map((f) => [f.title, f.detail || f.reason]));
      ok(/no description/.test(why['Streaming Engineer'] || why['Platform Engineer']), JSON.stringify(why));
      eq(filtered.find((f) => f.title === 'Office Manager').reason, 'title');
    });
  }, { env: 'browser' });

  describe('radar titles › title words you skip', () => {
    it('a whole word or phrase skips the job, before anything else', () => {
      const f = quick('Sales Engineer, Data Products', { skipTitles: ['Sales'] });
      eq([f.pass, f.reason, f.detail], [false, 'skipped', '"Sales" in the title']);
      ok(quick('Salesforce Data Engineer', { skipTitles: ['Sales'] }).pass, 'not part of a word');
      eq(quick('Data Engineer, Customer Support', { skipTitles: ['customer support'] }).reason, 'skipped');
    });
    it('the reason has a name in Filtered', () => {
      eq(C().FILTER_REASONS.skipped, 'Title words you skip');
    });
  });
})();
