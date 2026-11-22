/*
 * Jobs on a company's own careers site: access is asked for that one site, and the assistant runs in that section only.
 */
(function () {
  const { describe, it, eq, ok, notOk, beforeEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const D = AJP.radar.detect;
  const URL1 = 'https://www.example-co.com/careers/jr1/data-engineer?gh_jid=1';

  describe('company career sites › scope', () => {
    it('one site, one section', () => {
      eq(D.siteScope(URL1), { origin: 'https://www.example-co.com/*', pattern: 'https://www.example-co.com/careers/*' });
      eq(D.siteScope('https://jobs.example-co.com/123').pattern, 'https://jobs.example-co.com/*');
    });
    it('only https links', () => {
      eq(D.siteScope('http://example-co.com/careers/1'), null);
      eq(D.siteScope('not a url'), null);
    });
    it('inside the section only', () => {
      const p = ['https://www.example-co.com/careers/*'];
      ok(D.inScope(URL1, p));
      notOk(D.inScope('https://www.example-co.com/pricing', p));
      notOk(D.inScope('https://www.example-co.com.evil.test/careers/1', p));
    });
    it('job sites already in the manifest need no extra access', () => {
      const m = ['*://*.greenhouse.io/*'];
      ok(D.declaredSite('https://job-boards.greenhouse.io/x/jobs/1', m));
      notOk(D.declaredSite(URL1, m));
      notOk(D.declaredSite('https://greenhouse.io.evil.test/x', m));
    });
  });

  describe('company career sites › background', () => {
    const mock = globalThis.browser;
    beforeEach(async () => {
      await mock.__reset();
      mock.scripting.__registered = [];
    });
    it('allowed: registers that section and opens the job', async () => {
      mock.__granted.add('https://www.example-co.com/*');
      const r = await AJP.send('radar.job.open', { url: URL1 });
      eq(r.panel, true);
      eq(mock.scripting.__registered.map((x) => x.matches), [['https://www.example-co.com/careers/*']]);
      ok(mock.scripting.__registered[0].js.includes('src/lib/radar-detect.js'), 'the panel needs it');
      eq(await AJP.store.get('radarSites'), ['https://www.example-co.com/careers/*']);
    });
    it('opening a second job there adds nothing', async () => {
      mock.__granted.add('https://www.example-co.com/*');
      await AJP.send('radar.job.open', { url: URL1 });
      await AJP.send('radar.job.open', { url: 'https://www.example-co.com/careers/jr2/analyst' });
      eq(mock.scripting.__registered.length, 1);
    });
    it('refused: the job still opens, without the assistant', async () => {
      const r = await AJP.send('radar.job.open', { url: URL1 });
      eq(r.panel, false);
      eq(mock.scripting.__registered, []);
      eq(await AJP.store.get('radarSites'), []);
    });
    it('a non-https link is refused', async () => eq((await AJP.send('radar.job.open', { url: 'http://x.test/a/b' })).ok, false));
  }, { env: 'browser' });
})();
