/*
 * Job Radar waves B and C: Workable, Recruitee, Breezy HR, SmartRecruiters, Rippling, Personio, Teamtailor, Workday,
 * against captured responses; then the scan engine's paging, detail calls and Workday keyword searches (fake fetch).
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const C = AJP.radar.core;
  const B = AJP.radar.boards;
  const FX = globalThis.RADAR_FIXTURES;
  const NOW = Date.parse('2026-11-21T12:00:00Z');
  const parse = (id, body, e = {}, req) => {
    const entry = { board: id, company: 'x', ...e };
    const out = B.get(id).parseList(body, entry, { keywords: [] }, req);
    return { ...out, jobs: out.jobs.map((p) => C.normalize(p, entry)) };
  };

  describe('radar › wave B adapters (captured responses)', () => {
    it('Workable: shortcode keys, locations, description; telecommuting → remote', () => {
      const r = parse('workable', FX.workable, { company: 'hooli' });
      eq(r.jobs.length, 3);
      const j = r.jobs[0];
      eq([j.key, j.remote, j.employmentType, j.url], ['workable:hooli:81B46579FE', 'remote', 'Full-time', 'https://apply.workable.com/j/81B46579FE']);
      includes(j.locations[0], 'Paris');
      ok(j.description.length > 100 && !/<p>/.test(j.description));
      eq(j.postedAt, '2026-05-29T00:00:00.000Z');
      eq(B.get('workable').listRequest({ company: 'hooli' }).url, 'https://apply.workable.com/api/v1/widget/accounts/hooli?details=true');
    });
    it('Recruitee: non-ISO "UTC" date, description + requirements, salary object, hybrid flag', () => {
      const r = parse('recruitee', FX.recruitee, { company: 'umbrella' });
      const j = r.jobs[0];
      eq(j.postedAt, '2026-11-18T16:23:32.000Z');
      eq(j.remote, 'hybrid');
      ok(j.description.includes('\n') && j.description.length > 200, 'both parts');
      eq(r.jobs[1].salary, { min: 55000, max: 70000, currency: 'EUR', period: 'year', source: 'field' });
      eq(B.get('recruitee').listRequest({ company: 'umbrella' }).url, 'https://umbrella.recruitee.com/api/offers/');
    });
    it('Breezy HR: no descriptions → title-only; free-text salary "$45,000 / year"; is_remote', () => {
      const r = parse('breezy', FX.breezy, { company: 'cyberdyne' });
      const j = r.jobs[0];
      eq([j.descriptionLevel, j.remote, j.title], ['title', 'remote', 'Customer Success Agent']);
      eq(j.salary, { min: 45000, max: 45000, currency: 'USD', period: 'year', source: 'text' });
      eq(B.get('breezy').listRequest({ company: 'cyberdyne' }).url, 'https://cyberdyne.breezy.hr/json');
    });
    it('SmartRecruiters: offset paging until totalFound; description from the detail jobAd sections', () => {
      const p1 = parse('smartrecruiters', FX.smartrecruiters.page1, { company: 'WayneEnterprises' });
      eq([p1.jobs.length, p1.total], [2, 3]);
      includes(p1.next.url, 'offset=2');
      eq(p1.jobs[0].descriptionLevel, 'title', 'no description in the list');
      ok(p1.jobs[0].url.startsWith('https://jobs.smartrecruiters.com/WayneEnterprises/'));
      const p2 = parse('smartrecruiters', FX.smartrecruiters.page2, { company: 'WayneEnterprises' });
      eq([p2.jobs.length, p2.next], [1, null]);
      const d = B.get('smartrecruiters').parseDetail(FX.smartrecruiters.detail);
      ok(d.description.length > 100 && !/<p>/.test(d.description));
      includes(B.get('smartrecruiters').detailRequest({ id: '7' }, { company: 'WayneEnterprises' }).url, '/companies/WayneEnterprises/postings/7');
    });
    it('Rippling: a job listed once per location is merged; page paging until totalPages; date + pay range from the detail', () => {
      const p0 = parse('rippling', FX.rippling.page0, { company: 'vandelay' });
      eq(p0.jobs.length, 2, 'the duplicate is merged');
      eq(p0.jobs[0].locations, ['New York, NY', 'San Francisco, CA']);
      eq([p0.jobs[0].remote, p0.jobs[0].postedAt], ['onsite', null]);
      includes(p0.next.url, 'page=1');
      eq(parse('rippling', FX.rippling.page1, { company: 'vandelay' }).next, null);
      const d = B.get('rippling').parseDetail(FX.rippling.detail);
      eq(d.salary, { min: 185000, max: 240000, currency: 'USD', period: 'year', source: 'field' });
      ok(d.description.length > 100 && d.postedAt.startsWith('2026-03-31'));
      eq(B.get('rippling').detailRequest({ id: 'abc' }, { company: 'vandelay' }).url, 'https://api.rippling.com/platform/api/ats/v1/board/vandelay/jobs/abc');
      eq(B.hostsFor({ board: 'rippling' }), ['https://ats.rippling.com/*', 'https://api.rippling.com/*']);
    });
  });

  describe('radar › wave C adapters (captured responses)', () => {
    it('Personio (XML): positions, CDATA descriptions joined, job URL; .de → .com fallback', () => {
      const r = parse('personio', FX.personio, { company: 'stark' });
      eq(r.jobs.length, 2);
      const j = r.jobs[0];
      eq([j.title, j.locations[0], j.url], ['Business Development Representative (d/f/m)', 'Berlin', 'https://stark.jobs.personio.de/job/2885178']);
      ok(j.description.includes('The Role') && !/<p>|CDATA/.test(j.description));
      eq(B.get('personio').onNotFound({ company: 'stark' }).domain, 'com');
      eq(B.get('personio').listRequest({ company: 'stark', domain: 'com' }).url, 'https://stark.jobs.personio.com/xml?language=en');
    });
    it('Teamtailor (RSS): namespaced locations, escaped HTML description, pubDate, remoteStatus; custom domain', () => {
      const r = parse('teamtailor', FX.teamtailor, { company: 'soylent' });
      const j = r.jobs[0];
      eq([j.title, j.locations, j.remote, j.department], ['Customer Success Manager - Dutch Speaking', ['Stockholm'], 'hybrid', 'Customer Success']);
      eq(j.postedAt, '2026-11-16T09:25:07.000Z');
      excludes(j.description, '&lt;');
      eq(B.get('teamtailor').listRequest({ company: 'soylent', domain: 'careers.soylent.com' }).url, 'https://careers.soylent.com/jobs.rss');
      eq(B.hostsFor({ board: 'teamtailor', company: 'soylent', domain: 'careers.soylent.com' }), ['https://*.teamtailor.com/*', 'https://careers.soylent.com/*']);
      eq(B.hostsFor({ board: 'teamtailor', company: 'soylent', domain: 'soylent.teamtailor.com' }), ['https://*.teamtailor.com/*']);
    });
    it('Workday: POST search per keyword (max 3); "Posted N Days Ago" approximate; "5 Locations" left to the detail', () => {
      const e = { board: 'workday', company: 'massive', wd: 5, site: 'ExternalSite' };
      const reqs = B.get('workday').listRequests(e, { keywords: ['Data Engineer', 'Analytics Engineer', 'ML Engineer', 'Fourth'] });
      eq(reqs.length, 3);
      eq([reqs[0].method, reqs[0].url, JSON.parse(reqs[0].body)], ['POST', 'https://massive.wd5.myworkdayjobs.com/wday/cxs/massive/ExternalSite/jobs', { limit: 20, offset: 0, searchText: 'Data Engineer', appliedFacets: {} }]);
      const r = parse('workday', FX.workday.list, e, reqs[0]);
      eq(r.jobs.length, 3);
      eq([r.jobs[0].postedAtExact, r.jobs[2].locations], [false, []]);
      ok(r.jobs[0].url.startsWith('https://massive.wd5.myworkdayjobs.com/ExternalSite/job/'));
      const d = B.get('workday').parseDetail(FX.workday.detail);
      ok(d.description.length > 100);
      eq([d.postedAt, d.postedAtExact], ['2026-11-19', true]);
      eq(B.get('workday').detailRequest({ id: '/job/x/Y_1' }, e).url, 'https://massive.wd5.myworkdayjobs.com/wday/cxs/massive/ExternalSite/job/x/Y_1');
    });
    it('every board answers an unexpected shape with AJP-RADAR-FMT', () => {
      for (const id of ['workable', 'recruitee', 'breezy', 'smartrecruiters', 'rippling', 'personio', 'teamtailor', 'workday']) {
        let code = '';
        try {
          B.get(id).parseList(id === 'personio' || id === 'teamtailor' ? '<html>oops</html>' : { nope: 1 }, { company: 'x' }, {});
        } catch (err) {
          code = err.code;
        }
        eq(code, 'AJP-RADAR-FMT', id);
      }
    });
    it('all 11 boards are registered with their host permissions', () => {
      eq(B.all().map((a) => a.id).sort(), ['ashby', 'breezy', 'greenhouse', 'lever', 'personio', 'recruitee', 'rippling', 'smartrecruiters', 'teamtailor', 'workable', 'workday']);
      ok(B.all().every((a) => a.hosts.length && a.hosts.every((h) => /^https:\/\/[^/]+\/\*$/.test(h))));
    });
  });

  // ---- Scan engine: paging, detail calls, budgets, Workday keywords (browser: storage) ------------------
  const mock = globalThis.browser;
  const res = (body, status = 200) => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  let calls;
  const fake = (routes) => {
    calls = [];
    return async (url, o) => {
      calls.push({ url, method: (o && o.method) || 'GET', body: o && o.body });
      for (const [re, r] of routes) if (re.test(url)) return typeof r === 'function' ? r(url, o) : r;
      return res({}, 404);
    };
  };
  const saved = {};
  async function seed(watch, profile = {}) {
    await mock.__reset();
    Object.assign(saved, AJP.radar.scan.CONFIG);
    Object.assign(AJP.radar.scan.CONFIG, { hostGapMs: 0, retryWaitMaxMs: 5 });
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p, { targetRoles: [], skills: [{ name: 'Python' }] }, profile);
    await AJP.store.set('profile', p);
    await AJP.store.set('radarWatchlist', watch.map((w) => ({ key: AJP.radar.detect.keyOf(w), paused: false, failuresInRow: 0, lastScanAt: null, ...w })));
  }
  describe('radar › scan engine: paging, details, Workday', () => {
    afterEach(() => Object.assign(AJP.radar.scan.CONFIG, saved));
    it('SmartRecruiters: both pages read; every passing job gets its detail (description)', async () => {
      await seed([{ board: 'smartrecruiters', company: 'WayneEnterprises' }]);
      const s = await AJP.radar.scan.run({ now: NOW, fetchImpl: fake([[/offset=0/, res(FX.smartrecruiters.page1)], [/offset=2/, res(FX.smartrecruiters.page2)], [/postings\/\d+$/, () => res(FX.smartrecruiters.detail)]]) });
      eq([s.listed, s.new], [3, 3]);
      eq(calls.filter((c) => /postings\/\d+$/.test(c.url)).length, 3);
      ok((await AJP.store.get('radarJobs')).every((j) => j.descriptionLevel === 'full'));
    });
    it('detail budget per company: jobs over it stay title-only (best title fit first)', async () => {
      await seed([{ board: 'smartrecruiters', company: 'WayneEnterprises' }]);
      AJP.radar.scan.CONFIG.detailPerCompany = 1;
      AJP.radar.scan.CONFIG.backfillPerScan = 0; // the later backfill is tested on its own
      await AJP.radar.scan.run({ now: NOW, fetchImpl: fake([[/offset=0/, res(FX.smartrecruiters.page1)], [/offset=2/, res(FX.smartrecruiters.page2)], [/postings\/\d+$/, () => res(FX.smartrecruiters.detail)]]) });
      const jobs = await AJP.store.get('radarJobs');
      eq([jobs.filter((j) => j.descriptionLevel === 'full').length, jobs.filter((j) => j.descriptionLevel === 'title').length], [1, 2]);
    });
    it('page cap: no more than CONFIG.maxPages list pages per company', async () => {
      await seed([{ board: 'rippling', company: 'vandelay' }]);
      AJP.radar.scan.CONFIG.maxPages = 1;
      await AJP.radar.scan.run({ now: NOW, fetchImpl: fake([[/page=0/, res(FX.rippling.page0)], [/page=1/, res(FX.rippling.page1)], [/api\.rippling\.com/, () => res(FX.rippling.detail)]]) });
      eq(calls.filter((c) => /ats\.rippling\.com/.test(c.url)).length, 1);
    });
    it('Workday: one POST search per track keyword (max 3), details for the matches, dates from the detail', async () => {
      await seed([{ board: 'workday', company: 'massive', wd: 5, site: 'ExternalSite' }], { targetRoles: ['Data Engineer', 'Analytics Engineer', 'ML Engineer', 'Platform Engineer'] });
      await AJP.radar.scan.run({ now: NOW, fetchImpl: fake([[/\/jobs$/, res(FX.workday.list)], [/\/job\//, () => res(FX.workday.detail)]]) });
      const searches = calls.filter((c) => c.method === 'POST');
      eq(searches.map((c) => JSON.parse(c.body).searchText), ['Data Engineer', 'Analytics Engineer', 'ML Engineer']);
      const jobs = await AJP.store.get('radarJobs');
      ok(jobs.length >= 1 && jobs.every((j) => j.postedAtExact === true && j.descriptionLevel === 'full'), JSON.stringify(jobs.map((j) => [j.title, j.postedAtExact])));
    });
    it('Personio: 404 on .de → .com, remembered; Teamtailor RSS scanned on its custom domain', async () => {
      await seed([{ board: 'personio', company: 'stark' }, { board: 'teamtailor', company: 'soylent', domain: 'careers.soylent.com' }]);
      const s = await AJP.radar.scan.run({ now: NOW, fetchImpl: fake([[/personio\.com\/xml/, res(FX.personio)], [/careers\.soylent\.com\/jobs\.rss/, res(FX.teamtailor)]]) });
      eq(s.errors, []);
      eq((await AJP.store.get('radarWatchlist')).find((w) => w.board === 'personio').domain, 'com');
      eq(s.listed, 4);
    });
  }, { env: 'browser' });
})();
