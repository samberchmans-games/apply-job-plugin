/*
 * pdf.js wrapper — read the text of a PDF resume (Admin → Resumes). Uses Mozilla pdf.js (src/vendor/pdfjs),
 * loaded on demand so the Admin page stays fast.
 *
 *   AJP.pdf.toText(arrayBuffer) -> { text, pages, chars }
 *   AJP.pdf.linesFromItems(items) -> string   (pure: rebuilds lines, bullets and paragraphs from positioned text)
 *
 * Follows THE STANDARD: failures are AJP.err codes (AJP-PDF-NOTEXT, AJP-PDF-LOCKED, AJP-RES-PARSE).
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.pdf) return;

  const CONFIG = { base: null, maxPages: 10 }; // base: URL of src/vendor/pdfjs/ (tests set it)
  const BULLETS = /^[•▪●◦‣·⁃▪●◦∙*–-]\s*/;

  function base() {
    if (CONFIG.base) return CONFIG.base;
    if (AJP.api && AJP.api.runtime && AJP.api.runtime.getURL) return AJP.api.runtime.getURL('src/vendor/pdfjs/');
    return new URL('/src/vendor/pdfjs/', globalThis.location.href).href;
  }

  let libPromise = null;
  function load() {
    if (!libPromise) {
      libPromise = import(base() + 'pdf.min.mjs').then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = base() + 'pdf.worker.min.mjs';
        return lib;
      });
      libPromise.catch(() => (libPromise = null)); // allow a later retry
    }
    return libPromise;
  }

  /*
   * Positioned text items (pdf.js getTextContent) -> readable lines.
   *   - items on the same baseline form a line, ordered left to right; gaps become spaces
   *   - a bigger vertical gap starts a new paragraph (blank line)
   *   - Word/Docs bullet glyphs (•, ▪,  …) become "- " so resume tailoring sees bullet points
   */
  function linesFromItems(items) {
    const parts = (items || [])
      .filter((it) => it && typeof it.str === 'string' && it.str.length)
      .map((it) => {
        const t = it.transform || [1, 0, 0, 1, 0, 0];
        const size = Math.max(1, Math.abs(t[3]) || it.height || 10);
        return { str: it.str, x: t[4], y: t[5], w: it.width || it.str.length * size * 0.5, size };
      });
    if (!parts.length) return '';
    parts.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const p of parts) {
      const cur = lines[lines.length - 1];
      if (cur && Math.abs(cur.y - p.y) <= Math.max(2, 0.4 * Math.min(cur.size, p.size))) cur.parts.push(p);
      else lines.push({ y: p.y, size: p.size, parts: [p] });
    }
    const out = [];
    let prev = null;
    for (const line of lines) {
      line.parts.sort((a, b) => a.x - b.x);
      let text = '';
      let end = null;
      for (const p of line.parts) {
        if (end != null) {
          const gap = p.x - end;
          if (gap > p.size * 2.5) text += '   '; // a column gap
          else if (gap > p.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(p.str)) text += ' ';
        }
        text += p.str;
        end = p.x + p.w;
      }
      text = text.replace(/\s+$/, '').replace(/^\s+/, '');
      if (!text) continue;
      if (BULLETS.test(text) && !/^-\d/.test(text)) text = '- ' + text.replace(BULLETS, '');
      if (prev && prev.y - line.y > Math.max(prev.size, line.size) * 1.9) out.push('');
      out.push(text);
      prev = line;
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function mapError(e) {
    const name = e && e.name;
    if (name === 'PasswordException') return AJP.err('PDF_LOCKED', { reason: e.message }, e);
    if (name === 'InvalidPDFException' || name === 'MissingPDFException') return AJP.err('RESUME_PARSE', { reason: 'Not a valid PDF file' }, e);
    if (e && typeof e.code === 'string' && e.code.startsWith('AJP-')) return e;
    return AJP.err('RESUME_PARSE', { reason: 'PDF could not be read: ' + String((e && e.message) || e).slice(0, 120) }, e);
  }

  async function toText(arrayBuffer) {
    const log = AJP.logger('pdf');
    const t0 = Date.now();
    let lib;
    try {
      lib = await load();
    } catch (e) {
      throw AJP.err('RESUME_PARSE', { reason: 'PDF reader failed to load: ' + e.message }, e);
    }
    let doc;
    try {
      doc = await lib.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false }).promise;
      const pages = Math.min(doc.numPages, CONFIG.maxPages);
      const texts = [];
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        texts.push(linesFromItems(content.items));
      }
      const text = texts.filter(Boolean).join('\n\n').trim();
      if (text.replace(/\s/g, '').length < 30) throw AJP.err('PDF_NO_TEXT', { pages: doc.numPages });
      log.info('PDF text extracted', { pages: doc.numPages, read: pages, chars: text.length, ms: Date.now() - t0 });
      return { text, pages: doc.numPages, chars: text.length };
    } catch (e) {
      throw mapError(e);
    } finally {
      if (doc) doc.destroy();
    }
  }

  // reset(): forget the loaded reader (tests; or after changing CONFIG.base)
  AJP.pdf = { CONFIG, toText, linesFromItems, mapError, load, reset: () => (libPromise = null) };
})();
