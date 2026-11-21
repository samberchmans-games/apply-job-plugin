/*
 * radar-view.js — Admin → Job Radar: new jobs (by match), watchlist (add by careers URL or a list, pause, remove,
 * scan), settings. Site permissions are requested here, inside the click (Firefox requires it), from the hosts the
 * shared board module names. All work goes through radar.* messages to the background.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  const log = AJP.logger('radar-view');
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = AJP.api;
  let ui = { toast() {} };
  let filter = 'new';
  const ago = (iso) => {
    if (!iso) return 'never';
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
  const money = (s) => {
    if (!s || !(s.min || s.max)) return '';
    const f = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
    const per = { hour: '/h', month: '/mo', week: '/wk', year: '' }[s.period] || '';
    return `${s.currency === 'USD' ? '$' : s.currency + ' '}${[s.min, s.max].filter(Boolean).map(f).join('–')}${per}`;
  };
  const REMOTE = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };
  const boardLabel = (id) => (AJP.radar.boards.get(id) || { label: id }).label;
  const fail = (r) => `${r.error} ${r.hint || ''} (${r.code})`;

  // Ask for the boards' sites (optional permissions) — must run inside the click handler, before any other await.
  async function allow(entries) {
    const origins = [...new Set(entries.flatMap((e) => AJP.radar.boards.hostsFor(e)))];
    if (!origins.length || !api.permissions || !api.permissions.request) return true;
    try {
      return await api.permissions.request({ origins });
    } catch (e) {
      log.warn('Permission request failed', { error: e.message });
      return false;
    }
  }

  // ---- Status + settings --------------------------------------------------------------------------------
  async function renderStatus() {
    const st = await AJP.send('radar.status');
    if (!st || st.ok === false) return;
    const s = st.lastSummary;
    $('#radarStatus').innerHTML = st.running
      ? '⏳ Scanning now…'
      : `${st.enabled ? '🟢 On' : '⚪ Off'} · ${st.companies} compan${st.companies === 1 ? 'y' : 'ies'} watched · last scan ${s ? `${ago(s.at)}: ${s.companies} checked, ${s.new} new, ${s.matches} match${s.matches === 1 ? '' : 'es'}${s.errors && s.errors.length ? `, ${s.errors.length} with errors` : ''}` : 'not yet'}`;
    const n = st.newCount;
    const badge = $('#radarCount');
    if (badge) {
      badge.textContent = n;
      badge.hidden = !n;
    }
  }
  async function renderSettings() {
    const r = await AJP.send('radar.settings.get');
    if (!r || r.ok === false) return;
    const s = r.settings;
    const f = $('#radarSettings');
    f.enabled.checked = !!s.enabled;
    f.intervalHours.value = s.intervalHours;
    f.threshold.value = s.threshold;
    f.locations.value = (s.locations || []).join('; ');
    f.remote.value = s.remote;
    f.minSalary.value = s.minSalary || '';
    f.notify.value = s.notify;
  }
  async function saveSettings() {
    const f = $('#radarSettings');
    const r = await AJP.send('radar.settings.save', { settings: { enabled: f.enabled.checked, intervalHours: Number(f.intervalHours.value), threshold: Number(f.threshold.value), locations: f.locations.value, remote: f.remote.value, minSalary: f.minSalary.value.replace(/[^\d]/g, ''), notify: f.notify.value } });
    if (r && r.ok === false) return ui.toast(fail(r));
    await renderSettings();
    renderStatus();
    ui.toast('Job Radar settings saved');
  }

  // ---- New jobs -----------------------------------------------------------------------------------------
  async function renderJobs() {
    const r = await AJP.send('radar.jobs', { status: filter });
    const box = $('#radarJobs');
    if (!r || r.ok === false) return void (box.textContent = r ? fail(r) : '');
    const thr = Number($('#radarSettings').threshold.value) || 60;
    box.innerHTML = r.jobs.length
      ? r.jobs
          .map((j) => {
            const meta = [esc(j.companyName), esc(j.locations.slice(0, 2).join(' · ')), REMOTE[j.remote] || '', money(j.salary), j.postedAt ? `posted ${ago(j.postedAt)}` : ''].filter(Boolean).join(' · ');
            return `<div class="radar-job" data-key="${esc(j.key)}">
              <span class="pill ${j.score >= thr ? 'good' : ''}" title="Match with your ${esc(j.bestTrackId || 'profile')} track">${j.score}%</span>
              <div class="radar-main"><a href="${esc(j.url)}" target="_blank" rel="noopener"><b>${esc(j.title)}</b></a>${j.descriptionLevel === 'title' ? ' <span class="pill warn" title="This board gives no job description: the match uses the title only">title match only</span>' : ''}
                <div class="hint">${meta}</div></div>
              <div class="radar-act">${j.status !== 'saved' ? '<button data-act="saved">Save to Applications</button>' : '<span class="hint">Saved</span>'}${j.status !== 'dismissed' ? '<button data-act="dismissed">Dismiss</button>' : '<button data-act="new">Restore</button>'}</div>
            </div>`;
          })
          .join('')
      : `<p class="hint">${filter === 'new' ? 'No new jobs yet. Add companies below; they are checked every few hours, and matching jobs appear here.' : 'Nothing here.'}</p>`;
  }
  async function jobAction(key, status) {
    const r = await AJP.send('radar.job.update', { key, status });
    if (r && r.ok === false) return ui.toast(fail(r));
    ui.toast(status === 'saved' ? 'Saved to Applications' : status === 'dismissed' ? 'Dismissed: it won’t come back' : 'Restored');
    renderJobs();
    renderStatus();
  }

  // ---- Watchlist ------------------------------------------------------------------------------------------
  async function renderWatch() {
    const r = await AJP.send('radar.watch.list');
    const box = $('#radarWatch');
    if (!r || r.ok === false) return;
    box.innerHTML = r.entries.length
      ? `<table class="tbl"><thead><tr><th>Company</th><th>Board</th><th>Open jobs</th><th>Last scan</th><th>Status</th><th></th></tr></thead><tbody>${r.entries
          .map((w) => `<tr data-key="${esc(w.key)}"><td><b>${esc(w.companyName)}</b></td><td>${esc(boardLabel(w.board))}</td><td>${w.openJobs == null ? '' : w.openJobs}</td><td>${ago(w.lastScanAt)}</td>
            <td>${w.paused ? `<span class="pill warn">Paused</span>${w.lastError ? ` <span class="hint">${esc(w.lastError.code)}</span>` : ''}` : w.lastError ? `<span class="pill warn">${esc(w.lastError.code)}</span>` : '<span class="hint">OK</span>'}</td>
            <td class="radar-act"><button data-act="scan">Scan</button><button data-act="${w.paused ? 'resume' : 'pause'}">${w.paused ? 'Resume' : 'Pause'}</button><button data-act="remove">Remove</button></td></tr>`)
          .join('')}</tbody></table>`
      : '<p class="hint">No companies yet. Paste a careers page link above (for example https://boards.greenhouse.io/company).</p>';
  }
  async function addOne() {
    const input = $('#radarUrl');
    const url = input.value.trim();
    const out = $('#radarAddOut');
    const entry = AJP.radar.detect.fromUrl(url);
    if (!entry) return void (out.textContent = `❌ ${AJP.describeError(AJP.err('RADAR_UNSUPPORTED')).message} ${AJP.ERRORS.RADAR_UNSUPPORTED[2]}`);
    if (!(await allow([entry]))) return void (out.textContent = `❌ ${AJP.ERRORS.RADAR_PERMISSION[1]} (AJP-RADAR-PERM)`);
    out.textContent = 'Checking the job board…';
    const r = await AJP.send('radar.watch.add', { url });
    if (r && r.ok === false) return void (out.textContent = `❌ ${fail(r)}`);
    out.textContent = r.exists ? `Already watching ${r.entry.companyName}.` : `✅ Watching ${r.entry.companyName} (${boardLabel(r.entry.board)}): ${r.entry.openJobs} open job${r.entry.openJobs === 1 ? '' : 's'} today. New ones that fit you will appear above.`;
    input.value = '';
    renderWatch();
    renderStatus();
  }
  async function addList() {
    const text = $('#radarList').value;
    const lines = text.split(/[\r\n,;]+/).map((l) => l.trim()).filter(Boolean);
    const found = lines.map((l) => AJP.radar.detect.fromUrl(l)).filter(Boolean);
    if (found.length && !(await allow(found))) return void ($('#radarListOut').textContent = `❌ ${AJP.ERRORS.RADAR_PERMISSION[1]} (AJP-RADAR-PERM)`);
    $('#radarListOut').textContent = `Checking ${lines.length} line${lines.length === 1 ? '' : 's'}…`;
    const r = await AJP.send('radar.watch.addList', { text });
    if (r && r.ok === false) return void ($('#radarListOut').textContent = `❌ ${fail(r)}`);
    $('#radarListOut').innerHTML = `✅ Added ${r.added.length}.` + (r.skipped.length ? ` Skipped ${r.skipped.length}:<ul>${r.skipped.map((s) => `<li><code>${esc(s.line)}</code>: ${esc(s.reason)}</li>`).join('')}</ul>` : '');
    renderWatch();
    renderStatus();
  }
  async function watchAction(key, act) {
    if (act === 'remove') {
      if (!confirm('Stop watching this company? Its new jobs are removed from the list.')) return;
      await AJP.send('radar.watch.remove', { key });
    } else if (act === 'pause' || act === 'resume') {
      await AJP.send('radar.watch.update', { key, paused: act === 'pause' });
    } else if (act === 'scan') {
      return scan(key);
    }
    renderWatch();
    renderJobs();
    renderStatus();
  }
  async function scan(key) {
    $('#radarStatus').textContent = '⏳ Scanning now…';
    const r = await AJP.send('radar.scanNow', key ? { key } : {});
    if (r && r.ok === false) ui.toast(fail(r));
    else if (r.summary && !r.summary.skipped) ui.toast(`Checked ${r.summary.companies} compan${r.summary.companies === 1 ? 'y' : 'ies'}: ${r.summary.new} new job${r.summary.new === 1 ? '' : 's'}${r.summary.errors.length ? `, ${r.summary.errors.length} with errors (see the watchlist)` : ''}`);
    renderJobs();
    renderWatch();
    renderStatus();
  }

  // ---- Wiring ---------------------------------------------------------------------------------------------
  function render() {
    renderSettings().then(() => (renderJobs(), renderWatch(), renderStatus()));
    AJP.send('radar.viewed'); // the blue badge counts matches since you last looked
  }
  function init(opts = {}) {
    ui = { ...ui, ...opts };
    const g = (name, fn) => AJP.guard(`radar.${name}`, fn, { mod: 'admin', onError: (d) => ui.toast(`${d.message} (${d.code})`) });
    $('#radarAdd').addEventListener('click', g('add', addOne));
    $('#radarUrl').addEventListener('keydown', (e) => e.key === 'Enter' && $('#radarAdd').click());
    $('#radarAddList').addEventListener('click', g('addList', addList));
    $('#radarListFile').addEventListener('change', g('listFile', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) $('#radarList').value = await f.text();
    }));
    $('#radarScan').addEventListener('click', g('scanAll', () => scan(null)));
    $('#radarSettingsSave').addEventListener('click', g('saveSettings', saveSettings));
    $('#radarSettings').addEventListener('submit', (e) => e.preventDefault()); // Enter in a field must not reload Admin
    $('#radarFilter').addEventListener('change', (e) => ((filter = e.target.value), renderJobs()));
    $('#radarJobs').addEventListener('click', g('jobAction', (e) => {
      const b = e.target.closest('button[data-act]');
      if (b) return jobAction(b.closest('[data-key]').dataset.key, b.dataset.act);
    }));
    $('#radarWatch').addEventListener('click', g('watchAction', (e) => {
      const b = e.target.closest('button[data-act]');
      if (b) return watchAction(b.closest('[data-key]').dataset.key, b.dataset.act);
    }));
    renderStatus(); // nav count
  }
  // Prefill from "Watch this company" when the panel had no permission yet (#radar?add=<url>)
  function prefill(url) {
    if (url) $('#radarUrl').value = url;
  }

  // Storage changed (a background scan finished, a job was saved from the popup): refresh what is on screen.
  const refresh = AJP.debounce((visible) => {
    renderStatus();
    if (visible) (renderJobs(), renderWatch());
  }, 300);

  AJP.radarView = { init, render, renderStatus, prefill, refresh };
})();
