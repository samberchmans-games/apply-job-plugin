/*
 * Holding an application across pages: Apply → (new tab) → sign up / log in → application form.
 * 1 hour after the last activity it is dropped (with an alert); once applied it is offboarded.
 * History retention: applications, job history, drafts and logs older than N days (default 30).
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;
  const sh = () => document.querySelector('ajp-panel') && document.querySelector('ajp-panel').shadowRoot;
  const sandbox = () => document.getElementById('sandbox');
  const H = () => AJP.contentHooks;
  const JOB = { title: 'Senior Data Engineer', company: 'Initech', url: 'https://boards.greenhouse.io/initech/jobs/42', score: 78 };
  const HOUR = 3600 * 1000;
  const holdThisTab = (job = JOB) => AJP.send('setTabJob', { job });
  const age = (tab, ms) => AJP.store.update('tabJobs', (all) => void (all[tab].at = Date.now() - ms));

  describe('hold › background', () => {
    beforeEach(() => mock.__reset());
    it('the job held for this tab is returned, and each visit keeps it alive', async () => {
      await holdThisTab();
      await age(1, 50 * 60 * 1000);
      const r = await AJP.send('tabJob.get');
      eq([r.job.title, r.job.jobKey], ['Senior Data Engineer', AJP.tracker.jobKey(JOB.url)]);
      ok(Date.now() - (await AJP.store.get('tabJobs'))[1].at < 5000, 'activity refreshed the hour');
    });
    it('over 1 hour without activity → dropped, and the reply says which job was lost', async () => {
      await holdThisTab();
      await age(1, HOUR + 1000);
      const r = await AJP.send('tabJob.get');
      eq([r.job, r.expired.title], [null, 'Senior Data Engineer']);
      notOk((await AJP.store.get('tabJobs'))[1]);
    });
    it('the same job opened in another tab (no Apply click, no link back) is recognised', async () => {
      await holdThisTab();
      mock.__tabId = 5;
      try {
        const r = await AJP.send('tabJob.get', { url: JOB.url + '?utm_source=mail' });
        eq(r.job && r.job.title, 'Senior Data Engineer');
        eq((await AJP.store.get('tabJobs'))[5].title, 'Senior Data Engineer');
      } finally {
        mock.__tabId = 1;
      }
    });
    it('applied → offboarded: job details leave tab memory (only an "applied" marker stays), Applications keeps it', async () => {
      await holdThisTab();
      await AJP.send('recordApplication', { app: { ...JOB, status: 'applied' } });
      const tj = (await AJP.store.get('tabJobs'))[1];
      eq([tj.title, !!tj.appliedAt], [undefined, true]);
      eq((await AJP.send('tabJob.get')).job, null);
      eq((await AJP.store.get('applications'))[0].status, 'applied');
    });
    it('"Not this job" drops the hold', async () => {
      await holdThisTab();
      await AJP.send('tabJob.forget');
      eq((await AJP.send('tabJob.get')).job, null);
    });
    it('Apply clicked → a new tab WITHOUT an opener link still gets the job (within 20 s), once', async () => {
      await AJP.send('applyClicked', { job: JOB });
      await mock.__fireTabCreated({ id: 9 });
      eq((await AJP.store.get('tabJobs'))[9].title, 'Senior Data Engineer');
      notOk((await AJP.store.get('tabJobs')).__pending);
    });
    it('…but not a tab opened much later', async () => {
      await AJP.send('applyClicked', { job: JOB });
      await AJP.store.update('tabJobs', (all) => void (all.__pending.at = Date.now() - 60 * 1000));
      await mock.__fireTabCreated({ id: 9 });
      notOk((await AJP.store.get('tabJobs'))[9]);
    });
  }, { env: 'browser' });

  describe('hold › the panel on sign-up, login and form pages', () => {
    beforeEach(async () => {
      await mock.__reset();
      sandbox().innerHTML = '';
      Object.assign(H().state, { analysis: null, job: null, held: null, error: '', message: '' });
    });
    afterEach(() => {
      AJP.panel.remove();
      sandbox().innerHTML = '';
      H().state.held = null;
    });
    const show = async () => {
      ok(await H().holdIfApplying(), 'held');
      return waitFor(() => sh() && sh().querySelector('.held') && sh(), { msg: 'held panel' });
    };

    it('a login page: the job stays on screen, "Application on hold", Autofill off, passwords untouched', async () => {
      await holdThisTab();
      sandbox().innerHTML = '<form><label>Email <input id="e" type="email"></label><label>Password <input id="p" type="password"></label><button>Sign in</button></form>';
      const s = await show();
      includes(s.textContent, 'Senior Data Engineer · Initech · 78% match');
      includes(s.querySelector('.held').textContent, 'Sign in on this site');
      ok(s.querySelector('[data-act="autofill"]').disabled);
      eq(document.getElementById('p').value, '');
    });
    it('a sign-up page (two password boxes) says "Create your account"', async () => {
      await holdThisTab();
      sandbox().innerHTML = '<form><input type="email"><input type="password"><input type="password"></form>';
      includes((await show()).querySelector('.held').textContent, 'Create your account');
    });
    it('when the application form appears, the panel says "Ready" and Autofill turns on', async () => {
      await holdThisTab();
      sandbox().innerHTML = '<form><input type="password"></form>';
      const s = await show();
      ok(s.querySelector('[data-act="autofill"]').disabled);
      sandbox().innerHTML = '<form><label for="fn">First name</label><input id="fn"><label for="ln">Last name</label><input id="ln"><label for="em">Email</label><input id="em"><label for="cv">Resume</label><input id="cv" type="file"></form>';
      await waitFor(() => /Ready to fill your application/.test(sh().textContent) && !sh().querySelector('[data-act="autofill"]').disabled, { msg: 'ready', timeout: 4000 });
    });
    it('Autofill on the held page uploads the resume tailored for THAT job and tracks THAT job', async () => {
      await holdThisTab();
      await AJP.store.set('resumes', { activeId: 'r1', items: [
        { id: 'r1', name: 'Main', text: '# Ana\n- x', file: { name: 'main.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' } },
        { id: 't1', name: 'Tailored — Initech', text: '# Ana\n- y', enhancementId: 'e1', job: { url: JOB.url }, file: { name: 'Ana - Resume - Initech - Senior Data Engineer.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' } },
      ] });
      sandbox().innerHTML = '<form><label for="fn">First name</label><input id="fn"><label for="em">Email</label><input id="em"><label for="cv">Resume/CV</label><input id="cv" type="file"></form>';
      const s = await show();
      includes(s.textContent, 'your resume tailored for this job will be uploaded');
      s.querySelector('[data-act="autofill"]').click();
      await waitFor(() => document.getElementById('cv').files.length, { msg: 'attached' });
      eq(document.getElementById('cv').files[0].name, 'Ana - Resume - Initech - Senior Data Engineer.pdf');
      const app = await waitFor(async () => (await AJP.store.get('applications'))[0], { msg: 'tracked' });
      eq([app.title, app.company, app.jobKey], ['Senior Data Engineer', 'Initech', AJP.tracker.jobKey(JOB.url)]);
    });
    it('Mark applied on a held page ends the hold', async () => {
      await holdThisTab();
      sandbox().innerHTML = '<form><input id="a"><input id="b"><input id="c"></form>';
      const s = await show();
      s.querySelector('[data-act="applied"]').click();
      await waitFor(() => /Marked as applied/.test(sh().textContent), { msg: 'applied' });
      eq(H().state.held, null);
      eq((await AJP.send('tabJob.get')).job, null);
    });
    it('expired: a closable alert "Tracking of this job was lost"', async () => {
      await holdThisTab();
      await age(1, HOUR + 1000);
      sandbox().innerHTML = '<form><input type="password"></form>';
      ok(await H().holdIfApplying());
      await waitFor(() => sh() && /Tracking of this job was lost/.test(sh().textContent), { msg: 'alert' });
      includes(sh().textContent, 'Senior Data Engineer · Initech');
      sh().querySelector('.msg [data-act="close"]').click();
      await waitFor(() => !document.querySelector('ajp-panel'), { msg: 'closed' });
    });
    it('"Not this job" removes the panel and the hold', async () => {
      await holdThisTab();
      sandbox().innerHTML = '<form><input type="password"></form>';
      const s = await show();
      s.querySelector('[data-act="forgetHeld"]').click();
      await waitFor(() => !document.querySelector('ajp-panel'), { msg: 'gone' });
      eq((await AJP.send('tabJob.get')).job, null);
    });
    it('nothing held → nothing shown', async () => notOk(await H().holdIfApplying()));
    it('page kinds: login, sign-up, form, waiting', () => {
      sandbox().innerHTML = '<input type="password">';
      eq(H().applyPhase(), 'login');
      sandbox().innerHTML = '<form><p>Create an account</p><input type="password"></form>';
      eq(H().applyPhase(), 'signup');
      sandbox().innerHTML = '<input type="file">';
      eq(H().applyPhase(), 'form');
      sandbox().innerHTML = '<p>Loading…</p>';
      ok(['waiting', 'form'].includes(H().applyPhase())); // the test page itself may have inputs
    });
  }, { env: 'browser' });

  describe('hold › Apply clicks on a job page', () => {
    afterEach(() => {
      AJP.panel.remove();
      sandbox().innerHTML = '';
    });
    it('clicking "Apply now" on an analyzed job remembers it for the next tab', async () => {
      await mock.__reset();
      sandbox().innerHTML = '<a href="#" id="ap">Apply now</a>';
      await AJP.send('analyzeTab', { tabId: 1, jdText: 'Requirements\n- Python\n- AWS' });
      await waitFor(() => sh() && /\d+%/.test(sh().querySelector('.badge').textContent));
      document.getElementById('ap').addEventListener('click', (e) => e.preventDefault());
      document.getElementById('ap').click();
      await waitFor(async () => (await AJP.store.get('tabJobs')).__pending, { msg: 'pending saved' });
    });
  }, { env: 'browser' });

  describe('history retention', () => {
    beforeEach(() => mock.__reset());
    const days = (n) => new Date(Date.now() - n * 86400000).toISOString();
    it('default 30 days: older applications, job history, drafts and logs are removed', async () => {
      await AJP.store.set('applications', [{ id: 'a', status: 'applied', appliedAt: days(40) }, { id: 'b', status: 'applied', appliedAt: days(5) }]);
      await AJP.store.set('evaluations', [{ jobKey: 'x', at: days(45) }, { jobKey: 'y', at: days(1) }]);
      await AJP.store.set('enhancements', [{ id: 'e1', createdAt: days(31) }]);
      await AJP.store.set('logs', [{ t: days(60), msg: 'old' }, { t: days(2), msg: 'new' }]);
      const r = await AJP.send('pruneHistory');
      eq(r.removed, 3);
      eq((await AJP.store.get('applications')).map((a) => a.id), ['b']);
      eq((await AJP.store.get('evaluations')).map((e) => e.jobKey), ['y']);
      eq((await AJP.store.get('enhancements')).length, 0);
      eq((await AJP.store.get('logs')).map((l) => l.msg), ['new']);
    });
    it('an application counts from the day you APPLIED (later edits do not extend it)', async () => {
      await AJP.store.set('applications', [{ id: 'a', status: 'applied', appliedAt: days(40), updatedAt: days(1) }, { id: 'b', status: 'applied', appliedAt: days(10) }]);
      await AJP.send('pruneHistory');
      eq((await AJP.store.get('applications')).map((x) => x.id), ['b']);
    });
    it('within the period the duplicate warning and the saved job description are still there', async () => {
      await AJP.store.set('applications', [{ id: 'a', status: 'applied', url: 'https://boards.greenhouse.io/initech/jobs/42', jobKey: AJP.tracker.jobKey('https://boards.greenhouse.io/initech/jobs/42'), appliedAt: days(20), snapshot: { jd: 'Requirements…' } }]);
      await AJP.send('pruneHistory');
      const apps = await AJP.store.get('applications');
      ok(AJP.tracker.findDuplicate(apps, { url: 'https://boards.greenhouse.io/initech/jobs/42?gh_src=x' }), 'duplicate found');
      eq(apps[0].snapshot.jd, 'Requirements…');
    });
    it('the period is a setting; 0 keeps everything', async () => {
      await AJP.store.set('applications', [{ id: 'a', status: 'applied', appliedAt: days(400) }]);
      await AJP.store.update('settings', (s) => void (s.retentionDays = 0));
      await AJP.send('pruneHistory');
      eq((await AJP.store.get('applications')).length, 1);
      await AJP.store.update('settings', (s) => void (s.retentionDays = 365));
      await AJP.send('pruneHistory');
      eq((await AJP.store.get('applications')).length, 0);
    });
  }, { env: 'browser' });
})();
