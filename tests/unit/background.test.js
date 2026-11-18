/*
 * Integration tests: the real background.js and content.js run against the browser mock.
 * Messages flow exactly as in the extension (content → background → content).
 */
(function () {
  const { describe, it, eq, ok, includes, excludes, beforeEach, afterEach, waitFor, sleep } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;
  const send = (type, payload) => AJP.send(type, payload);

  let realFetch;
  const fakeAI = (content) => {
    globalThis.fetch = async (url, opts) => {
      fakeAI.bodies.push(opts.body);
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    };
  };
  fakeAI.bodies = [];
  const enableAI = () => AJP.store.update('settings', (s) => { s.ai.provider = 'groq'; s.ai.keys.groq = 'gsk-test'; });

  describe('background › messages', () => {
    beforeEach(async () => {
      await mock.__reset();
      realFetch = globalThis.fetch;
      fakeAI.bodies = [];
    });
    afterEach(() => (globalThis.fetch = realFetch));

    it('unknown message types get no handler (no crash)', async () => {
      const r = await mock.runtime.sendMessage({ type: 'doesNotExist' });
      eq(r, undefined);
    });
    it('learnAnswer stores, counts and records sites', async () => {
      await send('learnAnswer', { label: 'How did you hear about us?', value: 'LinkedIn', host: 'a.com' });
      await send('learnAnswer', { label: 'How did you hear about us', value: 'Referral', host: 'b.com' });
      await send('learnAnswer', { label: 'How did you hear about us', value: 'Referral', host: 'b.com' });
      const a = (await AJP.store.get('answers'))['how did you hear about us'];
      eq([a.value, a.count, a.hosts], ['Referral', 3, ['a.com', 'b.com']]);
    });
    it('learnAnswer ignores empty values and labels', async () => {
      await send('learnAnswer', { label: '', value: 'x' });
      await send('learnAnswer', { label: 'Q', value: '' });
      await send('learnAnswer', { label: 'Question', value: null });
      eq(await AJP.store.get('answers'), {});
    });
    it('concurrent learnAnswer messages do not lose updates', async () => {
      await Promise.all(Array.from({ length: 20 }, (_, i) => send('learnAnswer', { label: 'Question ' + i, value: 'v' + i })));
      eq(Object.keys(await AJP.store.get('answers')).length, 20);
    });
    it('recordApplication inserts, then updates the same URL', async () => {
      await send('recordApplication', { app: { url: 'https://x/1', title: 'Dev', company: 'Acme', score: 70, status: 'in progress' } });
      await send('recordApplication', { app: { url: 'https://x/1', status: 'applied' } });
      await send('recordApplication', { app: { url: 'https://x/2', title: 'Other' } });
      const list = await AJP.store.get('applications');
      eq(list.length, 2);
      const a = list.find((x) => x.url === 'https://x/1');
      eq([a.title, a.status, a.score], ['Dev', 'applied', 70]);
      ok(a.id && a.date && a.updatedAt);
    });
    it('openAdmin opens the Admin page at the right section', async () => {
      await send('openAdmin', { hash: 'resumes' });
      eq(mock.__created[0].url, 'moz-extension://test/src/admin/admin.html#resumes');
    });
    it('analyzeTab tells the page to open the panel with the selected text', async () => {
      const r = await send('analyzeTab', { tabId: 1, jdText: 'Python job' });
      ok(r.ok);
      const m = mock.__tabMsgs.find((x) => x.msg.type === 'openPanel');
      eq([m.msg.jdText, m.opts.frameId], ['Python job', 0]);
      AJP.panel.remove();
    });
    it('ai.test reports a helpful error when AI is off', async () => {
      const r = await send('ai.test');
      eq(r.ok, false);
      includes(r.error, 'AI is turned off');
    });
    it('ai.extractSkills returns parsed JSON', async () => {
      await enableAI();
      fakeAI('{"required_skills":["Go"],"preferred_skills":[],"summary":"s"}');
      const r = await send('ai.extractSkills', { jd: 'JD' });
      eq(r.result.required_skills, ['Go']);
    });
    it('ai.tailorResume needs a resume first', async () => {
      await enableAI();
      const r = await send('ai.tailorResume', { jd: 'JD', missing: [], job: {} });
      eq(r.ok, false);
      includes(r.error, 'No resume text');
    });
    it('ai.tailorResume saves a new resume version with gap notes, original untouched', async () => {
      await enableAI();
      await AJP.store.set('resumes', { activeId: 'orig', items: [{ id: 'orig', name: 'Mine', text: 'ORIGINAL', createdAt: '2026-01-01' }] });
      fakeAI('# Ana\n## Skills\nPython\n---GAPS---\n- not covered: Kafka — take a course');
      const r = await send('ai.tailorResume', { jd: 'JD', missing: ['Kafka'], job: { title: 'Dev', company: 'Acme' } });
      ok(r.ok, r.error);
      const res = await AJP.store.get('resumes');
      eq(res.items.length, 2);
      eq(res.activeId, 'orig', 'active resume unchanged');
      eq(res.items[1].text, 'ORIGINAL');
      const t = res.items[0];
      eq([t.name, t.basedOn], ['Tailored — Acme — Dev', 'orig']);
      eq(t.text, '# Ana\n## Skills\nPython');
      includes(t.gaps, 'Kafka');
    });
    it('ai.draftAnswer returns text and sends no EEO data', async () => {
      await enableAI();
      await AJP.store.update('profile', (p) => void (p.autoApply.eeo.race = 'SECRET_RACE'));
      await AJP.store.set('resumes', { activeId: 'r', items: [{ id: 'r', text: 'resume', createdAt: '' }] });
      fakeAI('Because I love it.');
      const r = await send('ai.draftAnswer', { question: 'Why?', jd: 'JD', job: {} });
      eq(r.text, 'Because I love it.');
      excludes(fakeAI.bodies.join(''), 'SECRET_RACE');
    });
  }, { env: 'browser' });

  describe('background › log storage (support logs)', () => {
    beforeEach(() => mock.__reset());

    it('logs from pages are persisted by the background', async () => {
      await send('log', { entries: [{ t: 'now', lvl: 'info', ctx: 'content', mod: 'x', msg: 'from page' }] });
      includes((await AJP.store.get('logs')).map((l) => l.msg), 'from page');
    });
    it('background logs are persisted too', async () => {
      AJP.setLogLevel('info');
      AJP.logger('unit').info('bg entry');
      await AJP.flushLogs();
      await waitFor(async () => (await AJP.store.get('logs')).some((l) => l.msg === 'bg entry'), { msg: 'bg log saved' });
    });
    it('keeps at most 3000 entries (oldest dropped)', async () => {
      const batch = (n, p) => Array.from({ length: n }, (_, i) => ({ t: '', lvl: 'info', ctx: 'c', mod: 'm', msg: p + i }));
      await AJP.store.set('logs', batch(2950, 'old'));
      await send('log', { entries: batch(100, 'new') });
      const logs = await AJP.store.get('logs');
      eq(logs.length, 3000);
      eq(logs[logs.length - 1].msg, 'new99');
      excludes(logs.map((l) => l.msg), 'old0');
    });
    it('a single page can not flood the log in one message (max 200)', async () => {
      await send('log', { entries: Array.from({ length: 1000 }, (_, i) => ({ msg: 'm' + i })) });
      eq((await AJP.store.get('logs')).length, 200);
    });
    it('failed messages are logged as errors', async () => {
      await send('ai.test');
      await AJP.flushLogs();
      await waitFor(async () => (await AJP.store.get('logs')).some((l) => l.lvl === 'error' && /ai\.test failed/.test(l.msg)), { msg: 'error log' });
    });
  }, { env: 'browser' });

  describe('end-to-end › page analysis and autofill', () => {
    const sandbox = () => document.getElementById('sandbox');
    const shadow = () => document.querySelector('ajp-panel') && document.querySelector('ajp-panel').shadowRoot;
    beforeEach(async () => {
      await mock.__reset();
      await AJP.store.update('profile', (p) => {
        p.personal.firstName = 'Ana';
        p.personal.email = 'ana@example.com';
        p.skills = [{ name: 'Python' }, { name: 'Docker' }];
      });
    });
    afterEach(() => {
      AJP.panel.remove();
      sandbox().innerHTML = '';
    });

    it('right-click "analyze selection" shows a score in the panel', async () => {
      await send('analyzeTab', { tabId: 1, jdText: 'Requirements\nPython\nDocker\nKubernetes' });
      await waitFor(() => shadow() && /\d+%/.test(shadow().querySelector('.badge').textContent), { msg: 'score badge' });
      eq(shadow().querySelector('.badge').textContent, '67%');
    });
    it('autofill button fills the form and the panel shows the report', async () => {
      sandbox().innerHTML = '<label for="a">First name</label><input id="a"><label for="b">Email</label><input id="b"><label for="c">Why us?</label><textarea id="c"></textarea>';
      await send('analyzeTab', { tabId: 1, jdText: 'Requirements\nPython' });
      await waitFor(() => shadow() && shadow().querySelector('[data-act="autofill"]'), { msg: 'panel' });
      shadow().querySelector('[data-act="autofill"]').click();
      await waitFor(() => document.getElementById('a').value === 'Ana', { msg: 'filled' });
      eq(document.getElementById('b').value, 'ana@example.com');
      await waitFor(() => /Filled \d+ from profile/.test(shadow().textContent), { msg: 'report' });
      ok(shadow().querySelector('[data-act="draft"]'), 'draft button for the textarea question');
      const apps = await waitFor(async () => { const l = await AJP.store.get('applications'); return l.length && l; }, { msg: 'application tracked' });
      eq(apps[0].status, 'in progress');
    });
    it('"Mark applied" records the application', async () => {
      await send('analyzeTab', { tabId: 1, jdText: 'Requirements\nPython' });
      await waitFor(() => shadow() && shadow().querySelector('[data-act="applied"]'));
      shadow().querySelector('[data-act="applied"]').click();
      const apps = await waitFor(async () => { const l = await AJP.store.get('applications'); return l.length && l; });
      eq([apps[0].status, apps[0].score], ['applied', 100]);
      await sleep(10);
    });
  }, { env: 'browser' });
})();
