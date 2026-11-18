/*
 * Admin page smoke tests: loads the REAL src/admin/admin.html in an iframe with its own browser mock,
 * then drives the Applications tracker UI (stats, board, table, detail dialog, CSV export).
 */
(function () {
  const { describe, it, eq, ok, includes, beforeEach, afterEach, waitFor, sleep } = globalThis.AJPTest;
  const DAY = 86400000;
  let frame;
  let w; // iframe window
  const $ = (s) => w.document.querySelector(s);
  const $$ = (s) => [...w.document.querySelectorAll(s)];

  async function loadAdmin(seed) {
    const html = await (await fetch('../src/admin/admin.html', { cache: 'no-store' })).text();
    const page = html
      .replace('<head>', '<head><base href="' + new URL('../src/admin/', location.href).href + '">')
      .replace('<script src="../lib/core.js"></script>', '<script src="../../tests/mocks/browser-mock.js"></script><script>window.__SEED__ && browser.storage.local.set(window.__SEED__)</script><script src="../lib/core.js"></script>');
    frame = document.createElement('iframe');
    frame.style.cssText = 'width:1200px;height:800px;border:0;position:absolute;left:-5000px;top:0';
    document.body.appendChild(frame);
    frame.contentWindow.__SEED__ = null;
    await new Promise((res) => {
      frame.onload = res;
      frame.srcdoc = page.replace('<head>', `<head><script>window.__SEED__=${JSON.stringify(seed || null)}</script>`);
    });
    w = frame.contentWindow;
    await waitFor(() => w.AJP && w.AJP.trackerView && $('#ver').textContent, { msg: 'admin booted' });
    w.location.hash = 'applications';
    await waitFor(() => $('#applications').classList.contains('on'), { msg: 'applications tab' });
  }

  const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
  const SEED = {
    applications: [
      { id: 'a1', jobKey: 'k1', url: 'https://x.com/1', company: 'Acme', title: 'Java Architect', status: 'applied', appliedAt: ago(10), date: ago(10), score: 81, statusHistory: [{ status: 'applied', at: ago(10) }], snapshot: { jd: 'Requirements: Java and Spring', savedAt: ago(10) }, resumeName: 'Java resume' },
      { id: 'a2', jobKey: 'k2', url: 'https://x.com/2', company: 'Globex', title: 'AWS Cloud Architect', status: 'interviewing', appliedAt: ago(5), date: ago(6), score: 90, statusHistory: [{ status: 'applied', at: ago(5) }, { status: 'interviewing', at: ago(2) }], detectedBy: 'confirmation' },
      { id: 'a3', jobKey: 'k3', url: 'https://x.com/3', company: 'Initech', title: 'Platform Engineer', status: 'in progress', date: ago(1), score: 55, statusHistory: [{ status: 'in progress', at: ago(1) }] },
    ],
  };

  describe('admin › applications tracker UI', () => {
    beforeEach(() => loadAdmin(SEED));
    afterEach(() => frame && frame.remove());

    it('shows stats tiles (tracked, applied, response rate, follow-ups due)', async () => {
      await waitFor(() => $$('#trkStats .tile').length, { msg: 'stats' });
      const t = $('#trkStats').textContent;
      includes(t, '3Tracked jobs');
      includes(t, '2Applied');
      includes(t, '50%Response rate');
      includes(t, '1Follow-ups due');
    });
    it('board shows each job in its status column', async () => {
      await waitFor(() => $$('.board .app').length === 3, { msg: 'cards' });
      eq($('.col[data-status="applied"]').textContent.includes('Acme'), true);
      eq($('.col[data-status="interviewing"]').textContent.includes('Globex'), true);
      eq($('.col[data-status="in progress"]').textContent.includes('Initech'), true);
      ok($('.app[data-id="a1"] .pill.due'), 'follow-up badge on the 10-day-old application');
      ok($('.app[data-id="a2"] .pill.auto'), 'auto-detected marker');
    });
    it('dropping a card on another column changes its status', async () => {
      await waitFor(() => $('.app[data-id="a1"]'));
      const dt = new w.DataTransfer();
      $('.app[data-id="a1"]').dispatchEvent(new w.DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      $('.col[data-status="interviewing"]').dispatchEvent(new w.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await waitFor(async () => (await w.AJP.store.get('applications')).find((a) => a.id === 'a1').status === 'interviewing', { msg: 'moved' });
      const a1 = (await w.AJP.store.get('applications')).find((a) => a.id === 'a1');
      eq(a1.statusHistory.map((h) => h.status), ['applied', 'interviewing']);
    });
    it('search and status filters narrow the list', async () => {
      await waitFor(() => $$('.board .app').length === 3);
      $('#trkSearch').value = 'globex';
      $('#trkSearch').dispatchEvent(new w.Event('input'));
      await waitFor(() => $$('.board .app').length === 1, { msg: 'search' });
      $('#trkSearch').value = '';
      $('#trkSearch').dispatchEvent(new w.Event('input'));
      $('#trkDue').checked = true;
      $('#trkDue').dispatchEvent(new w.Event('change'));
      await waitFor(() => $$('.board .app').length === 1 && $('.app[data-id="a1"]'), { msg: 'due filter' });
    });
    it('table view lists jobs and changes status from a dropdown', async () => {
      $('.seg [data-view="table"]').click();
      await waitFor(() => $$('#trkView tbody tr').length === 3, { msg: 'table' });
      const sel = $('select[data-status-of="a3"]');
      sel.value = 'withdrawn';
      sel.dispatchEvent(new w.Event('change', { bubbles: true }));
      await waitFor(async () => (await w.AJP.store.get('applications')).find((a) => a.id === 'a3').status === 'withdrawn', { msg: 'status changed' });
      $('.seg [data-view="board"]').click();
    });
    it('detail dialog: saved job description, resume used, notes and interview date are saved', async () => {
      await waitFor(() => $('.app[data-id="a1"]'));
      $('.app[data-id="a1"]').click();
      await waitFor(() => $('#trkDetail').open, { msg: 'dialog' });
      includes($('#trkDetail').textContent, 'Requirements: Java and Spring');
      includes($('#trkDetail').textContent, 'Java resume');
      const notes = $('#trkDetail [data-f="notes"]');
      notes.value = 'Spoke to Dana';
      notes.dispatchEvent(new w.Event('input', { bubbles: true }));
      const when = $('#trkDetail [data-f="interviewAt"]');
      when.value = '2026-12-01T10:30';
      when.dispatchEvent(new w.Event('input', { bubbles: true }));
      await waitFor(async () => {
        const a = (await w.AJP.store.get('applications')).find((x) => x.id === 'a1');
        return a.notes === 'Spoke to Dana' && a.interviewAt;
      }, { msg: 'saved' });
      const a = (await w.AJP.store.get('applications')).find((x) => x.id === 'a1');
      eq(a.interviewAt, new Date('2026-12-01T10:30').toISOString(), 'stored as the local time the user typed');
      eq(w.AJP.trackerView.toLocalInput(a.interviewAt), '2026-12-01T10:30', 'shown back exactly as typed (no timezone shift)');
    });
    it('"I followed up today" resets the reminder', async () => {
      await waitFor(() => $('.app[data-id="a1"]'));
      $('.app[data-id="a1"]').click();
      await waitFor(() => $('#trkDetail').open);
      $('#trkDetail [data-d="followed"]').click();
      await waitFor(async () => (await w.AJP.store.get('applications')).find((x) => x.id === 'a1').lastFollowUpAt, { msg: 'followed' });
      $('#trkDetail [data-d="close"]').click();
      await waitFor(() => !$('.app[data-id="a1"] .pill.due'), { msg: 'due badge gone' });
    });
    it('job text is escaped in the board and dialog', async () => {
      await w.AJP.store.update('applications', (l) => void (l[0].company = '<img src=x onerror="window.__pwnd=1">'));
      await w.AJP.trackerView.render();
      ok(!$('#trkView img'), 'no injected element');
      await sleep(20);
      ok(!w.__pwnd);
    });
    it('Export CSV downloads all visible applications', async () => {
      let href = null;
      w.HTMLAnchorElement.prototype.click = function () {
        href = this.href;
        this.dl = this.download;
      };
      await waitFor(() => $$('.board .app').length === 3);
      $('#trkExport').click();
      await waitFor(() => href, { msg: 'download triggered' });
      const csv = await (await fetch(href)).text();
      includes(csv, 'Company,Title,Status');
      includes(csv, 'Acme');
      includes(csv, 'Globex');
      eq(csv.trim().split('\r\n').length, 4);
    });
  }, { env: 'browser' });

  describe('admin › logs & report an issue', () => {
    const LOGS = [
      { t: '2026-11-18T10:00:00Z', lvl: 'info', ctx: 'content', sid: 's1', mod: 'content', msg: 'panel.autofill start', tid: 'tAAA1111' },
      { t: '2026-11-18T10:00:01Z', lvl: 'error', ctx: 'bg', sid: 's2', mod: 'ai', msg: 'ai.draftAnswer failed', tid: 'tAAA1111', code: 'AJP-AI-429', data: { code: 'AJP-AI-429' } },
      { t: '2026-11-18T10:05:00Z', lvl: 'info', ctx: 'admin', sid: 's3', mod: 'admin', msg: 'Admin opened' },
    ];
    beforeEach(async () => {
      await loadAdmin({ logs: LOGS });
      w.location.hash = 'logs';
      await waitFor(() => $('#logs').classList.contains('on') && $('#logView').textContent, { msg: 'logs tab' });
    });
    afterEach(() => frame && frame.remove());

    it('shows error codes and an error summary', async () => {
      await waitFor(() => $('#errSummary .errchip'), { msg: 'summary' });
      includes($('#errSummary').textContent, 'AJP-AI-429 ×1');
      ok($('#logView .code'));
    });
    it('clicking a trace id shows that whole action only', async () => {
      $('#logView .tid').click();
      await waitFor(() => $('#logSearch').value === 'tAAA1111' && !/Admin opened/.test($('#logView').textContent), { msg: 'filtered' });
      includes($('#logView').textContent, 'panel.autofill start');
      includes($('#logView').textContent, 'ai.draftAnswer failed');
    });
    it('clicking an error code filters to it', async () => {
      await waitFor(() => $('#errSummary .errchip'));
      $('#errSummary .errchip').click();
      await waitFor(() => $('#logSearch').value === 'AJP-AI-429', { msg: 'code filter' });
    });
    it('Report an issue → Download report creates a bundle with the description', async () => {
      let href = null;
      let name = null;
      w.HTMLAnchorElement.prototype.click = function () {
        href = this.href;
        name = this.download;
      };
      $('#reportOpen').click();
      ok($('#reportDialog').open);
      $('#reportText').value = 'Draft answer failed on Lever';
      $('#reportDownload').click();
      await waitFor(() => href, { msg: 'download' });
      const b = JSON.parse(await (await fetch(href)).text());
      ok(/^apply-job-report-R-\d{8}-[A-Z0-9]{5}\.json$/.test(name), name);
      eq(b.description, 'Draft answer failed on Lever');
      eq(b.errors.byCode['AJP-AI-429'], 1);
      ok(b.logs.length >= 3);
      includes($('#reportOut').textContent, b.reportId);
    });
    it('Copy summary shows a short text with the report id', async () => {
      $('#reportOpen').click();
      $('#reportText').value = 'Panel missing';
      $('#reportCopy').click();
      await waitFor(() => !$('#reportSummary').hidden && $('#reportSummary').value, { msg: 'summary text' });
      includes($('#reportSummary').value, 'Apply Job issue report R-');
      includes($('#reportSummary').value, 'Panel missing');
    });
    it('popup link opens the report dialog directly (#logs?report=1)', async () => {
      frame.remove();
      await loadAdmin({ logs: LOGS });
      w.location.hash = 'logs?report=1';
      w.location.reload();
      await new Promise((r) => (frame.onload = r));
      w = frame.contentWindow;
      await waitFor(() => w.document.querySelector('#reportDialog') && w.document.querySelector('#reportDialog').open, { msg: 'dialog auto-open' });
    });
    it('uncaught errors on the Admin page are logged with AJP-INTERNAL', async () => {
      // (no background in this frame, so capture what the Admin page would send to it)
      const got = [];
      w.AJP.setLogSink(async (e) => got.push(...e));
      w.eval("setTimeout(function () { throw new Error('admin boom'); }, 0)"); // thrown inside the Admin page itself
      await waitFor(() => got.some((l) => l.msg === 'Uncaught error' && l.code === 'AJP-INTERNAL' && l.ctx === 'admin'), { msg: 'captured' });
    });
  }, { env: 'browser' });

  describe('admin › empty tracker', () => {
    beforeEach(() => loadAdmin(null));
    afterEach(() => frame && frame.remove());
    it('explains how jobs get added', async () => {
      await waitFor(() => $('#trkView').textContent, { msg: 'render' });
      includes($('#trkView').textContent, 'No applications yet');
      includes($('#trkStats').textContent, '—Response rate');
    });
  }, { env: 'browser' });
})();
