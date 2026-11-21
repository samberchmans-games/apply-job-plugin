/*
 * Job Radar built-in company directory: the generated list is valid; scans cover it in rotation (slice per interval),
 * skipping your own companies, hidden ones, boards not allowed and companies that keep failing; a download budget;
 * Greenhouse light lists with details only for the jobs that fit; hide a company.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;

  describe('radar directory › the generated list', () => {
    const real = () => globalThis.RADAR_REAL_DIRECTORY || [];
    it('hundreds of companies, each on a supported board, no duplicates', () => {
      ok(real().length >= 300, String(real().length));
      ok(real().every(([b, c, n]) => AJP.radar.boards.get(b) && c && n), 'every board known');
      eq(new Set(real().map(([b, c]) => b + ':' + c)).size, real().length);
    });
  });

  const mock = globalThis.browser;
  const res = (body, status = 200) => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const light = (company, titles) => ({ jobs: titles.map((t, i) => ({ id: i + 1, title: t, company_name: company, location: { name: 'Remote' }, absolute_url: `https://boards.greenhouse.io/${company}/jobs/${i + 1}`, first_published: '2026-11-21T08:00:00Z' })) });
  let calls;
  let realFetch;
  const saved = {};
  const FAKE = [['greenhouse', 'a', 'A Co'], ['greenhouse', 'b', 'B Co'], ['greenhouse', 'c', 'C Co'], ['lever', 'd', 'D Co'], ['greenhouse', 'e', 'E Co']];
  function net(extra = []) {
    calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      for (const [re, r] of extra) if (re.test(url)) return typeof r === 'function' ? r(url) : r;
      const m = String(url).match(/boards\/(\w+)\/jobs(\/\d+)?/);
      if (m && m[2]) return res({ content: '&lt;p&gt;Python SQL Airflow&lt;/p&gt;' });
      if (m) return res(light(m[1].toUpperCase() + ' Co', ['Data Engineer', 'Office Manager']));
      return res({}, 404);
    };
  }
  async function seed() {
    await mock.__reset();
    realFetch = globalThis.fetch;
    Object.assign(saved, AJP.radar.scan.CONFIG);
    Object.assign(AJP.radar.scan.CONFIG, { hostGapMs: 0, directoryMinPerScan: 2, retryWaitMaxMs: 5 });
    AJP.radar.directory = FAKE.map((r) => r.slice());
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p, { targetRoles: ['Data Engineer'], skills: [{ name: 'Python' }], workTypes: { remote: true, hybrid: true, onsite: true } });
    await AJP.store.set('profile', p);
  }
  function restore() {
    globalThis.fetch = realFetch;
    Object.assign(AJP.radar.scan.CONFIG, saved);
    AJP.radar.directory = [];
  }
  const scanned = () => [...new Set(calls.map((u) => (u.match(/boards\/(\w+)\/jobs\?/) || [])[1]).filter(Boolean))];

  describe('radar directory › rotation', () => {
    beforeEach(seed);
    afterEach(restore);
    it('on by default: each scan takes the next slice; jobs that fit are kept, with descriptions from the detail call', async () => {
      net();
      const s1 = await AJP.radar.scan.run({ force: true });
      eq([s1.directory, scanned()], [2, ['a', 'b']]);
      const jobs = await AJP.store.get('radarJobs');
      eq(jobs.map((j) => j.title), ['Data Engineer', 'Data Engineer'], 'Office Manager filtered out');
      ok(jobs.every((j) => j.descriptionLevel === 'full' && /Python/.test(j.description)), 'details fetched for the matches');
      eq(calls.filter((u) => /jobs\/\d+$/.test(u)).length, 2, 'one detail per matching job, none for filtered ones');
      net();
      await AJP.radar.scan.run({ force: true });
      eq(scanned(), ['c'], 'next slice: C, then D (Lever) which this fake answers 404, quietly');
      ok(calls.some((u) => /api\.lever\.co\/v0\/postings\/d/.test(u)));
    });
    it('not due yet: no directory slice until the interval has passed', async () => {
      net();
      await AJP.radar.scan.run({});
      net();
      const s = await AJP.radar.scan.run({});
      eq(s.directory, 0);
    });
    it('skips your own companies, hidden companies and boards the browser does not allow', async () => {
      await AJP.store.set('radarWatchlist', [{ key: 'greenhouse:a', board: 'greenhouse', company: 'a', companyName: 'A Co', paused: true }]);
      await AJP.store.update('radarSettings', (s) => void (s.excluded = ['greenhouse:b']));
      net();
      await AJP.radar.scan.run({ force: true, allowedBoards: new Set(['greenhouse']) });
      eq(scanned(), ['c', 'e']);
    });
    it('a directory company failing 3 scans in a row is skipped (quietly: no error in the summary)', async () => {
      AJP.radar.directory = [['greenhouse', 'dead', 'Dead Co'], ['greenhouse', 'a', 'A Co']];
      AJP.radar.scan.CONFIG.directoryMinPerScan = 2;
      net([[/boards\/dead\//, res({}, 404)]]);
      for (let i = 0; i < 3; i++) {
        const s = await AJP.radar.scan.run({ force: true });
        eq(s.errors, [], 'quiet');
      }
      net([[/boards\/dead\//, res({}, 404)]]);
      await AJP.radar.scan.run({ force: true });
      eq(scanned(), ['a']);
    });
    it('download budget: once used, the rest of the slice waits for the next scan', async () => {
      AJP.radar.scan.CONFIG.directoryMinPerScan = 5;
      AJP.radar.scan.CONFIG.bytesPerScan = 10;
      AJP.radar.scan.CONFIG.concurrency = 1;
      net();
      await AJP.radar.scan.run({ force: true, allowedBoards: new Set(['greenhouse']) });
      eq(scanned().length, 1);
    });
    it('turned off in settings → no directory companies are scanned', async () => {
      await AJP.store.update('radarSettings', (s) => void (s.directory = false));
      net();
      const s = await AJP.radar.scan.run({ force: true });
      eq([s.directory, calls.length], [0, 0]);
    });
  }, { env: 'browser' });

  describe('radar directory › messages', () => {
    beforeEach(seed);
    afterEach(restore);
    it('radar.directory: size per board, boards allowed, hidden count', async () => {
      mock.__granted.add('https://boards-api.greenhouse.io/*');
      const r = await AJP.send('radar.directory');
      eq([r.on, r.total, r.byBoard, r.allowed], [true, 5, { greenhouse: 4, lever: 1 }, ['greenhouse']]);
    });
    it('hide a company: its new jobs go and the directory never scans it again; unhide brings it back', async () => {
      mock.__granted.add('https://boards-api.greenhouse.io/*');
      net();
      await AJP.send('radar.scanNow', {});
      const before = (await AJP.store.get('radarJobs')).length;
      ok(before >= 1);
      await AJP.send('radar.company.hide', { board: 'greenhouse', company: 'a' });
      notOk((await AJP.store.get('radarJobs')).some((j) => j.company === 'a'));
      eq((await AJP.store.get('radarSettings')).excluded, ['greenhouse:a']);
      eq((await AJP.send('radar.directory')).hidden, 1);
      await AJP.send('radar.company.unhide', { key: 'greenhouse:a' });
      eq((await AJP.store.get('radarSettings')).excluded, []);
    });
    it('the background scans the directory only on boards the browser allows', async () => {
      net();
      await AJP.send('radar.scanNow', {});
      eq(calls.length, 0, 'no board allowed yet');
      mock.__granted.add('https://boards-api.greenhouse.io/*');
      net();
      await AJP.send('radar.scanNow', {});
      ok(scanned().length >= 1 && calls.every((u) => /greenhouse/.test(u)));
    });
  }, { env: 'browser' });
})();
