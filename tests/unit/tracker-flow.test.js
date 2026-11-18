/*
 * Application tracker, end-to-end: real content script + background + detector against the browser mock.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach, waitFor, sleep } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;
  const sandbox = () => document.getElementById('sandbox');
  const shadow = () => document.querySelector('ajp-panel') && document.querySelector('ajp-panel').shadowRoot;
  const apps = () => AJP.store.get('applications');
  const tabJobs = () => AJP.store.get('tabJobs');
  const firstApp = () => waitFor(async () => (await apps())[0], { msg: 'application saved' });
  const JOB = { url: 'https://www.linkedin.com/jobs/view/4012345678', title: 'Java Architect', company: 'Acme', score: 81, snapshot: { jd: 'Requirements: Java, Spring', savedAt: '2026-11-18' } };
  const APPLY_FORM = `<form id="f" onsubmit="return false">
      <label for="n">Name</label><input id="n"><label for="e">Email</label><input id="e" type="email">
      <label for="r">Resume</label><input id="r" type="file"><button type="button" id="go">Submit application</button></form>`;

  const reset = async () => {
    await mock.__reset();
    AJP.detector.CONFIG.askAfterMs = 30000;
    AJP.detector.start({}); // re-arm confirmation for this test (content.js handlers stay)
    sandbox().innerHTML = '';
  };
  const cleanup = () => {
    AJP.panel.remove();
    sandbox().innerHTML = '';
  };

  describe('tracker flow › saving from the panel and background', () => {
    beforeEach(reset);
    afterEach(cleanup);

    it('dedupes the same job across URL variants', async () => {
      await AJP.send('recordApplication', { app: { ...JOB, status: 'in progress' } });
      await AJP.send('recordApplication', { app: { url: 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678', status: 'applied' } });
      const list = await apps();
      eq(list.length, 1);
      eq([list[0].status, list[0].title], ['applied', 'Java Architect']);
    });
    it('BUG FIX: Autofill after "applied" keeps the job as applied', async () => {
      await AJP.send('recordApplication', { app: { ...JOB, status: 'applied' } });
      await AJP.send('recordApplication', { app: { ...JOB, status: 'in progress', auto: true } });
      eq((await apps())[0].status, 'applied');
    });
    it('records which resume was used', async () => {
      await AJP.store.set('resumes', { activeId: 'r2', items: [{ id: 'r1', name: 'General' }, { id: 'r2', name: 'Java resume' }] });
      await AJP.send('recordApplication', { app: { ...JOB, status: 'applied' } });
      eq([(await apps())[0].resumeId, (await apps())[0].resumeName], ['r2', 'Java resume']);
    });
    it('saves a snapshot of the job description from the tab', async () => {
      await AJP.send('setTabJob', { job: JOB });
      await AJP.send('recordApplication', { app: { url: JOB.url, status: 'applied' } });
      eq((await apps())[0].snapshot.jd, 'Requirements: Java, Spring');
    });
    it('"Mark applied" in the panel saves the job with its description and offers Undo', async () => {
      await AJP.send('analyzeTab', { tabId: 1, jdText: 'Requirements\nJava\nSpring' });
      await waitFor(() => shadow() && shadow().querySelector('[data-act="applied"]'), { msg: 'panel' });
      shadow().querySelector('[data-act="applied"]').click();
      const a = await firstApp();
      eq([a.status, a.detectedBy], ['applied', 'manual']);
      includes(a.snapshot.jd, 'Spring');
      await waitFor(() => shadow().querySelector('[data-act="undoApplied"]'), { msg: 'undo link' });
      shadow().querySelector('[data-act="undoApplied"]').click();
      await waitFor(async () => (await apps()).length === 0, { msg: 'mis-click undone (removed)' });
      await waitFor(() => /removed from the tracker/.test(shadow().textContent), { msg: 'undo message' });
    });
  }, { env: 'browser' });

  describe('tracker flow › detecting a submitted application', () => {
    beforeEach(reset);
    afterEach(cleanup);

    it('Submit + "Thank you for applying" → saved as applied automatically', async () => {
      await AJP.send('setTabJob', { job: JOB });
      sandbox().innerHTML = APPLY_FORM;
      document.getElementById('go').click();
      await waitFor(async () => ((await tabJobs())[1] || {}).submittedAt, { msg: 'submit recorded' });
      sandbox().innerHTML = '<h2>Thank you for applying!</h2>'; // SPA swaps in the confirmation
      const a = await firstApp();
      eq([a.status, a.detectedBy, a.company, a.score], ['applied', 'confirmation', 'Acme', 81]);
      includes(a.snapshot.jd, 'Java');
    });
    it('the panel announces it and Undo works', async () => {
      await AJP.send('setTabJob', { job: JOB });
      sandbox().innerHTML = APPLY_FORM;
      document.getElementById('go').click();
      sandbox().innerHTML = '<div role="alert">Your application was sent to Acme</div>';
      await waitFor(() => shadow() && /detected and saved as/.test(shadow().textContent), { msg: 'announcement' });
      shadow().querySelector('[data-act="undoApplied"]').click();
      await waitFor(async () => (await apps()).length === 0, { msg: 'undone' });
    });
    it('Undo after an existing job was detected returns it to its previous status', async () => {
      await AJP.send('recordApplication', { app: { ...JOB, status: 'in progress' } }); // e.g. from Autofill
      await AJP.send('setTabJob', { job: JOB });
      sandbox().innerHTML = APPLY_FORM;
      document.getElementById('go').click();
      sandbox().innerHTML = '<h1>Application submitted</h1>';
      await waitFor(async () => (await apps())[0].status === 'applied', { msg: 'applied' });
      await waitFor(() => shadow() && shadow().querySelector('[data-act="undoApplied"]'), { msg: 'undo link' });
      shadow().querySelector('[data-act="undoApplied"]').click();
      await waitFor(async () => (await apps())[0].status === 'in progress', { msg: 'back to started' });
    });
    it('works with a normal form submit too', async () => {
      await AJP.send('setTabJob', { job: JOB });
      sandbox().innerHTML = APPLY_FORM.replace('type="button" id="go"', 'type="submit" id="go"');
      document.getElementById('f').requestSubmit();
      await waitFor(async () => ((await tabJobs())[1] || {}).submittedAt, { msg: 'submit recorded' });
    });
    it('a confirmation page on a known job site counts even without a Submit click', async () => {
      // Simulates landing on e.g. boards.greenhouse.io/.../confirmation in a tab that was on the job.
      const r = await AJP.send('applicationSignal', { signal: 'confirm', how: 'url', url: 'https://boards.greenhouse.io/acme/jobs/5551234/confirmation', host: 'boards.greenhouse.io' });
      ok(r.app, 'saved');
      eq((await apps())[0].jobKey, 'greenhouse:5551234');
    });
    it('a confirmation on an unknown site with no job context is ignored', async () => {
      const r = await AJP.send('applicationSignal', { signal: 'confirm', how: 'confirmation', url: 'https://shop.example.com/thanks', host: 'shop.example.com' });
      eq(r.ignored, 'no context');
      eq((await apps()).length, 0);
    });
    it('a newsletter signup (one email field) is not an application', async () => {
      await AJP.send('setTabJob', { job: JOB });
      sandbox().innerHTML = '<form><label for="m">Email</label><input id="m" type="email"><button type="button">Submit</button></form>';
      sandbox().querySelector('button').click();
      await sleep(80);
      notOk((await tabJobs())[1].submittedAt);
    });
    it('a job description that mentions "once your application has been submitted" is not a confirmation', async () => {
      await AJP.send('setTabJob', { job: JOB });
      sandbox().innerHTML = '<h3>Once your application has been submitted, our team will review it</h3><p>Thank you for applying is a phrase in a paragraph and is ignored.</p>';
      AJP.detector.check();
      await sleep(80);
      eq((await apps()).length, 0);
    });
    it('no confirmation after Submit → the panel asks "Did you submit?"; Yes saves it', async () => {
      AJP.detector.CONFIG.askAfterMs = 60;
      await AJP.send('setTabJob', { job: JOB });
      sandbox().innerHTML = APPLY_FORM;
      document.getElementById('go').click();
      await waitFor(() => shadow() && shadow().querySelector('[data-act="askYes"]'), { msg: 'question shown' });
      includes(shadow().textContent, 'Did you submit your application to Acme');
      shadow().querySelector('[data-act="askYes"]').click();
      const a = await firstApp();
      eq([a.status, a.detectedBy], ['applied', 'confirmed by you']);
    });
    it('answering "No" saves nothing', async () => {
      AJP.detector.CONFIG.askAfterMs = 60;
      await AJP.send('setTabJob', { job: JOB });
      sandbox().innerHTML = APPLY_FORM;
      document.getElementById('go').click();
      await waitFor(() => shadow() && shadow().querySelector('[data-act="askNo"]'), { msg: 'question shown' });
      shadow().querySelector('[data-act="askNo"]').click();
      await sleep(50);
      eq((await apps()).length, 0);
    });
    it('turning off auto-detect in settings stops detection', async () => {
      await AJP.store.update('settings', (s) => void (s.tracker.autoDetect = false));
      await AJP.send('setTabJob', { job: JOB });
      const r = await AJP.send('applicationSignal', { signal: 'confirm', how: 'confirmation', url: JOB.url, host: 'www.linkedin.com' });
      eq(r.ignored, 'auto-detect off');
      eq((await apps()).length, 0);
    });
  }, { env: 'browser' });

  describe('tracker flow › job context across tabs', () => {
    beforeEach(reset);
    afterEach(cleanup);

    it('LinkedIn "Apply" opening the company site in a new tab keeps the job', async () => {
      await AJP.send('setTabJob', { job: JOB }); // tab 1 = LinkedIn job
      await mock.__fireTabCreated({ id: 7, openerTabId: 1 }); // tab 7 = company Workday
      mock.__tabId = 7;
      await AJP.send('applicationSignal', { signal: 'confirm', how: 'confirmation', url: 'https://acme.wd5.myworkdayjobs.com/x/job/y/Java_R1/apply', host: 'acme.wd5.myworkdayjobs.com' });
      const a = await firstApp();
      eq([a.title, a.company, a.jobKey], ['Java Architect', 'Acme', 'linkedin:4012345678']);
    });
    it('closing a tab forgets its context', async () => {
      await AJP.send('setTabJob', { job: JOB });
      await mock.__fireTabRemoved(1);
      await waitFor(async () => !(await tabJobs())[1], { msg: 'removed' });
    });
    it('keeps at most 30 tabs of context', async () => {
      for (let i = 0; i < 35; i++) {
        mock.__tabId = 100 + i;
        await AJP.send('setTabJob', { job: { ...JOB, url: JOB.url + '?n=' + i } });
      }
      eq(Object.keys(await tabJobs()).length, 30);
    });
  }, { env: 'browser' });

  describe('tracker flow › duplicate warning in the panel', () => {
    beforeEach(reset);
    afterEach(cleanup);

    it('opening a job you already applied to shows a warning', async () => {
      await AJP.send('recordApplication', { app: { url: location.href, title: 'Old', company: 'Acme', status: 'applied' } });
      await AJP.send('analyzeTab', { tabId: 1, jdText: 'Requirements\nJava' });
      await waitFor(() => shadow() && /already tracked this job/.test(shadow().textContent), { msg: 'warning' });
      includes(shadow().textContent, 'applied since');
    });
    it('no warning for a new job', async () => {
      await AJP.send('analyzeTab', { tabId: 1, jdText: 'Requirements\nJava' });
      await waitFor(() => shadow() && /\d+%/.test(shadow().querySelector('.badge').textContent), { msg: 'panel' });
      notOk(/already tracked/.test(shadow().textContent));
    });
  }, { env: 'browser' });

  describe('tracker flow › follow-up reminder badge', () => {
    beforeEach(reset);

    it('an hourly alarm is registered', () => eq(mock.__alarms['ajp-followups'].periodInMinutes, 60));
    it('shows the number of follow-ups due on the toolbar icon', async () => {
      await AJP.store.set('applications', [
        { id: 'a', status: 'applied', appliedAt: new Date(Date.now() - 10 * 86400000).toISOString() },
        { id: 'b', status: 'applied', appliedAt: new Date().toISOString() },
      ]);
      await mock.__fireAlarm('ajp-followups');
      eq(mock.__badge.text, '1');
    });
    it('clears when nothing is due', async () => {
      await AJP.store.set('applications', []);
      eq(await AJP.refreshBadge(), 0);
      eq(mock.__badge.text, '');
    });
    it('uses the follow-up days from settings', async () => {
      await AJP.store.update('settings', (s) => void (s.tracker.followUpDays = '3'));
      await AJP.store.set('applications', [{ id: 'a', status: 'applied', appliedAt: new Date(Date.now() - 4 * 86400000).toISOString() }]);
      eq(await AJP.refreshBadge(), 1);
    });
  }, { env: 'browser' });
})();
