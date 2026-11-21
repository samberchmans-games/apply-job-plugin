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
      : `${st.enabled ? '🟢 On' : '⚪ Off'} · ${st.companies} compan${st.companies === 1 ? 'y' : 'ies'} of yours + the directory · last scan ${s ? `${ago(s.at)}: ${s.companies} checked, ${s.new} new, ${s.matches} match${s.matches === 1 ? '' : 'es'}${s.errors && s.errors.length ? `, ${s.errors.length} with errors` : ''}` : 'not yet'}`;
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
    f.directory.checked = s.directory !== false;
    f.intervalHours.value = s.intervalHours;
    f.threshold.value = s.threshold;
    f.locations.value = (s.locations || []).join('; ');
    f.remote.value = s.remote;
    f.minSalary.value = s.minSalary || '';
    f.notify.value = s.notify;
  }
  async function saveSettings() {
    const f = $('#radarSettings');
    const r = await AJP.send('radar.settings.save', { settings: { enabled: f.enabled.checked, directory: f.directory.checked, intervalHours: Number(f.intervalHours.value), threshold: Number(f.threshold.value), locations: f.locations.value, remote: f.remote.value, minSalary: f.minSalary.value.replace(/[^\d]/g, ''), notify: f.notify.value } });
    if (r && r.ok === false) return ui.toast(fail(r));
    await renderSettings();
    renderStatus();
    ui.toast('Job Radar settings saved');
  }

  // ---- New jobs -----------------------------------------------------------------------------------------
  const FRESH = { today: ['fresh', 'Posted today'], week: ['week', 'This week'] };
  let sort = 'match';
  let tracksById = {};
  function card(j, thr) {
    const el = j.eligibility || { status: 'ok', reasons: [], flags: {} };
    const fr = FRESH[AJP.radar.core.freshness(j)];
    const track = tracksById[j.bestTrackId];
    const meta = [esc(j.companyName), esc(j.locations.slice(0, 2).join(' · ')), REMOTE[j.remote] || '', money(j.salary), j.postedAt ? `posted ${ago(j.postedAt)}${j.postedAtExact === false ? ' (about)' : ''}` : ''].filter(Boolean).join(' · ');
    const tags = [
      fr ? `<span class="pill ${fr[0]}">${fr[1]}</span>` : '',
      track && !track.implicit ? `<span class="pill">${esc(track.name)}</span>` : '',
      j.descriptionLevel === 'title' ? '<span class="pill warn" title="This board gives no job description: the match uses the title only">title match only</span>' : '',
      el.flags && el.flags.sponsors ? '<span class="pill good">Sponsors visas</span>' : '',
      el.status === 'check' ? `<span class="pill warn" title="${esc(el.reasons.join('; '))}">Check: ${esc(el.reasons[0])}</span>` : '',
    ].filter(Boolean).join(' ');
    return `<div class="radar-job ${el.status === 'blocked' ? 'blocked' : ''}" data-key="${esc(j.key)}">
      <span class="pill ${j.score >= thr ? 'good' : ''}" title="Best fit: ${esc(track ? track.name : 'your profile')}">${j.score}%</span>
      <div class="radar-main"><a href="${esc(j.url)}" target="_blank" rel="noopener"><b>${esc(j.title)}</b></a> ${tags}
        <div class="hint">${meta}</div>${el.status === 'blocked' ? `<div class="hint warn">⚠ ${esc(el.reasons.join('; '))}</div>` : ''}</div>
      <div class="radar-act">${j.status !== 'saved' ? '<button data-act="saved">Save to Applications</button>' : '<span class="hint">Saved</span>'}${j.status !== 'dismissed' ? '<button data-act="dismissed">Dismiss</button>' : '<button data-act="new">Restore</button>'}<button data-act="hide" title="Never show jobs from ${esc(j.companyName)} again">Hide company</button></div>
    </div>`;
  }
  // The built-in company directory: how big, which boards are allowed, on/off.
  async function renderDirectory() {
    const box = $('#radarDir');
    if (!box) return;
    const d = await AJP.send('radar.directory');
    if (!d || d.ok === false) return;
    const boards = Object.entries(d.byBoard).map(([b, n]) => `${esc(boardLabel(b))} ${n}`).join(', ');
    const missing = Object.keys(d.byBoard).filter((b) => !d.allowed.includes(b));
    box.innerHTML = `<b>🌐 Built-in company directory: ${d.total} companies</b> (${boards}) · ${d.on ? 'on' : 'off'}` +
      `<div class="hint">Job Radar checks these companies for you, a slice at a time (all of them about once a day), and shows only the jobs that fit your career tracks and places.${d.hidden ? ` ${d.hidden} hidden by you.` : ''}${d.lastAt ? ` Last slice ${ago(new Date(d.lastAt).toISOString())}.` : ''}</div>` +
      (d.on && missing.length ? `<div class="row"><span class="hint warn">⚠ The browser hasn't allowed ${missing.map(boardLabel).join(', ')} yet, so those companies are skipped.</span><button class="primary" data-dir="allow">Allow all 11 job boards</button></div>` : '');
  }
  async function renderJobs() {
    const profile = await AJP.store.get('profile');
    tracksById = Object.fromEntries(AJP.tracks.list(profile).map((t) => [t.id, t]));
    renderTracks(profile);
    const r = await AJP.send('radar.jobs', { status: filter, sort });
    const box = $('#radarJobs');
    if (!r || r.ok === false) return void (box.textContent = r ? fail(r) : '');
    const thr = Number($('#radarSettings').threshold.value) || 60;
    const isBlocked = (j) => j.eligibility && j.eligibility.status === 'blocked';
    const ok = r.jobs.filter((j) => !isBlocked(j));
    const blocked = r.jobs.filter(isBlocked);
    box.innerHTML =
      (ok.length ? ok.map((j) => card(j, thr)).join('') : `<p class="hint">${filter === 'new' ? 'No new jobs yet. The built-in directory and your companies are checked every few hours; jobs that fit your tracks appear here (or click Scan now).' : 'Nothing here.'}</p>`) +
      (blocked.length ? `<details class="radar-blocked"><summary>Likely not eligible (${blocked.length}): the job text conflicts with your work authorization in Auto-apply details. Not counted in alerts; open to check.</summary>${blocked.map((j) => card(j, thr)).join('')}</details>` : '');
  }
  // What Job Radar looks for: your career tracks (up to 3), each with its titles and places.
  function renderTracks(profile) {
    const box = $('#radarTracks');
    if (!box) return;
    const list = AJP.tracks.list(profile);
    const titles = (t) => (t.targetTitles && t.targetTitles.length ? t.targetTitles : profile.targetRoles || []);
    const places = (t) => (t.areas && t.areas.length ? t.areas : profile.areas || []);
    const any = list.some((t) => titles(t).length);
    box.innerHTML = any
      ? `Looking for: ${list.map((t) => `<b>${esc(t.implicit ? 'your target roles' : t.name)}</b> (${esc(titles(t).slice(0, 4).join(', ') || 'any title')}${places(t).length ? ' · ' + esc(places(t).slice(0, 3).join('; ')) : ''})`).join(' · ')}. <a href="#tracks">Edit career tracks</a>`
      : '⚠ Add target roles in <a href="#prefs">Job preferences</a> (or titles in <a href="#tracks">Career tracks</a>) so Job Radar keeps only jobs that fit you.';
  }

  async function jobAction(key, status) {
    if (status === 'hide') {
      const [board, company] = key.split(':');
      if (!confirm('Hide this company? Its jobs disappear and it won’t be checked again (you can add it back as a company you watch).')) return;
      await AJP.send('radar.company.hide', { board, company });
      ui.toast('Company hidden');
      renderDirectory();
      return renderJobs();
    }
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
  const unsupported = () => `❌ ${AJP.ERRORS.RADAR_UNSUPPORTED[1]} ${AJP.ERRORS.RADAR_UNSUPPORTED[2]} (AJP-RADAR-UNSUP)`;
  // A company's own careers page (e.g. acme.com/careers): ask for that one site, read the page once, and look for the
  // job board it embeds (links, iframes, scripts; Teamtailor by its assets). The board itself needs a second click.
  let pending = null;
  async function fromCareersPage(url, out) {
    const page = AJP.radar.detect.parseUrl(url);
    // Job sites without a public feed: say so at once (no point reading the page).
    if (!page || /(^|\.)(linkedin|indeed|glassdoor|ziprecruiter|icims|monster|dice)\.[a-z.]+$/i.test(page.hostname)) return void (out.textContent = unsupported());
    if (!(await askSite(page))) return void (out.textContent = `❌ ${AJP.ERRORS.RADAR_PERMISSION[1]} (AJP-RADAR-PERM)`);
    out.textContent = 'Reading the careers page…';
    let html = '';
    try {
      html = await AJP.http(page.href, { credentials: 'omit' }, { json: false, timeoutMs: 15000, tries: 1, networkKey: 'RADAR_NETWORK', timeoutKey: 'RADAR_TIMEOUT', statusKey: () => 'RADAR_BOARD_NOT_FOUND', label: 'careers page', log });
    } catch (e) {
      const d = AJP.describeError(e);
      return void (out.textContent = `❌ ${d.message} ${d.hint || ''} (${d.code})`);
    }
    const hit = AJP.radar.detect.fromHtml(html, page.href);
    if (!hit || !AJP.radar.boards.get(hit.board)) {
      log.info('No job board found on a careers page', { host: page.hostname });
      return void (out.textContent = `❌ No supported job board was found on this page. Open one of its job posts and paste that link instead (it usually shows the board). (AJP-RADAR-UNSUP)`);
    }
    pending = hit;
    out.innerHTML = `Found its <b>${esc(boardLabel(hit.board))}</b> job board (<code>${esc(hit.company)}</code>). <button id="radarAllowAdd" class="primary">Allow and add</button>`;
    $('#radarAllowAdd').addEventListener('click', AJP.guard('radar.allowAdd', addPending, { mod: 'admin', onError: (d) => ui.toast(`${d.message} (${d.code})`) }));
  }
  async function askSite(page) {
    if (!api.permissions || !api.permissions.request) return true;
    try {
      return await api.permissions.request({ origins: [`${page.protocol}//${page.hostname}/*`] });
    } catch (e) {
      log.warn('Site permission request failed', { error: e.message });
      return false;
    }
  }
  async function addPending() {
    const out = $('#radarAddOut');
    const entry = pending;
    if (!entry) return;
    if (!(await allow([entry]))) return void (out.textContent = `❌ ${AJP.ERRORS.RADAR_PERMISSION[1]} (AJP-RADAR-PERM)`);
    out.textContent = 'Checking the job board…';
    pending = null;
    return finishAdd(await AJP.send('radar.watch.add', entry));
  }
  function finishAdd(r) {
    const out = $('#radarAddOut');
    if (r && r.ok === false) return void (out.textContent = `❌ ${fail(r)}`);
    out.textContent = r.exists ? `Already watching ${r.entry.companyName}.` : `✅ Watching ${r.entry.companyName} (${boardLabel(r.entry.board)}): ${r.entry.openJobs} open job${r.entry.openJobs === 1 ? '' : 's'} today. New ones that fit you will appear above.`;
    $('#radarUrl').value = '';
    renderWatch();
    renderStatus();
  }

  async function addOne() {
    const input = $('#radarUrl');
    const url = input.value.trim();
    const out = $('#radarAddOut');
    const entry = AJP.radar.detect.fromUrl(url);
    if (!entry) return fromCareersPage(url, out);
    if (!AJP.radar.boards.get(entry.board)) return void (out.textContent = unsupported());
    if (!(await allow([entry]))) return void (out.textContent = `❌ ${AJP.ERRORS.RADAR_PERMISSION[1]} (AJP-RADAR-PERM)`);
    out.textContent = 'Checking the job board…';
    return finishAdd(await AJP.send('radar.watch.add', { url }));
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
    renderSettings().then(() => (renderJobs(), renderWatch(), renderStatus(), renderDirectory()));
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
    $('#radarSort').addEventListener('change', (e) => ((sort = e.target.value), renderJobs()));
    $('#radarDir').addEventListener('click', g('dirAllow', async (e) => {
      if (!e.target.closest('[data-dir="allow"]')) return;
      const ok = await allow(AJP.radar.boards.all().map((a) => ({ board: a.id })));
      ui.toast(ok ? 'All job boards allowed: the directory is scanned from the next scan' : `${AJP.ERRORS.RADAR_PERMISSION[1]} (AJP-RADAR-PERM)`);
      renderDirectory();
    }));
    // One prompt for every supported job board, so adding companies never asks again.
    $('#radarAllowAll').addEventListener('click', g('allowAll', async () => {
      const ok = await allow(AJP.radar.boards.all().map((a) => ({ board: a.id })));
      $('#radarAllOut').textContent = ok ? '✅ All 11 job boards allowed: adding companies won’t ask again.' : `❌ ${AJP.ERRORS.RADAR_PERMISSION[1]} (AJP-RADAR-PERM)`;
    }));
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
    if (visible) (renderJobs(), renderWatch(), renderDirectory());
  }, 300);

  AJP.radarView = { init, render, renderStatus, prefill, refresh };
})();
