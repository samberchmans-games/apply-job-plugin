/*
 * Problem reports on GitHub (option A) end to end: crash prompt, similar reports, My reports status, badge, Admin.
 * GitHub is faked: no network calls leave the test page.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach, waitFor, sleep } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;
  const sh = () => document.querySelector('ajp-panel') && document.querySelector('ajp-panel').shadowRoot;
  const err = (code, msg = 'something broke') => ({ t: new Date().toISOString(), lvl: 'error', ctx: 'content', mod: 'x', msg, code });
  const pageError = (code) => AJP.send('log', { entries: [err(code)] });
  const promptState = () => AJP.store.get('promptState');

  let realFetch;
  let fetched;
  function fakeGitHub(handler) {
    fetched = [];
    globalThis.fetch = async (url) => {
      fetched.push(decodeURIComponent(url));
      const r = handler(decodeURIComponent(url));
      if (r instanceof Error) throw r;
      return new Response(JSON.stringify(r), { status: 200 });
    };
  }
  const issue = (number, state, labels, title = '') => ({ number, title, html_url: `https://github.com/samberchmans-games/apply-job-plugin/issues/${number}`, state, labels: labels.map((name) => ({ name })) });

  describe('problem reports › crash prompt', () => {
    beforeEach(async () => {
      await mock.__reset();
      await AJP.send('analyzeTab', { tabId: 1, jdText: 'Requirements\nJava' });
      await waitFor(() => sh() && sh().querySelector('.badge'));
    });
    afterEach(() => AJP.panel.remove());

    it('an unexpected error on a page shows a "Report it?" prompt in the panel', async () => {
      await pageError('AJP-INTERNAL');
      await waitFor(() => sh().querySelector('.crash'), { msg: 'prompt' });
      includes(sh().querySelector('.crash').textContent, 'AJP-INTERNAL');
      includes(sh().querySelector('.crash').textContent, 'Nothing is sent until you review it');
      eq((await promptState()).pending.code, 'AJP-INTERNAL');
    });
    it('the toolbar badge shows "!" while a problem waits to be reported', async () => {
      await pageError('AJP-INTERNAL');
      await waitFor(() => mock.__badge.text === '!', { msg: 'badge' });
      eq(mock.__badge.color, '#dc2626');
    });
    it('"Not now" hides it and clears the badge; it won\'t ask again today', async () => {
      await pageError('AJP-INTERNAL');
      await waitFor(() => sh().querySelector('[data-act="crashLater"]'));
      sh().querySelector('[data-act="crashLater"]').click();
      await waitFor(async () => !(await promptState()).pending, { msg: 'cleared' });
      await waitFor(() => mock.__badge.text !== '!', { msg: 'badge cleared' });
      await pageError('AJP-INTERNAL');
      await sleep(80);
      notOk((await promptState()).pending, 'once per day');
    });
    it('"Don\'t ask again" is remembered for that error code', async () => {
      await pageError('AJP-INTERNAL');
      await waitFor(() => sh().querySelector('[data-act="crashNever"]'));
      sh().querySelector('[data-act="crashNever"]').click();
      await waitFor(async () => (await promptState()).never && (await promptState()).never['AJP-INTERNAL'], { msg: 'never' });
    });
    it('"Report" opens Admin with the report dialog for that code', async () => {
      await pageError('AJP-STORE');
      await waitFor(() => sh().querySelector('[data-act="crashReport"]'));
      mock.__created.length = 0;
      sh().querySelector('[data-act="crashReport"]').click();
      await waitFor(() => mock.__created.length, { msg: 'admin opened' });
      includes(mock.__created[0].url, '#logs?report=1&code=AJP-STORE');
    });
    it('problems users fix themselves (AI off, rate limit) never prompt', async () => {
      for (let i = 0; i < 4; i++) await pageError('AJP-AI-429');
      await sleep(80);
      notOk((await promptState()).pending);
    });
    it('the same unexpected error 3× in 10 minutes prompts', async () => {
      for (let i = 0; i < 3; i++) await pageError('AJP-AI-5XX');
      await waitFor(async () => (await promptState()).pending, { msg: 'prompt after 3' });
    });
    it('with the setting off, nothing prompts', async () => {
      await AJP.store.update('settings', (s) => void (s.support.crashPrompt = false));
      await pageError('AJP-INTERNAL');
      await sleep(80);
      notOk((await promptState()).pending);
    });
  }, { env: 'browser' });

  describe('problem reports › GitHub lookups', () => {
    beforeEach(async () => {
      await mock.__reset();
      realFetch = globalThis.fetch;
    });
    afterEach(() => (globalThis.fetch = realFetch));
    const reports = () => AJP.store.get('reports');
    const save = (id) => AJP.send('report.saved', { report: { reportId: id, codes: ['AJP-INTERNAL'], title: `[AJP-INTERNAL] x (${id})` } });

    it('similar reports: open issues with the same code', async () => {
      fakeGitHub(() => ({ items: [issue(7, 'open', ['bug'], '[AJP-AI-429] Draft failed (R-1)')] }));
      const r = await AJP.send('github.similar', { codes: ['AJP-AI-429'] });
      eq(r.items, [{ number: 7, title: '[AJP-AI-429] Draft failed (R-1)', url: 'https://github.com/samberchmans-games/apply-job-plugin/issues/7', state: 'open' }]);
      includes(fetched[0], 'is:open "AJP-AI-429" in:title');
      ok(fetched[0].startsWith('https://api.github.com/search/issues'));
    });
    it('similar reports offline: no error, just nothing found', async () => {
      fakeGitHub(() => new TypeError('Failed to fetch'));
      const r = await AJP.send('github.similar', { codes: ['AJP-AI-429'] });
      eq([r.ok, r.items, r.unavailable], [true, [], true]);
    });
    it('a saved report starts as "not submitted"', async () => {
      await save('R-20261118-AAAAA');
      eq((await reports())[0].status, 'not-submitted');
    });
    it('status: received → fixed in vX, with the issue number', async () => {
      await save('R-20261118-AAAAA');
      fakeGitHub(() => ({ items: [issue(42, 'open', ['bug', 'needs-triage'])] }));
      await AJP.send('github.status', { force: true });
      eq([(await reports())[0].status, (await reports())[0].number], ['received', 42]);
      fakeGitHub(() => ({ items: [issue(42, 'closed', ['fixed-in:v0.2.0'])] }));
      await AJP.send('github.status', { force: true });
      const r = (await reports())[0];
      eq([r.status, r.version, r.seen], ['fixed', 'v0.2.0', false]);
    });
    it('a newly fixed report shows ✓ on the toolbar until seen', async () => {
      await save('R-20261118-AAAAA');
      fakeGitHub(() => ({ items: [issue(42, 'closed', ['fixed-in:v0.2.0'])] }));
      await AJP.send('github.status', { force: true });
      await waitFor(() => mock.__badge.text === '✓', { msg: 'badge ✓' });
      await AJP.send('reports.seen');
      await waitFor(() => mock.__badge.text === '', { msg: 'badge cleared' });
    });
    it('fixed/closed reports are not checked again', async () => {
      await AJP.store.set('reports', [{ reportId: 'R-1', status: 'fixed' }, { reportId: 'R-2', status: 'duplicate' }]);
      fakeGitHub(() => ({ items: [] }));
      eq((await AJP.send('github.status', { force: true })).checked, 0);
    });
    it('checks at most 5 reports per run, and not more than every 10 minutes', async () => {
      for (let i = 0; i < 8; i++) await save('R-20261118-0000' + i);
      fakeGitHub(() => ({ items: [] }));
      eq((await AJP.send('github.status', {})).checked, 5);
      eq((await AJP.send('github.status', {})).checked, 3, 'the other 3 next');
      eq((await AJP.send('github.status', {})).checked, 0, 'throttled');
    });
    it('offline: status becomes "couldn\'t check" (no crash)', async () => {
      await save('R-20261118-AAAAA');
      fakeGitHub(() => new TypeError('Failed to fetch'));
      await AJP.send('github.status', { force: true });
      const r = (await reports())[0];
      eq([r.status, r.checkFailed], ['unknown', true]);
    });
  }, { env: 'browser' });

  describe('problem reports › Admin', () => {
    let frame;
    let w;
    let opened;
    const $ = (s) => w.document.querySelector(s);
    async function loadAdmin(seed, hash = 'logs') {
      let html = await (await fetch('../src/admin/admin.html', { cache: 'no-store' })).text();
      html = html.replace('<script src="tracker-view.js"></script>', '<script src="../background/background.js"></script>\n<script src="tracker-view.js"></script>');
      const page = html.replace('<head>', '<head><base href="' + new URL('../src/admin/', location.href).href + '"><script>window.__SEED__=' + JSON.stringify(seed) + '</script>')
        .replace('<script src="../lib/core.js"></script>', '<script src="../../tests/mocks/browser-mock.js"></script><script>browser.storage.local.set(window.__SEED__); window.fetch = async (u) => { window.__fetched = (window.__fetched || []).concat(decodeURIComponent(u)); return new Response(JSON.stringify(window.__GH__ ? window.__GH__(decodeURIComponent(u)) : { items: [] })); };</script><script src="../lib/core.js"></script>');
      frame = document.createElement('iframe');
      frame.style.cssText = 'width:1200px;height:800px;border:0;position:absolute;left:-5000px;top:0';
      document.body.appendChild(frame);
      await new Promise((res) => {
        frame.onload = res;
        frame.srcdoc = page;
      });
      w = frame.contentWindow;
      opened = [];
      w.open = (u) => opened.push(u);
      await waitFor(() => w.AJP && w.AJP.renderReports && $('#ver').textContent, { msg: 'admin' });
      w.location.hash = hash;
      await waitFor(() => $('#logs').classList.contains('on'), { msg: 'logs tab' });
    }
    afterEach(() => frame && frame.remove());

    it('Report on GitHub: shows similar open reports first, then opens the pre-filled form', async () => {
      await loadAdmin({ logs: [err('AJP-AI-5XX', 'ai failed')] });
      w.__GH__ = () => ({ items: [issue(7, 'open', ['bug'], '[AJP-AI-5XX] AI failed (R-1)')] });
      $('#reportOpen').click();
      $('#reportText').value = 'Tailor resume failed on Greenhouse';
      $('#reportGitHub').click();
      await waitFor(() => !$('#ghSimilar').hidden, { msg: 'similar shown' });
      includes($('#ghSimilar').textContent, '#7 [AJP-AI-5XX] AI failed');
      eq(opened.length, 0, 'not opened yet');
      $('#reportGitHub').click();
      await waitFor(() => opened.length, { msg: 'github opened' });
      ok(opened[0].startsWith('https://github.com/samberchmans-games/apply-job-plugin/issues/new?template=bug_report.yml'));
      includes(decodeURIComponent(opened[0]), 'Tailor resume failed on Greenhouse');
      const reps = await waitFor(async () => { const r = await w.AJP.store.get('reports'); return r.length && r; }, { msg: 'saved' });
      ok(/^R-\d{8}-[A-Z0-9]{5}$/.test(reps[0].reportId));
      includes($('#reportOut').textContent, 'Submit new issue');
      await waitFor(() => /Not submitted yet/.test($('#myReports').textContent), { msg: 'My reports row' });
    });
    it('My reports shows status, issue link and fix version', async () => {
      await loadAdmin({ reports: [
        { reportId: 'R-1', title: '[AJP-INTERNAL] Panel froze (R-1)', createdAt: '2026-11-10T00:00:00Z', status: 'fixed', number: 42, url: 'https://github.com/x/42', version: 'v0.2.0', seen: true },
        { reportId: 'R-2', title: '[AJP-STORE] Save failed (R-2)', createdAt: '2026-11-12T00:00:00Z', status: 'received', number: 43, url: 'https://github.com/x/43', checkedAt: new Date().toISOString() },
      ] });
      await waitFor(() => w.document.querySelectorAll('#myReports tbody tr').length === 2, { msg: 'rows' });
      const t = $('#myReports').textContent;
      includes(t, '🎉 Fixed #42 in v0.2.0');
      includes(t, '✅ Received #43');
    });
    it('a background problem shows a banner; "Not now" clears it', async () => {
      await loadAdmin({ promptState: { pending: { code: 'AJP-INTERNAL', msg: 'x', at: Date.now() } } });
      await waitFor(() => !$('#crashBanner').hidden, { msg: 'banner' });
      includes($('#crashBanner').textContent, 'AJP-INTERNAL');
      $('[data-crash="later"]').click();
      await waitFor(async () => !(await w.AJP.store.get('promptState')).pending, { msg: 'cleared' });
      ok($('#crashBanner').hidden);
    });
    it('"Simulate a problem" (for testers) raises the report prompt through the normal path', async () => {
      await loadAdmin({});
      $('#simulateError').click();
      await waitFor(async () => (await w.AJP.store.get('promptState')).pending, { msg: 'pending' });
      await waitFor(() => !$('#crashBanner').hidden, { msg: 'banner' });
      includes($('#crashBanner').textContent, 'AJP-INTERNAL');
    });
    it('the link from a crash prompt opens the dialog with the code filled in', async () => {
      await loadAdmin({}, 'logs?report=1&code=AJP-INTERNAL');
      await waitFor(() => $('#reportDialog').open, { msg: 'dialog' });
      includes($('#reportText').value, 'AJP-INTERNAL');
    });
  }, { env: 'browser' });
})();
