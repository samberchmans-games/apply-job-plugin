/*
 * enhance-view.js — Admin → Resumes: review resume-enhancement drafts and create the tailored resume.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  const E = AJP.resumeEngine;
  const log = AJP.logger('enhance-view');
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PRI = { must: 'Must', should: 'Should', nice: 'Nice' };
  const MATCH = { strong: '✅ Strong', partial: '🟡 Partial', none: '❌ Not in resume' };

  let ui = { toast() {}, onCreated() {} };
  let current = null; // draft being reviewed
  let state = {}; // editId -> { accepted, after, edited }
  let picks = []; // skills the user ticked, in tick order: [{ skill, role, manual }]
  const lim = () => current.limits || E.DEFAULT_LIMITS;
  const isRewrite = (e) => e.kind !== 'skills' && e.source !== 'skill';
  const rewritesOn = () => current.edits.filter((e) => isRewrite(e) && state[e.id].accepted && !state[e.id].blocked).length;

  // Resume-only match % if these skills were shown on the resume (what a recruiter / ATS reads).
  function projected(skills) {
    const a = AJP.matcher.analyze({ jdText: current.jd, profile: { skills: skills.map((name) => ({ name })) }, resumeText: vctx().resumeText });
    return a.score == null ? null : a.score;
  }
  // Default places: spread across jobs (2 : 1 current : previous …) unless the user chose one.
  function placeDefaults() {
    const roles = current.roles || [];
    picks.filter((p) => !p.manual).forEach((p) => {
      const i = picks.indexOf(p);
      p.role = roles.length ? roles[E.placeSkill(i, roles.length)].key : '';
    });
  }

  function skillsSection() {
    const d = current;
    const opts = d.skillOptions || [];
    if (!opts.length) return '';
    const roles = d.roles || [];
    const before = d.resumeScore;
    const now = projected(picks.map((p) => p.skill));
    const L = lim();
    const row = (o) => {
      const p = picks.find((x) => x.skill === o.skill);
      const wouldBe = p ? null : projected(picks.map((x) => x.skill).concat(o.skill));
      const overLift = !p && wouldBe != null && wouldBe > E.liftCeiling(d, L);
      const overCount = !p && picks.length >= L.maxSkills;
      const off = overCount; // the skills count is the hard limit; going past the ceiling is a warning
      const why = overCount ? `Limit: ${L.maxSkills} skills` : overLift ? `Careful: above ${E.liftCeiling(d, L)}% (your match + ${L.maxLift}) can look like keyword stuffing. Tick only what you really did.` : '';
      const place = !p ? '' : roles.length > 1
        ? `→ <select data-skill-role="${esc(o.skill)}">${roles.map((r) => `<option value="${esc(r.key)}" ${r.key === p.role ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>`
        : roles.length ? `→ <span class="hint">${esc(roles[0].label)}</span>` : '';
      return `<div class="skill-pick ${off ? 'off' : ''}" data-skill-row="${esc(o.skill)}">
        <label class="check" title="${esc(why)}"><input type="checkbox" data-skill="${esc(o.skill)}" ${p ? 'checked' : ''} ${off ? 'disabled' : ''}> <b>${esc(o.skill)}</b></label>
        <span class="pill">${o.importance === 'required' ? 'Required' : o.importance === 'preferred' ? 'Nice to have' : 'Mentioned'}</span>
        ${o.inProfile ? '<span class="hint">in your profile</span>' : ''} ${place} ${why ? `<span class="hint">${esc(why)}</span>` : ''}</div>`;
    };
    return `<h3>Skills the job asks for that your resume doesn't show</h3>
      <p class="hint">Tick <b>only skills you really have</b>, and choose the job where you used each one${roles.length > 1 ? ' (spread across jobs by default, most in your current one)' : ''}. Each goes into one line of that job and into your Skills list.</p>
      <div class="lift ${now != null && now > E.liftCeiling(d, L) ? 'over' : ''}"><b>Resume match ${before == null ? '—' : before + '%'} → <span id="enhLift">${now == null ? '—' : now + '%'}</span></b>${now != null && now > E.liftCeiling(d, L) ? ' <span class="pill warn">above your match + ' + L.maxLift + '</span>' : ''}
        <span class="hint">(${d.matchScore != null ? `your match ${esc(d.matchScore)}%, ` : ''}limit ${E.liftCeiling(d, L)}% and ${L.maxSkills} skills: a light touch keeps it yours)</span></div>
      ${opts.map(row).join('')}
      <div class="row"><button id="enhAddSkills" ${picks.length ? '' : 'disabled'}>Add ${picks.length || ''} selected skill${picks.length === 1 ? '' : 's'} to the draft</button>
      ${(d.confirmedSkills || []).length ? `<span class="hint">In the draft: ${esc(d.confirmedSkills.join(', '))}</span>` : ''}</div>`;
  }

  async function renderList() {
    const drafts = await AJP.store.get('enhancements');
    const box = $('#enhList');
    if (!drafts.length) {
      box.innerHTML = '<p class="hint">No tailoring drafts yet. On a job page, open the panel and click <b>📝 Tailor resume</b>.</p>';
      return;
    }
    box.innerHTML = `<h3>Tailoring drafts</h3>` + drafts
      .map((d) => `<div class="res enh" data-enh="${esc(d.id)}">
        📝 <b>${esc((d.job && d.job.title) || 'Job')}</b>${d.job && d.job.company ? ' · ' + esc(d.job.company) : ''}
        <span class="hint">· ${d.stats.edits - d.stats.blocked} edits · ${d.stats.strong}/${d.stats.requirements} requirements strong</span>
        ${d.appliedResumeId ? '<span class="tag">created</span>' : ''}
        <small>${new Date(d.createdAt).toLocaleString()}</small>
        <button class="small" data-enh-open="${esc(d.id)}">Review</button>
        <button class="small danger" data-enh-del="${esc(d.id)}">✕</button></div>`)
      .join('');
  }

  function vctx() {
    return current.__vctx;
  }

  function editCard(e) {
    const st = state[e.id];
    const label = e.source === 'skill' ? `Skill · ${esc(e.skill)} → ${esc(e.role)}` : e.kind === 'summary' ? 'Summary' : e.kind === 'skills' ? 'Skills order' : `Bullet${e.role ? ' · ' + esc(e.role) : ''}`;
    const atLimit = isRewrite(e) && !st.accepted && rewritesOn() >= lim().maxEdits;
    const reqs = e.requirementIds.map((id) => {
      const r = current.requirements.find((x) => x.id === id);
      return r ? `<span class="pill" title="${esc(r.jdQuote || r.text)}">${esc(id)} · ${esc(r.text.slice(0, 40))}</span>` : '';
    }).join(' ');
    const live = st.edited ? E.validateEdit({ target: e.target, after: st.after, evidence: e.evidence, userEdited: true }, vctx()) : null;
    const blocked = live ? !live.ok : !e.ok;
    const viol = (live ? live.violations : e.violations).map((v) => `<li>${esc(v.message)}${v.detail ? `: <b>${esc(v.detail)}</b>` : ''}</li>`).join('');
    const warns = (live || e).warnings.filter((w) => w.code !== 'NEEDS_METRIC').map((w) => `<span class="pill warn">${esc(w.message)}</span>`).join(' ');
    const metric = (live || e).needsMetric
      ? `<div class="metric">💡 No measurable result here. If you have a <b>real</b> number (time saved, % fewer failures, users, cost), add it in the box above. Never use the job's numbers.</div>`
      : '';
    return `<div class="edit ${blocked ? 'blocked' : ''}" data-edit="${e.id}">
      <div class="edit-head">
        <label class="check" title="${atLimit ? `Limit: ${lim().maxEdits} changes. Untick another one first.` : ''}"><input type="checkbox" data-accept="${e.id}" ${st.accepted && !blocked ? 'checked' : ''} ${blocked || atLimit ? 'disabled' : ''}> <b>${label}</b></label>
        ${reqs} ${e.limited ? '<span class="pill">extra idea</span>' : ''} ${atLimit ? `<span class="hint">limit of ${lim().maxEdits} changes reached</span>` : ''}
      </div>
      ${e.before ? `<div class="before"><span class="hint">Before</span> ${esc(e.before)}</div>` : '<div class="before hint">Before: (none)</div>'}
      <div class="after"><span class="hint">After${st.edited ? ' (edited by you)' : ''}</span>
        <textarea rows="${e.kind === 'summary' ? 3 : 2}" data-after="${e.id}">${esc(st.after)}</textarea></div>
      ${e.reason ? `<div class="hint">Why: ${esc(e.reason)}</div>` : ''}
      ${e.source === 'skill' && e.wording === 'simple' ? '<div class="hint">✏️ Simple wording: edit it to say how you used it.</div>' : ''}
      ${blocked ? `<div class="viol">⛔ ${st.edited ? 'Your text' : 'Blocked by safety checks'}:<ul>${viol}</ul>${st.edited ? '' : '<span class="hint">You can rewrite it yourself in the box above — only write what is true.</span>'}</div>` : ''}
      ${warns ? `<div>${warns}</div>` : ''}
      ${metric}
    </div>`;
  }

  function render() {
    const d = current;
    const dlg = $('#enhDialog');
    const n = Object.values(state).filter((s) => s.accepted && !s.blocked).length;
    const cov = d.coverage;
    dlg.innerHTML = `
      <h2 style="margin-top:0">Tailor resume: ${esc((d.job && d.job.title) || 'Job')}${d.job && d.job.company ? ' · ' + esc(d.job.company) : ''}${d.trackName ? ` <span class="pill">🧭 ${esc(d.trackName)}</span>` : ''}</h2>
      <p class="hint">Based on “${esc(d.resumeName)}” · ${new Date(d.createdAt).toLocaleString()}${d.ai ? ` · tailored with <b>${esc(d.ai.label)}</b>` : ''}. Nothing changes until you click <b>Create tailored resume</b>; your original stays as it is.</p>
      ${d.matchScore != null ? `<p class="hint">Your match for this job: <b>${esc(d.matchScore)}%</b>. Tailoring adds a little; it doesn't turn a different job into a fit.</p>` : ''}
      <div class="stats">
        <div class="tile"><b>${d.stats.requirements}</b><span>Job requirements</span></div>
        <div class="tile"><b>${d.stats.strong} / ${d.stats.partial} / ${d.stats.none}</b><span>Strong / partial / gaps</span></div>
        <div class="tile"><b>${cov.evidence == null ? '—' : cov.evidence + '%'}</b><span>Backed by your resume</span></div>
        <div class="tile"><b>${cov.atsBefore == null ? '—' : `${cov.atsBefore}% → ${cov.atsAfter}%`}</b><span>Job keywords present</span></div>
      </div>

      <h3>What the job asks for, and your evidence</h3>
      <table class="tbl reqs"><thead><tr><th>Priority</th><th>Requirement</th><th>Your evidence (from your resume)</th><th>Match</th></tr></thead><tbody>
      ${d.requirements.map((r) => `<tr><td>${PRI[r.priority] || r.priority}</td><td title="${esc(r.jdQuote)}">${esc(r.text)}</td>
        <td>${r.evidence.map((x) => `<q>${esc(x.quote)}</q>`).join('<br>') || '<span class="hint">—</span>'}</td><td>${MATCH[r.match]}</td></tr>`).join('')}
      </tbody></table>

      ${skillsSection()}

      <h3>Suggested changes (${d.edits.length})</h3>
      <p class="hint">Each change only re-words what you actually did and must point to your own resume text. Numbers from the job description are never copied. Changes that break a rule are blocked.
        <b>At most ${lim().maxEdits} changes</b> (${rewritesOn()} selected): a light touch for a close match, not a rewrite.</p>
      ${d.edits.map(editCard).join('') || '<p class="hint">No changes suggested.</p>'}

      <h3>Gaps — not added to your resume</h3>
      ${d.gaps.length ? `<ul class="gaps-list">${d.gaps.map((g) => `<li><b>${esc(g.text)}</b> (${PRI[g.priority] || g.priority})${g.advice ? ' — ' + esc(g.advice) : ''}</li>`).join('')}</ul>` : '<p class="hint">None 🎉</p>'}

      <div class="row" style="justify-content:flex-end">
        <label class="check"><input type="checkbox" id="enhActive"> ${d.trackName ? `Use it as the “${esc(d.trackName)}” track's resume` : 'Make it my active resume'}</label>
        <button id="enhDiscard" class="danger">Discard draft</button>
        <button id="enhClose">Close</button>
        <button id="enhCreate" class="primary" ${n ? '' : 'disabled'}>Create tailored resume (${n} change${n === 1 ? '' : 's'})</button>
      </div>
      <div id="enhOut" class="hint"></div>`;
  }

  async function open(id) {
    const drafts = await AJP.store.get('enhancements');
    const d = drafts.find((x) => x.id === id);
    if (!d) return ui.toast('That draft no longer exists');
    const resumes = await AJP.store.get('resumes');
    const profile = await AJP.store.get('profile');
    const base = resumes.items.find((r) => r.id === d.resumeId);
    const doc = E.parse((base && base.text) || '');
    current = d;
    current.__vctx = { doc, resumeText: (base && base.text) || '', jdText: d.jd, allowedSkills: E.allowedSkills(doc, (base && base.text) || '', profile.skills) };
    state = {};
    for (const e of d.edits) state[e.id] = { accepted: e.accepted, after: e.after, edited: false, blocked: !e.ok };
    picks = (d.skillPicks || []).map((p) => ({ skill: p.skill, role: p.role, manual: true }));
    render();
    if (!$('#enhDialog').open) $('#enhDialog').showModal();
    log.info('Enhancement review opened', { edits: d.edits.length, blocked: d.stats.blocked });
  }

  function init(opts) {
    ui = { ...ui, ...opts };
    const dlg = $('#enhDialog');
    $('#enhList').addEventListener('click', async (e) => {
      const openId = e.target.dataset.enhOpen || (e.target.closest('[data-enh]') && !e.target.dataset.enhDel && e.target.closest('[data-enh]').dataset.enh);
      if (e.target.dataset.enhDel) {
        if (!confirm('Delete this draft?')) return;
        await AJP.store.update('enhancements', (l) => l.filter((x) => x.id !== e.target.dataset.enhDel));
        return renderList();
      }
      if (openId) open(openId);
    });
    dlg.addEventListener('input', (e) => {
      const id = e.target.dataset.after;
      if (!id) return;
      const ed = current.edits.find((x) => x.id === id);
      const st = state[id];
      st.after = e.target.value;
      st.edited = st.after !== ed.after;
      const v = st.edited ? E.validateEdit({ target: ed.target, after: st.after, evidence: ed.evidence, userEdited: true }, vctx()) : { ok: ed.ok };
      st.blocked = !v.ok;
      if (st.edited && v.ok) st.accepted = true;
      clearTimeout(st.t);
      st.t = setTimeout(() => {
        const pos = e.target.selectionStart;
        render();
        const ta = dlg.querySelector(`[data-after="${id}"]`);
        if (ta) {
          ta.focus();
          ta.setSelectionRange(pos, pos);
        }
      }, 500);
    });
    dlg.addEventListener('change', (e) => {
      const sk = e.target.dataset.skill;
      if (sk) {
        if (e.target.checked) picks.push({ skill: sk, role: '', manual: false });
        else picks = picks.filter((p) => p.skill !== sk);
        placeDefaults();
        return render();
      }
      const roleOf = e.target.dataset.skillRole;
      if (roleOf) {
        const p = picks.find((x) => x.skill === roleOf);
        if (p) Object.assign(p, { role: e.target.value, manual: true });
        return render();
      }
      const id = e.target.dataset.accept;
      if (!id) return;
      state[id].accepted = e.target.checked;
      render();
    });
    dlg.addEventListener('click', async (e) => {
      if (e.target.id === 'enhClose') dlg.close();
      if (e.target.id === 'enhDownload') {
        const all = await AJP.store.get('resumes');
        const r = all.items.find((x) => x.id === current.__created);
        if (r && r.file) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(await (await fetch(r.file.dataUrl)).blob()); // local dataUrl decode
          a.download = r.file.name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }
      }
      if (e.target.id === 'enhAddSkills') {
        e.target.disabled = true;
        const r = await AJP.send('resume.addSkills', { id: current.id, picks: picks.map((p) => ({ skill: p.skill, role: p.role })) });
        if (!r.ok) {
          $('#enhOut').textContent = `❌ ${r.error} ${r.hint || ''} (${r.code})`;
          e.target.disabled = false;
          return;
        }
        const keep = current.__vctx;
        const prev = state;
        current = r.draft;
        current.__vctx = keep;
        state = {};
        for (const ed of current.edits) state[ed.id] = prev[ed.id] && ed.source !== 'skill' ? prev[ed.id] : { accepted: ed.accepted, after: ed.after, edited: false, blocked: !ed.ok };
        picks = current.skillPicks.map((p) => ({ skill: p.skill, role: p.role, manual: true }));
        render();
        const sk = r.skipped.length ? ` Not added: ${r.skipped.map((x) => `${x.skill} (${x.reason})`).join(', ')}.` : '';
        ui.toast(`Added ${r.added.length} skill${r.added.length === 1 ? '' : 's'} to the draft.${sk}`, 5000);
        log.info('Skills added to draft', { added: r.added.length, skipped: r.skipped.length });
      }
      if (e.target.id === 'enhDiscard') {
        if (!confirm('Discard this draft?')) return;
        await AJP.store.update('enhancements', (l) => l.filter((x) => x.id !== current.id));
        dlg.close();
        renderList();
      }
      if (e.target.id === 'enhCreate') {
        e.target.disabled = true;
        const decisions = current.edits.map((ed) => ({ editId: ed.id, accepted: !!state[ed.id].accepted && !state[ed.id].blocked, after: state[ed.id].edited ? state[ed.id].after : undefined }));
        const r = await AJP.send('resume.applyEnhancement', { id: current.id, decisions, makeActive: $('#enhActive').checked });
        if (!r.ok) {
          $('#enhOut').textContent = `❌ ${r.error} ${r.hint || ''} (${r.code})`;
          e.target.disabled = false;
          return;
        }
        // Stay here: say what happened, offer the PDF, and point back to the job (its panel re-scores by itself).
        renderList();
        ui.onCreated(r.resume);
        $('#enhOut').innerHTML = `✅ ${r.replaced ? 'Updated' : 'Created'} <b>${esc(r.resume.name)}</b> (${r.applied} change${r.applied === 1 ? '' : 's'}).
          <button id="enhDownload" class="primary">⬇ Download PDF</button>
          <span class="hint">${r.resume.file ? esc(r.resume.file.name) + ' · ' : ''}Back on the job page, the panel now scores with this resume and Autofill uploads it.</span>`;
        current.__created = r.resume.id;
        e.target.disabled = false;
      }
    });
    // Deep link #resumes?enh=<id> — on load and when the Admin tab is already open.
    const fromHash = () => {
      const m = location.hash.match(/[?&]enh=([\w-]+)/);
      if (m && !(current && current.id === m[1] && $('#enhDialog').open)) open(m[1]);
    };
    window.addEventListener('hashchange', fromHash);
    setTimeout(fromHash, 0);
  }

  AJP.enhanceView = { init, renderList, open, _state: () => state };
})();
