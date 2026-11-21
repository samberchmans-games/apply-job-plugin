/*
 * Job Radar relevance (your report): "Data Center Power Generation and Microgrids Engineer" and "Security Data
 * Engineer" (physical security of data center sites) were listed for Data Architect / Senior Data Engineer. A job's
 * title must fit, AND its description must share at least 2 of your technical skills (soft skills don't count).
 */
(function () {
  const { describe, it, eq, ok, notOk, beforeEach, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const C = AJP.radar.core;
  const FX = () => globalThis.RADAR_FIXTURES.relevance;
  const SKILLS = ['Python', 'SQL', 'AWS', 'Snowflake', 'Spark', 'Airflow', 'Kafka', 'ETL', 'Data modeling', 'Databricks', 'dbt', 'Tableau', 'Communication', 'Leadership'].map((name) => ({ name }));
  const profile = () => ({ skills: SKILLS, targetRoles: [], areas: [], workTypes: {}, tracks: [{ id: 'a', name: 'Data', targetTitles: ['Data Architect'] }, { id: 'b', name: 'Engineer', targetTitles: ['Senior Data Engineer'] }] });
  const asJob = (d) => C.normalize({ id: d.id, title: d.title, description: C.htmlToText(d.content), locations: [d.location.name] }, { board: 'greenhouse', company: 'x' });
  const listed = (d) => {
    const j = asJob(d);
    if (!C.quickFilter(j, {}, profile()).pass) return false;
    return C.relevant({ ...j, ...AJP.radar.scan.score(j, profile(), { items: [] }) }, profile());
  };

  describe('radar relevance › the reported jobs', () => {
    it('"Data Center Power Generation and Microgrids Engineer": "data center" is a facility, not data work', () => {
      notOk(C.titleFits(FX().dataCenter.title, ['Senior Data Engineer', 'Data Architect']));
      notOk(listed(FX().dataCenter));
    });
    it('"Security Data Engineer": the title fits, but the description shares 1 technical skill → left out', () => {
      ok(C.titleFits(FX().securityData.title, ['Senior Data Engineer']));
      const j = asJob(FX().securityData);
      eq(AJP.radar.scan.score(j, profile(), { items: [] }).techMatched, 1);
      notOk(listed(FX().securityData));
    });
    it('a genuine data engineering job is kept (4 technical skills in common)', () => {
      ok(AJP.radar.scan.score(asJob(FX().realData), profile(), { items: [] }).techMatched >= 2);
      ok(listed(FX().realData));
    });
    it('soft skills (communication, leadership…) never make a job relevant; "data entry" is not data work', () => {
      eq(C.techMatches({ matched: [{ skill: 'Communication' }, { skill: 'Leadership' }, { skill: 'Stakeholder management' }] }), 0);
      notOk(C.titleFits('Data Entry Specialist', ['Data Engineer', 'Data Analyst', 'Data Specialist']));
    });
    it('title-only jobs wait for their description; a profile without technical skills skips the check', () => {
      ok(C.relevant({ descriptionLevel: 'title', techMatched: null }, profile()));
      ok(C.relevant({ descriptionLevel: 'full', techMatched: 0 }, { skills: [{ name: 'Communication' }] }));
      notOk(C.relevant({ descriptionLevel: 'full', techMatched: 1 }, profile()));
    });
  });

  // ---- scan / backfill / re-check drop irrelevant jobs (browser) --------------------------------------------
  const mock = globalThis.browser;
  const res = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  let realFetch;
  const saved = {};
  async function seed() {
    await mock.__reset();
    realFetch = globalThis.fetch;
    Object.assign(saved, AJP.radar.scan.CONFIG);
    Object.assign(AJP.radar.scan.CONFIG, { hostGapMs: 0 });
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p, profile(), { workTypes: { remote: true, hybrid: true, onsite: true } });
    await AJP.store.set('profile', p);
    mock.__granted.add('https://boards-api.greenhouse.io/*');
    await AJP.store.set('radarWatchlist', [{ key: 'greenhouse:initech', board: 'greenhouse', company: 'initech', companyName: 'Initech', paused: false, failuresInRow: 0 }]);
  }
  const net = () =>
    (globalThis.fetch = async (url) => {
      const all = [FX().dataCenter, FX().securityData, FX().realData];
      const m = String(url).match(/jobs\/(\d+)$/);
      if (m) return res(all.find((d) => String(d.id) === m[1]));
      return res({ jobs: all.map((d) => ({ id: d.id, title: d.title, location: d.location, absolute_url: `https://boards.greenhouse.io/initech/jobs/${d.id}`, company_name: 'Initech' })) });
    });
  describe('radar relevance › scans', () => {
    beforeEach(seed);
    afterEach(() => {
      globalThis.fetch = realFetch;
      Object.assign(AJP.radar.scan.CONFIG, saved);
    });
    it('a scan of a board with all three lists only the genuine data job', async () => {
      net();
      await AJP.send('radar.scanNow', {});
      eq((await AJP.send('radar.jobs', {})).jobs.map((j) => j.title), [FX().realData.title]);
    });
    it('jobs listed before this rule are removed by the one-time re-check', async () => {
      const pre = [FX().securityData, FX().realData].map((d) => ({ ...asJob(d), status: 'new', foundAt: new Date().toISOString(), score: 50 }));
      await AJP.store.set('radarJobs', pre);
      const r = await AJP.radarRefilter();
      eq(r.removed, 1);
      eq((await AJP.store.get('radarJobs')).map((j) => j.title), [FX().realData.title]);
    });
  }, { env: 'browser' });
})();
