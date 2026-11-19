/*
 * Resumes without "-" bullets: more bullet symbols, Word list paragraphs, achievement lines without markers
 * (loose mode), the one-click fix in Admin, and tailoring on such a resume.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const E = AJP.resumeEngine;
  const PLAIN = [
    'Sam B', 'Data Architect · sam@example.com', '',
    'Professional Experience',
    'Senior Data Architect, Acme Corp',
    'Jan 2019 – Present',
    'Designed the enterprise data lake on AWS for 40 business units',
    'Led a team of 6 engineers delivering Snowflake and Spark pipelines',
    'Data Engineer, Globex',
    'Jun 2015 – Dec 2018',
    'Built Python ETL jobs that loaded sales data into the warehouse every night',
    '', 'Education', 'B.Tech Computer Science, Anna University 2005 – 2009',
  ].join('\n');

  describe('bullets › symbols, Word lists and plain achievement lines (pure)', () => {
    for (const mark of ['●', '➢', '■', '✓', '', '•', '-'])
      it(`"${mark === '' ? 'Word symbol bullet' : mark}" is a bullet`, () => eq(E.parse(`## Experience\n### Dev — Co (2020)\n${mark}\tBuilt Python services`).bullets[0].text, 'Built Python services'));
    it('"1.5 years of experience" is not a bullet', () => {
      eq(E.parse('## Experience\n### Dev — Co (2020)\n1.5 years of experience in Java').bullets.filter((b) => !b.loose).length, 0);
    });
    it('no bullet characters → achievement lines are used (loose); titles, companies and dates are not', () => {
      const d = E.parse(PLAIN);
      ok(d.loose);
      eq(d.bullets.map((b) => b.text.slice(0, 20)), ['Designed the enterpri', 'Led a team of 6 engi', 'Built Python ETL job'].map((x) => x.slice(0, 20)));
      eq(d.bullets[0].role, 'Jan 2019 – Present');
    });
    it('a resume WITH bullets is never read loosely', () => notOk(E.parse('## Experience\n### Dev — Co (2020)\n- Built things\nLed the platform team for years and years').loose));
    it('the one-click fix puts "- " in front of achievement lines only, and the result has real bullets', () => {
      const r = E.addBulletMarkers(PLAIN);
      eq(r.count, 3);
      includes(r.text, '- Designed the enterprise data lake');
      includes(r.text, '\nSenior Data Architect, Acme Corp\n');
      notOk(E.parse(r.text).loose);
    });
    it('a loose line is rewritten without adding a marker', () => {
      const d = E.parse(PLAIN);
      const t = E.assemble(PLAIN, [{ target: d.bullets[0].id, after: 'Designed the AWS data lake used by 40 business units' }]);
      includes(t, '\nDesigned the AWS data lake used by 40 business units\n');
      ok(E.verifyIntegrity(PLAIN, t).ok);
    });
    it('Word: list paragraphs (numbering / List style) get "- "', () => {
      const xml = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Built pipelines</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t xml:space="preserve">Led a team</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Senior Engineer</w:t></w:r></w:p>';
      const out = AJP.docx.markLists(xml).replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
      eq(out, '- Built pipelines\n- Led a team\nSenior Engineer\n');
    });
    for (const head of ['EXPERIENCE SUMMARY', 'Experience Summary', 'Professional Experience Highlights', 'CAREER HISTORY', 'Employment Details:', 'WORK EXPERIENCE']) {
      it(`"${head}" is the Experience section; achievements under it are found`, () => {
        const text = ['SAM B', 'PROFESSIONAL SUMMARY', 'Data architect with many years of experience in cloud data platforms, leading teams.', head,
          'ACME CORPORATION', 'Senior Data Architect | Jan 2019 – Till Date', 'Designed the enterprise data lake on AWS for 40 business units',
          'Led a team of 6 engineers delivering Snowflake pipelines', 'EDUCATION', 'B.Tech, Anna University 2005 – 2009'].join('\n');
        const d = E.parse(text);
        eq(d.bullets.map((b) => b.text.slice(0, 12)), ['Designed the', 'Led a team o']);
        ok(d.bullets.every((b) => b.section === head.replace(/:$/, '')), d.bullets.map((b) => b.section).join());
      });
    }
    it('a company name in capitals is not a heading', () => eq(E.parse('## Experience\nACME CORPORATION\n- Built things').bullets[0].section, 'Experience'));
    it('the summary stays the summary ("Professional Summary")', () => eq(E.parse('PROFESSIONAL SUMMARY\nData architect.\nEXPERIENCE\nAcme 2019 - 2020\n- Built x').summary.length, 1));
    it('the years reader understands the same resume (dates on their own line)', () => {
      const c = AJP.experience.candidate({}, PLAIN);
      eq(c.roles.length, 2);
      ok(c.skillYears('Python') >= 3);
    });
  });

  describe('bullets › tailoring and Admin with a resume without bullets', () => {
    let realFetch;
    let frame;
    afterEach(() => {
      if (realFetch) globalThis.fetch = realFetch;
      if (frame) frame.remove();
    });
    it('tailoring works: the edits target the achievement lines', async () => {
      await globalThis.browser.__reset();
      await AJP.store.update('settings', (s) => { s.ai.provider = 'groq'; s.ai.keys.groq = 'k'; s.tailoring.minMatch = 0; });
      await AJP.store.set('resumes', { activeId: 'r1', items: [{ id: 'r1', name: 'Plain', text: PLAIN }] });
      realFetch = globalThis.fetch;
      const answers = [
        { requirements: [{ id: 'R1', text: 'Data lakes on AWS', priority: 'must', match: 'strong', evidence: [{ quote: 'Designed the enterprise data lake on AWS for 40 business units' }] }], ats_keywords: ['AWS'] },
        { edits: [{ target: 'b1', after: 'Designed the enterprise AWS data lake serving 40 business units', requirement_ids: ['R1'], evidence: ['Designed the enterprise data lake on AWS for 40 business units'], reason: 'r' }] },
      ];
      let i = 0;
      globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answers[i++]) } }] }));
      const r = await AJP.send('resume.enhance', { jd: 'Requirements\n- AWS data lake', job: { title: 'Data Architect' } });
      ok(r.ok, r.error);
      const e = r.draft.edits.find((x) => x.target === 'b1');
      ok(e && e.ok, JSON.stringify(e && e.violations));
      const done = await AJP.send('resume.applyEnhancement', { id: r.draft.id });
      ok(done.ok, done.error);
      includes(done.resume.text, '\nDesigned the enterprise AWS data lake serving 40 business units\n');
    });
    it('Admin shows the notice and "Mark achievement lines as bullets" fixes the text', async () => {
      let html = await (await fetch('../src/admin/admin.html', { cache: 'no-store' })).text();
      const seed = { resumes: { activeId: 'r1', items: [{ id: 'r1', name: 'Plain', text: PLAIN }] } };
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
      await waitFor(() => $('#resumeBullets') && !$('#resumeBullets').hidden, { msg: 'notice' });
      includes($('#resumeBullets').textContent, 'reads 3 lines that look like achievements');
      $('#resumeAddBullets').click();
      await waitFor(async () => /- Designed the enterprise/.test((await w.AJP.store.get('resumes')).items[0].text), { msg: 'saved' });
      await waitFor(() => $('#resumeBullets').hidden, { msg: 'notice gone' });
    });
  }, { env: 'browser' });
})();
