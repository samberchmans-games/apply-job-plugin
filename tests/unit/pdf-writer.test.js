/*
 * PDF writer — one resume format: every resume gets a PDF that applications upload.
 * Pure tests (CLI + browser): encoding, wrapping, blocks, file structure, names, errors.
 * Browser tests: pdf.js reads our PDF back; Admin keeps the PDF in sync; Download/View; autofill uses it.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, throws, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const P = AJP.pdfWriter;

  const RESUME = [
    '# Ana Silva',
    'ana@example.com · Austin, TX',
    '',
    '## Experience',
    '### Senior Engineer — Acme Corp (2019–Present)',
    '- Migrated customer data from on-prem Oracle to AWS',
    '- Built REST APIs in **Java** and Spring Boot for the payments team, used by 40 internal services and three partner banks every day',
    '',
    '## Skills',
    'Java, Python, SQL, AWS',
  ].join('\n');
  const latin1 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  };

  describe('pdf-writer › text, wrapping and blocks (pure)', () => {
    it('ASCII and Latin-1 characters encode as themselves', () => eq(P.encode('Aé ü').codes, [65, 233, 32, 252]));
    it('smart quotes, dashes and bullets map to WinAnsi', () => eq(P.encode('“x” – • —').codes, [0x93, 120, 0x94, 32, 0x96, 32, 0x95, 32, 0x97]));
    it('characters a standard PDF font cannot show become "?" and are counted', () => {
      const r = P.encode('Ana 安娜 ✓');
      eq(r.replaced, 3);
      includes(String.fromCharCode(...r.codes), '?');
    });
    it('bold text is wider than regular', () => ok(P.widthOf(P.encode('Senior Engineer').codes, true, 11) > P.widthOf(P.encode('Senior Engineer').codes, false, 11)));
    it('wraps long lines by real width; no line exceeds it and no word is lost', () => {
      const text = 'Built REST APIs in Java and Spring Boot for the payments team used by forty internal services every single day';
      const lines = P.wrap(text, { size: 10.5, width: 200 });
      ok(lines.length > 1);
      for (const l of lines) ok(P.widthOf(P.encode(l).codes, false, 10.5) <= 200, l);
      eq(lines.join(' '), text);
    });
    it('a single word longer than the line is split, not dropped', () => {
      const lines = P.wrap('x'.repeat(300), { size: 10, width: 100 });
      ok(lines.length > 1);
      eq(lines.join('').length, 300);
    });
    it('reads the resume structure: name, contact, section, role, bullets, paragraph', () => {
      const b = P.blocks(RESUME);
      eq(b.map((x) => x.style), ['name', 'contact', 'section', 'role', 'bullet', 'bullet', 'section', 'para']);
      eq(b[0].text, 'Ana Silva');
      excludes(b[5].text, '**', 'markdown emphasis removed');
    });
    it('the name on the resume is its "# " heading', () => eq(P.nameFrom(RESUME), 'Ana Silva'));
  });

  describe('pdf-writer › the PDF file (pure)', () => {
    it('is a valid PDF: header, objects, xref offsets that point at each object, trailer', () => {
      const { bytes, pages } = P.fromResumeText(RESUME, { title: 'Ana Silva - Resume', author: 'Ana Silva' });
      const s = latin1(bytes);
      ok(s.startsWith('%PDF-1.4'));
      ok(s.trimEnd().endsWith('%%EOF'));
      eq(pages, 1);
      const xrefAt = Number(s.match(/startxref\n(\d+)/)[1]);
      eq(s.slice(xrefAt, xrefAt + 4), 'xref');
      const offs = s.slice(xrefAt).match(/^\d{10} 00000 n $/gm).map((l) => Number(l.slice(0, 10)));
      offs.forEach((o, i) => eq(s.slice(o, o + String(i + 1).length + 6), `${i + 1} 0 obj`));
      includes(s, '/BaseFont /Helvetica-Bold');
      includes(s, '/Title (Ana Silva - Resume)');
    });
    it('the text is in the file as plain text (ATS-readable, nothing compressed)', () => {
      const s = latin1(P.fromResumeText(RESUME).bytes);
      includes(s, '(Migrated customer data from on-prem Oracle to AWS) Tj');
      includes(s, '(EXPERIENCE) Tj', 'section headings in capitals');
      excludes(s, 'FlateDecode');
    });
    it('brackets and backslashes are escaped', () => includes(latin1(P.fromResumeText('# A\n- Used (and liked) C:\\tools').bytes), '(Used \\(and liked\\) C:\\\\tools) Tj'));
    it('a long resume flows onto more pages', () => {
      const long = '# Ana\n## Experience\n' + Array.from({ length: 90 }, (_, i) => `- Achievement number ${i + 1} with enough words to fill a line`).join('\n');
      ok(P.fromResumeText(long).pages >= 2);
    });
    it('reports how many characters had to be replaced', () => eq(P.fromResumeText('# Ana\n- Spoke 中文').replaced, 2));
    it('empty text → AJP-PDF-CREATE (coded, with a hint)', () => {
      const e = throws(() => P.fromResumeText('  \n '));
      eq(e.code, 'AJP-PDF-CREATE');
      ok(e.hint);
    });
    it('file names: "<Name> - Resume - <Company>.pdf", safe for every OS', () => {
      eq(P.fileName('Ana Silva', 'Initech'), 'Ana Silva - Resume - Initech.pdf');
      eq(P.fileName('Ana Silva'), 'Ana Silva - Resume.pdf');
      eq(P.fileName('', ''), 'Resume.pdf');
      eq(P.fileName('Ana/Silva', 'A:B "C"'), 'Ana Silva - Resume - A B C.pdf');
    });
  });

  // ---- Browser ----------------------------------------------------------------------------------
  const pdfBase = () => new URL('../src/vendor/pdfjs/', location.href).href;
  const buf = (f) => fetch(f.dataUrl).then((r) => r.arrayBuffer());

  describe('pdf-writer › round trip and file records', () => {
    it('pdf.js reads our PDF back: same lines, bullets as "- "', async () => {
      AJP.pdf.CONFIG.base = pdfBase();
      const { file } = P.fileFor({ text: RESUME });
      const { text } = await AJP.pdf.toText(await buf(file));
      includes(text, 'Ana Silva');
      includes(text, '- Migrated customer data from on-prem Oracle to AWS');
      includes(text, 'Senior Engineer — Acme Corp (2019–Present)');
      includes(text, 'Java, Python, SQL, AWS');
    });
    it('fileFor gives a generated PDF record with a name, size and page count', () => {
      const { file } = P.fileFor({ text: RESUME }, { company: 'Initech' });
      eq([file.name, file.type, file.generated, file.pages], ['Ana Silva - Resume - Initech.pdf', 'application/pdf', true, 1]);
      ok(file.dataUrl.startsWith('data:application/pdf;base64,JVBERi0xLjQ'));
      ok(file.size > 500);
    });
    it('the PDF data is never written to the logs', () => {
      const { file } = P.fileFor({ text: RESUME });
      eq(AJP.redact({ file }).file.dataUrl, '[redacted]');
    });
  }, { env: 'browser' });

  describe('pdf-writer › Autofill uploads a PDF', () => {
    const sandbox = () => document.getElementById('sandbox');
    afterEach(() => (sandbox().innerHTML = ''));
    const form = () => (sandbox().innerHTML = '<label for="cv">Resume/CV</label><input id="cv" type="file">');
    const run = (resume) => AJP.filler.fill({ profile: AJP.clone(AJP.store.DEFAULTS.profile), answers: {}, resume, root: sandbox() });

    it('a typed resume (no file) gets a PDF made on the spot, and the report names it', async () => {
      form();
      const r = await run({ id: 'r1', text: RESUME });
      const f = document.getElementById('cv').files[0];
      eq([f.name, f.type], ['Ana Silva - Resume.pdf', 'application/pdf']);
      eq(r.attached, 'Ana Silva - Resume.pdf');
    });
    it('an older Word upload is sent as a PDF made from its text', async () => {
      form();
      await run({ id: 'r1', text: RESUME, file: { name: 'ana.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dataUrl: 'data:application/octet-stream;base64,UEsDBA==' } });
      eq(document.getElementById('cv').files[0].type, 'application/pdf');
    });
    it('a PDF the user uploaded is sent as it is', async () => {
      form();
      await run({ id: 'r1', text: RESUME, file: { name: 'my-own.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' } });
      eq(document.getElementById('cv').files[0].name, 'my-own.pdf');
    });
  }, { env: 'browser' });

  describe('pdf-writer › Admin', () => {
    let frame;
    let w;
    const $ = (s) => w.document.querySelector(s);
    afterEach(() => frame && frame.remove());
    async function loadAdmin(seed) {
      const html = await (await fetch('../src/admin/admin.html', { cache: 'no-store' })).text();
      const page = html.replace('<head>', '<head><base href="' + new URL('../src/admin/', location.href).href + '"><script>window.__SEED__=' + JSON.stringify(seed) + '</script>')
        .replace('<script src="../lib/core.js"></script>', '<script src="../../tests/mocks/browser-mock.js"></script><script>browser.storage.local.set(window.__SEED__)</script><script src="../lib/core.js"></script>');
      frame = document.createElement('iframe');
      frame.style.cssText = 'width:1200px;height:800px;border:0;position:absolute;left:-5000px;top:0';
      document.body.appendChild(frame);
      await new Promise((res) => {
        frame.onload = res;
        frame.srcdoc = page;
      });
      w = frame.contentWindow;
      await waitFor(() => w.AJP && w.AJP.pdfWriter && $('#ver').textContent, { msg: 'admin' });
      w.location.hash = 'resumes';
      const empty = !seed.resumes.items.length;
      await waitFor(() => $('#resumes').classList.contains('on') && (empty || !$('#resumeEditor').hidden), { msg: 'resume editor' });
    }
    const stored = async () => (await w.AJP.store.get('resumes')).items[0];
    const typed = { resumes: { activeId: 'r1', items: [{ id: 'r1', name: 'Typed', text: RESUME, createdAt: '2026-11-01' }] } };

    it('the old print view and .md download are gone; Download PDF and View PDF are there', async () => {
      await loadAdmin(typed);
      notOk($('#resumePrint'));
      includes($('#resumeDownload').textContent, 'Download PDF');
      includes($('#resumeView').textContent, 'View PDF');
    });
    it('Download PDF saves "<Name> - Resume.pdf" and keeps that PDF with the resume', async () => {
      await loadAdmin(typed);
      let name = null;
      w.HTMLAnchorElement.prototype.click = function () { name = this.download; };
      $('#resumeDownload').click();
      await waitFor(() => name, { msg: 'download started' });
      eq(name, 'Ana Silva - Resume.pdf');
      const r = await stored();
      ok(r.file && r.file.generated);
    });
    it('editing the text remakes a generated PDF (debounced)', async () => {
      await loadAdmin({ resumes: { activeId: 'r1', items: [{ id: 'r1', name: 'Typed', text: RESUME, file: P.fileFor({ text: RESUME }).file, createdAt: '2026-11-01' }] } });
      const before = (await stored()).file.dataUrl;
      const ta = $('#resumeText');
      ta.value = RESUME.replace('# Ana Silva', '# Ana M. Silva');
      ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      const f = await waitFor(async () => { const r = await stored(); return r.file.dataUrl !== before && r.file; }, { msg: 'PDF remade', timeout: 5000 });
      eq(f.name, 'Ana M. Silva - Resume.pdf');
    });
    it('a PDF the user uploaded is never replaced by an edit', async () => {
      const own = { name: 'mine.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' };
      await loadAdmin({ resumes: { activeId: 'r1', items: [{ id: 'r1', name: 'Mine', text: RESUME, file: own, createdAt: '2026-11-01' }] } });
      const ta = $('#resumeText');
      ta.value = RESUME + '\n- One more line';
      ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      await waitFor(async () => /One more line/.test((await stored()).text), { msg: 'text saved' });
      await new Promise((r) => setTimeout(r, 1600));
      eq((await stored()).file.name, 'mine.pdf');
    });
    it('uploading a Word/text file keeps the original and adds a PDF made from its text', async () => {
      await loadAdmin({ resumes: { activeId: null, items: [] } });
      const dt = new w.DataTransfer();
      dt.items.add(new w.File([RESUME], 'ana.txt', { type: 'text/plain' }));
      $('#resumeFile').files = dt.files;
      $('#resumeFile').dispatchEvent(new w.Event('change', { bubbles: true }));
      const r = await waitFor(async () => { const x = (await w.AJP.store.get('resumes')).items[0]; return x && x.file && x; }, { msg: 'saved' });
      eq([r.original.name, r.file.type, r.file.generated], ['ana.txt', 'application/pdf', true]);
      await waitFor(() => /made from the text/.test($('#resumeList').textContent), { msg: 'list says so' });
    });
  }, { env: 'browser' });
})();
