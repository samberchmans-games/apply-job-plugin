/*
 * Profile suggestions from learned answers: rules (pure, also CLI) + Admin (save / dismiss / save all) + popup.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const S = AJP.profileSuggest;
  const profile = (patch = {}) => {
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p.personal, { firstName: 'Ana', email: 'ana@example.com', phone: '512-555-0100' }, patch.personal || {});
    if (patch.salary) Object.assign(p.salary, patch.salary);
    if (patch.autoApply) Object.assign(p.autoApply, patch.autoApply);
    return p;
  };
  const ans = (label, value, count = 1, extra = {}) => ({ [AJP.normKey(label)]: { label, value, count, hosts: ['boards.greenhouse.io'], lastUsed: '2026-11-18T10:00:00Z', ...extra } });

  describe('profile suggestions › rules', () => {
    it('empty profile field + an answer → suggested (notice period)', () => {
      const s = S.list(profile(), ans('What is your notice period?', '2 weeks'));
      eq(s.map((x) => [x.key, x.field, x.proposed, x.empty]), [['notice', 'Notice period', '2 weeks', true]]);
    });
    it('the same value as the profile → nothing', () => eq(S.list(profile(), ans('Phone number', '512-555-0100', 5)), []));
    it('a different value: only after you typed it twice', () => {
      eq(S.list(profile(), ans('Phone number', '737-555-0199', 1)), []);
      eq(S.list(profile(), ans('Phone number', '737-555-0199', 2))[0].current, '512-555-0100');
    });
    it('salary: "$150,000 – $170,000" / "150k" → 150000; an ambiguous "150" is not suggested', () => {
      eq(S.list(profile(), ans('Desired salary', '$150,000 - $170,000'))[0].proposed, '150000');
      eq(S.list(profile(), ans('Salary expectations', '150k'))[0].proposed, '150000');
      eq(S.list(profile(), ans('Salary expectations', '150')), []);
      eq(S.list(profile({ salary: { min: '150000' } }), ans('Desired salary', '$150,000', 4)), [], 'same as profile');
    });
    it('years: "8 years" → 8; yes/no questions normalised', () => {
      eq(S.list(profile(), ans('How many years of experience do you have?', '8 years'))[0].proposed, '8');
      eq(S.list(profile(), ans('Are you willing to relocate?', 'yes'))[0].proposed, 'Yes');
      eq(S.list(profile(), ans('Will you require visa sponsorship?', 'No, I will not'))[0].proposed, 'No');
    });
    it('EEO answers, names, schools and cover letters are never suggested', () => {
      const a = { ...ans('Gender', 'Female', 3), ...ans('Race / ethnicity', 'Asian', 3), ...ans('Veteran status', 'No', 3), ...ans('Disability', 'No', 3), ...ans('Pronouns', 'she/her', 3),
        ...ans('Full name', 'Ana Maria Silva', 3), ...ans('School', 'UT Austin', 3), ...ans('Cover letter', 'Dear…', 3) };
      eq(S.list(profile(), a), []);
    });
    it('several answers for one field → the most used wins', () => {
      const s = S.list(profile(), { ...ans('Notice period', '2 weeks', 3), ...ans('What is your notice period?', '1 month', 1) });
      eq([s.length, s[0].proposed], [1, '2 weeks']);
    });
    it('dismissed stays dismissed for that value; a new value can be suggested again', () => {
      const first = S.list(profile(), ans('Notice period', '2 weeks'))[0];
      eq(S.list(profile(), ans('Notice period', '2 weeks'), { [first.id]: 'x' }), []);
      eq(S.list(profile(), ans('Notice period', '3 weeks'), { [first.id]: 'x' }).length, 1);
    });
    it('empty fields first, then the most used', () => {
      const s = S.list(profile(), { ...ans('Phone', '737-555-0199', 9), ...ans('LinkedIn profile', 'https://linkedin.com/in/ana', 1) });
      eq(s.map((x) => x.key), ['linkedin', 'phone']);
    });
    it('apply writes the profile path', () => {
      const p = profile();
      S.apply(p, S.list(p, ans('Notice period', '2 weeks'))[0]);
      eq(p.autoApply.noticePeriod, '2 weeks');
    });
    it('apply refuses an unknown target (coded error)', () => eq((() => { try { S.apply(profile(), { key: 'gender', path: 'autoApply.eeo.gender', proposed: 'x' }); } catch (e) { return e.code; } })(), 'AJP-INTERNAL'));
    it('Autofill reads questions with the same shared rules', () => eq(AJP.filler.ruleFor('Notice period').key, AJP.fieldRules.ruleFor('Notice period').key));
  });

  // ---- Admin ---------------------------------------------------------------------------------------------
  describe('profile suggestions › Admin and popup', () => {
    let frame;
    let w;
    const $ = (s) => w.document.querySelector(s);
    afterEach(() => frame && frame.remove());
    async function load(page, seed, hash) {
      const dir = page.startsWith('admin') ? 'admin' : 'popup';
      let html = await (await fetch(`../src/${dir}/${page}`, { cache: 'no-store' })).text();
      html = html.replace('<head>', `<head><base href="${new URL(`../src/${dir}/`, location.href).href}"><script>window.__SEED__=${JSON.stringify(seed)}</script>`)
        .replace('<script src="../lib/core.js"></script>', '<script src="../../tests/mocks/browser-mock.js"></script><script>browser.storage.local.set(window.__SEED__)</script><script src="../lib/core.js"></script>');
      frame = document.createElement('iframe');
      frame.style.cssText = 'width:1200px;height:800px;border:0;position:absolute;left:-5000px;top:0';
      document.body.appendChild(frame);
      await new Promise((res) => {
        frame.onload = res;
        frame.srcdoc = html;
      });
      w = frame.contentWindow;
      await waitFor(() => w.AJP && w.AJP.store, { msg: 'page' });
      if (hash) w.location.hash = hash;
    }
    const seed = () => ({ profile: profile(), answers: { ...ans('What is your notice period?', '2 weeks', 3, { hosts: ['jobs.lever.co', 'boards.greenhouse.io'] }), ...ans('LinkedIn profile', 'https://linkedin.com/in/ana', 1) } });

    it('Learned answers shows the suggestions with a count in the menu', async () => {
      await load('admin.html', seed(), 'answers');
      await waitFor(() => !$('#suggestBox').hidden, { msg: 'box' });
      eq($('#sugCount').textContent, '2');
      includes($('#suggestRows').textContent, 'Notice period');
      includes($('#suggestRows').textContent, 'jobs.lever.co');
    });
    it('Save to profile writes it, updates the field on screen, and the suggestion goes away', async () => {
      await load('admin.html', seed(), 'answers');
      await waitFor(() => $('[data-sug-save^="notice"]'), { msg: 'row' });
      $('[data-sug-save^="notice"]').click();
      await waitFor(async () => (await w.AJP.store.get('profile')).autoApply.noticePeriod === '2 weeks', { msg: 'saved' });
      const field = $('[data-path="autoApply.noticePeriod"]');
      if (field) eq(field.value, '2 weeks');
      await waitFor(() => !$('[data-sug-save^="notice"]') && $('#sugCount').textContent === '1', { msg: 'gone' });
    });
    it('a later edit elsewhere in Admin does not undo the saved suggestion', async () => {
      await load('admin.html', seed(), 'answers');
      await waitFor(() => $('[data-sug-save^="notice"]'));
      $('[data-sug-save^="notice"]').click();
      await waitFor(async () => (await w.AJP.store.get('profile')).autoApply.noticePeriod === '2 weeks');
      const city = $('[data-path="personal.city"]');
      city.value = 'Austin';
      city.dispatchEvent(new w.Event('input', { bubbles: true }));
      await waitFor(async () => (await w.AJP.store.get('profile')).personal.city === 'Austin', { msg: 'city saved' });
      eq((await w.AJP.store.get('profile')).autoApply.noticePeriod, '2 weeks');
    });
    it('Dismiss hides it and remembers', async () => {
      await load('admin.html', seed(), 'answers');
      await waitFor(() => $('[data-sug-dismiss^="linkedin"]'));
      $('[data-sug-dismiss^="linkedin"]').click();
      await waitFor(async () => Object.keys((await w.AJP.store.get('suggestions')).dismissed).length === 1, { msg: 'dismissed' });
      await waitFor(() => !$('[data-sug-dismiss^="linkedin"]'));
      eq((await w.AJP.store.get('profile')).personal.linkedin, '');
    });
    it('Save all writes every suggestion', async () => {
      await load('admin.html', seed(), 'answers');
      await waitFor(() => !$('#suggestAll').hidden, { msg: 'save all' });
      $('#suggestAll').click();
      await waitFor(async () => { const p = await w.AJP.store.get('profile'); return p.autoApply.noticePeriod && p.personal.linkedin; }, { msg: 'all saved' });
      await waitFor(() => $('#suggestBox').hidden && $('#sugCount').hidden, { msg: 'box hidden' });
    });
    it('nothing to suggest → no box, no count', async () => {
      await load('admin.html', { profile: profile() }, 'answers');
      await waitFor(() => w.AJP.profileSuggest && $('#answerRows').textContent.length, { msg: 'rendered' });
      ok($('#suggestBox').hidden);
      ok($('#sugCount').hidden);
    });
    it('the toolbar popup mentions the suggestions', async () => {
      await load('popup.html', seed());
      await waitFor(() => /2 profile suggestions/.test(w.document.body.textContent), { msg: 'popup line' });
    });
  }, { env: 'browser' });
})();
