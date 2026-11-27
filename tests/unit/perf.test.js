/*
 * Performance changes (B66–B68) keep the same results: Job Radar saves several companies at once; (more below).
 * Speed itself is measured with tests/run-bench.sh, not here.
 */
(function () {
  const { describe, it, eq, ok, beforeEach, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;

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
