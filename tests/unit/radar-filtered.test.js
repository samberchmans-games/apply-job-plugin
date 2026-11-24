/*
 * Remote limits (states and countries) and Job Radar's Filtered list: every job left out keeps its reason,
 * can be moved back, and returns by itself when your preferences change.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const M = AJP.matcher;
  const C = AJP.radar.core;
  const nj = { areas: ['NJ'], personal: {} };
  const check = (description, locations = ['Remote'], p = nj) => M.remoteRestriction({ description, locations }, p.areas, p);

  describe('remote limits › states', () => {
    it('state names, codes and lists', () => {
      eq([...M.statesIn('New Jersey, West Virginia and Washington, DC')].sort(), ['DC', 'NJ', 'WV']);
      eq([...M.statesIn('CA, OR, WA')].sort(), ['CA', 'OR', 'WA']);
    });
    it('ordinary capitals are not states', () => {
      eq(M.statesIn('Work IN the cloud OR on site, MA degree preferred').size, 0);
    });
  });

  describe('remote limits › what the job says', () => {
    it('your state excluded: limited', () => {
      for (const t of ['This role is not available in NJ, NY or CA.', 'We are unable to hire in New Jersey.', 'Open across the US except for New Jersey and Alaska.', 'We cannot hire in the following states:\nNJ\nNY']) {
        eq([t, check(t).status], [t, 'limited']);
      }
    });
    it('another state excluded: open', () => eq(check('This role is not available in NY or CA.').status, 'open'));
    it('must live in other states: limited; in yours: open', () => {
      const r = check('You must reside in CA, TX or WA.');
      eq([r.status, r.why], ['limited', 'Only in CA, TX, WA']);
      eq(check('You must reside in CA, NJ or WA.').status, 'open');
    });
    it('your state unknown: shown with a note', () => {
      const r = check('You must live in CA or TX.', ['Remote'], { areas: ['United States'], personal: {} });
      eq(r.status, 'check');
    });
    it('a country limit', () => {
      eq(check('Candidates must be located in Canada.').status, 'limited');
      eq(check('Candidates must be located in the U.S. to apply.').status, 'open');
    });
    it('US-wide wins over a country list', () => eq(check('You must reside in the US.', ['Germany', 'Spain']).status, 'open'));
    it('pay and legal notices naming states are not limits', () => {
      for (const t of ['Salary for New Jersey is not available until the offer stage.', 'Benefits are not available in NJ for contractors.', 'Except where prohibited by law in New Jersey.', 'You will join us and enjoy our team.']) eq([t, check(t).status], [t, 'open']);
    });
  });

  describe('remote limits › what the location says', () => {
    it('open remote listed abroad: shown with a note', () => {
      const r = check('', ['The Netherlands', 'Germany']);
      eq(r.status, 'listed');
      includes(r.why, 'confirm they hire in the US');
    });
    it('scoped remote', () => {
      eq(check('', ['Remote Canada']).status, 'limited');
      eq(check('', ['Remote - EMEA only']).status, 'limited');
      eq(check('', ['Remote - California']).status, 'limited');
      eq(check('', ['Remote - New Jersey']).status, 'open');
    });
    it('worldwide or your country: open', () => {
      for (const l of ['Remote - Worldwide', 'Remote US', 'Anywhere']) eq([l, check('', [l]).status], [l, 'open']);
    });
    it('a region includes the countries in it', () => {
      const de = { areas: ['Berlin, Germany'], personal: {} };
      eq(check('', ['Remote - EMEA'], de).status, 'open');
    });
  });

  describe('filtered list › storage', () => {
    const rec = (key, at, description) => ({ key, filteredAt: new Date(at).toISOString(), reason: 'title', ...(description ? { description, descriptionLevel: 'full' } : {}) });
    const now = Date.parse('2026-06-01T00:00:00Z');
    it('one record per job, the newest reason wins', () => {
      const out = C.mergeFiltered([rec('a', now - 5000)], [{ ...rec('a', now), reason: 'skills' }], now);
      eq(out.map((j) => [j.key, j.reason]), [['a', 'skills']]);
    });
    it('old records expire', () => eq(C.mergeFiltered([rec('old', now - 61 * 86400000), rec('ok', now)], [], now).map((j) => j.key), ['ok']));
    it('a kept description is trimmed: the list is rewritten after every company', () => {
      const f = C.toFiltered({ key: 'k', title: 'T', description: 'x'.repeat(20000), descriptionLevel: 'full' }, 'skills', '', now, true);
      eq(f.description.length, C.LIMITS.filteredTextChars);
    });
    it('a title-stage record does not keep the description', () => {
      const f = C.toFiltered({ key: 'k', title: 'T', description: 'long', descriptionLevel: 'full' }, 'title', '', now);
      eq([f.description, f.descriptionLevel, f.reason], [undefined, 'title', 'title']);
    });
  });

  describe('filtered list › background', () => {
    const mock = globalThis.browser;
    const job = (id, o = {}) => ({ ...C.normalize({ id, title: 'Data Engineer', locations: ['Remote'], description: 'Python and SQL pipelines with Airflow.', raw: { workplaceType: 'remote' }, foundAt: new Date().toISOString() }, { board: 'ashby', company: 'acme' }), status: 'new', score: 80, ...o });
    beforeEach(async () => {
      await mock.__reset();
      const p = AJP.clone(AJP.store.DEFAULTS.profile);
      Object.assign(p, { targetRoles: ['Data Engineer'], areas: ['NJ'], skills: [{ name: 'Python' }, { name: 'SQL' }, { name: 'Airflow' }], workTypes: { remote: true, hybrid: true, onsite: true } });
      await AJP.store.set('profile', p);
    });
    it('a re-check moves a restricted job to Filtered with the reason', async () => {
      await AJP.store.set('radarJobs', [job(1, { description: 'Python, SQL and Airflow. This role is not available in NJ.' })]);
      await AJP.radarRefilter();
      eq((await AJP.store.get('radarJobs')).length, 0);
      const r = await AJP.send('radar.filtered', {});
      eq([r.total, r.jobs[0].reason, r.jobs[0].detail, r.counts.restricted], [1, 'restricted', 'Not available in NJ', 1]);
      eq(r.jobs[0].description, undefined, 'lists stay light');
    });
    it('Move to Matched keeps it there on later re-checks', async () => {
      await AJP.store.set('radarJobs', [job(1, { description: 'Python, SQL and Airflow. This role is not available in NJ.' })]);
      await AJP.radarRefilter();
      const { jobs } = await AJP.send('radar.filtered', {});
      eq((await AJP.send('radar.filtered.restore', { key: jobs[0].key })).moved, true);
      await AJP.radarRefilter();
      const l = await AJP.store.get('radarJobs');
      eq([l.length, l[0].override], [1, true]);
      eq((await AJP.send('radar.filtered', {})).total, 0);
    });
    it('a filtered job returns when your preferences change', async () => {
      await AJP.store.set('radarJobs', [job(1, { description: 'Python, SQL and Airflow. This role is not available in NJ.' })]);
      await AJP.radarRefilter();
      await AJP.store.update('profile', (p) => void (p.areas = ['TX']));
      const r = await AJP.radarRefilter();
      eq(r.returned, 1);
      eq((await AJP.store.get('radarJobs')).length, 1);
      eq((await AJP.send('radar.filtered', {})).total, 0);
    });
    it('without its description it is read again by the next scan', async () => {
      const f = C.toFiltered(job(2), 'title', '', Date.now());
      await AJP.store.set('radarFiltered', [f]);
      await AJP.store.set('radarSeen', { [f.key]: new Date().toISOString() });
      await AJP.radarRefilter();
      notOk((await AJP.store.get('radarSeen'))[f.key]);
      eq((await AJP.store.get('radarFiltered')).length, 0);
    });
    it('pages, reason filter and counts', async () => {
      const list = Array.from({ length: 30 }, (_, i) => C.toFiltered(job(100 + i), i < 10 ? 'level' : 'title', '', Date.now() - i));
      await AJP.store.set('radarFiltered', list);
      const p2 = await AJP.send('radar.filtered', { offset: 25, limit: 25 });
      eq([p2.total, p2.jobs.length, p2.counts.level, p2.counts.title], [30, 5, 10, 20]);
      eq((await AJP.send('radar.filtered', { reason: 'level' })).total, 10);
    });
    it('hiding a company clears its filtered records', async () => {
      await AJP.store.set('radarFiltered', [C.toFiltered(job(3), 'title', '', Date.now())]);
      await AJP.send('radar.company.hide', { board: 'ashby', company: 'acme' });
      eq((await AJP.store.get('radarFiltered')).length, 0);
    });
    it('filtered records are never exported', async () => {
      await AJP.store.set('radarFiltered', [C.toFiltered(job(4), 'title', '', Date.now())]);
      notOk('radarFiltered' in (await AJP.store.exportAll()).data);
    });
  }, { env: 'browser' });
})();
