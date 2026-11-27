/*
 * The extension database: data that changes often, and the API keys, live where job-site pages can't read them and
 * where a write isn't copied to every open tab. Same AJP.store API; old data moves over by itself.
 */
(function () {
  const { describe, it, eq, ok, notOk, beforeEach, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;
  const raw = async (k) => (await mock.storage.local.get(k))[k];

  describe('extension database › storage', () => {
    beforeEach(async () => {
      await mock.__reset();
      AJP.store._useDb(true);
      await AJP.store.wipe();
    });
    afterEach(async () => {
      await AJP.store.wipe();
      AJP.store._useDb(false);
    });
    it('busy data is kept in the database, not in shared storage', async () => {
      await AJP.store.set('radarJobs', [{ key: 'a' }]);
      eq(await AJP.store.get('radarJobs'), [{ key: 'a' }]);
      eq(await raw('radarJobs'), undefined);
    });
    // aiCalls, not logs: the background writes its own log lines at any moment during the test run.
    it('data saved before the update moves over once', async () => {
      await mock.storage.local.set({ aiCalls: [{ task: 'old' }] });
      eq((await AJP.store.get('aiCalls')).map((l) => l.task), ['old']);
      eq(await raw('aiCalls'), undefined);
      eq((await AJP.store.get('aiCalls')).length, 1);
    });
    it('API keys never sit in shared storage; the extension still sees them', async () => {
      await AJP.store.update('settings', (s) => void (s.ai.keys.groq = 'gsk-secret'));
      eq((await AJP.store.get('settings')).ai.keys.groq, 'gsk-secret');
      eq((await raw('settings')).ai.keys.groq, '');
    });
    it('keys saved before the update move over', async () => {
      const s = AJP.clone(AJP.store.DEFAULTS.settings);
      s.ai.keys.gemini = 'AIza-old';
      await mock.storage.local.set({ settings: s });
      eq((await AJP.store.get('settings')).ai.keys.gemini, 'AIza-old');
      eq((await raw('settings')).ai.keys.gemini, '');
    });
    it('a job-site page sees settings without keys', async () => {
      await AJP.store.update('settings', (s) => void (s.ai.keys.groq = 'gsk-secret'));
      AJP.store._useDb(false);
      eq((await AJP.store.get('settings')).ai.keys.groq, '');
      AJP.store._useDb(true);
    });
    it('changes reach listeners', async () => {
      const seen = [];
      AJP.store.onChange((c) => seen.push(...Object.keys(c)));
      await AJP.store.set('radarFiltered', []);
      await waitFor(() => seen.includes('radarFiltered'), { msg: 'notice' });
    });
    it('backup: keys only when asked; restore puts each part back in its place', async () => {
      await AJP.store.update('settings', (s) => void (s.ai.keys.groq = 'gsk-secret'));
      await AJP.store.set('radarWatchlist', [{ key: 'greenhouse:acme' }]);
      const plain = await AJP.store.exportAll();
      eq(plain.data.settings.ai.keys.groq, '');
      const full = await AJP.store.exportAll({ includeKeys: true });
      eq(full.data.settings.ai.keys.groq, 'gsk-secret');
      await AJP.store.wipe();
      await AJP.store.importAll(full);
      eq((await AJP.store.get('settings')).ai.keys.groq, 'gsk-secret');
      eq((await raw('settings')).ai.keys.groq, '');
      eq(await AJP.store.get('radarWatchlist'), [{ key: 'greenhouse:acme' }]);
    });
    it('wipe clears both places', async () => {
      await AJP.store.set('modelHealth', { groq: { last: 'm' } });
      await AJP.store.wipe();
      eq(await AJP.store.get('modelHealth'), {});
    });
  }, { env: 'browser' });

  describe('background › what job-site pages may ask for', () => {
    beforeEach(() => mock.__reset());
    it('a page can analyze and autofill', async () => {
      mock.__senderUrl = 'https://boards.greenhouse.io/acme/jobs/1';
      const r = await AJP.send('tabJob.get', { url: 'https://boards.greenhouse.io/acme/jobs/1' });
      ok(r.ok !== false, JSON.stringify(r));
    });
    it('a page cannot control Job Radar or run AI checks', async () => {
      mock.__senderUrl = 'https://boards.greenhouse.io/acme/jobs/1';
      for (const type of ['radar.restart', 'ai.check', 'radar.settings.save', 'report.saved']) eq((await AJP.send(type, {})).code, 'AJP-MSG-DENIED', type);
    });
    it('the extension’s own pages can', async () => {
      mock.__senderUrl = mock.runtime.getURL('src/admin/admin.html');
      notOk((await AJP.send('radar.status', {})).code === 'AJP-MSG-DENIED');
    });
    it('every message our page code sends is on the list', async () => {
      const m = await (await fetch('../manifest.json', { cache: 'no-store' })).json();
      const sent = new Set();
      for (const f of m.content_scripts[0].js) {
        const text = await (await fetch('../' + f, { cache: 'no-store' })).text();
        const code = text.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n'); // not examples in comments
        for (const x of code.matchAll(/AJP\.send\('([\w.]+)'/g)) sent.add(x[1]);
      }
      ok(sent.size > 15, 'found the page code');
      eq([...sent].filter((t) => !AJP.PAGE_MESSAGES.has(t)), []);
    });
  }, { env: 'browser' });
})();
