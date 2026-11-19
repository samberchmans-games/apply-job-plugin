/*
 * Tailoring limits: tailoring only for close matches, a light touch (max rewrites), skills the user confirms with
 * the job they choose for each (spread across jobs by default), and a ceiling on the resume match.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, beforeEach, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const E = AJP.resumeEngine;
  const mock = globalThis.browser;

  describe('tailoring limits › rules (pure)', () => {
    it('defaults: from 70%, +15 points, 6 rewrites, 4 skills; settings are clamped', () => {
      eq(E.limits({}), { minMatch: 70, maxLift: 15, maxEdits: 6, maxSkills: 4 });
      eq(E.limits({ tailoring: { minMatch: '60', maxLift: 99, maxEdits: 0, maxSkills: 'x' } }), { minMatch: 60, maxLift: 40, maxEdits: 1, maxSkills: 4 });
    });
    it('only the most important rewrites stay selected (must before nice); the skills order does not count', () => {
      const reqs = [{ id: 'R1', priority: 'nice' }, { id: 'R2', priority: 'must' }, { id: 'R3', priority: 'should' }];
      const edits = [
        { id: 'e1', ok: true, accepted: true, kind: 'bullet', requirementIds: ['R1'] },
        { id: 'e2', ok: true, accepted: true, kind: 'bullet', requirementIds: ['R2'] },
        { id: 'e3', ok: true, accepted: true, kind: 'summary', requirementIds: ['R3'] },
        { id: 'e4', ok: true, accepted: true, kind: 'skills', requirementIds: [] },
        { id: 'e5', ok: false, accepted: false, kind: 'bullet', requirementIds: ['R2'] },
      ];
      const out = E.limitEdits(edits, reqs, 2);
      eq(out.map((e) => [e.id, e.accepted, !!e.limited]), [['e1', false, true], ['e2', true, false], ['e3', true, false], ['e4', true, false], ['e5', false, false]]);
    });
    it('jobs come from the Experience roles, in resume order', () => {
      const doc = E.parse('# Ana\n## Experience\n### Lead — Acme (2020–Present)\n- A\n- B\n### Dev — Globex (2015–2020)\n- C\n## Education\nBS');
      eq(E.roles(doc).map((r) => [r.label, r.bulletIds]), [['Lead — Acme', ['b1', 'b2']], ['Dev — Globex', ['b3']]]);
    });
    it('default places: 2 current : 1 previous; one job → all there; a 6th skill goes to the third job', () => {
      eq([0, 1, 2].map((i) => E.placeSkill(i, 2)), [0, 0, 1]);
      eq([0, 1, 2].map((i) => E.placeSkill(i, 1)), [0, 0, 0]);
      eq([0, 1, 2, 3, 4, 5].map((i) => E.placeSkill(i, 3)), [0, 0, 1, 0, 0, 2]);
    });
    it('simple wording: "<line>, using <Skill>"; a line that already names it is kept', () => {
      eq(E.weaveFallback('Built data pipelines for reporting.', 'Kafka'), 'Built data pipelines for reporting, using Kafka');
      eq(E.weaveFallback('Ran Kafka streams', 'Kafka'), 'Ran Kafka streams');
    });
    it('the ceiling: your real match + maxLift (the resume may catch up, plus a little)', () => {
      eq(E.liftCeiling({ matchScore: 75, resumeScore: 40 }, { maxLift: 15 }), 90);
      eq(E.liftCeiling({ matchScore: null, resumeScore: 40 }, { maxLift: 15 }), 55);
      eq(E.liftCeiling({ matchScore: 95, resumeScore: 90 }, { maxLift: 15 }), 100);
    });
    it('the AI is told: a light touch, at most N edits', () => {
      const p = E.editsPrompt({ doc: E.parse('## Experience\n### A — B (2020)\n- x'), requirements: [], atsKeywords: [], skills: [], job: {}, maxEdits: 4 });
      includes(p.prompt, 'NOT a rewrite: at most 4 bullet edits');
    });
  });

  // ---- Background + panel -----------------------------------------------------------------------------------
  const F = () => globalThis.__ENH_FIXTURE__;
  let realFetch;
  let bodies;
  function fakeAI(...answers) {
    bodies = [];
    let i = 0;
    globalThis.fetch = async (url, opts) => {
      bodies.push(JSON.parse(opts.body));
      const a = answers[Math.min(i++, answers.length - 1)];
      if (a instanceof Error) return new Response('down', { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: typeof a === 'string' ? a : JSON.stringify(a) } }] }));
    };
  }
  async function setup() {
    await mock.__reset();
    await AJP.store.update('settings', (s) => { s.ai.provider = 'groq'; s.ai.keys.groq = 'gsk-test'; });
    AJP.ai.CONFIG.tries = 1;
    await AJP.store.update('profile', (p) => void (p.skills = [{ name: 'Java' }, { name: 'Python' }, { name: 'AWS' }]));
    await AJP.store.set('resumes', { activeId: 'r1', items: [{ id: 'r1', name: 'Main resume', text: F().RESUME, createdAt: '2026-11-01' }] });
  }
  const enhance = (score = 75) => AJP.send('resume.enhance', { jd: F().JD, job: { title: 'Senior Data Engineer', company: 'Initech', url: 'https://x.com/1' }, score });

  describe('tailoring limits › only for close matches', () => {
    beforeEach(async () => {
      realFetch = globalThis.fetch;
      await setup();
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
      AJP.panel.remove();
    });
    it('the background refuses a low match with AJP-TAILOR-LOW, before any AI call', async () => {
      fakeAI(F().ANALYSIS, F().EDITS);
      const r = await enhance(40);
      eq(r.code, 'AJP-TAILOR-LOW');
      includes(r.hint, '70%+');
      eq(bodies.length, 0);
    });
    it('the limit is a setting', async () => {
      await AJP.store.update('settings', (s) => void (s.tailoring.minMatch = 35));
      fakeAI(F().ANALYSIS, F().EDITS);
      ok((await enhance(40)).ok);
    });
    it('the panel explains a low match and lists the biggest gaps instead of tailoring', async () => {
      fakeAI(F().ANALYSIS, F().EDITS);
      await AJP.send('analyzeTab', { tabId: 1, jdText: F().JD });
      const sh = await waitFor(() => document.querySelector('ajp-panel') && document.querySelector('ajp-panel').shadowRoot.querySelector('[data-act="tailor"]') && document.querySelector('ajp-panel').shadowRoot);
      sh.querySelector('[data-act="tailor"]').click();
      await waitFor(() => /tailoring starts at 70%/.test(sh.textContent), { msg: 'explained' });
      includes(sh.textContent, 'Biggest gaps: Kubernetes');
      eq(bodies.length, 0, 'no AI call');
    });
  }, { env: 'browser' });

  describe('tailoring limits › a light touch and confirmed skills', () => {
    let draft;
    beforeEach(async () => {
      realFetch = globalThis.fetch;
      await setup();
      await AJP.store.update('settings', (s) => void (s.tailoring.maxEdits = 2));
      fakeAI(F().ANALYSIS, F().EDITS);
      draft = (await enhance(75)).draft;
    });
    afterEach(() => (globalThis.fetch = realFetch));
    const send = (picks) => AJP.send('resume.addSkills', { id: draft.id, picks });
    const ACME = () => draft.roles[0].key;
    const GLOBEX = () => draft.roles[1].key;

    it('only maxEdits rewrites are selected; the others are kept as unselected "extra ideas"', () => {
      const rewrites = draft.edits.filter((e) => e.ok && e.kind !== 'skills');
      eq(rewrites.filter((e) => e.accepted).length, 2);
      ok(rewrites.some((e) => e.limited && !e.accepted));
      ok(draft.stats.limited >= 1);
    });
    it('the draft lists the job skills the resume does not show, never pre-selected, and the jobs', () => {
      const names = draft.skillOptions.map((o) => o.skill);
      includes(names, 'Kubernetes');
      eq(draft.skillOptions[0].importance, 'required');
      eq(draft.skillPicks, []);
      eq(draft.roles.map((r) => r.label), ['Senior Engineer — Acme Corp', 'Engineer — Globex']);
      eq([draft.matchScore, typeof draft.resumeScore], [75, 'number']);
    });
    it('confirmed skills go into a line of the CHOSEN job (AI wording), not all into the current job', async () => {
      const taken = draft.edits.filter((e) => e.accepted && e.kind === 'bullet').map((e) => e.target);
      const free = ['b1', 'b2', 'b3', 'b4'].find((b) => !taken.includes(b));
      const line = AJP.resumeEngine.parse(F().RESUME).bullets.find((b) => b.id === free).text.replace(/\.$/, '');
      fakeAI({ edits: [
        { skill: 'Kubernetes', target: free, after: `${line}, deployed on Kubernetes` },
        { skill: 'Snowflake', target: 'b5', after: 'Wrote Python ETL jobs for reporting, loading the results into Snowflake' },
      ] });
      const r = await send([{ skill: 'Kubernetes', role: ACME() }, { skill: 'Snowflake', role: GLOBEX() }]);
      ok(r.ok, r.error);
      const s = r.draft.edits.filter((e) => e.source === 'skill');
      eq(s.map((e) => [e.skill, e.target, e.role.includes('Acme') ? 'Acme' : 'Globex', e.wording, e.accepted]), [['Kubernetes', free, 'Acme', 'ai', true], ['Snowflake', 'b5', 'Globex', 'ai', true]]);
      eq(r.draft.confirmedSkills, ['Kubernetes', 'Snowflake']);
      ok(r.draft.coverage.resumeAfter > r.draft.resumeScore);
    });
    it('an AI line in the WRONG job is not used: simple wording in the chosen job instead', async () => {
      fakeAI({ edits: [{ skill: 'Snowflake', target: 'b1', after: 'Migrated data to Snowflake' }] });
      const r = await send([{ skill: 'Snowflake', role: GLOBEX() }]);
      const e = r.draft.edits.find((x) => x.source === 'skill');
      eq([e.target, e.wording, e.after], ['b5', 'simple', 'Wrote Python ETL jobs for reporting, using Snowflake']);
    });
    it('AI off or failing → simple wording the user can edit', async () => {
      fakeAI(new Error('down'));
      const r = await send([{ skill: 'Kubernetes', role: ACME() }]);
      const e = r.draft.edits.find((x) => x.source === 'skill');
      eq([e.wording, e.accepted], ['simple', true]);
      includes(e.after, 'using Kubernetes');
    });
    it('AI text that invents a number is rejected → simple wording', async () => {
      fakeAI({ edits: [{ skill: 'Kubernetes', target: 'b1', after: 'Migrated 10TB of customer data to AWS on Kubernetes' }] });
      const e = (await send([{ skill: 'Kubernetes', role: ACME() }])).draft.edits.find((x) => x.source === 'skill');
      eq(e.wording, 'simple');
      excludes(e.after, '10TB');
    });
    it('a line already changed by a selected rewrite is not reused', async () => {
      fakeAI(new Error('down'));
      const taken = draft.edits.filter((e) => e.accepted && e.kind === 'bullet').map((e) => e.target);
      const e = (await send([{ skill: 'Kubernetes', role: ACME() }])).draft.edits.find((x) => x.source === 'skill');
      notOk(taken.includes(e.target), `${e.target} in ${taken}`);
    });
    it('skills not offered are ignored; more than maxSkills are skipped with the reason', async () => {
      await AJP.store.update('enhancements', (l) => l.map((d) => ({ ...d, limits: { ...d.limits, maxSkills: 1 } })));
      fakeAI(new Error('down'));
      const r = await send([{ skill: 'Rust', role: ACME() }, { skill: 'Kubernetes', role: ACME() }, { skill: 'Snowflake', role: GLOBEX() }]);
      eq(r.draft.confirmedSkills, ['Kubernetes']);
      eq(r.skipped, [{ skill: 'Snowflake', reason: 'limit' }]);
    });
    it('going above your match + maxLift is allowed but flagged (the skills count is the hard limit)', async () => {
      await AJP.store.update('enhancements', (l) => l.map((d) => ({ ...d, matchScore: 0, resumeScore: 0, limits: { ...d.limits, maxLift: 5 } })));
      fakeAI(new Error('down'));
      const r = await send([{ skill: 'Kubernetes', role: ACME() }]);
      eq(r.draft.confirmedSkills, ['Kubernetes']);
      eq(r.overCeiling, true);
    });
    it('creating the resume: confirmed skills in their lines AND in the Skills list; rewrites capped', async () => {
      fakeAI(new Error('down'));
      const d2 = (await send([{ skill: 'Kubernetes', role: ACME() }, { skill: 'Snowflake', role: GLOBEX() }])).draft;
      // Try to force every rewrite on: only maxEdits (2) are applied.
      const decisions = d2.edits.map((e) => ({ editId: e.id, accepted: e.ok }));
      const r = await AJP.send('resume.applyEnhancement', { id: d2.id, decisions });
      ok(r.ok, r.error);
      ok(r.skipped.some((x) => x.codes.includes('LIMIT')), JSON.stringify(r.skipped));
      const t = r.resume.text;
      includes(t, 'using Kubernetes');
      includes(t, 'Wrote Python ETL jobs for reporting, using Snowflake');
      includes(t.split('## Skills')[1], 'Additional skills: Kubernetes, Snowflake');
      ok(AJP.resumeEngine.verifyIntegrity(F().RESUME, t).ok, 'protected lines intact');
    });
  }, { env: 'browser' });

  // ---- Admin review screen ------------------------------------------------------------------------------------------
  describe('tailoring limits › review screen', () => {
    let frame;
    let w;
    let draft;
    const $ = (s) => w.document.querySelector(s);
    beforeEach(async () => {
      realFetch = globalThis.fetch;
      await setup();
      await AJP.store.update('settings', (s) => void (s.tailoring.maxEdits = 2));
      fakeAI(F().ANALYSIS, F().EDITS);
      draft = (await enhance(75)).draft;
      globalThis.fetch = realFetch;
      let html = await (await fetch('../src/admin/admin.html', { cache: 'no-store' })).text();
      html = html.replace('<script src="tracker-view.js"></script>', '<script src="../background/background.js"></script>\n<script src="tracker-view.js"></script>');
      const seed = { resumes: await AJP.store.get('resumes'), profile: await AJP.store.get('profile'), settings: await AJP.store.get('settings'), enhancements: [draft] };
      const page = html.replace('<head>', `<head><base href="${new URL('../src/admin/', location.href).href}"><script>window.__SEED__=${JSON.stringify(seed)}</script>`)
        .replace('<script src="../lib/core.js"></script>', '<script src="../../tests/mocks/browser-mock.js"></script><script>browser.storage.local.set(window.__SEED__)</script><script src="../lib/core.js"></script>');
      frame = document.createElement('iframe');
      frame.style.cssText = 'width:1200px;height:800px;border:0;position:absolute;left:-5000px;top:0';
      document.body.appendChild(frame);
      await new Promise((res) => {
        frame.onload = res;
        frame.srcdoc = page;
      });
      w = frame.contentWindow;
      await waitFor(() => w.AJP && $('#ver') && $('#ver').textContent);
      w.location.hash = 'resumes?enh=' + draft.id;
      await waitFor(() => $('#enhDialog') && $('#enhDialog').open, { msg: 'review' });
    });
    afterEach(() => {
      frame && frame.remove();
      globalThis.fetch = realFetch;
    });
    const tick = (skill) => {
      const cb = $(`[data-skill="${skill}"]`);
      cb.checked = !cb.checked;
      cb.dispatchEvent(new w.Event('change', { bubbles: true }));
    };
    const roleOf = (skill) => $(`[data-skill-role="${skill}"]`).value;

    it('shows the job skills the resume lacks, nothing ticked, and the match ceiling', () => {
      ok($('[data-skill="Kubernetes"]'));
      notOk($('[data-skill="Kubernetes"]').checked);
      includes($('#enhDialog').textContent, 'your match 75%, limit 90%');
    });
    it('ticked skills are spread across jobs by default (2 current : 1 previous), and the user can move one', async () => {
      const names = draft.skillOptions.map((o) => o.skill).slice(0, 3);
      eq(names.length, 3, 'the fixture job offers Kubernetes, Communication, Snowflake');
      names.forEach(tick);
      eq(names.map((n) => roleOf(n) === draft.roles[0].key), [true, true, false]);
      const sel = $(`[data-skill-role="${names[0]}"]`);
      sel.value = draft.roles[1].key;
      sel.dispatchEvent(new w.Event('change', { bubbles: true }));
      eq(roleOf(names[0]), draft.roles[1].key);
    });
    it('the live meter rises as skills are ticked', () => {
      const before = $('#enhLift').textContent;
      tick('Kubernetes');
      ok($('#enhLift').textContent !== before, `${before} → ${$('#enhLift').textContent}`);
    });
    it('the rewrite limit: with 2 selected, other rewrites cannot be ticked', () => {
      const boxes = [...$('#enhDialog').querySelectorAll('[data-accept]')];
      const open = boxes.filter((b) => !b.checked && !b.closest('.edit').classList.contains('blocked') && !/Skills order/.test(b.closest('label').textContent));
      ok(open.length >= 1);
      ok(open.every((b) => b.disabled));
      includes($('#enhDialog').textContent, 'limit of 2 changes reached');
    });
    it('"Add selected skills to the draft" adds skill lines to the review', async () => {
      tick('Kubernetes');
      $('#enhAddSkills').click();
      await waitFor(() => /Skill · Kubernetes →/.test($('#enhDialog').textContent), { msg: 'skill edit shown' });
      includes($('#enhDialog').textContent, 'In the draft: Kubernetes');
    });
  }, { env: 'browser' });
})();
