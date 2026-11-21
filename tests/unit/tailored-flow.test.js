/*
 * Tailoring results: wrapped lines (PDF / copy-paste) handled, one tailored resume per job, the job in the file name,
 * the panel scoring with the job's tailored resume (live) and downloading it, the Admin grouping, soft lift limit.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, beforeEach, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const E = AJP.resumeEngine;

  // The wrapping of a real resume (anonymised): sentences and bullets broken across lines.
  const WRAPPED = ['Jordan Lee', 'Solution Architect / Lead Data Engineer', 'PROFESSIONAL SUMMARY',
    'Data architect and lead engineer with 15+ years of experience designing and running data platforms on AWS. Snowflake',
    'subject matter expert with hands-on work in platform design and enterprise Data Mesh',
    'architecture.', 'TECHNICAL SKILLS', 'Languages & Frameworks: Python, Java (Spring Boot), SQL', 'CAREER PROFILE',
    'Architect / Lead Data Engineer | Initech Dec 2022 – Present', 'Architecture',
    '• Used keyed dbt merge loads and a reprocessing framework so reruns, corrections and backfills never create duplicate or',
    'missing data.', '• Moved application secrets out of FSA into HashiCorp Vault.', 'Data Engineering, Integration & Cloud Migration',
    '• Led the migration from Sybase to Amazon RDS as a one-time full data load, rewrote the Sybase stored procedures in Java,',
    'and validated the result with row-level checks against the source.',
    'Tools: Java Spring Boot, Camel, Python, Hibernate, Redis, Helm, HashiCorp Vault, Control-M, Snowflake, Oracle, Sybase,',
    'Spark/PySpark, dbt, AWS (Glue, EKS, ECS, Lambda, SQS, RDS)', 'Associate VP – Data Integration | Globex Nov 2021 – Dec 2022',
    '• Used keyed idempotent producers to keep delivery duplicate-free and replays safe.'].join('\n');

  describe('tailored resumes › wrapped lines', () => {
    it('a wrapped bullet is ONE bullet (with its continuation lines)', () => {
      const b = E.parse(WRAPPED).bullets;
      eq(b.length, 4);
      eq(b[0].text, 'Used keyed dbt merge loads and a reprocessing framework so reruns, corrections and backfills never create duplicate or missing data.');
      includes(b[2].text, 'and validated the result with row-level checks');
    });
    it('rewriting a wrapped bullet replaces all of it (no leftover "missing data.")', () => {
      const t = E.assemble(WRAPPED, [{ target: 'b1', after: 'Built keyed dbt merge loads so reruns and backfills never duplicate or lose data' }]);
      excludes(t, '\nmissing data.');
      includes(t, '• Built keyed dbt merge loads so reruns and backfills never duplicate or lose data\n• Moved application secrets');
      ok(E.verifyIntegrity(WRAPPED, t).ok);
    });
    it('"Tools:" lines, sub-headings and job lines never join a bullet', () => {
      const lines = E.parse(WRAPPED).blocks.filter((x) => x.kind !== 'bullet').map((x) => x.text.trim());
      for (const l of ['Data Engineering, Integration & Cloud Migration', 'Associate VP – Data Integration | Globex Nov 2021 – Dec 2022']) includes(lines, l);
      ok(lines.some((l) => l.startsWith('Tools: Java Spring Boot')));
    });
    it('the shared rule: lower-case start / trailing comma join; action verbs, labels, job lines and Title-Case headings do not', () => {
      const c = AJP.continuesLine;
      ok(c('never create duplicate or', 'missing data.'));
      ok(c('Snowflake, Oracle, Sybase,', 'Spark/PySpark, dbt'));
      notOk(c('Designed the enterprise data lake on AWS for 40 business units', 'Led a team of 6 engineers delivering pipelines'));
      notOk(c('Built pipelines across many teams and regions for the analytics', 'Tools: Java, Python'));
      notOk(c('Built pipelines across many teams and regions for the analytics', 'Data Engineering, Integration & Cloud Migration'));
      notOk(c('Built pipelines across many teams and regions for the analytics', 'Associate VP | Globex Nov 2021 – Dec 2022'));
      notOk(c('one.', '• next bullet'));
    });
    it('the PDF: no orphan words; sections, job lines and sub-headings styled', () => {
      const b = AJP.pdfWriter.blocks(WRAPPED);
      const para = b.find((x) => x.style === 'para' && /Data architect/.test(x.text));
      includes(para.text, 'Snowflake subject matter expert');
      includes(para.text, 'Data Mesh architecture.');
      eq(b.filter((x) => x.style === 'section').map((x) => x.text), ['PROFESSIONAL SUMMARY', 'TECHNICAL SKILLS', 'CAREER PROFILE']);
      eq(b.filter((x) => x.style === 'role').map((x) => x.text.slice(0, 20)), ['Architect / Lead Dat', 'Architecture', 'Data Engineering, In', 'Associate VP – Data ']);
      ok(b.some((x) => x.style === 'bullet' && /never create duplicate or missing data\./.test(x.text)));
    });
    it('a skills line is never styled as a sub-heading', () => eq(AJP.pdfWriter.blocks('# A\n## Skills\nJava, Python, SQL, AWS').pop().style, 'para'));
    it('the file name has the job', () => eq(AJP.pdfWriter.fileName('Jordan Lee', 'Initech', 'Senior Data Engineer'), 'Jordan Lee - Resume - Initech - Senior Data Engineer.pdf'));
    it('verified evidence means the requirement is not "not in resume"', () => {
      const { requirements } = E.verifyRequirements([{ id: 'R1', text: 'AWS data platforms', priority: 'must', match: 'none', evidence: [{ quote: 'Moved application secrets out of FSA into HashiCorp Vault' }] }], WRAPPED);
      eq(requirements[0].match, 'partial');
    });
  });

  // ---- Background, panel, Admin ------------------------------------------------------------------------------
  const F = () => globalThis.__ENH_FIXTURE__;
  let realFetch;
  function fakeAI(...answers) {
    let i = 0;
    globalThis.fetch = async () => {
      const a = answers[Math.min(i++, answers.length - 1)];
      return new Response(JSON.stringify({ choices: [{ message: { content: typeof a === 'string' ? a : JSON.stringify(a) } }] }));
    };
  }
  async function setup() {
    await globalThis.browser.__reset();
    await AJP.store.update('settings', (s) => { s.ai.provider = 'groq'; s.ai.keys.groq = 'k'; s.tailoring.minMatch = 0; });
    await AJP.store.update('profile', (p) => void (p.skills = [{ name: 'Java' }, { name: 'Python' }, { name: 'AWS' }]));
    await AJP.store.set('resumes', { activeId: 'r1', items: [{ id: 'r1', name: 'Main resume', text: F().RESUME, createdAt: '2026-11-01' }] });
  }
  const JOB = () => ({ title: 'Senior Data Engineer', company: 'Initech', url: location.href });
  async function tailor() {
    fakeAI(F().ANALYSIS, F().EDITS);
    const d = (await AJP.send('resume.enhance', { jd: F().JD, job: JOB(), score: 72 })).draft;
    return AJP.send('resume.applyEnhancement', { id: d.id });
  }

  describe('tailored resumes › one per job, named for the job', () => {
    beforeEach(async () => {
      realFetch = globalThis.fetch;
      await setup();
    });
    afterEach(() => (globalThis.fetch = realFetch));
    it('the PDF name has the company AND the job title', async () => {
      const r = await tailor();
      eq(r.resume.file.name, 'Ana Silva - Resume - Initech - Senior Data Engineer.pdf');
      eq(r.resume.matchBefore, 72);
    });
    it('tailoring the same job again REPLACES its resume (no pile of copies)', async () => {
      const a = await tailor();
      const b = await tailor();
      eq([b.replaced, b.resume.id], [true, a.resume.id]);
      const items = (await AJP.store.get('resumes')).items;
      eq(items.filter((x) => x.enhancementId).length, 1);
      ok(items.find((x) => x.enhancementId).updatedAt);
    });
  }, { env: 'browser' });

  describe('tailored resumes › the panel', () => {
    const sh = () => document.querySelector('ajp-panel') && document.querySelector('ajp-panel').shadowRoot;
    beforeEach(async () => {
      realFetch = globalThis.fetch;
      await setup();
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
      AJP.panel.remove();
    });
    it('creating the tailored resume re-scores the open panel by itself, and says so', async () => {
      await AJP.send('analyzeTab', { tabId: 1, jdText: F().JD });
      await waitFor(() => sh() && /\d+%/.test(sh().querySelector('.badge').textContent), { msg: 'panel' });
      notOk(sh().querySelector('.tailored'));
      await tailor();
      await waitFor(() => sh().querySelector('.tailored'), { msg: 'tailored line' });
      includes(sh().querySelector('.tailored').textContent, 'Scored with your resume tailored for this job');
      notOk(/was 72%/.test(sh().querySelector('.tailored').textContent), 'before = the original resume scored now, not a stored number');
    });
    it('"⬇ Download PDF" in the panel saves the tailored file with the job in its name', async () => {
      await tailor();
      await AJP.send('analyzeTab', { tabId: 1, jdText: F().JD });
      await waitFor(() => sh() && sh().querySelector('[data-act="downloadTailored"]'), { msg: 'button' });
      let name = null;
      const real = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { name = this.download; };
      try {
        sh().querySelector('[data-act="downloadTailored"]').click();
        await waitFor(() => name, { msg: 'download' });
      } finally {
        HTMLAnchorElement.prototype.click = real;
      }
      eq(name, 'Ana Silva - Resume - Initech - Senior Data Engineer.pdf');
    });
    it('other resume changes do not re-score the panel', async () => {
      await AJP.send('analyzeTab', { tabId: 1, jdText: F().JD });
      await waitFor(() => sh() && /\d+%/.test(sh().querySelector('.badge').textContent));
      const got = [];
      const saved = AJP.getLogSink();
      AJP.setLogSink(async (e) => got.push(...e));
      try {
        await new Promise((r) => setTimeout(r, 300)); // let anything from earlier tests settle
        await AJP.flushLogs();
        got.length = 0;
        await AJP.store.update('resumes', (r) => void (r.items[0].name = 'Renamed'));
        await new Promise((r) => setTimeout(r, 200));
        await AJP.flushLogs();
      } finally {
        AJP.setLogSink(saved);
      }
      notOk(got.some((l) => /tailoredChanged|Analyzed job/.test(l.msg)), JSON.stringify(got.map((l) => l.msg)));
    });
  }, { env: 'browser' });

  describe('tailored resumes › Admin', () => {
    let frame;
    afterEach(() => frame && frame.remove());
    it('tailored resumes are grouped (collapsed) under your own', async () => {
      const seed = { resumes: { activeId: 'r1', items: [
        { id: 'r1', name: 'Main resume', text: '# A\n- x', createdAt: '2026-11-01' },
        { id: 't1', name: 'Tailored — Initech — Engineer', text: '# A\n- y', enhancementId: 'e1', job: { url: 'https://x.com/1' }, createdAt: '2026-11-02' },
        { id: 't2', name: 'Tailored — Globex — Architect', text: '# A\n- z', enhancementId: 'e2', job: { url: 'https://x.com/2' }, createdAt: '2026-11-03' },
      ] } };
      let html = await (await fetch('../src/admin/admin.html', { cache: 'no-store' })).text();
      html = html.replace('<head>', `<head><base href="${new URL('../src/admin/', location.href).href}"><script>window.__SEED__=${JSON.stringify(seed)}</script>`)
        .replace('<script src="../lib/core.js"></script>', '<script src="../../tests/mocks/browser-mock.js"></script><script>browser.storage.local.set(window.__SEED__)</script><script src="../lib/core.js"></script>');
      frame = document.createElement('iframe');
      frame.style.cssText = 'width:1200px;height:800px;border:0;position:absolute;left:-5000px;top:0';
      document.body.appendChild(frame);
      await new Promise((res) => { frame.onload = res; frame.srcdoc = html; });
      const w = frame.contentWindow;
      const $ = (s) => w.document.querySelector(s);
      await waitFor(() => w.AJP && $('#ver') && $('#ver').textContent);
      w.location.hash = 'resumes';
      await waitFor(() => $('.tailored-group'), { msg: 'group' });
      includes($('.tailored-group summary').textContent, 'Tailored for jobs (2)');
      notOk($('.tailored-group').open, 'collapsed');
      ok($('#resumeList > .res[data-id="r1"]'), 'your own resume stays on top');
    });
  }, { env: 'browser' });
})();
