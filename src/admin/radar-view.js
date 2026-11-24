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
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
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

  // A job on a company's own site: ask for that one site inside the click (Firefox requires it), then open it.
  function openJob(e) {
    const a = e.target.closest('.radar-main a[href]');
    if (!a || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const D = AJP.radar.detect;
    const scope = D.siteScope(a.href);
    const m = api.runtime.getManifest ? api.runtime.getManifest() : {};
    const declared = ((m.content_scripts || [])[0] || {}).matches || [];
    if (!scope || !api.permissions || !api.permissions.request || D.declaredSite(a.href, declared)) return;
    e.preventDefault();
    const asked = api.permissions.request({ origins: [scope.origin] }).catch((err) => {
      log.warn('Site access request failed', { error: err.message });
      return false;
    });
    AJP.guard('radar.openJob', async () => {
      const ok = await asked;
      const r = await AJP.send('radar.job.open', { url: a.href });
      if (r && r.ok === false) return ui.toast(fail(r));
      if (!ok || !r.panel) ui.toast('Job opened. To use the assistant there, click the Apply Job icon in the toolbar, then Analyze.');
    }, { mod: 'admin', onError: (d) => ui.toast(`${d.message} (${d.code})`) })();
  }

  // ---- Status + settings --------------------------------------------------------------------------------
  async function renderStatus() {
    const st = await AJP.send('radar.status');
    if (!st || st.ok === false) return;
    const s = st.lastSummary;
    $('#radarStop').hidden = !st.running;
    $('#radarRestartBox').hidden = !st.prefsChangedAt || st.running;
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
    f.relatedTitles.checked = s.relatedTitles !== false;
    f.nearTitles.checked = s.nearTitles !== false;
    f.skipTitles.value = (s.skipTitles || []).join('; ');
    // Which related titles your target titles bring in (Career tracks → titles).
    const profile = await AJP.store.get('profile');
    const mine = AJP.tracks.list(profile).flatMap((t) => (t.targetTitles && t.targetTitles.length ? t.targetTitles : profile.targetRoles || []));
    const rel = AJP.radar.core.relatedTitles(mine);
    $('#radarRelated').textContent = !mine.length ? 'Add target titles to your career tracks to choose which jobs Job Radar keeps.' : s.relatedTitles === false ? 'Related titles are off: only your own target titles are used.' : rel.length ? `Related titles also used: ${rel.join(', ')}.` : 'No built-in related titles for your target titles: add other names for the role to your career tracks.';
  }
  async function saveSettings() {
    const f = $('#radarSettings');
    const r = await AJP.send('radar.settings.save', { settings: { enabled: f.enabled.checked, directory: f.directory.checked, intervalHours: Number(f.intervalHours.value), threshold: Number(f.threshold.value), locations: f.locations.value, remote: f.remote.value, minSalary: f.minSalary.value.replace(/[^\d]/g, ''), notify: f.notify.value, relatedTitles: f.relatedTitles.checked, nearTitles: f.nearTitles.checked, skipTitles: f.skipTitles.value } });
    if (r && r.ok === false) return ui.toast(fail(r));
    await renderSettings();
    renderStatus();
    ui.toast('Job Radar settings saved');
  }

  // ---- New jobs -----------------------------------------------------------------------------------------
  const FRESH = { today: ['fresh', 'Posted today'], week: ['week', 'This week'] };
  let sort = 'match';
  let page = 0;
  const PER_PAGE = 25;
  let tab = 'matched';
  let fReason = 'all';
  let fSort = 'newest';
  let fPage = 0;
  let tracksById = {};
  function card(j, thr) {
    const el = j.eligibility || { status: 'ok', reasons: [], flags: {} };
    const fr = FRESH[AJP.radar.core.freshness(j)];
    const track = tracksById[j.bestTrackId];
    const skills = j.score != null && j.skillsTotal ? `${j.skillsMatched} of ${j.skillsTotal} skills` : j.score == null ? 'no description yet: scored when it arrives' : '';
    const yrs = j.yearsAsked != null && !AJP.radar.core.isLeadershipYears(j.yearsQuote) ? `asks ${j.yearsAsked}+ yrs` : '';
    const lead = j.yearsLeading ? `${j.yearsLeading}+ yrs leading` : '';
    const meta = [skills, [yrs, lead].filter(Boolean).join(' · '), esc(j.companyName), esc((j.allLocations || j.locations).slice(0, 4).join(' · ')), REMOTE[j.remote] || '', money(j.salary), j.postedAt ? `posted ${ago(j.postedAt)}${j.postedAtExact === false ? ' (about)' : ''}` : ''].filter(Boolean).join(' · ');
    const tags = [
      fr ? `<span class="pill ${fr[0]}">${fr[1]}</span>` : '',
      track && !track.implicit ? `<span class="pill" title="The career track this job fits best">${esc(track.name)} track</span>` : '',
      j.descriptionLevel === 'title' ? '<span class="pill warn" title="This board gives no job description: the match uses the title only">title match only</span>' : '',
      el.flags && el.flags.sponsors ? '<span class="pill good">Sponsors visas</span>' : '',
      el.status === 'check' ? `<span class="pill warn" title="${esc(el.reasons.join('; '))}">Check: ${esc(el.reasons[0])}</span>` : '',
      j.remoteNote ? `<span class="pill warn" title="Remote: confirm you can work from where you live">${esc(j.remoteNote)}</span>` : '',
      j.titleMatch === 'related' ? '<span class="pill" title="Its title is another name for a title you look for">Related title</span>' : '',
      j.titleMatch === 'near' ? '<span class="pill warn" title="A different title, kept because the description strongly matches your skills">Other title, your skills</span>' : '',
      j.override ? '<span class="pill" title="You moved this job back from Filtered">Moved by you</span>' : '',
    ].filter(Boolean).join(' ');
    return `<div class="radar-job ${el.status === 'blocked' ? 'blocked' : ''}" data-key="${esc(j.key)}" data-keys="${esc((j.keys || [j.key]).join(' '))}">
      <span class="pill ${j.score != null && j.score >= thr ? 'good' : ''}" title="${j.score == null ? 'No job description to score: open it to judge' : `Best fit: ${esc(track ? track.name : 'your profile')}`}">${j.score == null ? '–' : j.score + '%'}</span>
      <div class="radar-main"><a href="${esc(AJP.safeUrl(j.url))}" target="_blank" rel="noopener"><b>${esc(j.title)}</b></a> ${tags}
        <div class="hint">${meta}</div>${el.status === 'blocked' ? `<div class="hint warn">⚠ ${esc(el.reasons.join('; '))}</div>` : ''}</div>
      <div class="radar-act">${j.status !== 'saved' ? '<button data-act="saved">Save to Applications</button>' : '<span class="hint">Saved</span>'}${j.status !== 'dismissed' ? '<button data-act="dismissed">Dismiss</button>' : '<button data-act="new">Restore</button>'}<button data-act="hide" title="Never show jobs from ${esc(j.companyName)} again">Hide company</button></div>
    </div>`;
  }
  // A job left out: what it is, why, and a way to bring it back.
  function filteredCard(j) {
    const label = AJP.radar.core.FILTER_REASONS[j.reason] || j.reason;
    const meta = [esc(j.companyName), esc((j.locations || []).slice(0, 4).join(' · ')), REMOTE[j.remote] || '', money(j.salary), j.postedAt ? `posted ${ago(j.postedAt)}` : ''].filter(Boolean).join(' · ');
    return `<div class="radar-job" data-fkey="${esc(j.key)}">
      <span class="pill">${j.score == null ? '–' : j.score + '%'}</span>
      <div class="radar-main"><a href="${esc(AJP.safeUrl(j.url))}" target="_blank" rel="noopener"><b>${esc(j.title)}</b></a> <span class="pill warn">${esc(label)}</span>
        <div class="hint">${meta}</div>${j.detail ? `<div class="hint warn">${esc(j.detail)}</div>` : ''}</div>
      <div class="radar-act"><button data-restore>Move to Matched</button></div>
    </div>`;
  }
  async function renderFiltered() {
    let r = await AJP.send('radar.filtered', { reason: fReason, sort: fSort, offset: fPage * PER_PAGE, limit: PER_PAGE });
    if (!r || r.ok === false) return void ($('#radarFilteredJobs').textContent = r ? fail(r) : '');
    const pages = Math.max(1, Math.ceil(r.total / PER_PAGE));
    if (fPage > pages - 1) {
      fPage = pages - 1;
      r = await AJP.send('radar.filtered', { reason: fReason, sort: fSort, offset: fPage * PER_PAGE, limit: PER_PAGE });
      if (!r || r.ok === false) return;
    }
    $('#radarFilteredN').textContent = `(${r.all})`;
    const names = AJP.radar.core.FILTER_REASONS;
    $('#radarReason').innerHTML = `<option value="all">All reasons (${r.all})</option>` + Object.keys(names).filter((k) => r.counts[k] || k === fReason).map((k) => `<option value="${k}">${esc(names[k])} (${r.counts[k] || 0})</option>`).join('');
    $('#radarReason').value = fReason;
    if (tab !== 'filtered') return;
    const pager = r.total > PER_PAGE ? `<div class="row radar-pager"><button data-fpage="-1" ${fPage ? '' : 'disabled'}>‹ Previous</button><span class="hint">${fPage * PER_PAGE + 1}–${fPage * PER_PAGE + r.jobs.length} of ${r.total}</span><button data-fpage="1" ${fPage < pages - 1 ? '' : 'disabled'}>Next ›</button></div>` : '';
    $('#radarFilteredJobs').innerHTML = r.jobs.length ? r.jobs.map(filteredCard).join('') + pager : '<p class="hint">Nothing filtered yet. Jobs a scan leaves out appear here with the reason. Click Restart search to check every company again.</p>';
  }
  function showTab(next) {
    tab = next;
    const f = tab === 'filtered';
    $$('#radarTabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $('#radarMatchedBar').hidden = f;
    $('#radarJobs').hidden = f;
    $('#radarFilteredBar').hidden = !f;
    $('#radarFilteredJobs').hidden = !f;
    return renderFiltered();
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
  let cachedResumes = null;
  async function renderJobs() {
    const profile = await AJP.store.get('profile');
    cachedResumes = await AJP.store.get('resumes');
    tracksById = Object.fromEntries(AJP.tracks.list(profile).map((t) => [t.id, t]));
    renderTracks(profile);
    const r = await AJP.send('radar.jobs', { status: filter, sort, limit: 1000 });
    const box = $('#radarJobs');
    if (!r || r.ok === false) return void (box.textContent = r ? fail(r) : '');
    const thr = Number($('#radarSettings').threshold.value) || 60;
    const isBlocked = (j) => j.eligibility && j.eligibility.status === 'blocked';
    // The same job posted once per location (e.g. "Remote US" and "Remote Canada"): one card, every location.
    const groups = new Map();
    for (const j of r.jobs) {
      const k = `${j.board}:${j.company}:${AJP.normKey(j.title)}`;
      const g = groups.get(k);
      if (g) {
        g.keys.push(j.key);
        g.allLocations = [...new Set([...g.allLocations, ...j.locations])];
      } else groups.set(k, { ...j, keys: [j.key], allLocations: [...j.locations] });
    }
    r.jobs = [...groups.values()];
    const ok = r.jobs.filter((j) => !isBlocked(j));
    const pages = Math.max(1, Math.ceil(ok.length / PER_PAGE));
    page = Math.min(page, pages - 1);
    const shown = ok.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
    $('#radarMatchedN').textContent = `(${ok.length})`;
    const pager = ok.length > PER_PAGE ? `<div class="row radar-pager"><button data-page="-1" ${page ? '' : 'disabled'}>‹ Previous</button><span class="hint">${page * PER_PAGE + 1}–${page * PER_PAGE + shown.length} of ${ok.length}</span><button data-page="1" ${page < pages - 1 ? '' : 'disabled'}>Next ›</button></div>` : '';
    box.innerHTML =
      (ok.length ? shown.map((j) => card(j, thr)).join('') + pager : `<p class="hint">${filter === 'new' ? 'No new jobs yet. The built-in directory and your companies are checked every few hours; jobs that fit your tracks appear here (or click Scan now).' : 'Nothing here.'}</p>`);
    await renderFiltered();
  }
  // What Job Radar looks for: your career tracks (up to 3), each with its titles and places.
  function renderTracks(profile) {
    const box = $('#radarTracks');
    if (!box) return;
    const list = AJP.tracks.list(profile);
    const titles = (t) => (t.targetTitles && t.targetTitles.length ? t.targetTitles : profile.targetRoles || []);
    const places = (t) => (t.areas && t.areas.length ? t.areas : profile.areas || []);
    const any = list.some((t) => titles(t).length);
    const yrs = AJP.radar.core.userYears(profile, cachedResumes);
    const band = yrs == null ? '' : yrs >= 8 ? 'Senior to Principal' : yrs >= 5 ? 'Mid to Lead' : yrs >= 2 ? 'Junior to Senior' : 'Intern to Mid';
    const mgmt = list.some((t) => (t.targetTitles || []).some((x) => { const l = AJP.experience && AJP.experience.fromTitle(x); return l && ['manager', 'director', 'executive'].includes(l.id); }));
    const levels = yrs == null ? ' Add your total years in Profile to match job levels to your experience.' : ` Levels: <b>${band}</b> (your ${Math.round(yrs)} years; jobs asking for far more, or junior roles, are left out)${mgmt ? '' : '; manager roles only with a management track'}.`;
    box.innerHTML = any
      ? `Looking for: ${list.map((t) => `<b>${esc(t.implicit ? 'your target roles' : t.name)}</b> (${esc(titles(t).slice(0, 4).join(', ') || 'any title')}${places(t).length ? ' · ' + esc(places(t).slice(0, 3).join('; ')) : ''})`).join(' · ')}. <a href="#tracks">Edit career tracks</a>`
      : '⚠ Add target roles in <a href="#prefs">Job preferences</a> (or titles in <a href="#tracks">Career tracks</a>) so Job Radar keeps only jobs that fit you.';
    if (any) box.innerHTML = box.innerHTML.replace(/<a href="#tracks">Edit career tracks<\/a>$/, `${levels} <a href="#tracks">Edit career tracks</a>`);
  }

  async function jobAction(key, status, keys = [key]) {
    if (status === 'hide') {
      const [board, company] = key.split(':');
      if (!confirm('Hide this company? Its jobs disappear and it won’t be checked again (you can add it back as a company you watch).')) return;
      await AJP.send('radar.company.hide', { board, company });
      ui.toast('Company hidden');
      renderDirectory();
      return renderJobs();
    }
    let r = null;
    for (const k of status === 'saved' ? [key] : keys) {
      r = await AJP.send('radar.job.update', { key: k, status });
      if (r && r.ok === false) return ui.toast(fail(r));
    }
    if (status === 'saved') for (const k of keys.slice(1)) await AJP.send('radar.job.update', { key: k, status: 'dismissed' }); // the other locations of the same job
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
    $('#radarFilter').addEventListener('change', (e) => ((filter = e.target.value), (page = 0), renderJobs()));
    $('#radarSort').addEventListener('change', (e) => ((sort = e.target.value), (page = 0), renderJobs()));
    $('#radarJobs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (!b) return;
      page += Number(b.dataset.page);
      renderJobs().then(() => $('#radarJobs').scrollIntoView({ block: 'start' }));
    });
    $('#radarJobs').addEventListener('click', openJob);
    $('#radarFilteredJobs').addEventListener('click', openJob);
    $('#radarTabs').addEventListener('click', g('tab', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) return showTab(b.dataset.tab);
    }));
    $('#radarReason').addEventListener('change', g('reason', (e) => ((fReason = e.target.value), (fPage = 0), renderFiltered())));
    $('#radarFilteredSort').addEventListener('change', g('filteredSort', (e) => ((fSort = e.target.value), (fPage = 0), renderFiltered())));
    $('#radarFilteredJobs').addEventListener('click', g('filteredAction', async (e) => {
      const p = e.target.closest('[data-fpage]');
      if (p) {
        fPage += Number(p.dataset.fpage);
        await renderFiltered();
        return $('#radarTabs').scrollIntoView({ block: 'start' });
      }
      const b = e.target.closest('[data-restore]');
      if (!b) return;
      const r = await AJP.send('radar.filtered.restore', { key: b.closest('[data-fkey]').dataset.fkey });
      if (r && r.ok === false) return ui.toast(fail(r));
      ui.toast('Moved to Matched');
      await renderJobs();
    }));
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
      if (b) {
        const el = b.closest('[data-key]');
        return jobAction(el.dataset.key, b.dataset.act, (el.dataset.keys || el.dataset.key).split(' '));
      }
    }));
    $('#radarStop').addEventListener('click', g('stop', async () => {
      const r = await AJP.send('radar.stop');
      ui.toast(r && r.stopped !== false ? 'Scan stopped' : 'Stopping… the scan ends after the request in flight');
      renderStatus();
    }));
    $('#radarRestart').addEventListener('click', g('restart', async () => {
      const r = await AJP.send('radar.restart');
      if (r && r.ok === false) return ui.toast(fail(r));
      ui.toast(`Restarted with your current preferences${r.removed ? `: ${r.removed} job${r.removed === 1 ? '' : 's'} moved to Filtered` : ''}`);
      renderJobs();
      renderStatus();
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
