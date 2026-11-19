/*
 * panel.js — the floating on-page panel (Shadow DOM, so page CSS can't break it).
 * Pure view: content.js owns the state and passes callbacks.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.panel) return;

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .wrap { position: fixed; top: 80px; right: 16px; z-index: 2147483646; width: 360px; max-height: calc(100vh - 100px);
    display: flex; flex-direction: column; background: #fff; color: #111827; border: 1px solid #e5e7eb; border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0,0,0,.18); font-size: 13px; line-height: 1.4; }
  .wrap.min { width: auto; }
  .wrap.min .body { display: none; }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; cursor: move; user-select: none; }
  header .t { flex: 1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { font-weight: 700; padding: 2px 8px; border-radius: 999px; color: #fff; background: #6b7280; }
  .hb { border: 0; background: transparent; cursor: pointer; font-size: 15px; color: #6b7280; padding: 2px 4px; }
  .body { overflow: auto; padding: 12px; }
  .job { color: #4b5563; margin-bottom: 10px; }
  .job b { color: #111827; }
  .score { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .ring { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; font-size: 18px; font-weight: 700; }
  .ring span { background: #fff; width: 50px; height: 50px; border-radius: 50%; display: grid; place-items: center; }
  h4 { margin: 12px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { padding: 2px 8px; border-radius: 999px; font-size: 12px; border: 1px solid; }
  .chip.ok { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
  .chip.no { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
  .chip.no.pref { background: #fffbeb; border-color: #fde68a; color: #92400e; }
  .chip.sim { border-style: dashed; }
  .chip .sim { opacity: .8; font-size: 11px; }
  .fit .sub { grid-column: 2; font-size: 12px; opacity: .85; margin: 0 0 3px; }
  .fit { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
  .tracks { display: flex; flex-wrap: wrap; gap: 4px; margin: -4px 0 10px; }
  .tk { border: 1px solid #d1d5db; background: #fff; color: #374151; border-radius: 999px; padding: 3px 9px; font-size: 12px; cursor: pointer; }
  .tk.on { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
  .btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  button.b { border: 1px solid #d1d5db; background: #f9fafb; color: #111827; border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
  button.b.p { background: #2563eb; border-color: #2563eb; color: #fff; }
  button.b:disabled { opacity: .5; cursor: wait; }
  .msg { margin-top: 10px; padding: 8px; border-radius: 8px; background: #f3f4f6; white-space: pre-wrap; }
  .msg.err { background: #fef2f2; color: #991b1b; }
  .msg.warn { background: #fffbeb; color: #92400e; margin: 0 0 10px; }
  .msg.ask { background: #eff6ff; }
  .q { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; margin-top: 6px; }
  .muted { color: #6b7280; font-size: 12px; }
  .code { font-family: ui-monospace, Menlo, monospace; }
  a { color: #2563eb; cursor: pointer; }
  @media (prefers-color-scheme: dark) {
    .wrap { background: #111827; color: #f3f4f6; border-color: #374151; }
    header { border-color: #374151; }
    .job, .muted, h4 { color: #9ca3af; } .job b { color: #f3f4f6; }
    .ring span { background: #111827; }
    button.b { background: #1f2937; color: #f3f4f6; border-color: #4b5563; }
    .msg { background: #1f2937; } .q { border-color: #374151; }
    .tk { background: #1f2937; color: #e5e7eb; border-color: #4b5563; } .tk.on { background: #2563eb; border-color: #2563eb; }
    .msg.warn { background: #3a2a0a; color: #fcd34d; } .msg.ask { background: #172554; }
  }`;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const color = (s) => (s == null ? '#6b7280' : s >= 75 ? '#059669' : s >= 50 ? '#d97706' : '#dc2626');
  const tick = (ok) => (ok === true ? '✅' : ok === false ? '⚠️' : '—');
  const yrs = (n) => (n == null ? '?' : Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
  // Years-of-experience row (+ one line per skill the job asks years for).
  function yearsRow(y) {
    if (!y || y.asked == null) {
      return `<span>—</span><span class="yrs">Experience: no total years asked</span>${skillYears(y)}`;
    }
    const asked = `${y.asked}${y.askedMax ? '–' + y.askedMax : '+'} yrs${y.preferred ? ' (preferred)' : ''}`;
    const have = y.have == null ? 'add your total in Admin → Profile' : `you have ${yrs(y.have)} (from ${esc(y.source)})`;
    const t = y.ok === true ? '✅' : y.close ? '🟡' : tick(y.ok);
    return `<span title="${esc(y.quote || '')}">${t}</span><span class="yrs">Experience: ${asked} asked · ${have}${y.close ? ' — close' : ''}</span>${skillYears(y)}`;
  }
  function skillYears(y) {
    if (!y || !y.skills || !y.skills.length) return '';
    return y.skills.slice(0, 4).map((s) => `<span class="sub">${s.ok === true ? '✅' : s.ok === false ? '⚠️' : '—'} ${esc(s.skill)}: ${s.asked}+ yrs${s.preferred ? ' (preferred)' : ''} · ${s.have == null ? 'not in your dated roles' : 'you have ' + yrs(s.have)}</span>`).join('');
  }
  function levelRow(l) {
    if (!l || !l.job) return `<span>—</span><span>Level: not stated</span>`;
    const mine = l.mine ? `you: ${esc(l.mine.label)}` : 'set your current title in Admin → Profile';
    return `<span>${tick(l.ok)}</span><span class="lvl">Level: ${esc(l.job.label)} · ${mine}${l.note ? ' — ' + esc(l.note) : ''}</span>`;
  }

  let host = null;
  let root = null;
  let handlers = {};

  function ensure() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('ajp-panel');
    root = host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (t && handlers[t.dataset.act]) handlers[t.dataset.act](t.dataset.arg, t);
    });
  }

  function draggable(wrap) {
    const head = wrap.querySelector('header');
    let sx, sy, ox, oy;
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = wrap.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      const move = (ev) => {
        wrap.style.left = Math.max(0, ox + ev.clientX - sx) + 'px';
        wrap.style.top = Math.max(0, oy + ev.clientY - sy) + 'px';
        wrap.style.right = 'auto';
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    });
  }

  function render(state, cbs) {
    ensure();
    handlers = cbs || handlers;
    const a = state.analysis;
    const job = state.job || {};
    const s = a ? a.score : null;
    const busy = state.busy || '';
    const dis = (k) => (busy ? 'disabled' : '') + (busy === k ? ' title="Working…"' : '');

    let body = '';
    if (state.error && !a) {
      body = `<div class="msg err">${esc(state.error)}</div>
        <div class="muted" style="margin-top:8px">Tip: select the job description text, right-click → “Apply Job: analyze selection”.</div>`;
    } else if (a) {
      const f = a.fit;
      const sal = f.salary.job ? `$${Math.round(f.salary.job.min / 1000)}k–$${Math.round(f.salary.job.max / 1000)}k${f.salary.job.hourly ? ' (from hourly)' : ''}` : 'not listed';
      const tr = state.tracks && state.tracks.results.length > 1 ? state.tracks : null;
      const tabs = tr
        ? `<div class="tracks" role="tablist" aria-label="Career tracks">${tr.results.map((x) => `<button class="tk ${x.track.id === state.trackId ? 'on' : ''}" role="tab" aria-selected="${x.track.id === state.trackId}" data-act="track" data-arg="${esc(x.track.id)}" title="${x.track.id === tr.bestId ? 'Best fit for this job' : 'Switch to this track'}">${x.track.id === tr.bestId ? '★ ' : ''}${esc(x.track.name)} <b>${x.analysis.score == null ? '–' : x.analysis.score + '%'}</b></button>`).join('')}</div>`
        : '';
      body = `
        <div class="job"><b>${esc(job.title || 'Job')}</b>${job.company ? ' · ' + esc(job.company) : ''}</div>${tabs}
        <div class="score">
          <div class="ring" style="background:conic-gradient(${color(s)} ${(s || 0) * 3.6}deg,#e5e7eb 0)"><span>${s == null ? '?' : s + '%'}</span></div>
          <div><b>${a.matched.length}</b> of <b>${a.jdSkillCount}</b> skills match${a.similarCount ? ` <span class="muted">(+${a.similarCount} similar)</span>` : ''}<br>
          <span class="muted">${state.aiUsed ? 'AI-enhanced analysis' : 'Offline keyword analysis'} · ${a.ms}ms</span></div>
        </div>
        <h4>Matching (${a.matched.length})</h4>
        <div class="chips">${a.matched.map((m) => `<span class="chip ok" title="${esc(/^implied/.test(m.source) ? m.source : 'from ' + m.source)}">${esc(m.skill)}</span>`).join('') || '<span class="muted">none</span>'}</div>
        <h4>Gaps (${a.missing.length})</h4>
        <div class="chips">${a.missing.map((m) => `<span class="chip no ${m.importance === 'preferred' ? 'pref' : ''} ${m.similar ? 'sim' : ''}" title="${m.importance}${m.similar ? ` · you have ${esc(m.similar)} (similar, half credit)` : ''}">${esc(m.skill)}${m.similar ? ` <span class="sim">≈ ${esc(m.similar)}</span>` : ''}</span>`).join('') || '<span class="muted">none 🎉</span>'}</div>
        <h4>Fit</h4>
        <div class="fit">
          <span>${tick(f.workType.ok)}</span><span>Work type: ${esc(f.workType.job.join(', ') || 'not stated')}</span>
          <span>${tick(f.salary.ok)}</span><span>Salary: ${esc(sal)}</span>
          <span>${tick(f.location.ok)}</span><span>Location: ${esc(f.location.matched || job.location || 'not matched to your areas')}</span>
          ${yearsRow(f.years)}
          ${levelRow(f.seniority)}
        </div>
        <div class="btns">
          <button class="b" data-act="ai" ${dis('ai')}>✨ AI deep analysis</button>
          <button class="b" data-act="tailor" ${dis('tailor')}>📝 Tailor resume</button>
          <button class="b p" data-act="autofill" ${dis('autofill')}>⚡ Autofill form</button>
          <button class="b" data-act="applied">✔ Mark applied</button>
        </div>`;
    } else if (!state.message && !state.ask && !state.crash) {
      body = `<div class="muted">Reading the page…</div>`;
    }

    if (state.duplicate && state.duplicate.app) {
      const d = state.duplicate.app;
      const when = d.appliedAt || d.date;
      body = `<div class="msg warn">⚠ ${state.duplicate.how === 'same job' ? 'You already tracked this job' : 'You tracked a similar job at this company'}: <b>${esc(d.title || '')}</b> — ${esc(d.status)}${when ? ' since ' + esc(new Date(when).toLocaleDateString()) : ''}. <a data-act="openApps">Open tracker</a></div>` + body;
    }

    if (state.crash) {
      body += `<div class="msg err crash">Something went wrong <span class="code">(${esc(state.crash.code)})</span>. Report it so we can fix it? Nothing is sent until you review it on GitHub.
        <div class="btns"><button class="b p" data-act="crashReport">Report</button><button class="b" data-act="crashLater">Not now</button><button class="b" data-act="crashNever">Don't ask again for this error</button></div></div>`;
    }

    if (state.ask) {
      body += `<div class="msg ask">Did you submit your application${state.ask.company ? ' to <b>' + esc(state.ask.company) + '</b>' : ''}${state.ask.title ? ' for <b>' + esc(state.ask.title) + '</b>' : ''}?
        <div class="btns"><button class="b p" data-act="askYes">Yes, I applied</button><button class="b" data-act="askNo">No</button></div></div>`;
    }

    if (state.message) body += `<div class="msg ${state.messageErr ? 'err' : ''}">${state.message}</div>`;

    const r = state.autofill;
    if (r) {
      body += `<h4>Autofill${r.site ? ` <span class="site">· ${esc(r.site)}</span>` : ''}</h4><div class="muted">Filled ${r.filled.length} from profile, ${r.learned.length} from learned answers.
        ${(r.notes || []).map((n) => `<div class="note">ℹ️ ${esc(n)}</div>`).join('')}
        ${r.unknown.length ? `<br>Not filled (${r.unknown.length}): ${esc(r.unknown.slice(0, 8).join(' · '))}${r.unknown.length > 8 ? '…' : ''}` : ''}
        ${r.attached ? `<div class="att" style="margin:4px 0">📎 Resume attached: <b>${esc(r.attached)}</b></div>` : ''}
        <br><b>Review everything, then submit yourself.</b> What you type is remembered for next time.</div>`;
      for (const q of r.questions) {
        body += `<div class="q"><div>${esc(q.label)}</div>
          <button class="b" style="margin-top:6px" data-act="draft" data-arg="${esc(q.ajpId)}" ${dis('draft')}>✨ Draft answer with AI</button></div>`;
      }
    }

    root.innerHTML = `<style>${CSS}</style>
      <div class="wrap ${state.minimized ? 'min' : ''}">
        <header>
          <span class="badge" style="background:${color(s)}">${s == null ? '–' : s + '%'}</span>
          <span class="t">${state.minimized ? '' : 'Apply Job Assistant'}</span>
          <button class="hb" data-act="admin" title="Open Admin">⚙</button>
          <button class="hb" data-act="toggle" title="Minimize">${state.minimized ? '▢' : '–'}</button>
          <button class="hb" data-act="close" title="Close">✕</button>
        </header>
        <div class="body">${body}</div>
      </div>`;
    draggable(root.querySelector('.wrap'));
  }

  function remove() {
    if (host) host.remove();
    host = null;
  }

  AJP.panel = { render, remove, esc };
})();
