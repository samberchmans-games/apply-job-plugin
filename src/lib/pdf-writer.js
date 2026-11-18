/*
 * pdf-writer.js — turn a resume (the Markdown-ish text used everywhere in the extension) into a clean,
 * ATS-friendly PDF. No libraries: a single-column, text-based PDF with the standard Helvetica fonts, so
 * applicant tracking systems (and pdf.js) read the text back exactly, in order.
 *
 *   AJP.pdfWriter.fromResumeText(text, { title, author }) -> { bytes: Uint8Array, pages, replaced }
 *   AJP.pdfWriter.toDataUrl(bytes) -> "data:application/pdf;base64,…"
 *   AJP.pdfWriter.fileName(name, company) -> "Ana Silva - Resume - Initech.pdf"
 *
 * Layout: Letter, 0.75" margins. "# Name" (20pt bold) · contact line · "## SECTION" (bold + rule) ·
 * "### Role — Company (dates)" (bold) · "- bullet" (• with hanging indent) · paragraphs. Text wraps by real
 * Helvetica widths. Characters outside the PDF standard (WinAnsi) set are replaced with "?" and counted.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.pdfWriter) return;

  // Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126 (standard AFM metrics).
  const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  // Unicode → WinAnsi byte for the characters above 127 that resumes commonly use.
  const WIN = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
  const SPECIAL_W = { 0x80: 556, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000 };

  // One Unicode string → array of WinAnsi codes (+ count of characters that had to be replaced).
  function encode(str) {
    const codes = [];
    let replaced = 0;
    for (const ch of String(str).normalize('NFC')) {
      const cp = ch.codePointAt(0);
      if (cp >= 32 && cp <= 126) codes.push(cp);
      else if (cp >= 160 && cp <= 255) codes.push(cp);
      else if (WIN[cp]) codes.push(WIN[cp]);
      else if (cp === 9) codes.push(32);
      else if (cp === 0x2010 || cp === 0x2011 || cp === 0x2012 || cp === 0x2212) codes.push(45); // hyphen-like → "-"
      else if (cp === 0x00a0 || cp === 0x2009 || cp === 0x202f) codes.push(32);
      else {
        codes.push(63); // "?"
        replaced++;
      }
    }
    return { codes, replaced };
  }

  function widthOf(codes, bold, size) {
    const table = bold ? W_BOLD : W_REG;
    let w = 0;
    for (const c of codes) w += c >= 32 && c <= 126 ? table[c - 32] : SPECIAL_W[c] || 556;
    return (w * size) / 1000;
  }

  // Greedy word wrap by measured width.
  function wrap(text, { bold = false, size = 10, width }) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (!cur || widthOf(encode(next).codes, bold, size) <= width) cur = next;
      else {
        lines.push(cur);
        cur = w;
      }
      // A single word wider than the line is hard-split.
      while (widthOf(encode(cur).codes, bold, size) > width && cur.length > 1) {
        let cut = cur.length - 1;
        while (cut > 1 && widthOf(encode(cur.slice(0, cut)).codes, bold, size) > width) cut--;
        lines.push(cur.slice(0, cut));
        cur = cur.slice(cut);
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  const pdfString = (codes) =>
    '(' + codes.map((c) => (c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c < 32 || c > 126 ? '\\' + c.toString(8).padStart(3, '0') : String.fromCharCode(c))).join('') + ')';
  const inline = (s) => String(s).replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, '$1$2').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  const PAGE = { w: 612, h: 792, margin: 54 };
  const STYLE = {
    name: { size: 20, bold: true, before: 0, after: 4 },
    contact: { size: 9.5, bold: false, before: 0, after: 8 },
    section: { size: 11.5, bold: true, before: 10, after: 5, rule: true, upper: true },
    role: { size: 10.5, bold: true, before: 6, after: 2 },
    bullet: { size: 10, bold: false, before: 0, after: 2, indent: 14 },
    para: { size: 10, bold: false, before: 0, after: 4 },
  };

  // Resume text → blocks with a style.
  function blocks(text) {
    const out = [];
    let sawName = false;
    let afterName = 0;
    for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.trim();
      if (!line) {
        if (sawName) afterName = 99;
        continue;
      }
      let m;
      if ((m = line.match(/^#\s+(.+)/)) && !sawName) {
        sawName = true;
        out.push({ style: 'name', text: inline(m[1]) });
      } else if ((m = line.match(/^##\s+(.+)/))) {
        afterName = 99;
        out.push({ style: 'section', text: inline(m[1]) });
      } else if ((m = line.match(/^#{3,6}\s+(.+)/))) out.push({ style: 'role', text: inline(m[1]) });
      else if ((m = line.match(/^[-*•▪●◦]\s+(.+)/))) out.push({ style: 'bullet', text: inline(m[1]) });
      else if (sawName && afterName++ < 2 && out.length && out[out.length - 1].style !== 'section') out.push({ style: 'contact', text: inline(line) });
      else if (!sawName && !out.length) {
        sawName = true; // plain-text resume: the first line is the name
        out.push({ style: 'name', text: inline(line) });
      } else if (/^[A-Z][A-Z &/]{2,40}$/.test(line)) out.push({ style: 'section', text: line });
      else out.push({ style: 'para', text: inline(line) });
    }
    return out;
  }

  /*
   * Build the PDF. Returns { bytes, pages, replaced }.
   */
  function fromResumeText(text, { title = 'Resume', author = '' } = {}) {
    const items = blocks(text);
    if (!items.length) throw AJP.err('PDF_CREATE', { reason: 'empty resume text' });
    const width = PAGE.w - PAGE.margin * 2;
    const pages = [];
    let ops = [];
    let y = PAGE.h - PAGE.margin;
    let replaced = 0;
    const newPage = () => {
      pages.push(ops);
      ops = [];
      y = PAGE.h - PAGE.margin;
    };
    const text1 = (codes, x, yy, size, bold) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${yy.toFixed(2)} Tm ${pdfString(codes)} Tj ET`);

    for (const b of items) {
      const st = STYLE[b.style];
      const lead = st.size * 1.28;
      const indent = st.indent || 0;
      const lines = wrap(st.upper ? b.text.toUpperCase() : b.text, { bold: st.bold, size: st.size, width: width - indent });
      const need = st.before + lines.length * lead + st.after + (st.rule ? 4 : 0);
      // Keep headings with what follows; break before a block that doesn't fit.
      const keep = b.style === 'section' || b.style === 'role' ? lead * 2 : 0;
      if (y - Math.min(need + keep, PAGE.h - 2 * PAGE.margin) < PAGE.margin && y < PAGE.h - PAGE.margin) newPage();
      y -= st.before;
      lines.forEach((ln, i) => {
        if (y - lead < PAGE.margin) newPage();
        y -= lead;
        const enc = encode(ln);
        replaced += enc.replaced;
        if (b.style === 'bullet' && i === 0) text1([0x95], PAGE.margin + 3, y, st.size, false);
        text1(enc.codes, PAGE.margin + indent, y, st.size, st.bold);
      });
      if (st.rule) {
        y -= 3;
        ops.push(`0.6 0.6 0.6 RG 0.7 w ${PAGE.margin} ${y.toFixed(2)} m ${PAGE.w - PAGE.margin} ${y.toFixed(2)} l S 0 0 0 RG`);
      }
      y -= st.after;
    }
    pages.push(ops);

    // ---- Serialize (byte offsets for the xref must be exact; all content is single-byte) ----
    const objs = [];
    const add = (body) => objs.push(body) && objs.length;
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('PAGES');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = pages.map((p) => {
      const stream = p.join('\n');
      const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`);
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Title ${pdfString(encode(title).codes)} /Author ${pdfString(encode(author).codes)} /Producer (Apply Job Assistant) >>`);
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets = [];
    objs.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return { bytes, pages: pages.length, replaced };
  }

  function toDataUrl(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return 'data:application/pdf;base64,' + btoa(bin);
  }

  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  function fileName(name, company) {
    return [safe(name) || 'Resume', 'Resume', safe(company)].filter(Boolean).join(' - ').replace(/^Resume - Resume/, 'Resume') + '.pdf';
  }

  // The name on a resume: its first "# " heading, else its first line.
  function nameFrom(text) {
    const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const h = lines.find((l) => /^#\s+/.test(l));
    return inline((h || lines[0] || '').replace(/^#+\s*/, '')).slice(0, 60);
  }

  /*
   * A resume item's PDF file record (what autofill attaches). Generated files are marked so they can be
   * regenerated when the text changes; a PDF the user uploaded is never replaced.
   */
  function fileFor(resume, { company } = {}) {
    const name = nameFrom(resume.text);
    const { bytes, pages, replaced } = fromResumeText(resume.text, { title: `${name || 'Resume'} - Resume`, author: name });
    return {
      file: { name: fileName(name, company), type: 'application/pdf', size: bytes.length, dataUrl: toDataUrl(bytes), generated: true, pages, createdAt: new Date().toISOString() },
      replaced,
    };
  }

  AJP.pdfWriter = { fromResumeText, toDataUrl, fileName, fileFor, nameFrom, blocks, wrap, encode, widthOf };
})();
