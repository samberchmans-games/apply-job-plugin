(function () {
  const { describe, it, eq, includes, rejects } = globalThis.AJPTest;
  const AJP = globalThis.AJP;

  // Build a minimal .zip in memory (stored or deflated entries) — enough for the reader.
  async function makeZip(entries) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const { name, text, deflate } of entries) {
      const raw = enc.encode(text);
      let data = raw;
      if (deflate) {
        const s = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        data = new Uint8Array(await new Response(s).arrayBuffer());
      }
      const nameBytes = enc.encode(name);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(8, deflate ? 8 : 0, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, raw.length, true);
      lh.setUint16(26, nameBytes.length, true);
      parts.push(new Uint8Array(lh.buffer), nameBytes, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(10, deflate ? 8 : 0, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, raw.length, true);
      ch.setUint16(28, nameBytes.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, entries.length, true);
    eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);
    return await new Blob([...parts, ...central, new Uint8Array(eocd.buffer)]).arrayBuffer();
  }

  const DOC = '<w:document><w:body><w:p><w:r><w:t>Ana Silva</w:t></w:r></w:p><w:p><w:r><w:t>Python &amp; Kubernetes</w:t><w:tab/><w:t>2020</w:t></w:r></w:p></w:body></w:document>';

  describe('docx › resume text extraction', () => {
    it('reads a deflated word/document.xml', async () => {
      const zip = await makeZip([{ name: '[Content_Types].xml', text: '<x/>' }, { name: 'word/document.xml', text: DOC, deflate: true }]);
      const t = await AJP.docx.toText(zip);
      eq(t.split('\n')[0], 'Ana Silva');
      includes(t, 'Python & Kubernetes\t2020');
    });
    it('reads a stored (uncompressed) entry', async () => {
      const zip = await makeZip([{ name: 'word/document.xml', text: DOC }]);
      includes(await AJP.docx.toText(zip), 'Ana Silva');
    });
    it('decodes XML entities', async () => {
      const zip = await makeZip([{ name: 'word/document.xml', text: '<w:p><w:t>&lt;C#&gt; &quot;x&quot; &#65;</w:t></w:p>' }]);
      eq(await AJP.docx.toText(zip), '<C#> "x" A');
    });
    it('rejects a non-zip file with a coded error (AJP-RES-PARSE)', async () => {
      const e = await rejects(() => AJP.docx.toText(new TextEncoder().encode('just text, not a docx').buffer));
      eq(e.code, 'AJP-RES-PARSE');
      includes(e.details.reason, 'Not a valid .docx');
    });
    it('rejects a zip without word/document.xml', async () => {
      const zip = await makeZip([{ name: 'other.txt', text: 'hi' }]);
      includes((await rejects(() => AJP.docx.toText(zip))).details.reason, 'not found');
    });
  }, { env: 'browser' });
})();
