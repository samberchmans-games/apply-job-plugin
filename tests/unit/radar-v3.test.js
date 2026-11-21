/*
 * Job Radar: stricter title rule, remote jobs limited to other countries, no score without a description (and the
 * description backfill), track locations, re-checking the list when preferences change, Stop and Restart.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const C = AJP.radar.core;
  const job = (o = {}) => C.normalize({ id: o.id || 1, title: 'Senior Data Engineer', locations: ['Austin, TX'], ...o }, { board: 'greenhouse', company: 'acme' });

  describe('radar v3 › title rule: most words of a target title', () => {
    const fits = (t, titles) => C.titleFits(t, titles);
    it('"Data Engineer" fits Data Engineer jobs, not every engineer', () => {
      ok(fits('Senior Data Engineer II', ['Data Engineer']));
      ok(fits('Data Platform Engineer', ['Data Engineer']));
      ok(fits('Staff Data Engineering Lead', ['Data Engineer']), 'engineer ~ engineering');
      notOk(fits('Senior Software Engineer, Backend', ['Data Engineer']));
      notOk(fits('Manager, Machine Learning Engineering', ['Data Engineer', 'Data Architect']));
      notOk(fits('Temporary Publicity Coordinator', ['Data Engineer']));
    });
    it('3-word titles need 2 of 3; "Sr" = "Senior"', () => {
      ok(fits('Principal Solutions Architect', ['Cloud Solutions Architect']));
      notOk(fits('Cloud Support Engineer', ['Cloud Solutions Architect']));
      ok(fits('Sr. Data Architect', ['Senior Data Architect']));
    });
  });

  describe('radar v3 › remote jobs limited to another country', () => {
    const p = { targetRoles: ['Data Engineer'], areas: ['Austin, TX'], workTypes: { remote: true, hybrid: true, onsite: true }, tracks: [] };
    it('"Remote Canada" does not fit a US search; "Remote US" and plain "Remote" do', () => {
      eq(C.quickFilter(job({ locations: ['Remote Canada'], raw: { workplaceType: 'remote' } }), {}, p).reason, 'location');
      ok(C.quickFilter(job({ locations: ['Remote US'], raw: { workplaceType: 'remote' } }), {}, p).pass);
      ok(C.quickFilter(job({ locations: ['Remote'], raw: { workplaceType: 'remote' } }), {}, p).pass);
      eq(C.quickFilter(job({ locations: ['Remote - EMEA'], raw: { workplaceType: 'remote' } }), {}, p).reason, 'location');
    });
    it('places without a country say nothing about it: remote jobs anywhere pass', () => {
      ok(C.quickFilter(job({ locations: ['Remote Canada'], raw: { workplaceType: 'remote' } }), {}, { ...p, areas: ['Remote'] }).pass);
      ok(C.quickFilter(job({ locations: ['Remote Canada'], raw: { workplaceType: 'remote' } }), {}, { ...p, areas: ['Toronto, Canada'] }).pass);
    });
  });

  describe('radar v3 › career track locations', () => {
    it('kept when tracks are saved; used by the filter', () => {
      const n = AJP.tracks.normalize([{ id: 't', name: 'Data', targetTitles: ['Data Engineer'], areas: 'Seattle, WA; Remote - US' }]);
      eq(n[0].areas, ['Seattle, WA', 'Remote - US']);
      const p = { targetRoles: [], areas: ['Austin, TX'], workTypes: {}, tracks: n };
      eq(C.quickFilter(job(), {}, p).reason, 'location');
      ok(C.quickFilter(job({ locations: ['Seattle, Washington'] }), {}, p).pass);
    });
  });

  // ---- browser: scoring, backfill, re-check, Stop, Restart ----------------------------------------------
  const mock = globalThis.browser;
  const res = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  const list = (titles) => ({ jobs: titles.map((t, i) => ({ id: 100 + i, title: t, company_name: 'Acme', location: { name: 'Austin, TX' }, absolute_url: `https://boards.greenhouse.io/acme/jobs/${100 + i}`, first_published: '2026-11-21T08:00:00Z' })) });
  let realFetch;
  const saved = {};
  async function seed(profileExtra = {}) {
    await mock.__reset();
    realFetch = globalThis.fetch;
    Object.assign(saved, AJP.radar.scan.CONFIG);
    Object.assign(AJP.radar.scan.CONFIG, { hostGapMs: 0, retryWaitMaxMs: 5 });
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p, { targetRoles: ['Data Engineer'], areas: ['Austin, TX'], skills: [{ name: 'Python' }, { name: 'SQL' }], workTypes: { remote: true, hybrid: true, onsite: true }, ...profileExtra });
    await AJP.store.set('profile', p);
    await AJP.store.update('radarSettings', (s) => void (s.threshold = 1));
    mock.__granted.add('https://boards-api.greenhouse.io/*');
    await AJP.store.set('radarWatchlist', [{ key: 'greenhouse:acme', board: 'greenhouse', company: 'acme', companyName: 'Acme', paused: false, failuresInRow: 0 }]);
  }
  const restore = () => {
    globalThis.fetch = realFetch;
    Object.assign(AJP.radar.scan.CONFIG, saved);
  };

  describe('radar v3 › scores: the same numbers as the job page, none without a description', () => {
    beforeEach(() => seed());
    afterEach(restore);
    it('a job with a description: score + "N of M skills"; title-only jobs: no score, never alerted', async () => {
      AJP.radar.scan.CONFIG.detailPerCompany = 1;
      AJP.radar.scan.CONFIG.backfillPerScan = 0;
      globalThis.fetch = async (url) => (/jobs\/\d+$/.test(url) ? res({ content: '&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;li&gt;Kafka&lt;/li&gt;&lt;li&gt;Spark&lt;/li&gt;&lt;/ul&gt;' }) : res(list(['Data Engineer', 'Senior Data Engineer'])));
      const s = (await AJP.send('radar.scanNow', {})).summary;
      const jobs = (await AJP.send('radar.jobs', {})).jobs;
      const full = jobs.find((j) => j.descriptionLevel === 'full');
      const bare = jobs.find((j) => j.descriptionLevel === 'title');
      eq([full.skillsMatched, full.skillsTotal], [2, 4]);
      ok(full.score > 0 && full.score < 100, String(full.score));
      eq(bare.score, null);
      eq(s.matches.length, 1, 'the unscored job is not a match');
      eq(jobs[0].key, full.key, 'unscored jobs sort last');
    });
    it('backfill: a listed title-only job gets its description and a real score on a later scan', async () => {
      AJP.radar.scan.CONFIG.detailPerCompany = 0;
      AJP.radar.scan.CONFIG.backfillPerScan = 0;
      globalThis.fetch = async (url) => (/jobs\/\d+$/.test(url) ? res({ content: '&lt;p&gt;Python SQL Kafka&lt;/p&gt;' }) : res(list(['Data Engineer'])));
      await AJP.send('radar.scanNow', {});
      eq((await AJP.send('radar.jobs', {})).jobs[0].score, null);
      AJP.radar.scan.CONFIG.backfillPerScan = 20;
      const s = (await AJP.send('radar.scanNow', {})).summary;
      eq(s.backfilled, 1);
      const j = (await AJP.send('radar.jobs', {})).jobs[0];
      eq([j.descriptionLevel, j.skillsTotal], ['full', 3]);
      ok(j.score > 0);
    });
  }, { env: 'browser' });

  describe('radar v3 › preferences change → the list is re-checked; Stop; Restart', () => {
    beforeEach(() => seed());
    afterEach(restore);
    it('changing a track’s titles removes listed jobs that no longer fit and offers Restart', async () => {
      globalThis.fetch = async (url) => (/jobs\/\d+$/.test(url) ? res({ content: 'Python' }) : res(list(['Data Engineer', 'Senior Data Engineer'])));
      await AJP.send('radar.scanNow', {});
      eq((await AJP.send('radar.jobs', {})).jobs.length, 2);
      await AJP.store.update('profile', (p) => void (p.tracks = [{ id: 't', name: 'Cloud', targetTitles: ['Cloud Architect'], skills: [] }]));
      await waitFor(async () => (await AJP.send('radar.jobs', {})).jobs.length === 0, { msg: 're-checked', timeout: 4000 });
      ok((await AJP.send('radar.status')).prefsChangedAt);
    });
    it('Stop: the running scan ends after the request in flight; nothing resumes', async () => {
      await AJP.store.set('radarWatchlist', ['a', 'b', 'c', 'd'].map((c) => ({ key: 'greenhouse:' + c, board: 'greenhouse', company: c, companyName: c, paused: false, failuresInRow: 0 })));
      AJP.radar.scan.CONFIG.concurrency = 1;
      let release;
      const gate = new Promise((r) => (release = r));
      let n = 0;
      globalThis.fetch = async () => (n++ === 0 ? (await gate, res(list([]))) : res(list([])));
      const running = AJP.send('radar.scanNow', {});
      await waitFor(async () => (await AJP.send('radar.status')).running, { msg: 'running' });
      const stopping = AJP.send('radar.stop');
      release();
      await stopping;
      const s = (await running).summary;
      ok(s.cancelled && s.companies <= 1, JSON.stringify(s));
      eq((await AJP.store.get('radarScanState')).queue, []);
      eq((await AJP.send('radar.status')).running, false);
    });
    it('Restart: forgets which jobs were seen and scans again with the current preferences', async () => {
      globalThis.fetch = async (url) => (/jobs\/\d+$/.test(url) ? res({ content: 'Python' }) : res(list(['Data Engineer', 'Lead Data Engineer'])));
      await AJP.send('radar.scanNow', {});
      await AJP.send('radar.job.update', { key: (await AJP.send('radar.jobs', {})).jobs[0].key, status: 'dismissed' });
      await AJP.store.update('radarJobs', (l) => l.filter((j) => j.status === 'dismissed')); // e.g. removed by an earlier re-check
      const r = await AJP.send('radar.restart');
      ok(r.restarted);
      await waitFor(async () => (await AJP.send('radar.jobs', {})).jobs.length === 1, { msg: 'the other job is back', timeout: 4000 });
      eq((await AJP.send('radar.jobs', { status: 'dismissed' })).jobs.length, 1, 'dismissed stays dismissed');
    });
  }, { env: 'browser' });
})();
