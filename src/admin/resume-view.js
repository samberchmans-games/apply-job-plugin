(function () {
  'use strict';
  const AJP = globalThis.AJP;
  AJP.logContext = 'admin';
  AJP.captureErrors('resume-view');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, '$1<i>$2</i>');

  // Minimal Markdown -> HTML (headings, bullets, bold/italic, paragraphs).
  function md(text) {
    const out = [];
    let inList = false;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trimEnd();
      const li = line.match(/^\s*[-*•]\s+(.*)/);
      if (!li && inList) { out.push('</ul>'); inList = false; }
      const h = line.match(/^(#{1,3})\s+(.*)/);
      if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      else if (li) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(li[1])}</li>`); }
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    if (inList) out.push('</ul>');
    return out.join('\n');
  }

  (async () => {
    const id = new URLSearchParams(location.search).get('id');
    const r = await AJP.store.get('resumes');
    const item = r.items.find((x) => x.id === id);
    document.getElementById('doc').innerHTML = item ? md(item.text) : '<p>Resume not found.</p>';
    if (item) document.title = item.name;
  })();
  document.getElementById('print').onclick = () => window.print();
})();
