/*
 * Job Radar: core parsing, detection, wave A adapters (against captured fixtures) and the scan engine (fake fetch).
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, beforeEach, afterEach, rejects } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const C = AJP.radar.core;
  const D = AJP.radar.detect;
  const B = AJP.radar.boards;
  const FX = globalThis.RADAR_FIXTURES;

  describe('radar › text parsing (no DOMParser)', () => {
    it('decodes named and numeric entities', () => {
      eq(C.decodeEntities('Tom &amp; Jerry &lt;3 &#39;x&#x27; &nbsp;&euro;5 &bogus;'), "Tom & Jerry <3 'x'  €5 &bogus;".replace(' ', ' '));
    });
    it('HTML → text: lists, paragraphs, line breaks; scripts and styles dropped', () => {
      eq(C.htmlToText('<p>Hello <b>world</b></p><ul><li>One</li><li>Two</li></ul><script>x()</script><style>.a{}</style>Line<br>break'), 'Hello world\n- One\n- Two\nLine\nbreak');
    });
    it('double-encoded HTML (Greenhouse) is decoded first', () => {
      eq(C.htmlToText('&lt;p&gt;We build &amp;amp; ship&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;'), 'We build & ship\n- Python');
    });
    it('XML: items, nested paths, CDATA, namespaced tags, repeated values', () => {
      const xml = '<rss><item><title><![CDATA[Data <b>Engineer</b>]]></title><tt:locations><tt:location><tt:name>Berlin</tt:name></tt:location><tt:location><tt:name>Remote</tt:name></tt:location></tt:locations></item><item><title>Two &amp; Co</title></item></rss>';
      const items = C.xmlItems(xml, 'item');
      eq(items.length, 2);
      eq(C.xmlValue(items[0], 'title'), 'Data <b>Engineer</b>');
      eq(C.xmlValues(items[0], 'locations/location/name'), ['Berlin', 'Remote']);
      eq(C.xmlValue(items[1], 'title'), 'Two & Co');
    });
  });

  describe('radar › dates, salary, remote', () => {
    const NOW = Date.parse('2026-11-21T12:00:00Z');
    it('every date style', () => {
      eq(C.parseDate('2026-07-22T13:38:40-04:00').iso, '2026-07-22T17:38:40.000Z');
      eq(C.parseDate(1786469891368).iso, new Date(1786469891368).toISOString());
      eq(C.parseDate('1786469891368').exact, true);
      eq(C.parseDate('2026-11-01 09:30:00 UTC').iso, '2026-11-01T09:30:00.000Z');
      eq(C.parseDate('Fri, 20 Nov 2026 08:00:00 +0000').iso, '2026-11-20T08:00:00.000Z');
      eq(C.parseDate('Posted Today', NOW), { iso: '2026-11-21T12:00:00.000Z', exact: false });
      eq(C.parseDate('Posted Yesterday', NOW).iso, '2026-11-20T12:00:00.000Z');
      eq(C.parseDate('Posted 3 Days Ago', NOW).iso, '2026-11-18T12:00:00.000Z');
      eq(C.parseDate('Posted 30+ Days Ago', NOW), { iso: '2026-10-22T12:00:00.000Z', exact: false });
      eq([C.parseDate(''), C.parseDate('not a date')], [null, null]);
    });
    it('salary from text: currencies, k suffix, dashes and "to", period; implausible ranges rejected', () => {
      eq(C.salaryFromText('Pay: $120,000 - $150,000 per year'), { min: 120000, max: 150000, currency: 'USD', period: 'year', source: 'text' });
      eq(C.salaryFromText('€60k–€75k').currency, 'EUR');
      eq([C.salaryFromText('€60k–€75k').min, C.salaryFromText('€60k–€75k').max], [60000, 75000]);
      eq(C.salaryFromText('£45 to £55 per hour'), { min: 45, max: 55, currency: 'GBP', period: 'hour', source: 'text' });
      eq(C.salaryFromText('CA$90,000 — CA$110,000').currency, 'CAD');
      eq(C.salaryFromText('$207K – $285K • Offers Equity').max, 285000);
      eq(C.salaryFromText('$50 - $60'), null, 'no period and under 10,000 → not a yearly salary');
      eq(C.salaryFromText('$2,000 - $3,000 an hour'), null);
      eq(C.salaryFromText('no money here'), null);
    });
    it('every remote flag', () => {
      eq(['remote', 'Hybrid', 'on-site', 'ONSITE', 'fully'].map((w) => C.remoteFrom({ workplaceType: w })), ['remote', 'hybrid', 'onsite', 'onsite', 'remote']);
      eq([C.remoteFrom({ isRemote: true }), C.remoteFrom({ telecommuting: true }), C.remoteFrom({ is_remote: true }), C.remoteFrom({ remote: true }), C.remoteFrom({ hybrid: true }), C.remoteFrom({ on_site: true })], ['remote', 'remote', 'remote', 'remote', 'hybrid', 'onsite']);
      eq([C.remoteFrom({ location: { is_remote: true } }), C.remoteFrom({ remoteStatus: 'fully' }), C.remoteFrom({ remoteStatus: 'hybrid' }), C.remoteFrom({})], ['remote', 'remote', 'hybrid', null]);
    });
  });

  describe('radar › job shape', () => {
    it('normalize: key, defaults, trimmed fields, length limits', () => {
      const j = C.normalize({ id: 42, title: '  Data   Engineer ', locations: ['Berlin', 'Berlin', '', 'Remote'], postedAt: '2026-11-01T00:00:00Z', description: 'x'.repeat(20000) }, { board: 'lever', company: 'acme' });
      eq([j.key, j.title, j.locations, j.remote, j.postedAtExact, j.description.length, j.descriptionLevel, j.status], ['lever:acme:42', 'Data Engineer', ['Berlin', 'Remote'], 'remote', true, 12000, 'full', 'new']);
    });
    it('keys are unique per board / company / id; no description → title only; salary from the text', () => {
      const a = C.normalize({ id: 1, title: 'A' }, { board: 'ashby', company: 'x' });
      const b = C.normalize({ id: 1, title: 'A' }, { board: 'ashby', company: 'y' });
      notOk(a.key === b.key);
      eq(a.descriptionLevel, 'title');
      eq(C.normalize({ id: 2, title: 'B', description: 'Salary $100k-$130k a year' }, { board: 'ashby', company: 'x' }).salary.max, 130000);
    });
  });

  describe('radar › quick filter, seen, pruning', () => {
    const job = (o) => C.normalize({ id: 1, title: 'Senior Data Engineer', locations: ['Austin, TX'], ...o }, { board: 'lever', company: 'acme' });
    const profile = (o = {}) => ({ targetRoles: ['Data Engineer'], tracks: [], skills: [], ...o });
    it('title fit against target titles (General track uses target roles); no titles → everything passes', () => {
      ok(C.quickFilter(job(), {}, profile()).pass);
      eq(C.quickFilter(job({ title: 'Office Manager' }), {}, profile()).reason, 'title');
      ok(C.quickFilter(job({ title: 'Office Manager' }), {}, profile({ targetRoles: [] })).pass);
      const tracked = profile({ tracks: [{ id: 't', name: 'Cloud', targetTitles: ['Cloud Architect'] }] });
      ok(C.quickFilter(job({ title: 'Principal Cloud Architect' }), {}, tracked).pass);
      eq(C.quickFilter(job(), {}, tracked).reason, 'title');
    });
    it('remote, location and minimum salary preferences (unknown values pass)', () => {
      eq(C.quickFilter(job({ raw: { workplaceType: 'onsite' } }), { remote: 'remote' }, profile()).reason, 'remote');
      ok(C.quickFilter(job(), { remote: 'remote' }, profile()).pass, 'unknown remote passes');
      ok(C.quickFilter(job({ raw: { workplaceType: 'remote' } }), { remote: 'hybrid' }, profile()).pass, 'remote is fine for a hybrid preference');
      eq(C.quickFilter(job({ locations: ['Paris'] }), { locations: ['Austin'] }, profile()).reason, 'location');
      ok(C.quickFilter(job({ locations: ['Paris'], raw: { workplaceType: 'remote' } }), { locations: ['Austin'] }, profile()).pass, 'remote jobs pass any location');
      eq(C.quickFilter(job({ salary: { min: 50000, max: 60000 } }), { minSalary: 100000 }, profile()).reason, 'salary');
      ok(C.quickFilter(job({ salary: { min: 40, max: 70, period: 'hour' } }), { minSalary: 100000 }, profile()).pass, '$70/h ≈ $145k');
      ok(C.quickFilter(job(), { minSalary: 100000 }, profile()).pass, 'no salary passes');
    });
    it('seen keys keep their first date; prune at 60 / 30 days and 500 jobs', () => {
      const NOW = Date.parse('2026-11-21T00:00:00Z');
      const s = C.markSeen({ a: '2026-11-01' }, ['a', 'b'], NOW);
      eq(s, { a: '2026-11-01', b: '2026-11-21' });
      const old = new Date(NOW - 61 * 86400000).toISOString().slice(0, 10);
      const jobs = [{ key: 'd', status: 'dismissed', dismissedAt: new Date(NOW - 31 * 86400000).toISOString(), foundAt: '2026-10-01' }, { key: 'k', status: 'dismissed', dismissedAt: new Date(NOW - 5 * 86400000).toISOString(), foundAt: '2026-11-15' }];
      for (let i = 0; i < 520; i++) jobs.push({ key: 'n' + i, status: 'new', foundAt: new Date(NOW - i * 60000).toISOString() });
      const p = C.prune({ jobs, seen: { x: old, y: '2026-11-20' } }, NOW);
      eq(Object.keys(p.seen), ['y']);
      eq(p.jobs.length, 500);
      notOk(p.jobs.some((j) => j.key === 'd'));
      eq(p.jobs[0].key, 'n0', 'newest first');
    });
  });

  describe('radar › careers URL detection (11 boards)', () => {
    const cases = [
      ['https://boards.greenhouse.io/acme', { board: 'greenhouse', company: 'acme' }],
      ['job-boards.greenhouse.io/acme/jobs/123', { board: 'greenhouse', company: 'acme' }],
      ['https://boards.greenhouse.io/embed/job_board?for=acme', { board: 'greenhouse', company: 'acme' }],
      ['https://jobs.lever.co/globex/abc-123', { board: 'lever', company: 'globex' }],
      ['https://jobs.eu.lever.co/globex', { board: 'lever', company: 'globex', region: 'eu' }],
      ['https://jobs.ashbyhq.com/initech/8fb1', { board: 'ashby', company: 'initech' }],
      ['https://apply.workable.com/hooli/j/ABC/', { board: 'workable', company: 'hooli' }],
      ['https://umbrella.recruitee.com/o/engineer', { board: 'recruitee', company: 'umbrella' }],
      ['https://stark.jobs.personio.de/job/1', { board: 'personio', company: 'stark', domain: 'de' }],
      ['https://stark.jobs.personio.com', { board: 'personio', company: 'stark', domain: 'com' }],
      ['https://jobs.smartrecruiters.com/WayneEnterprises/7430', { board: 'smartrecruiters', company: 'WayneEnterprises' }],
      ['https://acme.wd5.myworkdayjobs.com/en-US/External_Careers/job/x', { board: 'workday', company: 'acme', wd: 5, site: 'External_Careers' }],
      ['https://acme.wd1.myworkdayjobs.com/Careers', { board: 'workday', company: 'acme', wd: 1, site: 'Careers' }],
      ['https://cyberdyne.breezy.hr/p/123', { board: 'breezy', company: 'cyberdyne' }],
      ['https://soylent.teamtailor.com/jobs', { board: 'teamtailor', company: 'soylent', domain: 'soylent.teamtailor.com' }],
      ['https://ats.rippling.com/vandelay/jobs', { board: 'rippling', company: 'vandelay' }],
    ];
    for (const [url, want] of cases) it(url, () => eq(D.fromUrl(url), want));
    it('unsupported or invalid → null', () => {
      eq([D.fromUrl('https://www.linkedin.com/jobs/view/1'), D.fromUrl('not a url at all'), D.fromUrl('https://boards.greenhouse.io/'), D.fromUrl('')], [null, null, null, null]);
    });
    it('careers page HTML: an embedded Greenhouse board, a Lever link, Teamtailor assets on a custom domain', () => {
      eq(D.fromHtml('<script src="//boards.greenhouse.io/embed/job_board/js?for=acme"></script>'), { board: 'greenhouse', company: 'acme' });
      eq(D.fromHtml('<a href="https://jobs.lever.co/globex">Open roles</a>'), { board: 'lever', company: 'globex' });
      eq(D.fromHtml('<link href="https://assets.teamtailor-cdn.com/x.css"><a href="https://soylent.teamtailor.com/jobs/1">x</a>', 'https://careers.soylent.com/'), { board: 'teamtailor', company: 'soylent', domain: 'careers.soylent.com' });
      eq(D.fromHtml('<p>No board here</p>'), null);
    });
    it('watchlist keys', () => eq([D.keyOf({ board: 'lever', company: 'globex' }), D.keyOf({ board: 'workday', company: 'acme', site: 'Careers' })], ['lever:globex', 'workday:acme:Careers']));
  });

  describe('radar › wave A adapters (captured responses)', () => {
    const parse = (id, body, e = {}) => B.get(id).parseList(body, { board: id, company: e.company || 'x', ...e }, {}).jobs.map((p) => C.normalize(p, { board: id, company: e.company || 'x' }));
    it('Greenhouse: titles, locations, links, dates, plain-text description from double-encoded HTML', () => {
      const jobs = parse('greenhouse', FX.greenhouse, { company: 'acme' });
      eq(jobs.length, 3);
      const j = jobs[0];
      eq([j.title, j.companyName, j.url.startsWith('https://job-boards.greenhouse.io/acme/jobs/'), j.postedAt], ['AI Transformation Owner, CRO', 'acme', true, '2026-07-22T17:38:40.000Z']);
      ok(j.locations.includes('Remote, United States'));
      eq(j.remote, 'remote');
      excludes(j.description, '&lt;');
      excludes(j.description, '<p>');
      ok(j.description.length > 200 && j.descriptionLevel === 'full');
      eq(B.get('greenhouse').listRequest({ company: 'acme' }).url, 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true');
    });
    it('Lever: text, locations, hostedUrl, createdAt (ms), workplaceType, commitment; salaryRange when present', () => {
      const body = AJP.clone(FX.lever);
      body[2].salaryRange = { min: 140000, max: 180000, currency: 'USD', interval: 'per-year-salary' };
      const jobs = parse('lever', body, { company: 'globex' });
      eq(jobs.map((j) => j.remote), ['hybrid', 'remote', 'onsite']);
      eq([jobs[0].title, jobs[0].url.startsWith('https://jobs.lever.co/globex/'), jobs[0].employmentType], ['Administrative Business Partner', true, 'Full-time']);
      eq(jobs[0].postedAt, new Date(1786469891368).toISOString());
      eq(jobs[2].salary, { min: 140000, max: 180000, currency: 'USD', period: 'year', source: 'field' });
      eq([B.get('lever').listRequest({ company: 'globex' }).url, B.get('lever').listRequest({ company: 'globex', region: 'eu' }).url], ['https://api.lever.co/v0/postings/globex?mode=json', 'https://api.eu.lever.co/v0/postings/globex?mode=json']);
      eq(B.get('lever').onNotFound({ company: 'globex' }).region, 'eu');
      eq(B.get('lever').onNotFound({ company: 'globex', region: 'eu' }), null);
    });
    it('Ashby: unlisted jobs skipped; compensation and workplace type mapped', () => {
      const jobs = parse('ashby', FX.ashby, { company: 'initech' });
      eq(jobs.length, FX.ashby.jobs.filter((j) => j.isListed !== false).length);
      const j = jobs[0];
      eq([j.title, j.url.startsWith('https://jobs.ashbyhq.com/initech/'), j.remote], ['Technical Program Manager, Compute Infrastructure', true, 'hybrid']);
      eq(j.salary, { min: 207000, max: 285000, currency: 'USD', period: 'year', source: 'field' });
    });
    it('an unexpected response shape → AJP-RADAR-FMT', () => {
      for (const id of ['greenhouse', 'lever', 'ashby']) {
        let code = '';
        try {
          B.get(id).parseList({ nope: 1 }, { company: 'x' }, {});
        } catch (e) {
          code = e.code;
        }
        eq(code, 'AJP-RADAR-FMT', id);
      }
    });
  });

  // ---- Scan engine (browser: needs storage) ---------------------------------------------------------
  const mock = globalThis.browser;
  const res = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] || null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const ghBody = (titles) => ({ jobs: titles.map((t, i) => ({ id: 100 + i, title: t, company_name: 'Acme Corp', location: { name: 'Remote' }, absolute_url: `https://boards.greenhouse.io/acme/jobs/${100 + i}`, first_published: '2026-11-20T10:00:00Z', content: '&lt;p&gt;Requirements&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;li&gt;Airflow&lt;/li&gt;&lt;/ul&gt;' })) });
  let calls;
  function fakeFetch(routes) {
    calls = [];
    return async (url, opts) => {
      calls.push({ url, method: (opts && opts.method) || 'GET' });
      for (const [re, reply] of routes) if (re.test(url)) return typeof reply === 'function' ? reply(url, opts) : reply;
      return res({ error: 'not found' }, 404);
    };
  }
  const saved = {};
  async function seed({ watch = [], settings = {}, profile = {} } = {}) {
    await mock.__reset();
    Object.assign(saved, AJP.radar.scan.CONFIG);
    Object.assign(AJP.radar.scan.CONFIG, { hostGapMs: 0, retryWaitMaxMs: 5, timeoutMs: 200 });
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p, { targetRoles: ['Data Engineer'], skills: [{ name: 'Python' }, { name: 'SQL' }, { name: 'Airflow' }] }, profile);
    await AJP.store.set('profile', p);
    await AJP.store.update('radarSettings', (s) => void Object.assign(s, settings));
    await AJP.store.set('radarWatchlist', watch.map((w) => ({ key: D.keyOf(w), paused: false, failuresInRow: 0, lastScanAt: null, ...w })));
  }
  const restore = () => Object.assign(AJP.radar.scan.CONFIG, saved);
  const W = (company, board = 'greenhouse', o = {}) => ({ board, company, ...o });

  describe('radar › scan engine', () => {
    afterEach(restore);
    it('scans due companies: normalizes, skips non-matching titles, scores, saves jobs + seen + entry', async () => {
      await seed({ watch: [W('acme')] });
      const fetchImpl = fakeFetch([[/greenhouse\.io\/v1\/boards\/acme/, res(ghBody(['Senior Data Engineer', 'Office Manager']))]]);
      const s = await AJP.radar.scan.run({ fetchImpl });
      eq([s.companies, s.requests, s.listed, s.new, s.errors.length], [1, 1, 2, 1, 0]);
      const jobs = await AJP.store.get('radarJobs');
      eq(jobs.map((j) => j.title), ['Senior Data Engineer']);
      ok(jobs[0].score > 0 && jobs[0].bestTrackId, 'scored with the tracks');
      eq(Object.keys(await AJP.store.get('radarSeen')).length, 2, 'the filtered-out job is seen too');
      const w = (await AJP.store.get('radarWatchlist'))[0];
      eq([w.openJobs, w.failuresInRow, w.lastError, w.companyName, !!w.lastScanAt], [2, 0, null, 'Acme Corp', true]);
    });
    it('the score equals what the job page would show (same analyzeAll)', async () => {
      await seed({ watch: [W('acme')] });
      await AJP.radar.scan.run({ fetchImpl: fakeFetch([[/acme/, res(ghBody(['Data Engineer']))]]) });
      const j = (await AJP.store.get('radarJobs'))[0];
      const direct = AJP.tracks.analyzeAll({ jdText: j.description, jobTitle: j.title, jobLocation: j.locations.join('; '), profile: await AJP.store.get('profile'), resumes: await AJP.store.get('resumes') });
      eq(j.score, direct.results.find((r) => r.track.id === direct.bestId).analysis.score);
    });
    it('seen jobs are not added again; companies scanned within the interval are skipped', async () => {
      await seed({ watch: [W('acme')] });
      const fetchImpl = fakeFetch([[/acme/, res(ghBody(['Data Engineer']))]]);
      await AJP.radar.scan.run({ fetchImpl });
      const again = await AJP.radar.scan.run({ fetchImpl });
      eq(again.companies, 0, 'not due yet');
      const forced = await AJP.radar.scan.run({ fetchImpl, force: true });
      eq([forced.companies, forced.new], [1, 0]);
      eq((await AJP.store.get('radarJobs')).length, 1);
    });
    it('matches at or above the threshold are reported for the alert', async () => {
      await seed({ watch: [W('acme')], settings: { threshold: 1 } });
      const s = await AJP.radar.scan.run({ fetchImpl: fakeFetch([[/acme/, res(ghBody(['Data Engineer']))]]) });
      eq(s.matches.length, 1);
      eq(s.matches[0].companyName, 'Acme Corp');
    });
    it('HTTP errors → coded, saved on the entry; 5 failures in a row pause the company', async () => {
      await seed({ watch: [W('gone')] });
      const fetchImpl = fakeFetch([]);
      const s = await AJP.radar.scan.run({ fetchImpl });
      eq(s.errors, [{ key: 'greenhouse:gone', code: 'AJP-RADAR-404' }]);
      for (let i = 0; i < 4; i++) await AJP.radar.scan.run({ fetchImpl, force: true });
      const w = (await AJP.store.get('radarWatchlist'))[0];
      eq([w.failuresInRow, w.paused, w.lastError.code], [5, true, 'AJP-RADAR-404']);
      eq((await AJP.radar.scan.run({ fetchImpl, force: true })).companies, 0, 'paused companies are not scanned');
    });
    it('429 / 500: one retry, then a coded error; timeout and network errors are coded', async () => {
      await seed({ watch: [W('a'), W('b'), W('c'), W('d')] });
      let n = 0;
      const fetchImpl = fakeFetch([
        [/boards\/a\//, () => (n++ ? res(ghBody(['Data Engineer'])) : res('slow down', 429, { 'retry-after': '0' }))],
        [/boards\/b\//, res('oops', 500)],
        [/boards\/c\//, (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))],
        [/boards\/d\//, () => Promise.reject(new TypeError('Failed to fetch'))],
      ]);
      const s = await AJP.radar.scan.run({ fetchImpl });
      eq(s.new, 1, 'a: retried once and succeeded');
      eq(s.errors.map((e) => e.code).sort(), ['AJP-RADAR-5XX', 'AJP-RADAR-NET', 'AJP-RADAR-TIME']);
      eq(calls.filter((c) => /boards\/b\//.test(c.url)).length, 2, '500 retried once');
    });
    it('a response in the wrong shape → AJP-RADAR-FMT', async () => {
      await seed({ watch: [W('acme')] });
      eq((await AJP.radar.scan.run({ fetchImpl: fakeFetch([[/acme/, res('<html>maintenance</html>')]]) })).errors[0].code, 'AJP-RADAR-FMT');
    });
    it('Lever: 404 on the US host → the EU host once, remembered on the entry', async () => {
      await seed({ watch: [W('globex', 'lever')] });
      const s = await AJP.radar.scan.run({ fetchImpl: fakeFetch([[/api\.eu\.lever\.co/, res(FX.lever)]]) });
      eq(s.errors.length, 0);
      eq((await AJP.store.get('radarWatchlist'))[0].region, 'eu');
      eq(calls.map((c) => new URL(c.url).hostname), ['api.lever.co', 'api.eu.lever.co']);
    });
    it('a second scan while one runs → AJP-RADAR-BUSY; a lock older than 10 minutes is taken over', async () => {
      await seed({ watch: [W('acme')] });
      await AJP.store.set('radarScanState', { lockedAt: Date.now() - 60000 });
      eq((await rejects(() => AJP.radar.scan.run({ fetchImpl: fakeFetch([]) }))).code, 'AJP-RADAR-BUSY');
      await AJP.store.set('radarScanState', { lockedAt: Date.now() - 11 * 60000 });
      const s = await AJP.radar.scan.run({ fetchImpl: fakeFetch([[/acme/, res(ghBody(['Data Engineer']))]]) });
      eq(s.companies, 1);
      eq((await AJP.store.get('radarScanState')).lockedAt, null, 'released');
    });
    it('a scan stopped mid-way resumes at the right company', async () => {
      await seed({ watch: [W('a'), W('b'), W('c')] });
      await AJP.store.set('radarScanState', { queue: ['greenhouse:a', 'greenhouse:b', 'greenhouse:c'], done: ['greenhouse:a'] });
      const s = await AJP.radar.scan.run({ fetchImpl: fakeFetch([[/greenhouse/, res(ghBody(['Data Engineer']))]]) });
      ok(s.resumed);
      eq(calls.map((c) => c.url.match(/boards\/(\w)\//)[1]).sort(), ['b', 'c']);
      eq((await AJP.store.get('radarScanState')).queue, []);
    });
    it('the per-scan request budget stops the scan; the rest wait in the queue', async () => {
      await seed({ watch: [W('a'), W('b'), W('c'), W('d')] });
      AJP.radar.scan.CONFIG.requestsPerScan = 2;
      AJP.radar.scan.CONFIG.concurrency = 1;
      const s = await AJP.radar.scan.run({ fetchImpl: fakeFetch([[/greenhouse/, res(ghBody(['Data Engineer']))]]) });
      eq([s.requests, s.stopped], [2, true]);
      const st = await AJP.store.get('radarScanState');
      eq(st.queue.filter((k) => !st.done.includes(k)).length, 2);
    });
    it('probe: one request → open jobs and company name, before saving', async () => {
      await seed();
      const r = await AJP.radar.scan.probe({ board: 'greenhouse', company: 'acme' }, { fetchImpl: fakeFetch([[/acme/, res(ghBody(['A', 'B', 'C']))]]) });
      eq([r.openJobs, r.companyName], [3, 'Acme Corp']);
      eq((await rejects(() => AJP.radar.scan.probe({ board: 'greenhouse', company: 'nope' }, { fetchImpl: fakeFetch([]) }))).code, 'AJP-RADAR-404');
    });
  }, { env: 'browser' });
})();
