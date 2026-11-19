/*
 * UI tests for the Admin screens that had only manual checks (Profile, Skills, Job preferences, Resumes,
 * Auto-apply details, Backup & privacy, navigation) and for the toolbar popup. Each test loads the REAL page
 * in a frame with the browser mock (and the real background where messages are needed).
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;

  let frame;
  let w;
  const $ = (s) => w.document.querySelector(s);
  const $$ = (s) => [...w.document.querySelectorAll(s)];
  async function load(page, seed = {}, { hash = '', background = false, before = '' } = {}) {
    const dir = page.startsWith('admin') ? 'admin' : 'popup';
    let html = await (await fetch(`../src/${dir}/${page}`, { cache: 'no-store' })).text();
    if (background) {
      html = dir === 'admin'
        ? html.replace('<script src="tracker-view.js"></script>', '<script src="../background/background.js"></script>\n<script src="tracker-view.js"></script>')
        : html.replace('<script src="popup.js"></script>', '<script src="../lib/skills-dictionary.js"></script><script src="../lib/matcher.js"></script><script src="../lib/ai.js"></script><script src="../lib/resume-engine.js"></script><script src="../lib/tracks.js"></script><script src="../lib/issue-report.js"></script><script src="../lib/pdf-writer.js"></script><script src="../background/background.js"></script>\n<script src="popup.js"></script>');
    }
    html = html.replace('<head>', `<head><base href="${new URL(`../src/${dir}/`, location.href).href}"><script>window.__SEED__=${JSON.stringify(seed)}</script>${before}`)
      .replace('<script src="../lib/core.js"></script>', '<script src="../../tests/mocks/browser-mock.js"></script><script>browser.storage.local.set(window.__SEED__)</script><script src="../lib/core.js"></script>');
    frame = document.createElement('iframe');
    frame.style.cssText = 'width:1200px;height:800px;border:0;position:absolute;left:-5000px;top:0';
    document.body.appendChild(frame);
    await new Promise((res) => {
      frame.onload = res;
      frame.srcdoc = html;
    });
    w = frame.contentWindow;
    await waitFor(() => w.AJP && w.AJP.store && $('#ver') && $('#ver').textContent, { msg: page });
    if (hash) {
      w.location.hash = hash;
      await waitFor(() => !$(`#${hash.split('?')[0]}`) || $(`#${hash.split('?')[0]}`).classList.contains('on') || dir === 'popup', { msg: 'section ' + hash });
    }
  }
  const closeFrame = () => frame && frame.remove();
  const stored = (k) => w.AJP.store.get(k);
  const type = (el, v) => {
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const change = (el, v) => {
    if (el.type === 'checkbox') el.checked = v;
    else el.value = v;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const profile = (patch = {}) => {
    const p = AJP.clone(AJP.store.DEFAULTS.profile);
    Object.assign(p.personal, patch.personal || {});
    if (patch.skills) p.skills = patch.skills;
    return p;
  };

  // ---- Navigation & Profile -------------------------------------------------------------------------
  describe('admin screens › navigation and profile', () => {
    afterEach(closeFrame);
    it('opens on Profile; the menu switches sections; an unknown section falls back to Profile', async () => {
      await load('admin.html');
      ok($('#profile').classList.contains('on'));
      w.location.hash = 'skills';
      await waitFor(() => $('#skills').classList.contains('on') && !$('#profile').classList.contains('on'));
      w.location.hash = 'nonsense';
      await waitFor(() => $('#profile').classList.contains('on'), { msg: 'fallback' });
    });
    it('typing a profile field saves it (no Save button)', async () => {
      await load('admin.html');
      type($('[data-path="personal.firstName"]'), 'Ana');
      type($('[data-path="personal.linkedin"]'), 'https://linkedin.com/in/ana');
      await waitFor(async () => (await stored('profile')).personal.linkedin === 'https://linkedin.com/in/ana', { msg: 'saved' });
      eq((await stored('profile')).personal.firstName, 'Ana');
    });
    it('saved values are shown when Admin opens again', async () => {
      await load('admin.html', { profile: profile({ personal: { firstName: 'Ana', city: 'Austin', yearsExperience: '8' } }) });
      eq([$('[data-path="personal.firstName"]').value, $('[data-path="personal.city"]').value, $('[data-path="personal.yearsExperience"]').value], ['Ana', 'Austin', '8']);
    });
    it('shows the version', async () => {
      await load('admin.html');
      eq($('#ver').textContent, 'v' + AJP.VERSION);
    });
  }, { env: 'browser' });

  // ---- Skills ---------------------------------------------------------------------------------------------
  describe('admin screens › skills', () => {
    afterEach(closeFrame);
    const add = (name, level = '', years = '') => {
      $('#skillName').value = name;
      $('#skillLevel').value = level;
      $('#skillYears').value = years;
      $('#skillForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    };
    it('adds a skill under its standard name ("k8s" → Kubernetes) with level and years', async () => {
      await load('admin.html', {}, { hash: 'skills' });
      add('k8s', 'advanced', '3');
      await waitFor(async () => (await stored('profile')).skills.length === 1, { msg: 'saved' });
      eq((await stored('profile')).skills[0], { name: 'Kubernetes', level: 'advanced', years: '3' });
      includes($('#skillRows').textContent, 'Kubernetes');
    });
    it('a duplicate (any spelling) is rejected with a message', async () => {
      await load('admin.html', { profile: profile({ skills: [{ name: 'Kubernetes' }] }) }, { hash: 'skills' });
      add('K8S');
      await waitFor(() => /Already in your list/.test($('#toast').textContent), { msg: 'toast' });
      eq((await stored('profile')).skills.length, 1);
    });
    it('level and years can be edited in the table; Remove deletes', async () => {
      await load('admin.html', { profile: profile({ skills: [{ name: 'Java' }, { name: 'SQL' }] }) }, { hash: 'skills' });
      change($('#skillRows select[data-i="0"]'), 'expert');
      $('#skillRows select[data-i="0"]').dispatchEvent(new w.Event('input', { bubbles: true }));
      await waitFor(async () => (await stored('profile')).skills[0].level === 'expert', { msg: 'level' });
      $('#skillRows [data-del="1"]').click();
      await waitFor(async () => (await stored('profile')).skills.length === 1, { msg: 'removed' });
      eq((await stored('profile')).skills[0].name, 'Java');
    });
    it('"Detect skills from my active resume" adds the new ones and says which', async () => {
      await load('admin.html', { profile: profile({ skills: [{ name: 'Java' }] }), resumes: { activeId: 'r1', items: [{ id: 'r1', name: 'Main', text: '- Built Java and Python services on AWS with Docker' }] } }, { hash: 'skills' });
      $('#detectSkills').click();
      await waitFor(() => /Added/.test($('#detectOut').textContent), { msg: 'detected' });
      await waitFor(async () => (await stored('profile')).skills.length >= 4, { msg: 'saved' });
      const names = (await stored('profile')).skills.map((s) => s.name);
      for (const n of ['Java', 'Python', 'AWS', 'Docker']) includes(names, n);
      excludes($('#detectOut').textContent, 'Java,');
    });
    it('no resume yet → says where to add one', async () => {
      await load('admin.html', {}, { hash: 'skills' });
      $('#detectSkills').click();
      await waitFor(() => /No resume text yet/.test($('#detectOut').textContent), { msg: 'message' });
    });
  }, { env: 'browser' });

  // ---- Job preferences --------------------------------------------------------------------------------
  describe('admin screens › job preferences', () => {
    afterEach(closeFrame);
    it('salary, work types and relocation are saved', async () => {
      await load('admin.html', {}, { hash: 'prefs' });
      type($('[data-path="salary.min"]'), '150000');
      change($('[data-path="workTypes.onsite"]'), true);
      change($('[data-path="willingToRelocate"]'), 'No');
      await waitFor(async () => { const p = await stored('profile'); return p.salary.min === '150000' && p.workTypes.onsite && p.willingToRelocate === 'No'; }, { msg: 'saved' });
    });
    it('areas: Enter adds a chip, duplicates are ignored, ✕ removes', async () => {
      await load('admin.html', {}, { hash: 'prefs' });
      const box = $('.chipbox[data-list="areas"]');
      const enter = (v) => {
        const input = box.querySelector('input');
        input.value = v;
        input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      };
      enter('Austin, TX');
      enter('Remote - US');
      enter('Austin, TX');
      await waitFor(async () => (await stored('profile')).areas.length === 2, { msg: 'two areas' });
      box.querySelector('button[data-i="0"]').click();
      await waitFor(async () => JSON.stringify((await stored('profile')).areas) === '["Remote - US"]', { msg: 'removed' });
    });
  }, { env: 'browser' });

  // ---- Resumes --------------------------------------------------------------------------------------------
  describe('admin screens › resumes', () => {
    afterEach(closeFrame);
    const two = { resumes: { activeId: 'r1', items: [{ id: 'r1', name: 'Main', text: '# Ana\n- One' }, { id: 'r2', name: 'Java', text: '# Ana\n- Two' }] } };
    it('"+ New empty resume" adds one and opens it for editing', async () => {
      await load('admin.html', {}, { hash: 'resumes' });
      $('#newResume').click();
      await waitFor(async () => (await stored('resumes')).items.length === 1, { msg: 'added' });
      await waitFor(() => !$('#resumeEditor').hidden, { msg: 'editor' });
    });
    it('the first resume becomes the active one', async () => {
      await load('admin.html', {}, { hash: 'resumes' });
      $('#newResume').click();
      const r = await waitFor(async () => { const x = await stored('resumes'); return x.items.length && x; });
      eq(r.activeId, r.items[0].id);
    });
    it('bug B16: renaming and then quickly editing the text saves BOTH', async () => {
      await load('admin.html', two, { hash: 'resumes' });
      await waitFor(() => !$('#resumeEditor').hidden);
      type($('#resumeName'), 'Main (2026)');
      type($('#resumeText'), '# Ana\n- One\n- Three');
      await waitFor(async () => { const r = (await stored('resumes')).items[0]; return r.name === 'Main (2026)' && /Three/.test(r.text); }, { msg: 'saved' });
    });
    it('"Use as active resume" switches the active one', async () => {
      await load('admin.html', two, { hash: 'resumes' });
      await waitFor(() => $('#resumeList').textContent.includes('Java'));
      const row = [...$('#resumeList').querySelectorAll('[data-id]')].find((x) => x.dataset.id === 'r2') || [...$('#resumeList').children].find((x) => x.textContent.includes('Java'));
      row.click();
      await waitFor(() => $('#resumeName').value === 'Java', { msg: 'selected' });
      $('#resumeSetActive').click();
      await waitFor(async () => (await stored('resumes')).activeId === 'r2', { msg: 'active' });
    });
    it('Delete asks first: Cancel keeps it, OK deletes it', async () => {
      await load('admin.html', two, { hash: 'resumes' });
      await waitFor(() => !$('#resumeEditor').hidden);
      w.confirm = () => false;
      $('#resumeDelete').click();
      await new Promise((r) => setTimeout(r, 150));
      eq((await stored('resumes')).items.length, 2);
      w.confirm = () => true;
      $('#resumeDelete').click();
      await waitFor(async () => (await stored('resumes')).items.length === 1, { msg: 'deleted' });
    });
  }, { env: 'browser' });

  // ---- Auto-apply details -----------------------------------------------------------------------------------
  describe('admin screens › auto-apply details', () => {
    afterEach(closeFrame);
    it('add a job card, type into it, remove it', async () => {
      await load('admin.html', {}, { hash: 'autoapply' });
      $('[data-add="experience"]').click();
      await waitFor(() => $('#experienceList input[data-k="company"]'), { msg: 'card' });
      type($('#experienceList input[data-k="company"]'), 'Acme Corp');
      type($('#experienceList input[data-k="start"]'), '06/2019');
      await waitFor(async () => { const e = (await stored('profile')).autoApply.experience[0]; return e && e.company === 'Acme Corp' && e.start === '06/2019'; }, { msg: 'saved' });
      $('#experienceList [data-rm="experience"]').click();
      await waitFor(async () => (await stored('profile')).autoApply.experience.length === 0, { msg: 'removed' });
    });
    it('education cards work the same way', async () => {
      await load('admin.html', {}, { hash: 'autoapply' });
      $('[data-add="education"]').click();
      await waitFor(() => $('#educationList input[data-k="school"]'));
      type($('#educationList input[data-k="school"]'), 'UT Austin');
      await waitFor(async () => ((await stored('profile')).autoApply.education[0] || {}).school === 'UT Austin', { msg: 'saved' });
    });
    it('work authorization, sponsorship, notice period, EEO and cover letter are saved', async () => {
      await load('admin.html', {}, { hash: 'autoapply' });
      change($('[data-path="autoApply.workAuthorized"]'), 'Yes');
      change($('[data-path="autoApply.requireSponsorship"]'), 'No');
      type($('[data-path="autoApply.noticePeriod"]'), '2 weeks');
      change($('[data-path="autoApply.eeo.veteran"]'), 'I am not a protected veteran');
      type($('[data-path="autoApply.coverLetterTemplate"]'), 'Dear team');
      await waitFor(async () => {
        const a = (await stored('profile')).autoApply;
        return a.workAuthorized === 'Yes' && a.requireSponsorship === 'No' && a.noticePeriod === '2 weeks' && a.eeo.veteran === 'I am not a protected veteran' && a.coverLetterTemplate === 'Dear team';
      }, { msg: 'saved' });
    });
  }, { env: 'browser' });

  // ---- Backup & privacy -----------------------------------------------------------------------------------------
  describe('admin screens › backup & privacy', () => {
    afterEach(closeFrame);
    const seed = () => ({ profile: profile({ personal: { firstName: 'Ana' } }), settings: { ...AJP.clone(AJP.store.DEFAULTS.settings), ai: { ...AJP.clone(AJP.store.DEFAULTS.settings.ai), provider: 'groq', keys: { gemini: '', groq: 'gsk_secret', openrouter: '' } } } });
    async function exportText() {
      let blob = null;
      const realCreate = w.URL.createObjectURL;
      w.URL.createObjectURL = (b) => ((blob = b), 'blob:x');
      w.HTMLAnchorElement.prototype.click = function () {};
      $('#bkExport').click();
      await waitFor(() => blob, { msg: 'export' });
      w.URL.createObjectURL = realCreate;
      return blob.text();
    }
    it('Export: a backup file with your data and WITHOUT API keys by default', async () => {
      await load('admin.html', seed(), { hash: 'backup' });
      const t = await exportText();
      includes(t, '"firstName": "Ana"');
      excludes(t, 'gsk_secret');
      excludes(t, '"logs"');
    });
    it('Export with "include API keys" ticked contains the key', async () => {
      await load('admin.html', seed(), { hash: 'backup' });
      $('#bkKeys').checked = true;
      includes(await exportText(), 'gsk_secret');
    });
    it('Import a valid backup → data restored (then the page reloads)', async () => {
      await load('admin.html', {}, { hash: 'backup' });
      const file = { app: 'apply-job-plugin', version: AJP.VERSION, exportedAt: new Date().toISOString(), data: { profile: profile({ personal: { firstName: 'Restored' } }) } };
      let snapshot = null;
      w.alert = () => (snapshot = JSON.stringify(w.browser.__data.profile || {}));
      const dt = new w.DataTransfer();
      dt.items.add(new w.File([JSON.stringify(file)], 'backup.json', { type: 'application/json' }));
      $('#bkImport').files = dt.files;
      $('#bkImport').dispatchEvent(new w.Event('change', { bubbles: true }));
      await waitFor(() => snapshot, { msg: 'imported' });
      includes(snapshot, 'Restored');
    });
    it('Import a broken file → a coded message, nothing changed', async () => {
      await load('admin.html', seed(), { hash: 'backup' });
      let msg = null;
      w.alert = (m) => (msg = m);
      const dt = new w.DataTransfer();
      dt.items.add(new w.File(['{"not":"a backup"}'], 'x.json', { type: 'application/json' }));
      $('#bkImport').files = dt.files;
      $('#bkImport').dispatchEvent(new w.Event('change', { bubbles: true }));
      await waitFor(() => msg, { msg: 'alert' });
      ok(/Import failed: .*\(AJP-/.test(msg), msg);
      eq((await stored('profile')).personal.firstName, 'Ana');
    });
    it('Delete all data asks first; Cancel deletes nothing', async () => {
      await load('admin.html', seed(), { hash: 'backup' });
      let wiped = false;
      w.AJP.store.wipe = async () => (wiped = true);
      w.confirm = () => false;
      $('#bkWipe').click();
      await new Promise((r) => setTimeout(r, 100));
      notOk(wiped);
      w.confirm = () => true;
      $('#bkWipe').click();
      await waitFor(() => wiped, { msg: 'wiped' });
    });
  }, { env: 'browser' });

  // ---- Toolbar popup ------------------------------------------------------------------------------------------------
  describe('admin screens › toolbar popup', () => {
    afterEach(closeFrame);
    const complete = () => ({ profile: profile({ personal: { firstName: 'Ana', email: 'ana@example.com' }, skills: [{ name: 'Java' }, { name: 'SQL' }] }), resumes: { activeId: 'r1', items: [{ id: 'r1', name: 'Main', text: '- x' }] } });
    it('status: skills, resumes and the AI in use', async () => {
      await load('popup.html', complete());
      await waitFor(() => /2 skills/.test($('#status').textContent), { msg: 'status' });
      includes($('#status').textContent, '1 resume(s)');
      includes($('#status').textContent, 'AI off');
      excludes($('#status').textContent, '⚠');
    });
    it('warns about what is missing', async () => {
      await load('popup.html', {});
      await waitFor(() => /⚠/.test($('#status').textContent), { msg: 'warning' });
      for (const t of ['Profile incomplete', 'No skills added', 'No resume saved']) includes($('#status').textContent, t);
    });
    it('names the AI provider (Chrome built-in, Groq)', async () => {
      const s = AJP.clone(AJP.store.DEFAULTS.settings);
      s.ai.provider = 'chrome';
      await load('popup.html', { ...complete(), settings: s });
      await waitFor(() => /Chrome built-in/.test($('#status').textContent), { msg: 'chrome' });
    });
    it('follow-ups due → a link that opens Applications filtered to due', async () => {
      const old = new Date(Date.now() - 20 * 86400000).toISOString();
      await load('popup.html', { ...complete(), applications: [{ id: 'a1', url: 'https://x.com/1', company: 'Initech', title: 'Engineer', status: 'applied', appliedAt: old, date: old }] }, { background: true });
      await waitFor(() => $('#due'), { msg: 'due link' });
      $('#due').click();
      await waitFor(() => w.browser.__created.some((t) => /admin\.html#applications\?due=1/.test(t.url)), { msg: 'opened' });
    });
    it('"Open Admin" and "Report a problem" open the right Admin page', async () => {
      await load('popup.html', complete(), { background: true });
      $('#admin').click();
      await waitFor(() => w.browser.__created.some((t) => /admin\.html$/.test(t.url)), { msg: 'admin' });
      $('#report').click();
      await waitFor(() => w.browser.__created.some((t) => /#logs\?report=1/.test(t.url)), { msg: 'report' });
    });
    it('"Analyze this job page" asks the background to analyze the active tab', async () => {
      await load('popup.html', complete(), { background: true });
      $('#analyze').click();
      await waitFor(() => w.browser.__sent.some((m) => m.type === 'analyzeTab' && m.tabId === 1), { msg: 'sent' });
    });
    it('a failure shows the message, hint and code in the popup', async () => {
      await load('popup.html', complete());
      $('#autofill').click(); // no background in this frame → the send fails
      await waitFor(() => !$('#err').hidden, { msg: 'error shown' });
      ok(/\(AJP-[A-Z0-9-]+\)/.test($('#err').textContent), $('#err').textContent);
    });
  }, { env: 'browser' });
})();
