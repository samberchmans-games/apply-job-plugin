/*
 * tracker-view.js — Admin → Applications: stats, board/table, detail dialog, CSV export.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  const T = AJP.tracker;
  const log = AJP.logger('tracker-view');
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LABEL = { 'in progress': 'Started', applied: 'Applied', interviewing: 'Interviewing', offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn' };
  const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : '');
  // <input type=datetime-local> works in local time; we store ISO (UTC).
  const toLocalInput = (iso) => {
    const t = Date.parse(iso);
    return isNaN(t) ? '' : new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  let ui = { toast() {}, download() {} };
  let view = 'board';
  let openId = null;
  let last = { apps: [], dueIds: new Map() };

  try {
    view = localStorage.getItem('ajp.trk.view') || 'board';
  } catch (_) {}

  const serial = AJP.serial();
  const updateApps = (fn) => serial(() => AJP.store.update('applications', fn));

  async function setStatus(id, status) {
    await updateApps((list) => {
      const a = list.find((x) => x.id === id);
      if (a && a.status !== status) T.upsert(list, { id, url: a.url, status });
    });
    log.info('Status changed in Admin', { status });
    ui.toast(`Moved to ${LABEL[status]}`);
  }

  async function patch(id, fields) {
    await updateApps((list) => {
      const a = list.find((x) => x.id === id);
      if (a) Object.assign(a, fields, { updatedAt: new Date().toISOString() });
    });
  }

  function matches(a, q) {
    if (!q) return true;
    return AJP.norm([a.company, a.title, a.notes, a.recruiter, a.location, a.nextStep].join(' ')).includes(q);
  }

  // ---- Render ------------------------------------------------------------------------------
  function statsHtml(st, dueCount) {
    const max = Math.max(1, ...st.perWeek.map((w) => w.count));
    const pct = (v) => (v == null ? '—' : v + '%');
    return `
      <div class="tile"><b>${st.total}</b><span>Tracked jobs</span></div>
      <div class="tile"><b>${st.submitted}</b><span>Applied</span></div>
      <div class="tile"><b>${st.thisWeek}</b><span>Applied this week</span>
        <div class="bars" title="Applications per week, last 8 weeks">${st.perWeek.map((w) => `<i style="height:${(100 * w.count) / max}%" title="Week of ${w.weekStart}: ${w.count}"></i>`).join('')}</div></div>
      <div class="tile"><b>${pct(st.responseRate)}</b><span>Response rate</span></div>
      <div class="tile"><b>${pct(st.interviewRate)}</b><span>Interview rate</span></div>
      <div class="tile"><b>${pct(st.avgScoreInterviewed)} / ${pct(st.avgScoreNotInterviewed)}</b><span>Avg match: interviews / others</span></div>
      <div class="tile ${dueCount ? 'warn' : ''}"><b>${dueCount}</b><span>Follow-ups due</span></div>`;
  }

  function cardHtml(a) {
    const due = last.dueIds.get(a.id);
    return `<div class="app" draggable="true" tabindex="0" data-id="${a.id}">
      <div class="co">${esc(a.company || '—')}</div>
      <div>${esc(a.title || a.url)}</div>
      <div class="meta">
        ${a.score == null ? '' : `<span class="pill">${a.score}%</span>`}
        <span>${fmtDate(a.appliedAt || a.date)}</span>
        ${a.detectedBy && a.detectedBy !== 'manual' ? '<span class="pill auto" title="Detected automatically">auto</span>' : ''}
        ${due ? `<span class="pill due">${due.reason === 'interview' ? 'interview soon' : `follow up · ${due.days}d`}</span>` : ''}
      </div></div>`;
  }

  function boardHtml(list) {
    return `<div class="board">${T.STATUSES.map((s) => {
      const items = list.filter((a) => a.status === s);
      return `<div class="col" data-status="${s}"><h4>${LABEL[s]}<span>${items.length}</span></h4>${items.map(cardHtml).join('')}</div>`;
    }).join('')}</div>`;
  }

  function tableHtml(list) {
    return `<table class="tbl"><thead><tr><th>Applied</th><th>Company</th><th>Role</th><th>Match</th><th>Status</th><th>Next step</th></tr></thead><tbody>${
      list
        .map((a) => `<tr><td>${fmtDate(a.appliedAt || a.date)}</td><td>${esc(a.company || '—')}</td>
          <td><a href="#" data-open="${a.id}">${esc(a.title || a.url)}</a>${last.dueIds.get(a.id) ? ' <span class="pill due">due</span>' : ''}</td>
          <td>${a.score == null ? '—' : a.score + '%'}</td>
          <td><select data-status-of="${a.id}">${T.STATUSES.map((s) => `<option value="${s}" ${s === a.status ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select></td>
          <td>${esc(a.nextStep || '')}</td></tr>`)
        .join('') || '<tr><td colspan="6" class="hint">No applications match.</td></tr>'
    }</tbody></table>`;
  }

  function filtered() {
    const q = AJP.norm($('#trkSearch').value);
    const st = $('#trkStatus').value;
    const dueOnly = $('#trkDue').checked;
    return last.apps.filter((a) => matches(a, q) && (!st || a.status === st) && (!dueOnly || last.dueIds.has(a.id)));
  }

  async function render() {
    const [apps, settings] = await Promise.all([AJP.store.get('applications'), AJP.store.get('settings')]);
    const due = T.dueFollowUps(apps, Date.now(), Number(settings.tracker.followUpDays) || 7);
    last = { apps, dueIds: new Map(due.map((d) => [d.app.id, d])) };
    $('#trkStats').innerHTML = statsHtml(T.stats(apps), due.length);
    const list = filtered();
    $('#trkView').innerHTML = !apps.length
      ? '<p class="hint">No applications yet. Open a job, click <b>Autofill</b> or <b>Mark applied</b> in the panel — or just apply; confirmations are detected automatically.</p>'
      : view === 'board' ? boardHtml(list) : tableHtml(list);
    document.querySelectorAll('.seg [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    if (openId && $('#trkDetail').open && !$('#trkDetail').contains(document.activeElement)) renderDetail(openId);
  }

  // ---- Detail dialog -----------------------------------------------------------------------
  function renderDetail(id) {
    const a = last.apps.find((x) => x.id === id);
    const d = $('#trkDetail');
    if (!a) return d.close();
    openId = id;
    const snap = a.snapshot || {};
    const sal = snap.salary ? `$${Math.round(snap.salary.min / 1000)}k–$${Math.round(snap.salary.max / 1000)}k` : '';
    d.innerHTML = `
      <h2 style="margin-top:0">${esc(a.title || 'Job')}</h2>
      <p class="hint">${esc(a.company || '')}${a.location ? ' · ' + esc(a.location) : ''}${sal ? ' · ' + sal : ''}${a.score == null ? '' : ' · match ' + a.score + '%'}
        ${a.url ? ` · <a href="${esc(a.url)}" target="_blank" rel="noopener">Open job ↗</a>` : ''}</p>
      <div class="grid">
        <label>Status<select data-f="status">${T.STATUSES.map((s) => `<option value="${s}" ${s === a.status ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select></label>
        <label>Recruiter / contact<input data-f="recruiter" value="${esc(a.recruiter || '')}"></label>
        <label>Interview date<input type="datetime-local" data-f="interviewAt" value="${esc(toLocalInput(a.interviewAt))}"></label>
        <label>Next step<input data-f="nextStep" value="${esc(a.nextStep || '')}"></label>
        <label class="wide">Notes<textarea rows="4" data-f="notes">${esc(a.notes || '')}</textarea></label>
      </div>
      <p class="hist">Resume used: <b>${esc(a.resumeName || '—')}</b> · First seen ${fmtDate(a.date)}${a.appliedAt ? ' · Applied ' + fmtDate(a.appliedAt) : ''}${a.detectedBy ? ' · via ' + esc(a.detectedBy) : ''}${a.lastFollowUpAt ? ' · Last follow-up ' + fmtDate(a.lastFollowUpAt) : ''}<br>
        History: ${(a.statusHistory || []).map((h) => `${LABEL[h.status] || h.status} (${fmtDate(h.at)})`).join(' → ') || '—'}</p>
      ${snap.jd ? `<details><summary>Saved job description (${fmtDate(snap.savedAt)})</summary><pre class="jd">${esc(snap.jd)}</pre></details>` : '<p class="hint">No job description saved for this one.</p>'}
      <div class="row" style="justify-content:flex-end">
        <button data-d="followed">✓ I followed up today</button>
        <button data-d="delete" class="danger">Delete</button>
        <button data-d="close" class="primary">Close</button>
      </div>`;
    if (!d.open) d.showModal();
  }

  function initDetail() {
    const d = $('#trkDetail');
    // Collect edits from every field and save them together (a single-field debounce would drop earlier fields).
    let pending = {};
    let pendingId = null;
    const flush = async () => {
      const fields = pending;
      const id = pendingId;
      pending = {};
      if (!id || !Object.keys(fields).length) return;
      await patch(id, fields);
      ui.toast('Saved');
    };
    const flushSoon = AJP.debounce(flush, 400);
    d.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      if (!f || f === 'status') return;
      if (pendingId !== openId) flush();
      pendingId = openId;
      pending[f] = f === 'interviewAt' && e.target.value ? new Date(e.target.value).toISOString() : e.target.value;
      flushSoon();
    });
    d.addEventListener('change', (e) => {
      if (e.target.dataset.f === 'status') setStatus(openId, e.target.value);
    });
    d.addEventListener('click', async (e) => {
      const act = e.target.dataset.d;
      if (act === 'close') d.close();
      if (act === 'followed') {
        await patch(openId, { lastFollowUpAt: new Date().toISOString() });
        ui.toast('Follow-up recorded — reminder reset');
      }
      if (act === 'delete' && confirm('Delete this application from the tracker?')) {
        await updateApps((list) => list.filter((a) => a.id !== openId));
        d.close();
      }
    });
    d.addEventListener('close', async () => {
      await flush(); // never lose edits typed just before closing
      openId = null;
      render();
    });
  }

  // ---- Init ----------------------------------------------------------------------------------
  function init(opts) {
    ui = { ...ui, ...opts };
    $('#trkStatus').insertAdjacentHTML('beforeend', T.STATUSES.map((s) => `<option value="${s}">${LABEL[s]}</option>`).join(''));
    for (const id of ['#trkSearch', '#trkStatus', '#trkDue']) $(id).addEventListener(id === '#trkSearch' ? 'input' : 'change', render);
    if (/[?&]due=1/.test(location.hash)) $('#trkDue').checked = true;
    document.querySelector('.seg').addEventListener('click', (e) => {
      if (!e.target.dataset.view) return;
      view = e.target.dataset.view;
      try {
        localStorage.setItem('ajp.trk.view', view);
      } catch (_) {}
      render();
    });
    $('#trkExport').addEventListener('click', () => {
      const list = filtered();
      ui.download(`applications-${new Date().toISOString().slice(0, 10)}.csv`, T.toCSV(list), 'text/csv;charset=utf-8');
      log.info('Applications exported', { count: list.length });
    });

    const v = $('#trkView');
    v.addEventListener('click', (e) => {
      const card = e.target.closest('.app, [data-open]');
      if (!card) return;
      e.preventDefault();
      renderDetail(card.dataset.id || card.dataset.open);
    });
    v.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('app')) renderDetail(e.target.dataset.id);
    });
    v.addEventListener('change', (e) => {
      if (e.target.dataset.statusOf) setStatus(e.target.dataset.statusOf, e.target.value);
    });
    // Drag & drop between board columns
    v.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.app');
      if (card) e.dataTransfer.setData('text/plain', card.dataset.id);
    });
    v.addEventListener('dragover', (e) => {
      const col = e.target.closest('.col');
      if (!col) return;
      e.preventDefault();
      col.classList.add('over');
    });
    v.addEventListener('dragleave', (e) => {
      const col = e.target.closest('.col');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('over');
    });
    v.addEventListener('drop', (e) => {
      const col = e.target.closest('.col');
      if (!col) return;
      e.preventDefault();
      col.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      if (id) setStatus(id, col.dataset.status);
    });
    initDetail();
  }

  AJP.trackerView = { init, render, renderDetail, toLocalInput };
})();
