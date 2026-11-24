/*
 * panel.js — the floating on-page panel (Shadow DOM, so page CSS can't break it).
 * Pure view: content.js owns the state and passes callbacks.
 * Layout (top to bottom): summary (title, company, place, match ring) → track tabs → skills → fit checklist →
 * actions (Autofill first; Tailor and AI deep analysis next; Mark applied and Watch this company last).
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.panel) return;

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .wrap { --bg: #fff; --fg: #0f172a; --muted: #64748b; --line: #e2e8f0; --soft: #f8fafc; --accent: #4f46e5; --accent-h: #4338ca;
    --accent-soft: #eef2ff; --accent-ink: #3730a3; --ok: #047857; --ok-soft: #ecfdf5; --warn: #b45309; --warn-soft: #fffbeb;
    --bad: #b91c1c; --bad-soft: #fef2f2;
    position: fixed; top: 80px; right: 16px; z-index: 2147483646; width: 372px; max-height: calc(100vh - 100px);
    display: flex; flex-direction: column; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 14px;
    box-shadow: 0 1px 2px rgba(15,23,42,.06), 0 16px 40px rgba(15,23,42,.18); font-size: 13px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
  .ic { flex: none; }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 12px; border-bottom: 1px solid var(--line); cursor: move; user-select: none; }
  header .t { flex: 1; min-width: 0; font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12.5px; padding: 3px 10px 3px 8px; border-radius: 999px;
    color: var(--lvl); background: color-mix(in srgb, var(--lvl) 14%, transparent); }
  .badge::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--lvl); }
  .lbl { font-size: 12px; color: var(--muted); font-weight: 500; }
  .hb { display: inline-grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 7px; background: transparent; cursor: pointer; color: var(--muted); padding: 0; }
  .hb:hover { background: var(--soft); color: var(--fg); }
  .hb:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .body { overflow: auto; padding: 14px; }

  /* Minimized: a compact pill that stays readable on light and dark sites */
  .wrap.min { width: auto; border-radius: 999px; background: rgba(255,255,255,.88); -webkit-backdrop-filter: saturate(1.6) blur(10px); backdrop-filter: saturate(1.6) blur(10px);
    box-shadow: 0 0 0 1px rgba(15,23,42,.06), 0 8px 24px rgba(15,23,42,.2); }
  .wrap.min header { border-bottom: 0; padding: 5px 6px 5px 6px; gap: 4px; }
  .wrap.min .t { display: none; }
  .wrap.min .body { display: none; }

  /* Summary */
  .summary { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
  .summary .who { flex: 1; min-width: 0; }
  .job { color: var(--muted); font-size: 12.5px; }
  .job b { display: block; color: var(--fg); font-size: 14.5px; line-height: 1.3; margin-bottom: 2px; }
  .job .sep { display: none; } /* the title sits on its own line; the separator stays for screen readers and copy */
  .stat { margin-top: 6px; font-size: 12.5px; }
  .ring { width: 62px; height: 62px; flex: none; border-radius: 50%; display: grid; place-items: center; }
  .ring span { background: var(--bg); width: 50px; height: 50px; border-radius: 50%; display: grid; place-items: center; font-size: 16px; font-weight: 700; }
  .muted { color: var(--muted); font-size: 12px; }

  /* Track tabs: the best fit says so on the tab itself (no tooltip over other content) */
  .tracks { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 12px; }
  .tk { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
  .tk:hover { border-color: var(--accent); }
  .tk.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-ink); }
  .tk .best { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: var(--accent); }

  h4 { display: flex; align-items: center; gap: 6px; margin: 14px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  h4 .n { font-weight: 600; color: var(--fg); letter-spacing: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px; border-radius: 999px; font-size: 12px; border: 1px solid transparent; font-family: inherit; line-height: 1.5; }
  .chip.ok { background: var(--ok-soft); color: var(--ok); }
  .chip.no { background: var(--bad-soft); color: var(--bad); cursor: pointer; }
  .chip.no.pref { background: var(--warn-soft); color: var(--warn); }
  .chip.sim { border: 1px dashed currentColor; }
  .chip .sim { opacity: .85; font-size: 11px; }
  button.chip:hover { filter: brightness(.97); }
  .why { margin-top: 6px; padding: 8px 10px; border-radius: 8px; background: var(--soft); border: 1px solid var(--line); font-size: 12px; }
  .why[hidden] { display: none; }
  .tailored { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; padding: 8px 10px; border-radius: 10px; background: var(--accent-soft); color: var(--accent-ink); font-size: 12px; }
  .tailored span { flex: 1; }

  /* Fit checklist: label · value · status */
  .fit { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .frow { display: grid; grid-template-columns: 82px 1fr auto; gap: 8px; align-items: start; padding: 7px 10px; border-top: 1px solid var(--line); }
  .frow:first-child { border-top: 0; }
  .fl { color: var(--muted); font-size: 12px; }
  .fv { min-width: 0; font-size: 12.5px; }
  .fv .sub { display: block; color: var(--muted); font-size: 11.5px; margin-top: 2px; }
  .st { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; white-space: nowrap; }
  .st.ok { background: var(--ok-soft); color: var(--ok); }
  .st.warn { background: var(--warn-soft); color: var(--warn); }
  .st.na { background: var(--soft); color: var(--muted); }

  /* Actions */
  .actions { display: grid; gap: 6px; margin-top: 14px; }
  .actions .two { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .more { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin-top: 4px; }
  button.b { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--fg);
    border-radius: 9px; padding: 7px 10px; cursor: pointer; font-size: 12.5px; font-weight: 500; }
  button.b:hover { background: var(--soft); border-color: #cbd5e1; }
  button.b.p { background: var(--accent); border-color: var(--accent); color: #fff; padding: 9px 12px; font-size: 13px; font-weight: 600; }
  button.b.p:hover { background: var(--accent-h); }
  button.b.small { padding: 3px 9px; font-size: 12px; }
  button.link { display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; padding: 2px 0; color: var(--muted); font-size: 12px; cursor: pointer; }
  button.link:hover { color: var(--accent); }
  button:disabled { opacity: .5; cursor: wait; }
  .msg { margin-top: 10px; padding: 9px 10px; border-radius: 10px; background: var(--soft); border: 1px solid var(--line); white-space: pre-wrap; }
  .msg.err { background: var(--bad-soft); border-color: transparent; color: var(--bad); }
  .msg.warn { display: flex; gap: 8px; background: var(--warn-soft); border-color: transparent; color: var(--warn); margin: 0 0 12px; }
  .msg.ask { background: var(--accent-soft); border-color: transparent; }
  .q { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; margin-top: 6px; }
  .radar-line { display: inline-flex; align-items: center; gap: 5px; }
  .code { font-family: ui-monospace, Menlo, monospace; }
  a { color: var(--accent); cursor: pointer; }
  @media (prefers-color-scheme: dark) {
    .wrap { --bg: #111827; --fg: #f1f5f9; --muted: #94a3b8; --line: #263244; --soft: #1a2333; --accent: #818cf8; --accent-h: #a5b4fc;
      --accent-soft: #1e1b4b; --accent-ink: #c7d2fe; --ok: #34d399; --ok-soft: #052e22; --warn: #fbbf24; --warn-soft: #2a1f05;
      --bad: #fca5a5; --bad-soft: #3b0d0d; box-shadow: 0 16px 40px rgba(0,0,0,.5); }
    .wrap.min { background: rgba(17,24,39,.88); box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 8px 24px rgba(0,0,0,.5); }
    button.b.p { color: #0b1120; }
    button.b:hover { border-color: #475569; }
  }`;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n, size = 14) => (AJP.icon ? AJP.icon(n, { size }) : '');
  // Match level: one color per band (ring, header pill); its soft tint is mixed in CSS, so it suits light and dark.
  const level = (s) => [s == null ? '#64748b' : s >= 75 ? '#059669' : s >= 50 ? '#d97706' : '#dc2626'];
  const yrs = (n) => (n == null ? '?' : Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
  // Status pill for a fit row: true → Matched, false → the given word (Check), null → Not stated.
  const status = (ok, { no = 'Check', none = 'Not stated', yes = 'Matched' } = {}) => (ok === true ? `<span class="st ok">${yes}</span>` : ok === false ? `<span class="st warn">${no}</span>` : `<span class="st na">${none}</span>`);
  const frow = (label, value, st, sub = '', tip = '') => `<div class="frow"${tip ? ` title="${esc(tip)}"` : ''}><span class="fl">${label}</span><span class="fv">${value}${sub}</span>${st}</div>`;

  // Experience: years asked vs yours (+ one line per skill the job asks years for).
  function yearsRow(y) {
    if (!y || y.asked == null) return frow('Experience', 'No total years asked', status(null, { none: '—' }), skillYears(y));
    const asked = `${y.asked}${y.askedMax ? '–' + y.askedMax : '+'} yrs asked${y.preferred ? ' (preferred)' : ''}`;
    const have = y.have == null ? 'add your total in Admin → Profile' : `you have ${yrs(y.have)} (from ${esc(y.source)})`;
    const st = y.ok === true ? status(true) : y.close ? '<span class="st warn">Close</span>' : status(y.ok, { none: 'Unknown' });
    return frow('Experience', `${asked} · ${have}`, st, skillYears(y), y.quote || '');
  }
  function skillYears(y) {
    if (!y || !y.skills || !y.skills.length) return '';
    return y.skills.slice(0, 4).map((s) => `<span class="sub">${s.ok === true ? '✓' : s.ok === false ? '!' : '·'} ${esc(s.skill)}: ${s.asked}+ yrs${s.preferred ? ' (preferred)' : ''} · ${s.have == null ? 'not in your dated roles' : 'you have ' + yrs(s.have)}</span>`).join('');
  }
  function levelRow(l) {
    if (!l || !l.job) return frow('Level', 'Not stated', status(null, { none: '—' }));
    const mine = l.mine ? `you: ${esc(l.mine.label)}` : 'set your current title in Admin → Profile';
    return frow('Level', `${esc(l.job.label)} · ${mine}`, status(l.ok, { no: 'Note', none: '—' }), l.note ? `<span class="sub">${esc(l.note)}</span>` : '');
  }
  // Why a gap is a gap, and what to do about it (shown when its chip is clicked).
  function gapWhy(m) {
    const imp = m.importance === 'required' ? 'Required by this job' : m.importance === 'preferred' ? 'Nice to have for this job' : 'Mentioned in this job';
    if (m.similar) return `<b>${esc(m.skill)}</b> ≈ <b>${esc(m.similar)}</b>: ${imp.toLowerCase()}, not in your skills, but you have ${esc(m.similar)}, a similar skill (half credit). When you tailor, lead with your ${esc(m.similar)} work and what carries over to ${esc(m.skill)}. Add ${esc(m.skill)} to Skills only if you have used it.`;
    return `<b>${esc(m.skill)}</b>: ${imp.toLowerCase()} and not in your skills or resume. If you have used it, add it in Admin → Skills and the match updates. Tailoring never adds skills you don't have.`;
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
      const g = e.target.closest('[data-gap]');
      if (g) {
        // Gap chips explain themselves in place (no re-render, nothing sent anywhere).
        const box = root.querySelector('.why');
        const same = !box.hidden && box.dataset.for === g.dataset.gap;
        box.hidden = same;
        box.dataset.for = g.dataset.gap;
        box.innerHTML = same ? '' : decodeURIComponent(g.dataset.why);
        root.querySelectorAll('[data-gap]').forEach((x) => x.setAttribute('aria-expanded', String(!same && x === g)));
        return;
      }
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
    const s = a ? a.score : state.held && state.held.score != null ? state.held.score : null;
    const [lvl] = level(s);
    const busy = state.busy || '';
    const dis = (k) => (busy ? 'disabled' : '') + (busy === k ? ' title="Working…"' : '');

    let body = '';
    if (state.error && !a) {
      body = `<div class="msg err">${esc(state.error)}</div>
        <div class="muted" style="margin-top:8px">Tip: select the job description text, right-click → “Apply Job: analyze selection”.</div>`;
    } else if (a) {
      const f = a.fit;
      const sal = f.salary.job ? `$${Math.round(f.salary.job.min / 1000)}k–$${Math.round(f.salary.job.max / 1000)}k${f.salary.job.hourly ? ' (from hourly)' : ''}` : 'Not listed';
      const tr = state.tracks && state.tracks.results.length > 1 ? state.tracks : null;
      const tabs = tr
        ? `<div class="tracks" role="tablist" aria-label="Career tracks">${tr.results.map((x) => `<button class="tk ${x.track.id === state.trackId ? 'on' : ''}" role="tab" aria-selected="${x.track.id === state.trackId}" data-act="track" data-arg="${esc(x.track.id)}">${x.track.id === tr.bestId ? '<span class="best">Best fit</span>' : ''}${esc(x.track.name)} <b>${x.analysis.score == null ? '–' : x.analysis.score + '%'}</b></button>`).join('')}</div>`
        : '';
      const place = job.location ? ' · ' + esc(job.location) : '';
      const loc = `${esc(f.location.matched || job.location || 'Not matched to your saved areas')}`;
      const locSub = f.location.note ? `<span class="sub">remote: ${esc(f.location.note)}</span>` : f.location.abroad ? `<span class="sub">listed outside ${f.location.home === 'united states' ? 'the US' : esc(f.location.home)}: check you can work there</span>` : '';
      body = `
        <div class="summary">
          <div class="who">
            <div class="job"><b>${esc(job.title || 'Job')}</b>${job.company || job.location ? '<span class="sep"> · </span>' : ''}${job.company ? esc(job.company) + place : esc(job.location || '')}</div>
            <div class="stat"><b>${a.matched.length}</b> of <b>${a.jdSkillCount}</b> skills match${a.similarCount ? ` <span class="muted">(+${a.similarCount} similar)</span>` : ''}</div>
            <div class="muted">${state.aiUsed ? `AI-enhanced analysis${typeof state.aiUsed === 'string' ? ' (' + esc(state.aiUsed) + ')' : ''}` : 'Offline keyword analysis'} · ${a.ms}ms</div>
          </div>
          <div class="ring" style="background:conic-gradient(${lvl} ${(s || 0) * 3.6}deg,color-mix(in srgb, ${lvl} 16%, transparent) 0)" role="img" aria-label="${s == null ? 'No' : s + '%'} match"><span>${s == null ? '?' : s + '%'}</span></div>
        </div>${tabs}
        ${state.tailored ? `<div class="tailored">${icon('file')}<span>Scored with your resume tailored for this job${state.tailored.before != null && s != null ? (s > state.tailored.before ? ` (was ${esc(state.tailored.before)}%)` : `. Skills match unchanged at ${esc(s)}%: the edits reworded skills already counted`) : ''}</span>
          <button class="b small" data-act="downloadTailored" title="${esc(state.tailored.fileName || '')}">${icon('download', 13)} PDF</button></div>` : ''}
        <h4>Matching <span class="n">${a.matched.length}</span></h4>
        <div class="chips">${a.matched.map((m) => `<span class="chip ok" title="${esc(/^implied/.test(m.source) ? m.source : 'from ' + m.source)}">${esc(m.skill)}</span>`).join('') || '<span class="muted">none</span>'}</div>
        <h4>Gaps <span class="n">${a.missing.length}</span>${a.missing.length ? '<span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· click one to see why</span>' : ''}</h4>
        <div class="chips">${a.missing.map((m, i) => `<button type="button" class="chip no ${m.importance === 'preferred' ? 'pref' : ''} ${m.similar ? 'sim' : ''}" data-gap="${i}" aria-expanded="false" data-why="${encodeURIComponent(gapWhy(m))}">${esc(m.skill)}${m.similar ? ` <span class="sim">≈ ${esc(m.similar)}</span>` : ''}</button>`).join('') || '<span class="muted">None</span>'}</div>
        <div class="why" hidden></div>
        <h4>Fit</h4>
        <div class="fit">
          ${frow('Salary', esc(sal), status(f.salary.job ? f.salary.ok : null, { no: 'Below yours', none: 'Not listed' }))}
          ${yearsRow(f.years)}
          ${levelRow(f.seniority)}
          ${frow('Location', loc, status(f.location.ok, { no: 'Not matched', none: '—' }), locSub)}
          ${frow('Work type', esc(f.workType.job.join(', ') || 'Not stated'), status(f.workType.ok, { no: 'Check', none: '—' }))}
        </div>
        <div class="actions">
          <button class="b p" data-act="autofill" ${dis('autofill')}>${icon('zap')} Autofill form</button>
          <div class="two">
            <button class="b" data-act="tailor" ${dis('tailor')}>${icon('file')} Tailor resume</button>
            <button class="b" data-act="ai" ${dis('ai')}>${icon('sparkles')} AI deep analysis</button>
          </div>
          <div class="more">
            <button class="link" data-act="applied">${icon('check', 13)} Mark applied</button>
            ${state.radar ? (state.radar.watched ? `<span class="radar-line muted">${icon('radar', 13)} You watch this company in Job Radar</span>` : `<button class="link" data-act="watchCompany" title="Job Radar checks this company's ${esc(state.radar.label)} board every few hours and tells you about new jobs that fit you">${icon('radar', 13)} Watch this company</button>`) : ''}
          </div>
        </div>`;
    } else if (state.held) {
      // An application held across pages (Apply → sign up / log in → form).
      const h = state.held;
      const ph = state.heldPhase;
      const steps = {
        signup: `<b>Application on hold.</b> Create your account on this site (the extension never reads or saves passwords). When the application form appears, Autofill is ready.`,
        login: `<b>Application on hold.</b> Sign in on this site (the extension never reads or saves passwords). When the application form appears, Autofill is ready.`,
        form: `<b>Ready to fill your application</b>${h.tailored ? ' (your resume tailored for this job will be uploaded)' : ''}.`,
        waiting: `Holding your application for this job while you go through the site's steps.`,
      };
      body = `<div class="job" style="margin-bottom:10px"><b>${esc(h.title || 'Job')}</b>${h.company ? `<span class="sep"> · </span>${esc(h.company)}` : ''}${h.score != null ? `${h.company ? ' · ' : '<span class="sep"> · </span>'}${esc(h.score)}% match` : ''}</div>
        <div class="msg held ${esc(ph)}">${steps[ph] || steps.waiting}</div>
        ${h.tailored ? `<div class="muted" style="margin-top:6px">${esc(h.tailored)}</div>` : ''}
        <div class="actions">
          <button class="b p" data-act="autofill" ${ph === 'login' || ph === 'signup' || busy ? 'disabled' : ''}>${icon('zap')} Autofill form</button>
          <div class="more">
            <button class="link" data-act="applied">${icon('check', 13)} Mark applied</button>
            <button class="link" data-act="forgetHeld" title="Stop holding this job in this tab">${icon('x', 13)} Not this job</button>
          </div>
        </div>`;
    } else if (!state.message && !state.ask && !state.crash) {
      body = `<div class="muted">Reading the page…</div>`;
    }

    if (state.duplicate && state.duplicate.app) {
      const d = state.duplicate.app;
      const when = d.appliedAt || d.date;
      body = `<div class="msg warn">${icon('alert')}<span>${state.duplicate.how === 'same job' ? 'You already tracked this job' : 'You tracked a similar job at this company'}: <b>${esc(d.title || '')}</b> — ${esc(d.status)}${when ? ' since ' + esc(new Date(when).toLocaleDateString()) : ''}. <a data-act="openApps">Open tracker</a></span></div>` + body;
    }

    if (state.crash) {
      body += `<div class="msg err crash">Something went wrong <span class="code">(${esc(state.crash.code)})</span>. Report it so we can fix it? Nothing is sent until you review it on GitHub.
        <div class="actions"><button class="b p" data-act="crashReport">Report</button><div class="more"><button class="link" data-act="crashLater">Not now</button><button class="link" data-act="crashNever">Don't ask again for this error</button></div></div></div>`;
    }

    if (state.ask) {
      body += `<div class="msg ask">Did you submit your application${state.ask.company ? ' to <b>' + esc(state.ask.company) + '</b>' : ''}${state.ask.title ? ' for <b>' + esc(state.ask.title) + '</b>' : ''}?
        <div class="actions"><div class="two"><button class="b p" data-act="askYes">Yes, I applied</button><button class="b" data-act="askNo">No</button></div></div></div>`;
    }

    if (state.message) body += `<div class="msg ${state.messageErr ? 'err' : ''}">${state.message}</div>`;

    const r = state.autofill;
    if (r) {
      body += `<h4>Autofill${r.site ? ` <span class="site n">· ${esc(r.site)}</span>` : ''}</h4><div class="muted">Filled ${r.filled.length} from profile, ${r.learned.length} from learned answers.
        ${(r.notes || []).map((n) => `<div class="note">${esc(n)}</div>`).join('')}
        ${r.unknown.length ? `<br>Not filled (${r.unknown.length}): ${esc(r.unknown.slice(0, 8).join(' · '))}${r.unknown.length > 8 ? '…' : ''}` : ''}
        ${r.attached ? `<div class="att" style="margin:4px 0">Resume attached: <b>${esc(r.attached)}</b></div>` : ''}
        <br><b>Review everything, then submit yourself.</b> What you type is remembered for next time.</div>`;
      for (const q of r.questions) {
        body += `<div class="q"><div>${esc(q.label)}</div>
          <button class="b" style="margin-top:6px" data-act="draft" data-arg="${esc(q.ajpId)}" ${dis('draft')}>${icon('sparkles', 13)} Draft answer with AI</button></div>`;
      }
    }

    const min = !!state.minimized;
    root.innerHTML = `<style>${CSS}</style>
      <div class="wrap ${min ? 'min' : ''}" style="--lvl:${lvl}" role="dialog" aria-label="Apply Job Assistant">
        <header>
          <span class="badge" title="${s == null ? 'No match score yet' : 'Match with your profile'}">${s == null ? '–' : s + '%'}</span>${min && s != null ? '<span class="lbl">match</span>' : ''}
          <span class="t">${min ? '' : 'Apply Job Assistant'}</span>
          ${min ? '' : `<button class="hb" data-act="admin" title="Open Admin" aria-label="Open Admin">${icon('settings', 15)}</button>`}
          <button class="hb" data-act="toggle" title="${min ? 'Expand' : 'Minimize'}" aria-label="${min ? 'Expand' : 'Minimize'}">${icon(min ? 'expand' : 'minus', 15)}</button>
          <button class="hb" data-act="close" title="Close" aria-label="Close">${icon('x', 15)}</button>
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
