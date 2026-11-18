(function () {
  const { describe, it, eq, ok, rejects, beforeEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;

  describe('storage › local "database"', () => {
    beforeEach(() => mock.__reset());

    it('returns defaults when nothing is stored', async () => {
      const p = await AJP.store.get('profile');
      eq(p.skills, []);
      eq(p.workTypes, { remote: true, hybrid: true, onsite: false });
      eq((await AJP.store.get('settings')).ai.provider, 'none');
      eq(await AJP.store.get('answers'), {});
    });
    it('fills in new default fields for data saved by an older version', async () => {
      await mock.storage.local.set({ profile: { personal: { firstName: 'Ana' } } });
      const p = await AJP.store.get('profile');
      eq(p.personal.firstName, 'Ana');
      eq(p.personal.lastName, '');
      eq(p.autoApply.eeo.veteran, '');
    });
    it('set then get round-trips', async () => {
      await AJP.store.set('applications', [{ id: 'a1' }]);
      eq(await AJP.store.get('applications'), [{ id: 'a1' }]);
    });
    it('get returns a copy (callers cannot corrupt the cache)', async () => {
      const a = await AJP.store.get('profile');
      a.skills.push({ name: 'X' });
      eq((await AJP.store.get('profile')).skills, []);
    });
    it('cache is invalidated when another context writes', async () => {
      await AJP.store.get('answers'); // warm cache
      await mock.storage.local.set({ answers: { k: { value: 'v' } } }); // "another tab"
      eq((await AJP.store.get('answers')).k.value, 'v');
    });
    it('a read racing with a write never caches the stale value', async () => {
      await AJP.store.set('settings', { ...AJP.store.DEFAULTS.settings, logLevel: 'warn' });
      const slowRead = AJP.store.get('settings'); // starts before the write below lands
      await mock.storage.local.set({ settings: { ...AJP.store.DEFAULTS.settings, logLevel: 'error' } });
      await slowRead;
      eq((await AJP.store.get('settings')).logLevel, 'error');
    });
    it('update applies a mutation', async () => {
      await AJP.store.update('profile', (p) => void p.skills.push({ name: 'Go' }));
      eq((await AJP.store.get('profile')).skills, [{ name: 'Go' }]);
    });
    it('update can return a replacement value', async () => {
      await AJP.store.update('applications', () => [{ id: 'x' }]);
      eq(await AJP.store.get('applications'), [{ id: 'x' }]);
    });
    it('getMany fetches several keys', async () => {
      const r = await AJP.store.getMany(['profile', 'settings']);
      ok(r.profile && r.settings);
    });
    it('activeResume returns the active one, else the first, else null', async () => {
      eq(await AJP.store.activeResume(), null);
      await AJP.store.set('resumes', { activeId: 'b', items: [{ id: 'a' }, { id: 'b' }] });
      eq((await AJP.store.activeResume()).id, 'b');
      await AJP.store.set('resumes', { activeId: 'gone', items: [{ id: 'a' }] });
      eq((await AJP.store.activeResume()).id, 'a');
    });
  }, { env: 'browser' });

  describe('storage › backup / restore / wipe', () => {
    beforeEach(() => mock.__reset());

    it('export strips API keys by default', async () => {
      await AJP.store.update('settings', (s) => void (s.ai.keys.groq = 'gsk_secret'));
      const b = await AJP.store.exportAll();
      eq(b.app, 'apply-job-plugin');
      eq(b.data.settings.ai.keys.groq, '');
    });
    it('export can include API keys when asked', async () => {
      await AJP.store.update('settings', (s) => void (s.ai.keys.groq = 'gsk_secret'));
      eq((await AJP.store.exportAll({ includeKeys: true })).data.settings.ai.keys.groq, 'gsk_secret');
    });
    it('export leaves logs out by default', async () => {
      await AJP.store.set('logs', [{ msg: 'x' }]);
      ok(!('logs' in (await AJP.store.exportAll()).data));
    });
    it('import restores data', async () => {
      await AJP.store.update('profile', (p) => void (p.personal.firstName = 'Ana'));
      const b = await AJP.store.exportAll();
      await AJP.store.wipe();
      eq((await AJP.store.get('profile')).personal.firstName, '');
      await AJP.store.importAll(b);
      eq((await AJP.store.get('profile')).personal.firstName, 'Ana');
    });
    it('import rejects files that are not backups', async () => {
      await rejects(() => AJP.store.importAll({ hello: 1 }), /Not an Apply Job backup/);
      await rejects(() => AJP.store.importAll(null), /Not an Apply Job backup/);
    });
    it('import ignores logs and unknown keys', async () => {
      const keys = await AJP.store.importAll({ app: 'apply-job-plugin', data: { logs: [1], evil: 1, answers: {} } });
      eq(keys, ['answers']);
      ok(!('evil' in mock.__data));
    });
    it('wipe deletes everything', async () => {
      await AJP.store.set('answers', { a: 1 });
      await AJP.store.wipe();
      eq(Object.keys(mock.__data).length, 0);
    });
  }, { env: 'browser' });
})();
