/*
 * PDF resumes: line rebuilding (pure) + real pdf.js on generated PDFs + Admin upload.
 */
(function () {
  const { describe, it, eq, ok, includes, excludes, rejects, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const item = (str, x, y, size = 11, w) => ({ str, transform: [size, 0, 0, size, x, y], width: w != null ? w : str.length * size * 0.5, height: size });

  describe('pdf › rebuilding lines from positioned text', () => {
    const L = AJP.pdf.linesFromItems;
    it('items on one baseline become one line, ordered left to right', () =>
      eq(L([item('Engineer', 120, 700), item('Senior', 72, 700)]), 'Senior Engineer'));
    it('pieces that touch are joined without a space; gaps get one', () => {
      eq(L([item('Java', 72, 700, 11, 22), item('Script', 94, 700)]), 'JavaScript');
      eq(L([item('Java', 72, 700, 11, 22), item('Python', 100, 700)]), 'Java Python');
    });
    it('lines are ordered top to bottom', () => eq(L([item('second', 72, 680), item('first', 72, 700)]), 'first\nsecond'));
    it('a larger vertical gap starts a new paragraph', () => eq(L([item('A', 72, 700), item('B', 72, 686), item('C', 72, 640)]), 'A\nB\n\nC'));
    for (const b of ['•', '▪', '●', '◦', '', '', '–'])
      it(`bullet glyph ${JSON.stringify(b)} becomes "- "`, () => eq(L([item(b, 72, 700, 11, 5), item('Led the data team', 84, 700)]), '- Led the data team'));
    it('a negative number is not mistaken for a bullet', () => eq(L([item('-5% defects', 72, 700)]), '-5% defects'));
    it('a wide gap (two columns) is kept as a visible gap', () => includes(L([item('Skills', 72, 700, 11, 30), item('2019 – Present', 420, 700)]), 'Skills   2019'));
    it('slightly uneven baselines (superscripts, mixed fonts) stay on one line', () => eq(L([item('Acme', 72, 700), item('Corp', 100, 701.5)]), 'Acme Corp'));
    it('empty input → empty text', () => {
      eq(L([]), '');
      eq(L([item('', 72, 700)]), '');
    });
    it('password-protected PDFs map to AJP-PDF-LOCKED, broken ones to AJP-RES-PARSE', () => {
      eq(AJP.pdf.mapError({ name: 'PasswordException', message: 'No password given' }).code, 'AJP-PDF-LOCKED');
      eq(AJP.pdf.mapError({ name: 'InvalidPDFException', message: 'Invalid PDF structure' }).code, 'AJP-RES-PARSE');
      eq(AJP.pdf.mapError(new TypeError('weird')).code, 'AJP-RES-PARSE');
    });
  });

  // ---- Real PDFs, generated here (Helvetica, WinAnsi; \x95 is the bullet) -------------------------------
  function makePdf(pages) {
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const objs = [];
    const add = (body) => objs.push(body) && objs.length;
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('PAGES');
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const lines of pages) {
      const stream = lines.map((l) => `BT /F1 ${l.size || 11} Tf 1 0 0 1 ${l.x} ${l.y} Tm (${esc(l.text)}) Tj ET`).join('\n');
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff).buffer;
  }
  const B = '\x95';
  const RESUME_PAGE = [
    { x: 72, y: 740, size: 18, text: 'Ana Silva' },
    { x: 72, y: 722, text: 'ana.silva@example.com  |  Austin, TX' },
    { x: 72, y: 690, size: 13, text: 'EXPERIENCE' },
    { x: 72, y: 672, text: 'Senior Engineer, Acme Corp (2019 - Present)' },
    { x: 72, y: 656, text: B }, { x: 84, y: 656, text: 'Migrated customer data from on-prem Oracle to AWS' },
    { x: 72, y: 642, text: B }, { x: 84, y: 642, text: 'Reduced nightly job failures by 30% through better retries' },
    { x: 72, y: 628, text: B }, { x: 84, y: 628, text: 'Built REST APIs in Java and Spring Boot' },
    { x: 72, y: 596, size: 13, text: 'SKILLS' },
    { x: 72, y: 578, text: 'Java, Python, SQL, AWS, Docker' },
  ];
  const pdfBase = () => new URL('../src/vendor/pdfjs/', location.href).href;

  describe('pdf › reading real PDF files with pdf.js', () => {
    it('reads a resume: name, headings, bullets, skills', async () => {
      AJP.pdf.CONFIG.base = pdfBase();
      const r = await AJP.pdf.toText(makePdf([RESUME_PAGE]));
      eq(r.pages, 1);
      const lines = r.text.split('\n');
      eq(lines[0], 'Ana Silva');
      includes(lines, 'EXPERIENCE');
      includes(lines, '- Migrated customer data from on-prem Oracle to AWS');
      includes(lines, '- Reduced nightly job failures by 30% through better retries');
      includes(lines, 'Java, Python, SQL, AWS, Docker');
    });
    it('the result is ready for matching and tailoring (bullets, sections, skills)', async () => {
      AJP.pdf.CONFIG.base = pdfBase();
      const { text } = await AJP.pdf.toText(makePdf([RESUME_PAGE]));
      const doc = AJP.resumeEngine.parse(text);
      eq(doc.bullets.length, 3);
      eq(doc.skills.map((s) => s.text), ['Java, Python, SQL, AWS, Docker']);
      for (const s of ['Java', 'AWS', 'Docker', 'REST APIs']) ok(AJP.matcher.findSkills(text).has(s), s);
    });
    it('multi-page resumes are read in order', async () => {
      AJP.pdf.CONFIG.base = pdfBase();
      const r = await AJP.pdf.toText(makePdf([RESUME_PAGE, [{ x: 72, y: 740, size: 13, text: 'EDUCATION' }, { x: 72, y: 720, text: 'B.S. Computer Science, UT Austin, 2015' }]]));
      eq(r.pages, 2);
      ok(r.text.indexOf('EXPERIENCE') < r.text.indexOf('EDUCATION'));
      includes(r.text, 'B.S. Computer Science, UT Austin, 2015');
    });
    it('a scanned PDF (no text) → AJP-PDF-NOTEXT with a hint', async () => {
      AJP.pdf.CONFIG.base = pdfBase();
      const e = await rejects(() => AJP.pdf.toText(makePdf([[]])));
      eq(e.code, 'AJP-PDF-NOTEXT');
      includes(e.hint, '.docx');
    });
    it('a file that is not a PDF → AJP-RES-PARSE', async () => {
      AJP.pdf.CONFIG.base = pdfBase();
      eq((await rejects(() => AJP.pdf.toText(new TextEncoder().encode('just some text').buffer))).code, 'AJP-RES-PARSE');
    });
    it('if the PDF reader cannot load → AJP-RES-PARSE (and a later try can succeed)', async () => {
      AJP.pdf.reset();
      AJP.pdf.CONFIG.base = new URL('../src/vendor/missing/', location.href).href;
      const e = await rejects(() => AJP.pdf.toText(makePdf([RESUME_PAGE])));
      eq(e.code, 'AJP-RES-PARSE');
      includes(e.details.reason, 'failed to load');
      AJP.pdf.reset();
      AJP.pdf.CONFIG.base = pdfBase();
      ok((await AJP.pdf.toText(makePdf([RESUME_PAGE]))).text.length > 50);
    });
  }, { env: 'browser' });

  describe('pdf › Admin upload', () => {
    let frame;
    let w;
    const $ = (s) => w.document.querySelector(s);
    afterEach(() => frame && frame.remove());
    async function loadAdmin(seed = {}) {
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
      await waitFor(() => w.AJP && w.AJP.pdf && $('#ver').textContent, { msg: 'admin' });
      w.AJP.pdf.CONFIG.base = pdfBase();
      w.location.hash = 'resumes';
      await waitFor(() => $('#resumes').classList.contains('on'), { msg: 'resumes tab' });
    }
    function upload(bytes, name = 'ana-silva.pdf') {
      const dt = new w.DataTransfer();
      dt.items.add(new w.File([bytes], name, { type: 'application/pdf' }));
      $('#resumeFile').files = dt.files;
      $('#resumeFile').dispatchEvent(new w.Event('change', { bubbles: true }));
    }

    it('uploading a PDF saves the file AND its text, and says how many bullets were read', async () => {
      await loadAdmin();
      upload(makePdf([RESUME_PAGE]));
      const r = await waitFor(async () => { const x = await w.AJP.store.get('resumes'); return x.items[0] && x.items[0].text && x; }, { msg: 'text saved' });
      includes(r.items[0].text, '- Migrated customer data from on-prem Oracle to AWS');
      eq([r.items[0].file.name, r.activeId], ['ana-silva.pdf', r.items[0].id]);
      await waitFor(() => /3 bullet points read/.test($('#toast').textContent), { msg: 'toast' });
      await waitFor(() => /EXPERIENCE/.test($('#resumeText').value), { msg: 'editor shows text' });
    });
    it('a scanned PDF is still saved; the message explains why there is no text (AJP-PDF-NOTEXT)', async () => {
      await loadAdmin();
      upload(makePdf([[]]), 'scan.pdf');
      await waitFor(() => /AJP-PDF-NOTEXT/.test($('#toast').textContent), { msg: 'coded message' });
      const r = await w.AJP.store.get('resumes');
      eq([r.items.length, r.items[0].text], [1, '']);
    });
    it('"Read text from PDF" fills the text of a PDF resume saved earlier without text', async () => {
      const bytes = new Uint8Array(makePdf([RESUME_PAGE]));
      let bin = '';
      bytes.forEach((b) => (bin += String.fromCharCode(b)));
      await loadAdmin({ resumes: { activeId: 'r1', items: [{ id: 'r1', name: 'Old upload', text: '', file: { name: 'old.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + btoa(bin) }, createdAt: '2026-11-01' }] } });
      await waitFor(() => !$('#resumeExtract').hidden, { msg: 'button shown for PDFs' });
      $('#resumeExtract').click();
      await waitFor(async () => /Migrated customer data/.test((await w.AJP.store.get('resumes')).items[0].text), { msg: 'text filled' });
    });
    it('the button is hidden for non-PDF resumes', async () => {
      await loadAdmin({ resumes: { activeId: 'r1', items: [{ id: 'r1', name: 'Typed', text: '- a', createdAt: '2026-11-01' }] } });
      await waitFor(() => !$('#resumeEditor').hidden);
      ok($('#resumeExtract').hidden);
    });
  }, { env: 'browser' });
})();
