/*
 * Job Radar preferences: career tracks (up to 3) with their own titles, places and work types; eligibility from the
 * job text (visa sponsorship, citizenship, clearance) against Auto-apply details; freshness; ordering.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const C = AJP.radar.core;
  const NOW = Date.parse('2026-11-21T12:00:00Z');
  const job = (o = {}) => C.normalize({ id: o.id || 1, title: 'Senior Data Engineer', locations: ['Austin, TX, United States'], ...o }, { board: 'lever', company: 'acme' });
  const profile = (o = {}) => ({ targetRoles: ['Data Engineer'], areas: ['Austin, TX'], workTypes: { remote: true, hybrid: true, onsite: true }, tracks: [], skills: [], autoApply: {}, ...o });
  const T = (id, titles, extra = {}) => ({ id, name: id.toUpperCase(), targetTitles: titles, ...extra });

  describe('radar prefs › career tracks: role first, then that track’s places and work type', () => {
    it('each of up to 3 tracks has its own titles; the matching track is reported', () => {
      const p = profile({ tracks: [T('cloud', ['Cloud Architect']), T('data', ['Data Engineer']), T('ml', ['ML Engineer'])] });
      eq(C.quickFilter(job(), {}, p), { pass: true, trackId: 'data', titleMatch: 'exact' });
      eq(C.quickFilter(job({ title: 'Principal Cloud Architect' }), {}, p).trackId, 'cloud');
      eq(C.quickFilter(job({ title: 'Office Manager' }), {}, p).reason, 'title');
    });
    it("a track's own areas win over the profile's; the profile's areas are the default", () => {
      const p = profile({ tracks: [T('data', ['Data Engineer'], { areas: ['Seattle, WA'] })] });
      eq(C.quickFilter(job(), {}, p).reason, 'location', 'Austin job, track wants Seattle');
      ok(C.quickFilter(job({ locations: ['Seattle, Washington'] }), {}, p).pass);
      ok(C.quickFilter(job(), {}, profile()).pass, 'no track: profile areas (Austin)');
      eq(C.quickFilter(job({ locations: ['Berlin, Germany'] }), {}, profile()).reason, 'location');
    });
    it('the same title on two tracks: passes when either track’s places fit', () => {
      const p = profile({ tracks: [T('a', ['Data Engineer'], { areas: ['Seattle, WA'] }), T('b', ['Senior Data Engineer'], { areas: ['Austin, TX'] })] });
      eq(C.quickFilter(job(), {}, p), { pass: true, trackId: 'b', titleMatch: 'exact' });
    });
    it('work type: the track’s (else profile’s) choices; remote jobs fit any place; unknown passes', () => {
      const p = profile({ workTypes: { remote: true, hybrid: false, onsite: false } });
      eq(C.quickFilter(job({ raw: { workplaceType: 'onsite' } }), {}, p).reason, 'remote');
      ok(C.quickFilter(job({ locations: ['Berlin'], raw: { workplaceType: 'remote' } }), {}, p).pass, 'remote job, any place');
      ok(C.quickFilter(job(), {}, p).pass, 'work type unknown');
      const tr = profile({ workTypes: { remote: true, hybrid: false, onsite: false }, tracks: [T('d', ['Data Engineer'], { workTypes: { onsite: true } })] });
      ok(C.quickFilter(job({ raw: { workplaceType: 'onsite' } }), {}, tr).pass, 'the track allows on-site');
    });
    it('Job Radar settings narrow further when set (locations, work type)', () => {
      eq(C.quickFilter(job(), { locations: ['Denver'] }, profile()).reason, 'location');
      eq(C.quickFilter(job({ raw: { workplaceType: 'hybrid' } }), { remote: 'remote' }, profile()).reason, 'remote');
    });
  });

  describe('radar prefs › eligibility from the job text (never hidden, only set apart)', () => {
    const P = (aa) => ({ autoApply: aa });
    const cases = [
      ['We are unable to sponsor visas for this role.', 'noSponsor'],
      ['Candidates must be authorized to work in the US without current or future visa sponsorship.', 'noSponsor'],
      ['This position is not eligible for visa sponsorship.', 'noSponsor'],
      ['Sponsorship is not available.', 'noSponsor'],
      ['We do not provide H-1B sponsorship.', 'noSponsor'],
      ['Visa sponsorship is available for this role.', 'sponsors'],
      ['We offer visa sponsorship and relocation.', 'sponsors'],
      ['Must be a U.S. citizen.', 'citizen'],
      ['US citizenship is required due to ITAR.', 'citizen'],
      ['Active Secret clearance required.', 'clearance'],
      ['TS/SCI with polygraph.', 'clearance'],
    ];
    for (const [text, flag] of cases) it(`"${text}" → ${flag}`, () => ok(C.eligibility(text, {}).flags[flag], JSON.stringify(C.eligibility(text, {}).flags)));
    it('ordinary text raises nothing (no false alarms on "sponsor" alone)', () => {
      const e = C.eligibility('We sponsor team events and hackathons. Python, SQL, Airflow.', P({ requireSponsorship: 'Yes' }));
      eq([e.status, e.flags.noSponsor, e.flags.sponsors, e.flags.citizen], ['ok', false, false, false]);
    });
    it('you need sponsorship + "no sponsorship" → blocked with the reason; you don’t → nothing', () => {
      const t = 'Unfortunately we cannot sponsor visas.';
      const b = C.eligibility(t, P({ requireSponsorship: 'Yes' }));
      eq(b.status, 'blocked');
      includes(b.reasons[0], 'sponsor');
      eq(C.eligibility(t, P({ requireSponsorship: 'No' })).status, 'ok');
      eq(C.eligibility(t, P({})).status, 'check', 'not answered yet → check');
    });
    it('citizenship / clearance: blocked when you are not a citizen (or need sponsorship); check when unknown; fine for citizens', () => {
      const t = 'Must be a U.S. citizen. Secret clearance required.';
      eq(C.eligibility(t, P({ citizen: 'No' })).status, 'blocked');
      eq(C.eligibility(t, P({ requireSponsorship: 'Yes' })).status, 'blocked');
      eq(C.eligibility(t, P({})).status, 'check');
      eq(C.eligibility(t, P({ citizen: 'Yes' })).status, 'check', 'a clearance is still worth a look');
      eq(C.eligibility('Must be a U.S. citizen.', P({ citizen: 'Yes' })).status, 'ok');
    });
  });

  describe('radar prefs › freshness', () => {
    it('today / this week / older / unknown', () => {
      const at = (h) => ({ postedAt: new Date(NOW - h * 3600000).toISOString() });
      eq([C.freshness(at(3), NOW), C.freshness(at(30), NOW), C.freshness(at(24 * 8), NOW), C.freshness({}, NOW)], ['today', 'week', 'older', 'unknown']);
    });
  });

  // ---- Scan + messages (browser) ------------------------------------------------------------------------
  const mock = globalThis.browser;
  const res = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  const gh = (jobs) => ({ jobs: jobs.map((j, i) => ({ id: 900 + i, company_name: 'Acme', location: { name: j.loc || 'Remote' }, absolute_url: 'https://boards.greenhouse.io/acme/jobs/' + (900 + i), first_published: j.posted || '2026-11-21T08:00:00Z', content: j.text || 'Python SQL Airflow', title: j.title || 'Data Engineer' })) });
  let realFetch;
  const saved = {};
  async function seed(aa = {}, extra = {}) {
    await mock.__reset();
    realFetch = globalThis.fetch;
    Object.assign(saved, AJP.radar.scan.CONFIG);
    Object.assign(AJP.radar.scan.CONFIG, { hostGapMs: 0 });
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p, { targetRoles: ['Data Engineer'], skills: [{ name: 'Python' }, { name: 'SQL' }, { name: 'Airflow' }], workTypes: { remote: true, hybrid: true, onsite: true }, ...extra });
    Object.assign(p.autoApply, aa);
    await AJP.store.set('profile', p);
    await AJP.store.update('radarSettings', (s) => void (s.threshold = 1));
    mock.__granted.add('https://boards-api.greenhouse.io/*');
    await AJP.store.set('radarWatchlist', [{ key: 'greenhouse:acme', board: 'greenhouse', company: 'acme', companyName: 'Acme', paused: false, failuresInRow: 0 }]);
  }
  describe('radar prefs › scan and lists', () => {
    afterEach(() => {
      globalThis.fetch = realFetch;
      Object.assign(AJP.radar.scan.CONFIG, saved);
    });
    it('each job keeps its eligibility; "likely not eligible" jobs are listed but left out of matches, alerts and the badge', async () => {
      await seed({ requireSponsorship: 'Yes' });
      globalThis.fetch = async () => res(gh([{ title: 'Data Engineer', text: 'Python and SQL. We are unable to sponsor visas.' }, { title: 'Lead Data Engineer', text: 'Python SQL. Visa sponsorship is available.' }]));
      const s = (await AJP.send('radar.scanNow', {})).summary;
      eq([s.new, s.matches.length], [2, 1]);
      const jobs = (await AJP.send('radar.jobs', {})).jobs;
      eq(jobs.map((j) => j.eligibility.status).sort(), ['blocked', 'ok']);
      ok(jobs.find((j) => j.eligibility.flags.sponsors), 'the sponsoring job is tagged');
      eq(mock.__notes.length, 1);
      includes(mock.__notes[0].title, '1 new job');
      eq((await AJP.send('radar.status')).newCount, 1);
      eq((await AJP.send('radar.jobs', { eligible: true })).jobs.length, 1);
    });
    it('sort: best match first, or newest first', async () => {
      await seed();
      globalThis.fetch = async () => res(gh([{ title: 'Data Engineer', text: 'Python SQL Airflow', posted: '2026-11-01T08:00:00Z' }, { title: 'Senior Data Engineer', text: 'Python SQL Kafka Scala Spark Java Rust Go', posted: '2026-11-21T08:00:00Z' }]));
      await AJP.send('radar.scanNow', {});
      eq((await AJP.send('radar.jobs', { sort: 'match' })).jobs[0].title, 'Data Engineer');
      eq((await AJP.send('radar.jobs', { sort: 'newest' })).jobs[0].title, 'Senior Data Engineer');
    });
    it('Workday keyword searches take one title from each career track first', async () => {
      await seed({}, { tracks: [{ id: 'a', name: 'A', targetTitles: ['Data Engineer', 'ETL Developer'] }, { id: 'b', name: 'B', targetTitles: ['Cloud Architect'] }, { id: 'c', name: 'C', targetTitles: ['ML Engineer'] }] });
      await AJP.store.set('radarWatchlist', [{ key: 'workday:acme:Site', board: 'workday', company: 'acme', wd: 1, site: 'Site', paused: false, failuresInRow: 0 }]);
      const sent = [];
      globalThis.fetch = async (url, o) => (o && o.method === 'POST' && sent.push(JSON.parse(o.body).searchText), res({ total: 0, jobPostings: [] }));
      await AJP.radar.scan.run({ force: true });
      eq(sent, ['Data Engineer', 'Cloud Architect', 'ML Engineer']);
    });
  }, { env: 'browser' });
})();
