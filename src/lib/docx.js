/*
 * docx.js — extract plain text from a .docx resume with zero dependencies.
 * A .docx is a zip; we read word/document.xml and inflate it with the
 * browser's built-in DecompressionStream (Chrome 103+, Firefox 113+, Safari 16.4+).
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.docx) return;

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZipEntry(buf, wanted) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw AJP.err('RESUME_PARSE', { reason: 'Not a valid .docx (zip) file' });
    const entries = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let n = 0; n < entries; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      if (name === wanted) {
        const start = localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true);
        const data = u8.subarray(start, start + compSize);
        if (method === 0) return dec.decode(data);
        if (method === 8) return dec.decode(await inflateRaw(data));
        throw AJP.err('RESUME_PARSE', { reason: 'Unsupported zip compression method ' + method });
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    throw AJP.err('RESUME_PARSE', { reason: wanted + ' not found in file' });
  }

  function decodeEntities(s) {
    return s
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
  }

  async function toText(arrayBuffer) {
    const xml = await readZipEntry(arrayBuffer, 'word/document.xml');
    return decodeEntities(
      xml
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
    )
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  AJP.docx = { toText };
})();
