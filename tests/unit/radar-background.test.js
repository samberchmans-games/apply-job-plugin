/*
 * Job Radar through the background: every radar.* message (docs/JOB-FINDER.md §13), permissions, alerts, badge.
 * The network is a fake fetch; permissions and notifications come from the browser mock.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;
  const GH = 'https://boards-api.greenhouse.io/*';
  const res = (body, status = 200) => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  const gh = (titles, company = 'Acme Corp') => ({ jobs: titles.map((t, i) => ({ id: 500 + i, title: t, company_name: company, location: { name: 'Remote' }, absolute_url: `https://boards.greenhouse.io/acme/jobs/${500 + i}`, first_published: '2026-11-20T10:00:00Z', content: '&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;li&gt;Airflow&lt;/li&gt;&lt;/ul&gt;' })) });
  let realFetch;
  let calls;
  const saved = {};
  function net(routes) {
    calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      for (const [re, r] of routes) if (re.test(url)) return typeof r === 'function' ? r() : r;
      return res({ error: 'nf' }, 404);
    };
  }
  async function before() {
    await mock.__reset();
    realFetch = globalThis.fetch;
    Object.assign(saved, AJP.radar.scan.CONFIG);
    Object.assign(AJP.radar.scan.CONFIG, { hostGapMs: 0, retryWaitMaxMs: 5 });
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p, { targetRoles: ['Data Engineer'], skills: [{ name: 'Python' }, { name: 'SQL' }, { name: 'Airflow' }] });
    await AJP.store.set('profile', p);
    mock.__granted.add(GH);
  }
  function after() {
    globalThis.fetch = realFetch;
    Object.assign(AJP.radar.scan.CONFIG, saved);
  }

  describe('radar background › watchlist', () => {
    beforeEach(before);
    afterEach(after);
    it('add by careers URL: checks the board once (job count + name), then saves', async () => {
      net([[/boards\/acme\//, res(gh(['Data Engineer', 'Designer']))]]);
      const r = await AJP.send('radar.watch.add', { url: 'https://boards.greenhouse.io/acme' });
      ok(r.ok !== false, JSON.stringify(r));
      eq([r.entry.key, r.entry.openJobs, r.entry.companyName, r.exists], ['greenhouse:acme', 2, 'Acme Corp', false]);
      eq((await AJP.send('radar.watch.list')).entries.map((e) => e.key), ['greenhouse:acme']);
      eq((await AJP.send('radar.watch.add', { url: 'boards.greenhouse.io/acme' })).exists, true, 'no duplicates');
    });
    it('a bad URL → AJP-RADAR-UNSUP; an unknown company → AJP-RADAR-404 (nothing saved)', async () => {
      net([]);
      eq((await AJP.send('radar.watch.add', { url: 'https://www.linkedin.com/jobs/view/1' })).code, 'AJP-RADAR-UNSUP');
      eq((await AJP.send('radar.watch.add', { url: 'https://boards.greenhouse.io/nobody' })).code, 'AJP-RADAR-404');
      eq((await AJP.send('radar.watch.list')).entries, []);
    });
    it('no permission for the board yet → AJP-RADAR-PERM naming the hosts to ask for (Lever only for Lever)', async () => {
      net([]);
      const r = await AJP.send('radar.watch.add', { url: 'https://jobs.lever.co/globex' });
      eq(r.code, 'AJP-RADAR-PERM');
      const d = await AJP.send('radar.detect', { url: 'https://jobs.lever.co/globex' });
      eq(d.hosts, ['https://api.lever.co/*', 'https://api.eu.lever.co/*']);
      eq(d.label, 'Lever');
    });
    it('pause / resume (resume clears the failures) and remove (its new jobs go too)', async () => {
      net([[/boards\/acme\//, res(gh(['Data Engineer']))]]);
      await AJP.send('radar.watch.add', { url: 'https://boards.greenhouse.io/acme' });
      await AJP.send('radar.scanNow', {});
      await AJP.store.update('radarWatchlist', (l) => void (l[0].failuresInRow = 3));
      eq((await AJP.send('radar.watch.update', { key: 'greenhouse:acme', paused: true })).entry.paused, true);
      const resumed = (await AJP.send('radar.watch.update', { key: 'greenhouse:acme', paused: false })).entry;
      eq([resumed.paused, resumed.failuresInRow], [false, 0]);
      eq((await AJP.send('radar.jobs', {})).jobs.length, 1);
      await AJP.send('radar.watch.remove', { key: 'greenhouse:acme' });
      eq([(await AJP.send('radar.watch.list')).entries.length, (await AJP.send('radar.jobs', {})).jobs.length], [0, 0]);
    });
    it('add a list: supported lines added, others skipped with the reason', async () => {
      net([[/boards\/acme\//, res(gh(['Data Engineer']))], [/boards\/globex\//, res(gh(['Data Engineer'], 'Globex'))]]);
      const r = await AJP.send('radar.watch.addList', { text: 'https://boards.greenhouse.io/acme\n# a comment\nhttps://boards.greenhouse.io/globex\nhttps://example.com/careers\nboards.greenhouse.io/acme\nhttps://boards.greenhouse.io/nobody' });
      eq(r.added.map((a) => a.entry.key), ['greenhouse:acme', 'greenhouse:globex']);
      eq(r.skipped.map((s) => s.code || 'dup'), ['AJP-RADAR-UNSUP', 'dup', 'AJP-RADAR-404']);
      ok(r.skipped.every((s) => s.reason), 'every skipped line has a reason');
    });
  }, { env: 'browser' });

  describe('radar background › scans, jobs, alerts, badge', () => {
    beforeEach(before);
    afterEach(after);
    async function withJob(threshold = 1, notify = 'perScan') {
      await AJP.send('radar.settings.save', { settings: { threshold, notify } });
      net([[/boards\/acme\//, res(gh(['Senior Data Engineer']))]]);
      await AJP.send('radar.watch.add', { url: 'https://boards.greenhouse.io/acme' });
      return (await AJP.send('radar.scanNow', {})).summary;
    }
    it('scan now → new jobs (highest match first) and one notification per scan', async () => {
      const s = await withJob();
      eq([s.new, s.matches.length, s.alert.count], [1, 1, 1]);
      eq(mock.__notes.length, 1);
      includes(mock.__notes[0].title, '1 new job at 1%+ match');
      includes(mock.__notes[0].message, 'Acme Corp');
      const jobs = (await AJP.send('radar.jobs', { status: 'new' })).jobs;
      eq(jobs[0].title, 'Senior Data Engineer');
      await AJP.radarAlert();
      eq(mock.__notes.length, 1, 'a match is announced once');
    });
    it('daily summary mode: at most one notification a day', async () => {
      await withJob(1, 'digest');
      eq(mock.__notes.length, 1);
      net([[/boards\/acme\//, res(gh(['Senior Data Engineer', 'Lead Data Engineer']))]]);
      await AJP.send('radar.scanNow', {});
      eq(mock.__notes.length, 1, 'the second match waits for tomorrow');
      await AJP.store.update('radarSettings', (s) => void (s.lastDigestAt = new Date(Date.now() - 25 * 3600e3).toISOString()));
      await AJP.radarAlert();
      eq(mock.__notes.length, 2);
    });
    it('matches below the threshold: listed but no alert', async () => {
      await AJP.store.update('profile', (p) => void (p.skills = [{ name: 'Python' }])); // a partial match
      const s = await withJob(100);
      eq([s.new, s.matches.length, s.alert], [1, 0, null]);
      eq(mock.__notes.length, 0);
    });
    it('badge: new matches in blue after ! and ✓, before follow-ups; viewing the list clears it', async () => {
      await withJob();
      await AJP.refreshBadge();
      eq([mock.__badge.text, mock.__badge.color], ['1', '#2563eb']);
      await AJP.store.set('promptState', { pending: { code: 'AJP-X' } });
      await AJP.refreshBadge();
      eq(mock.__badge.text, '!');
      await AJP.store.set('promptState', {});
      await AJP.send('radar.viewed');
      eq(mock.__badge.text, '', 'seen: the badge falls back to follow-ups (none)');
      eq((await AJP.send('radar.status')).newCount, 0);
    });
    it('save → an Applications entry with the job description; dismiss → never shown again', async () => {
      await withJob();
      const key = (await AJP.send('radar.jobs', {})).jobs[0].key;
      const r = await AJP.send('radar.job.update', { key, status: 'saved' });
      eq([r.job.status, r.app.title, r.app.company, r.app.status], ['saved', 'Senior Data Engineer', 'Acme Corp', 'in progress']);
      includes(r.app.snapshot.jd, 'Python');
      eq((await AJP.store.get('applications')).length, 1);
      await AJP.send('radar.job.update', { key, status: 'dismissed' });
      net([[/boards\/acme\//, res(gh(['Senior Data Engineer']))]]);
      await AJP.send('radar.scanNow', {});
      eq((await AJP.send('radar.jobs', { status: 'new' })).jobs.length, 0, 'seen: not added back');
    });
    it('status and settings: interval and threshold kept in range; disabled radar skips alarm scans', async () => {
      const s = (await AJP.send('radar.settings.save', { settings: { intervalHours: 0.5, threshold: 150, remote: 'moon', notify: 'x', locations: 'Austin; Remote' } })).settings;
      eq([s.intervalHours, s.threshold, s.remote, s.notify, s.locations], [1, 100, 'any', 'digest', ['Austin', 'Remote']]);
      await AJP.send('radar.settings.save', { settings: { enabled: false } });
      eq(await AJP.radarScan(), { skipped: 'disabled' });
      const st = await AJP.send('radar.status');
      eq([st.enabled, st.running, st.companies], [false, false, 0]);
    });
    it('the hourly alarm is registered; a notification click opens Job Radar', async () => {
      ok(mock.__alarms['ajp-radar'] && mock.__alarms['ajp-radar'].periodInMinutes === 60);
      mock.__created.length = 0;
      mock.__noteClick('ajp-radar');
      await waitFor(() => mock.__created.some((t) => /admin\.html#radar/.test(t.url)), { msg: 'opened' });
    });
  }, { env: 'browser' });

  describe('radar panel › Watch this company', () => {
    beforeEach(before);
    afterEach(() => {
      after();
      AJP.panel.remove();
      document.querySelectorAll('.radar-test').forEach((n) => n.remove());
      AJP.contentHooks.state.radar = null;
    });
    const shadow = () => document.querySelector('ajp-panel').shadowRoot;
    const analysis = { score: 70, matched: [{ skill: 'Python', weight: 3, source: 'profile' }], missing: [], jdSkillCount: 1, ms: 1, fit: { workType: { job: ['remote'], wanted: ['remote'], ok: true }, salary: { job: { min: 150000, max: 190000, hourly: false }, ok: true }, location: { matched: null, ok: null } } };
    it('the panel shows the button for a supported board, and "You watch" once watched', () => {
      AJP.panel.render({ job: { title: 'Dev' }, analysis, radar: { url: 'https://boards.greenhouse.io/acme', label: 'Greenhouse', watched: false } }, {});
      ok(shadow().querySelector('[data-act="watchCompany"]'));
      AJP.panel.render({ job: { title: 'Dev' }, analysis, radar: { url: 'x', label: 'Greenhouse', watched: true } }, {});
      notOk(shadow().querySelector('[data-act="watchCompany"]'));
      includes(shadow().textContent, 'You watch this company');
    });
    it('detect: only boards Job Radar can read; says whether it is already watched', async () => {
      eq((await AJP.send('radar.detect', { url: 'https://www.indeed.com/viewjob?jk=1' })).code, 'AJP-RADAR-UNSUP', 'no public feed');
      net([[/boards\/acme\//, res(gh(['Data Engineer']))]]);
      eq((await AJP.send('radar.detect', { url: 'https://boards.greenhouse.io/acme/jobs/1' })).watched, false);
      await AJP.send('radar.watch.add', { url: 'https://boards.greenhouse.io/acme' });
      eq((await AJP.send('radar.detect', { url: 'https://boards.greenhouse.io/acme/jobs/1' })).watched, true);
    });
    it('a company careers page that embeds a Greenhouse board is recognised', async () => {
      const f = document.createElement('iframe');
      f.className = 'radar-test';
      f.setAttribute('src', 'about:blank#https://boards.greenhouse.io/embed/job_board?for=acme');
      const a = document.createElement('a');
      a.className = 'radar-test';
      a.href = 'https://boards.greenhouse.io/embed/job_board?for=acme';
      document.body.appendChild(a);
      AJP.contentHooks.resetRadar();
      await AJP.contentHooks.checkRadar();
      eq([AJP.contentHooks.state.radar.key, AJP.contentHooks.state.radar.label], ['greenhouse:acme', 'Greenhouse']);
    });
    it('click: watched in one go when the board is allowed; without permission Admin opens with the link filled in', async () => {
      net([[/boards\/acme\//, res(gh(['Data Engineer']))]]);
      const st = AJP.contentHooks.state;
      st.job = { title: 'Dev' };
      st.analysis = analysis;
      st.radar = { url: 'https://boards.greenhouse.io/acme', key: 'greenhouse:acme', label: 'Greenhouse', watched: false };
      AJP.contentHooks.render();
      shadow().querySelector('[data-act="watchCompany"]').click();
      await waitFor(() => /Watching/.test(shadow().textContent), { msg: 'watching' });
      eq((await AJP.send('radar.watch.list')).entries.map((e) => e.key), ['greenhouse:acme']);
      st.radar = { url: 'https://jobs.lever.co/globex', key: 'lever:globex', label: 'Lever', watched: false };
      mock.__created.length = 0;
      AJP.contentHooks.render();
      shadow().querySelector('[data-act="watchCompany"]').click();
      await waitFor(() => mock.__created.some((t) => t.url.includes('#radar?add=' + encodeURIComponent('https://jobs.lever.co/globex'))), { msg: 'admin opened' });
      includes(shadow().textContent, 'Allow access to Lever');
    });
  }, { env: 'browser' });
})();
