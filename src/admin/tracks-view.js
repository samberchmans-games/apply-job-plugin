/*
 * tracks-view.js — Admin → Career tracks: set up to 3 directions (e.g. "AWS Cloud Architect" + "Java Architect"),
 * see insights per track, and compare recent jobs across tracks.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  const T = AJP.tracks;
  const log = AJP.logger('tracks-view');
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const csv = (arr) => (arr || []).map((x) => (typeof x === 'string' ? x : x.name)).join(', ');
  const split = (s) => String(s || '').split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);

  let ui = { toast() {} };
  let tracks = [];

  const save = AJP.debounce(async () => {
    const norm = T.normalize(tracks);
    await AJP.store.update('profile', (p) => void (p.tracks = norm));
    ui.toast('Saved');
    renderInsights();
  }, 450);

  let defaults = { targetRoles: [], areas: [], salary: {}, workTypes: {} };
  const wtText = (w) => ['remote', 'hybrid', 'onsite'].filter((k) => w && w[k]).map((k) => (k === 'onsite' ? 'On-site' : k[0].toUpperCase() + k.slice(1))).join(', ') || 'any';
  function card(t, i, resumes) {
    return `<div class="card track" data-i="${i}">
      <div class="grid">
        <label>Track name<input data-k="name" value="${esc(t.name)}" placeholder="e.g. AWS Cloud Architect"></label>
        <label class="wide">Target job titles (comma-separated)<input data-k="targetTitles" value="${esc(csv(t.targetTitles))}" placeholder="Cloud Architect, Solutions Architect AWS"></label>
        <label class="wide">Track skills, added to your core skills (comma-separated)<input data-k="skills" value="${esc(csv(t.skills))}" placeholder="AWS, Terraform, Kubernetes"></label>
        <label>Resume for this track<select data-k="resumeId"><option value="">Active resume</option>${resumes.items.map((r) => `<option value="${esc(r.id)}" ${r.id === t.resumeId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
        <label>Min salary (blank = default)<input type="number" data-k="salary.min" value="${esc((t.salary && t.salary.min) || '')}" placeholder="${esc(defaults.salary.min || '')}"></label>
        <label>Max salary (blank = default)<input type="number" data-k="salary.max" value="${esc((t.salary && t.salary.max) || '')}" placeholder="${esc(defaults.salary.max || '')}"></label>
        <label class="wide">Locations for this track (separate with ;; blank = your defaults: ${esc(defaults.areas.join('; ') || 'none set')})<input data-k="areas" value="${esc((t.areas || []).join('; '))}" placeholder="${esc(defaults.areas.join('; ') || 'e.g. Austin, TX; Remote - US')}"></label>
      </div>
      <div class="row">
        <span class="hint">Work type (none ticked = default: ${esc(wtText(defaults.workTypes))}):</span>
        ${['remote', 'hybrid', 'onsite'].map((w) => `<label class="check"><input type="checkbox" data-k="workTypes.${w}" ${t.workTypes && t.workTypes[w] ? 'checked' : ''}> ${w === 'onsite' ? 'On-site' : w[0].toUpperCase() + w.slice(1)}</label>`).join('')}
        <button class="small danger" data-del="${i}" style="margin-left:auto">Delete track</button>
      </div>
      <div class="insights" data-ins="${esc(t.id)}"></div>
    </div>`;
  }

  async function render() {
    const [profile, resumes] = await Promise.all([AJP.store.get('profile'), AJP.store.get('resumes')]);
    tracks = AJP.clone(profile.tracks || []);
    defaults = { targetRoles: profile.targetRoles || [], areas: profile.areas || [], salary: profile.salary || {}, workTypes: profile.workTypes || {} };
    $('#trackCards').innerHTML = tracks.length
      ? tracks.map((t, i) => card(t, i, resumes)).join('')
      : '<p class="hint">No tracks yet: every job is scored against your whole profile (“General”). Add tracks if you are looking in more than one direction.</p>';
    $('#trackAdd').disabled = tracks.length >= T.MAX_TRACKS;
    $('#trackAdd').textContent = tracks.length >= T.MAX_TRACKS ? `Maximum ${T.MAX_TRACKS} tracks` : '+ Add track';
    await renderInsights();
  }

  async function renderInsights() {
    const [evaluations, applications] = await Promise.all([AJP.store.get('evaluations'), AJP.store.get('applications')]);
    for (const t of T.normalize(tracks)) {
      const box = document.querySelector(`[data-ins="${CSS.escape(t.id)}"]`);
      if (!box) continue;
      const s = T.insights(t.id, { evaluations, applications });
      box.innerHTML = `<div class="stats small">
          <div class="tile"><b>${s.evaluated}</b><span>Jobs evaluated</span></div>
          <div class="tile"><b>${s.avgScore == null ? '—' : s.avgScore + '%'}</b><span>Average match</span></div>
          <div class="tile"><b>${s.bestFor}</b><span>Best track for</span></div>
          <div class="tile"><b>${s.applied}</b><span>Applied</span></div>
          <div class="tile"><b>${s.interviews}</b><span>Interviews</span></div>
        </div>
        <div class="hint">Most frequent gaps (what to learn next): ${s.topGaps.length ? s.topGaps.map((g) => `<span class="pill">${esc(g.skill)} · ${g.pct}%</span>`).join(' ') : 'none yet — analyze a few jobs'}</div>`;
    }
    // Compare: recent jobs × tracks
    const list = T.normalize(tracks);
    const recent = evaluations.slice(0, 15);
    $('#trackCompare').innerHTML = list.length < 2 || !recent.length
      ? '<p class="hint">Add at least two tracks and open a few job posts to compare them here.</p>'
      : `<table class="tbl"><thead><tr><th>Job</th>${list.map((t) => `<th>${esc(t.name)}</th>`).join('')}<th>Seen</th></tr></thead><tbody>${recent
          .map((e) => `<tr><td><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title || e.url)}</a>${e.company ? ' · ' + esc(e.company) : ''}</td>${list
            .map((t) => {
              const v = e.scores ? e.scores[t.id] : null;
              return `<td class="${e.bestTrackId === t.id ? 'best' : ''}">${v == null ? '—' : v + '%'}${e.bestTrackId === t.id ? ' ★' : ''}</td>`;
            })
            .join('')}<td class="hint">${new Date(e.at).toLocaleDateString()}</td></tr>`)
          .join('')}</tbody></table>`;
  }

  function init(opts) {
    ui = { ...ui, ...opts };
    $('#trackAdd').addEventListener('click', async () => {
      if (tracks.length >= T.MAX_TRACKS) return;
      tracks.push({ id: AJP.uid('trk'), name: `Track ${tracks.length + 1}`, targetTitles: [], skills: [], resumeId: null });
      await AJP.store.update('profile', (p) => void (p.tracks = T.normalize(tracks)));
      log.info('Track added', { count: tracks.length });
      render();
    });
    $('#trackCards').addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      const card = e.target.closest('[data-i]');
      if (!k || !card) return;
      const t = tracks[+card.dataset.i];
      if (k === 'targetTitles' || k === 'skills') t[k] = split(e.target.value);
      else if (k === 'areas') t.areas = e.target.value.split(/;+/).map((x) => x.trim()).filter(Boolean);
      else if (k.startsWith('salary.')) t.salary = { ...(t.salary || {}), [k.slice(7)]: e.target.value };
      else if (k.startsWith('workTypes.')) t.workTypes = { ...(t.workTypes || {}), [k.slice(10)]: e.target.checked };
      else t[k] = e.target.value || (k === 'resumeId' ? null : '');
      save();
    });
    $('#trackCards').addEventListener('change', (e) => e.target.matches('select, input[type=checkbox]') && e.target.dispatchEvent(new Event('input', { bubbles: true })));
    $('#trackCards').addEventListener('click', async (e) => {
      const i = e.target.dataset.del;
      if (i == null || !confirm('Delete this track? Applications keep their track name.')) return;
      tracks.splice(+i, 1);
      await AJP.store.update('profile', (p) => void (p.tracks = T.normalize(tracks)));
      render();
    });
  }

  AJP.tracksView = { init, render };
})();
