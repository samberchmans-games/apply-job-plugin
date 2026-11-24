/*
 * Job Radar ↔ Applications (B63): an Applied button on each job; jobs you applied to elsewhere (job page, detected
 * submission, Applications) move to Applied by themselves; a similar job at the same company is flagged.
 */
(function () {
  const { describe, it, eq, ok, notOk, beforeEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;
  const job = (id, title, extra = {}) => ({ key: `greenhouse:acme:${id}`, board: 'greenhouse', company: 'acme', companyName: 'Acme Corp', title, url: `https://boards.greenhouse.io/acme/jobs/${id}`, locations: ['Remote'], status: 'new', score: 80, description: 'Build pipelines.', foundAt: '2026-11-20T00:00:00Z', ...extra });
  const jobs = () => AJP.store.get('radarJobs');
  const byKey = async (k) => (await jobs()).find((j) => j.key === k);

  describe('radar applied', () => {
    beforeEach(async () => {
      await mock.__reset();
      await AJP.store.set('radarScanState', { rulesVersion: AJP.radar.core.RULES_VERSION });
      await AJP.store.set('radarJobs', [job(1, 'Senior Data Engineer'), job(2, 'Data Engineer, Platform'), job(3, 'Analytics Engineer')]);
    });
    it('Applied on a job: it moves to Applied and is recorded in Applications as applied', async () => {
      const r = await AJP.send('radar.job.update', { key: 'greenhouse:acme:1', status: 'applied' });
      eq(r.app.status, 'applied');
      const j = await byKey('greenhouse:acme:1');
      eq(j.status, 'applied');
      ok(j.appliedAt);
      const apps = await AJP.store.get('applications');
      eq(apps.length, 1);
      eq([apps[0].title, apps[0].source], ['Senior Data Engineer', 'Job Radar']);
      eq((await AJP.send('radar.jobs', { status: 'applied' })).jobs.map((x) => x.key), ['greenhouse:acme:1']);
    });
    it('applied somewhere else (job page, Applications): the listed job moves to Applied by itself', async () => {
      await AJP.store.set('applications', [{ id: 'a1', url: 'https://boards.greenhouse.io/acme/jobs/2?gh_src=x', company: 'Acme Corp', title: 'Data Engineer, Platform', status: 'applied', appliedAt: '2026-11-22T10:00:00Z' }]);
      await AJP.radarSyncApplied();
      const j = await byKey('greenhouse:acme:2');
      eq([j.status, j.appliedAt, j.appliedAuto], ['applied', '2026-11-22T10:00:00Z', true]);
      eq((await byKey('greenhouse:acme:3')).status, 'new', 'other jobs untouched');
    });
    it('a similar job at the same company is flagged, not moved (it may be another opening)', async () => {
      await AJP.store.set('applications', [{ id: 'a1', url: 'https://acme.example.com/careers/99', company: 'Acme Corp', title: 'Senior Data Engineer', status: 'interviewing', appliedAt: '2026-11-01T10:00:00Z' }]);
      await AJP.radarSyncApplied();
      const j = await byKey('greenhouse:acme:1');
      eq(j.status, 'new');
      eq(j.appliedSimilar.title, 'Senior Data Engineer');
      notOk((await byKey('greenhouse:acme:3')).appliedSimilar);
    });
    it('only sent applications count ("in progress" is not applied)', async () => {
      await AJP.store.set('applications', [{ id: 'a1', url: 'https://boards.greenhouse.io/acme/jobs/2', company: 'Acme Corp', title: 'Data Engineer, Platform', status: 'in progress' }]);
      await AJP.radarSyncApplied();
      eq((await byKey('greenhouse:acme:2')).status, 'new');
    });
    it('"Not applied" moves it back to New and it stays there', async () => {
      await AJP.send('radar.job.update', { key: 'greenhouse:acme:1', status: 'applied' });
      await AJP.send('radar.job.update', { key: 'greenhouse:acme:1', status: 'new' });
      await AJP.radarSyncApplied();
      const j = await byKey('greenhouse:acme:1');
      eq([j.status, j.keepOpen], ['new', true]);
    });
    it('Mark applied on the job page: the listed job follows without a click in Job Radar', async () => {
      await AJP.send('recordApplication', { app: { url: 'https://boards.greenhouse.io/acme/jobs/3', company: 'Acme Corp', title: 'Analytics Engineer', status: 'applied' } });
      await waitFor(async () => (await byKey('greenhouse:acme:3')).status === 'applied', { msg: 'synced', timeout: 3000 });
    });
  }, { env: 'browser' });
})();
