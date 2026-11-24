/*
 * content.js — per-page controller. Wires extractor + matcher + filler + panel.
 * Runs in every frame; the panel only lives in the top frame.
 */
(function () {
  'use strict';
  if (window.__AJP_CONTENT__) return;
  window.__AJP_CONTENT__ = true;

  const AJP = globalThis.AJP;
  const api = AJP.api;
  const isTop = window === window.top;
  AJP.logContext = isTop ? 'content' : 'frame';
  const log = AJP.logger('content');

  const state = { job: null, analysis: null, aiSkills: null, aiUsed: false, minimized: false, busy: '', message: '', messageErr: false, autofill: null, error: '', duplicate: null, ask: null, lastApp: null, tracks: null, trackId: null, trackPicked: null, crash: null };
  let jdText = '';
  let lastUrl = location.href;

  AJP.store.get('settings').then((s) => AJP.setLogLevel(s.logLevel));

  const render = () => isTop && AJP.panel.render(state, callbacks);
  const say = (message, err = false) => {
    state.message = message;
    state.messageErr = err;
    render();
  };

  // Show a failed background reply as: message, hint, and the code users can quote to support.
  const fail = (r) => {
    const esc = AJP.panel.esc;
    say(`${esc(r.error || 'Something went wrong.')}${r.hint ? `<br><span class="muted">${esc(r.hint)}</span>` : ''} <span class="muted code">(${esc(r.code || 'AJP-INTERNAL')})</span>`, true);
  };

  // Job Radar: is this page (or a board it embeds) a supported job board? Then offer "Watch this company".
  let radarChecked = '';
  async function checkRadar() {
    if (!isTop || radarChecked === location.href || !AJP.radar || !AJP.radar.detect) return;
    radarChecked = location.href;
    const D = AJP.radar.detect;
    let url = D.fromUrl(location.href) ? location.href : '';
    if (!url) {
      const srcs = [...document.querySelectorAll('iframe[src], script[src], ' + ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'recruitee.com', 'breezy.hr', 'smartrecruiters.com', 'rippling.com', 'personio.', 'teamtailor.com', 'myworkdayjobs.com'].map((h) => `a[href*="${h}"]`).join(', '))].slice(0, 200).map((el) => el.src || el.href);
      url = srcs.find((u) => D.fromUrl(u)) || '';
    }
    if (!url) return void (state.radar = null);
    const r = await AJP.send('radar.detect', { url });
    state.radar = r && r.ok !== false ? { url, key: r.key, label: r.label, watched: r.watched } : null;
    render();
  }

  async function analyze({ text = null, keepAi = false } = {}) {
    const t0 = performance.now();
    let job;
    try {
      if (text) job = { title: document.title, company: '', location: '', text, url: location.href, source: 'selection' };
      else job = AJP.jd.extract();
    } catch (e) {
      const x = AJP.toAppError(e);
      log.error('Job page reading crashed', { code: x.code, error: x.message, host: location.hostname }, { code: x.code });
      job = null;
    }
    if (!job) {
      const x = AJP.err('JD_NOT_FOUND');
      log.warn('No job description found', { host: location.hostname, path: location.pathname.slice(0, 80) }, { code: x.code });
      state.error = `${x.message} (${x.code})`;
      state.analysis = null;
      render();
      return null;
    }
    state.error = '';
    checkRadar().catch((e) => log.debug('Radar check skipped', { error: e.message }));
    if (!keepAi || jdText !== job.text) {
      state.aiSkills = null;
      state.aiUsed = false;
    }
    // A different job (e.g. clicking the next job on LinkedIn) gets its own best track, not the last pick.
    if (jdText !== job.text) state.trackPicked = null;
    jdText = job.text;
    state.job = job;
    state.held = null;
    const [profile0, resumes0] = await Promise.all([AJP.store.get('profile'), AJP.store.get('resumes')]);
    // A resume tailored for THIS job is what you'd send, so the match uses it (and the panel says so).
    const key = AJP.tracker.jobKey(job.url || location.href);
    const tailored = resumes0.items.find((x) => x.enhancementId && x.job && x.job.url && AJP.tracker.jobKey(x.job.url) === key);
    let profile = profile0;
    let resumes = resumes0;
    if (tailored) {
      if (tailored.trackId) profile = { ...profile0, tracks: (profile0.tracks || []).map((t) => (t.id === tailored.trackId ? { ...t, resumeId: tailored.id } : t)) };
      else resumes = { ...resumes0, activeId: tailored.id };
    }
    state.tailored = tailored ? { id: tailored.id, fileName: tailored.file && tailored.file.name, before: null } : null;
    state.tailoredSig = tailoredSig(resumes0.items, key);
    // Score the job against every career track; keep the user's pick for this page, else the best track.
    const all = AJP.tracks.analyzeAll({ jdText, jobTitle: job.title, jobLocation: job.location, profile, resumes, aiSkills: state.aiSkills });
    state.tracks = all;
    if (!state.trackPicked || !all.results.some((r) => r.track.id === state.trackPicked)) state.trackPicked = null;
    state.trackId = state.trackPicked || all.bestId;
    state.analysis = selected().analysis;
    // "Before" is your original resume scored NOW with the same rules, so the comparison is always like for like.
    if (tailored && resumes0.items.some((x) => x.id === tailored.basedOn)) {
      const baseProfile = tailored.trackId ? { ...profile0, tracks: (profile0.tracks || []).map((t) => (t.id === tailored.trackId ? { ...t, resumeId: tailored.basedOn } : t)) } : profile0;
      const baseResumes = tailored.trackId ? resumes0 : { ...resumes0, activeId: tailored.basedOn };
      const base = AJP.tracks.analyzeAll({ jdText, jobTitle: job.title, jobLocation: job.location, profile: baseProfile, resumes: baseResumes, aiSkills: state.aiSkills });
      const same = base.results.find((r) => r.track.id === state.trackId);
      state.tailored.before = same ? same.analysis.score : null;
    }
    log.info('Analyzed job', { source: job.source, score: state.analysis.score, tracks: all.results.map((r) => r.analysis.score), best: all.bestId === state.trackId, matched: state.analysis.matched.length, missing: state.analysis.missing.length, ms: Math.round(performance.now() - t0) });
    if (!all.results[0].track.implicit || all.results.length > 1) {
      AJP.send('recordEvaluation', { ev: {
        jobKey: AJP.tracker.jobKey(job.url || location.href), url: job.url || location.href, title: job.title, company: job.company,
        bestTrackId: all.bestId,
        scores: Object.fromEntries(all.results.map((r) => [r.track.id, r.analysis.score])),
        gaps: Object.fromEntries(all.results.map((r) => [r.track.id, r.analysis.missing.slice(0, 10).map((m) => m.skill)])),
      } });
    }
    // Remember this job for the tab (apply detection) and warn if already applied.
    const apps = await AJP.store.get('applications');
    state.duplicate = AJP.tracker.findDuplicate(apps, jobMeta());
    AJP.send('setTabJob', { job: { ...jobMeta(), ...trackRef(), score: state.analysis.score, snapshot: snapshot() } });
    render();
    return state.analysis;
  }

  const selected = () => (state.tracks && state.tracks.results.find((r) => r.track.id === state.trackId)) || (state.tracks && state.tracks.results[0]);
  // The career track to use for tailoring/autofill/tracking (null for the implicit "General" track).
  const trackRef = () => {
    const s = selected();
    if (!s && state.held && state.held.trackId) return { trackId: state.held.trackId, trackName: state.held.trackName };
    return s && !s.track.implicit ? { trackId: s.track.id, trackName: s.track.name } : {};
  };

  function jobMeta() {
    // On a sign-up / login / application page, the job is the one held for this tab.
    const j = state.job || state.held || {};
    return { title: j.title, company: j.company, url: j.url || location.href, location: j.location };
  }

  // What we keep with an application, so the posting can be re-read after it disappears.
  function snapshot() {
    const a = state.analysis;
    return {
      jd: String(jdText || '').slice(0, 20000),
      salary: a && a.fit.salary.job,
      workTypes: a && a.fit.workType.job,
      location: (state.job && state.job.location) || '',
      source: state.job && state.job.source,
      savedAt: new Date().toISOString(),
    };
  }

  const appPayload = (extra) => ({ app: { ...jobMeta(), ...trackRef(), score: state.analysis ? state.analysis.score : state.held && state.held.score, snapshot: jdText ? snapshot() : undefined, ...extra } });

  const callbacks = {
    // Switch career track for this job (panel tabs).
    track(id) {
      if (!state.tracks || !state.tracks.results.some((r) => r.track.id === id)) return;
      state.trackPicked = id;
      state.trackId = id;
      state.analysis = selected().analysis;
      state.message = '';
      log.info('Track switched', { best: id === state.tracks.bestId });
      AJP.send('setTabJob', { job: { ...jobMeta(), ...trackRef(), score: state.analysis.score, snapshot: snapshot() } });
      render();
    },

    async crashReport() {
      const c = state.crash;
      state.crash = null;
      render();
      if (c) await AJP.send('crashPromptAction', { code: c.code, action: 'report' });
    },
    async crashLater() {
      const c = state.crash;
      state.crash = null;
      render();
      if (c) await AJP.send('crashPromptAction', { code: c.code, action: 'later' });
    },
    async crashNever() {
      const c = state.crash;
      state.crash = null;
      render();
      if (c) await AJP.send('crashPromptAction', { code: c.code, action: 'never' });
    },

    toggle() {
      state.minimized = !state.minimized;
      render();
    },
    close() {
      AJP.panel.remove();
    },
    admin() {
      AJP.send('openAdmin', {});
    },

    async ai() {
      state.busy = 'ai';
      say('Asking AI to read the job description…');
      const tr = AJP.startTrace('panel.aiAnalysis', { mod: 'content' });
      const r = await AJP.send('ai.extractSkills', { jd: jdText }, tr);
      state.busy = '';
      if (!r.ok) {
        tr.fail(r);
        return fail(r);
      }
      tr.end();
      const x = r.result || {};
      state.aiSkills = { required: x.required_skills || [], preferred: x.preferred_skills || [] };
      state.aiUsed = r.ai || true;
      if (x.company && state.job && !state.job.company) state.job.company = x.company;
      state.message = x.summary ? AJP.panel.esc(x.summary) + (x.years_required ? `<br><span class="muted">Years required: ${AJP.panel.esc(x.years_required)}</span>` : '') : '';
      await analyze({ text: state.job && state.job.source === 'selection' ? jdText : null, keepAi: true });
    },

    async tailor(via) {
      // Tailoring is for close matches: an honest edit lifts a good fit by ~10–15 points; it can't (and shouldn't)
      // turn a 40% match into a fit. Below the minimum, explain and show the biggest gaps instead.
      const t = (await AJP.store.get('settings')).tailoring || {};
      const num = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
      const lim = { minMatch: num(t.minMatch, 70), maxLift: num(t.maxLift, 15) };
      const score = state.analysis ? state.analysis.score : null;
      if (score != null && score < lim.minMatch) {
        const esc = AJP.panel.esc;
        const gaps = (state.analysis.missing || []).filter((m) => m.importance !== 'preferred').slice(0, 4).map((m) => esc(m.skill));
        log.info('Tailoring not offered: match below the minimum', { score, min: lim.minMatch });
        return say(
          `<b>${score}% match: tailoring starts at ${lim.minMatch}%.</b><br>` +
            `Honest edits lift a close match by about ${lim.maxLift} points; they can't close a ${lim.minMatch - score}-point gap, and a stretched resume tends to fall apart in interviews.<br>` +
            (gaps.length ? `Biggest gaps: ${gaps.join(', ')}.<br>` : '') +
            `Better use of your time: jobs at ${lim.minMatch}%+, or build these skills first. <span class="muted">(The limit is in Admin → AI settings → Tailoring limits.)</span>`
        );
      }
      state.busy = 'tailor';
      say('Reading the job’s requirements and matching them to your resume — this takes ~20–40s (a free AI limit can add a short wait; it retries by itself)…');
      const tr = AJP.startTrace('panel.enhanceResume', { mod: 'content', slowMs: 90000 });
      const r = await AJP.send('resume.enhance', { jd: jdText, job: jobMeta(), ...trackRef(), score, ...(via ? { via } : {}) }, tr);
      state.busy = '';
      if (!r.ok) {
        tr.fail(r);
        // The AI is busy: offer the user's other keys. One click each, because the resume would go to that provider.
        if (/^AJP-AI-/.test(r.code || '') && !['AJP-AI-OFF', 'AJP-AI-KEY'].includes(r.code)) {
          const alt = await AJP.send('ai.alternatives', via ? { exclude: via } : {});
          if (alt && alt.ok !== false && alt.options.length) {
            const esc = AJP.panel.esc;
            return say(
              `<b>${esc(alt.current)}: ${esc(r.error)}</b>${r.hint ? `<br><span class="muted">${esc(r.hint)}</span>` : ''}<br>You can use another AI you set up (your resume and this job go to the one you pick):` +
                `<div class="btns">${alt.options.map((o) => `<button class="b small" data-act="tailor" data-arg="${esc(o.id)}">Try with ${esc(o.label)}${o.paid ? ' (paid)' : ''}</button>`).join('')}</div>` +
                `<span class="muted code">(${esc(r.code)})</span>`,
              true
            );
          }
        }
        return fail(r);
      }
      const d = r.draft;
      const st = d.stats;
      const esc = AJP.panel.esc;
      tr.end({ requirements: st.requirements, edits: st.edits, blocked: st.blocked });
      say(
        `<b>${st.requirements} job requirements</b>: ${st.strong} strong, ${st.partial} partial, ${st.none} not in your resume.<br>` +
          `<b>${st.edits - st.blocked - (st.limited || 0)} suggested edits</b>${st.blocked ? ` (${st.blocked} blocked by safety checks)` : ''}${st.limited ? ` · ${st.limited} more ideas kept aside (light touch)` : ''}` +
          (d.skillOptions && d.skillOptions.length ? `<br>${d.skillOptions.length} job skill${d.skillOptions.length > 1 ? 's' : ''} your resume doesn't show: tick the ones you really have in the review.` : '') +
          `${st.needsMetric ? ` · ${st.needsMetric} could use your real numbers` : ''}.<br>` +
          (d.coverage.atsBefore != null ? `Job keywords in your resume: ${esc(d.coverage.atsBefore)}% → ${esc(d.coverage.atsAfter)}%.<br>` : '') +
          (d.ai ? `<span class="muted">AI: ${esc(d.ai.label)}</span><br>` : '') +
          `<a data-act="openEnhance" data-arg="${esc(d.id)}">Review the changes &amp; create the resume →</a>`
      );
    },

    // The resume tailored for this job, straight from the panel (file name has the job in it).
    async downloadTailored() {
      const resumes = await AJP.store.get('resumes');
      const r = state.tailored && resumes.items.find((x) => x.id === state.tailored.id);
      if (!r || !r.file || !r.file.dataUrl) return say('The tailored resume has no PDF yet. Open Admin → Resumes and click ⬇ Download PDF.', true);
      const blob = await (await fetch(r.file.dataUrl)).blob(); // local dataUrl decode, not a network call
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = r.file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      log.info('Tailored resume downloaded from the panel');
    },

    // "Not this job": stop holding the application in this tab.
    async forgetHeld() {
      await AJP.send('tabJob.forget');
      state.held = null;
      AJP.panel.remove();
    },

    openEnhance(id) {
      AJP.send('openAdmin', { hash: 'resumes?enh=' + id });
    },

    openResumes() {
      AJP.send('openAdmin', { hash: 'resumes' });
    },

    async autofill() {
      state.busy = 'autofill';
      state.autofill = { filled: [], learned: [], unknown: [], questions: [], skipped: [] };
      say('Filling the form…');
      const tr = AJP.startTrace('panel.autofill', { mod: 'content' });
      // Prefer the resume tailored for THIS job (its PDF is what gets uploaded).
      const resumes = await AJP.store.get('resumes');
      const key = AJP.tracker.jobKey(jobMeta().url);
      const tailored = resumes.items.find((x) => x.enhancementId && x.job && x.job.url && AJP.tracker.jobKey(x.job.url) === key);
      const r = await AJP.send('autofillTab', { tid: tr.id, ...trackRef(), resumeId: tailored ? tailored.id : undefined }, tr);
      if (!r.ok) {
        state.busy = '';
        tr.fail(r);
        return fail(r);
      }
      // The frames fill after this answer: stay busy (no second fill on a double click) until the first report.
      clearTimeout(state.busyTimer);
      state.busyTimer = setTimeout(() => {
        if (state.busy === 'autofill') (state.busy = ''), render();
      }, 30000);
      tr.end();
      state.autofillUsed = true;
      if (AJP.workday && AJP.workday.applies()) state.wdStep = AJP.workday.currentStep();
      AJP.send('recordApplication', appPayload({ status: 'in progress', auto: true }), tr);
    },

    async draft(ajpId, btn) {
      const q = state.autofill && state.autofill.questions.find((x) => x.ajpId === ajpId);
      if (!q) return;
      btn.disabled = true;
      btn.textContent = 'Drafting…';
      const maxWords = q.maxLength ? Math.max(20, Math.floor(q.maxLength / 7)) : null;
      const tr = AJP.startTrace('panel.draftAnswer', { mod: 'content', slowMs: 30000 });
      const r = await AJP.send('ai.draftAnswer', { question: q.label, jd: jdText, job: jobMeta(), maxWords, ...trackRef() }, tr);
      if (!r.ok) {
        tr.fail(r);
        btn.disabled = false;
        btn.textContent = '✨ Draft answer with AI';
        return fail(r);
      }
      await AJP.send('fillQuestion', { ajpId, text: r.text }, tr);
      tr.end({ chars: r.text.length });
      btn.textContent = `✓ Drafted${r.ai ? ' by ' + r.ai : ''} — review & edit it in the form`;
    },

    async applied() {
      const r = await AJP.send('recordApplication', appPayload({ status: 'applied', detectedBy: 'manual' }));
      if (r.ok) state.lastApp = r.app;
      if (!r.ok) return fail(r);
      state.held = null; // applied: the job's tracking is offboarded from tab memory (it lives on in Applications)
      say('Marked as applied. <a data-act="undoApplied">Undo</a> · <a data-act="openApps">Open tracker</a>');
    },

    async undoApplied() {
      if (!state.lastApp) return;
      const r = await AJP.send('undoStatus', { id: state.lastApp.id });
      state.lastApp = null;
      say(!r.ok || !r.app ? 'Nothing to undo.' : r.removed ? 'Undone — removed from the tracker.' : `Undone — status is back to “${AJP.panel.esc(r.app.status)}”.`);
    },

    openApps() {
      AJP.send('openAdmin', { hash: 'applications' });
    },

    // Job Radar: watch this company's job board. Without the board's permission yet, Admin opens with the link
    // filled in (the browser only lets an extension page ask for it).
    async watchCompany() {
      const rd = state.radar;
      if (!rd) return;
      const r = await AJP.send('radar.watch.add', { url: rd.url });
      if (r && r.code === 'AJP-RADAR-PERM') {
        await AJP.send('openAdmin', { hash: 'radar?add=' + encodeURIComponent(rd.url) });
        return say(`Allow access to ${AJP.panel.esc(rd.label)} in the Admin tab that just opened, then click Add.`);
      }
      if (!r || r.ok === false) return say(`${AJP.panel.esc((r && r.error) || 'Could not add the company.')} ${AJP.panel.esc((r && r.hint) || '')} (${AJP.panel.esc((r && r.code) || 'AJP-INTERNAL')})`, true);
      rd.watched = true;
      say(`🛰 Watching <b>${AJP.panel.esc(r.entry.companyName)}</b>${r.exists ? '' : `: ${r.entry.openJobs} open job${r.entry.openJobs === 1 ? '' : 's'} today`}. New jobs that fit you will appear in Job Radar. <a data-act="openRadar">Open Job Radar</a>`);
    },
    openRadar() {
      AJP.send('openAdmin', { hash: 'radar' });
    },

    async askYes() {
      const job = state.ask;
      state.ask = null;
      const r = await AJP.send('recordApplication', { app: { ...pickJob(job), status: 'applied', detectedBy: 'confirmed by you' } });
      if (r.ok) state.lastApp = r.app;
      if (!r.ok) return fail(r);
      state.held = null; // applied: the job's tracking is offboarded from tab memory (it lives on in Applications)
      say('Saved as applied. <a data-act="undoApplied">Undo</a>');
    },

    askNo() {
      state.ask = null;
      say('OK — not marked as applied.');
    },
  };

  const pickJob = (j) => ({ url: j.url, title: j.title, company: j.company, location: j.location, score: j.score, trackId: j.trackId, trackName: j.trackName });

  // ---- Apply detection (every frame) ----------------------------------------------
  function startDetector() {
    AJP.detector.start({
      onSubmit() {
        AJP.send('applicationSignal', { signal: 'submit', url: location.href, title: document.title, host: location.hostname });
        // No confirmation after a while? Ask the user instead of guessing.
        setTimeout(async () => {
          const r = await AJP.send('applicationSignal', { signal: 'check' });
          if (r.ok && !r.applied && !r.ignored && r.job) AJP.send('askApplied', { job: r.job });
        }, AJP.detector.CONFIG.askAfterMs);
      },
      onConfirm(how) {
        AJP.send('applicationSignal', { signal: 'confirm', how, url: location.href, title: document.title, host: location.hostname });
      },
    });
  }
  AJP.store.get('settings').then((s) => s.tracker.autoDetect && startDetector());

  // THE STANDARD: every panel action runs through AJP.guard — an unexpected failure is traced, logged
  // with its code (feeding the crash prompt) and shown in the panel instead of failing silently.
  for (const [name, fn] of Object.entries(callbacks)) {
    callbacks[name] = AJP.guard(`panel.${name}`, fn, {
      mod: 'content',
      onError: (d) => {
        state.busy = '';
        fail({ error: d.message, hint: d.hint, code: d.code });
      },
    });
  }

  // ---- Messages from background ------------------------------------------------
  api.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'openPanel' && isTop) {
      state.minimized = false;
      // No job description here (sign-up / login / form page)? Show the application held for this tab instead.
      analyze({ text: msg.jdText }).then((a) => !a && !msg.jdText && holdIfApplying());
    } else if (msg.type === 'doAutofill') {
      (async () => {
        // Use the chosen career track's profile and resume (file) for this application.
        const [rawProfile, answers, resumes] = await Promise.all([AJP.store.get('profile'), AJP.store.get('answers'), AJP.store.get('resumes')]);
        const track = msg.trackId ? AJP.tracks.list(rawProfile).find((t) => t.id === msg.trackId) : null;
        const profile = AJP.tracks.effectiveProfile(rawProfile, track);
        const resume = (msg.resumeId && resumes.items.find((x) => x.id === msg.resumeId)) || AJP.tracks.resumeFor(track, resumes);
        const tr = AJP.startTrace('frame.autofill', { mod: 'filler', tid: msg.tid });
        const report = await AJP.filler.fill({ profile, answers, resume });
        tr.end({ filled: report.filled.length, learned: report.learned.length, unknown: report.unknown.length, questions: report.questions.length, host: location.hostname });
        AJP.filler.startLearning();
        const total = report.filled.length + report.learned.length + report.questions.length + report.unknown.length;
        if (total || isTop) AJP.send('autofillReport', { report });
      })().catch((e) => {
        const x = AJP.toAppError(e);
        log.error('Autofill crashed', { code: x.code, error: x.message, stack: String(e && e.stack).split('\n').slice(0, 5).join('\n'), host: location.hostname }, { code: x.code, tid: msg.tid });
      });
    } else if (msg.type === 'autofillReport' && isTop) {
      if (state.busy === 'autofill') (state.busy = ''), clearTimeout(state.busyTimer);
      const r = msg.report;
      const cur = state.autofill || { filled: [], learned: [], unknown: [], questions: [], skipped: [] };
      for (const k of ['filled', 'learned', 'unknown', 'questions', 'skipped']) cur[k] = cur[k].concat(r[k] || []);
      if (r.attached) cur.attached = r.attached;
      if (r.site) cur.site = r.site;
      cur.notes = (cur.notes || []).concat((r.notes || []).filter((n) => !(cur.notes || []).includes(n)));
      state.autofill = cur;
      state.message = '';
      render();
    } else if (msg.type === 'appliedDetected' && isTop) {
      state.held = null; // applied: offboarded
      state.lastApp = msg.app;
      state.ask = null;
      state.minimized = false;
      say(`✅ Application to <b>${AJP.panel.esc(msg.app.company || msg.app.title || 'this job')}</b> detected and saved as <b>applied</b>. <a data-act="undoApplied">Undo</a> · <a data-act="openApps">Open tracker</a>`);
    } else if (msg.type === 'crashPrompt' && isTop) {
      state.crash = { code: msg.code, msg: msg.msg };
      state.minimized = false;
      render();
    } else if (msg.type === 'askApplied' && isTop) {
      state.ask = msg.job;
      state.minimized = false;
      render();
    } else if (msg.type === 'fillQuestion') {
      AJP.filler.fillQuestion(msg.ajpId, msg.text);
    }
  });

  // ---- Auto-analyze on known job sites (top frame) --------------------------------
  // When the resume tailored for THIS job is created, replaced or deleted (in Admin), the open panel re-scores with it.
  // Any other resume change leaves the panel alone.
  function tailoredSig(items, key) {
    const t = (items || []).find((x) => x.enhancementId && x.job && x.job.url && AJP.tracker.jobKey(x.job.url) === key);
    return t ? `${t.id}@${t.updatedAt || t.createdAt}` : '';
  }
  const rescore = AJP.guard('content.tailoredChanged', () => analyze({ text: state.job && state.job.source === 'selection' ? jdText : null, keepAi: true }), { mod: 'content' });
  AJP.api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.resumes || !state.analysis || window.top !== window) return;
    const key = AJP.tracker.jobKey((state.job && state.job.url) || location.href);
    if (tailoredSig(changes.resumes.newValue && changes.resumes.newValue.items, key) !== (state.tailoredSig || '')) rescore();
  });

  // ---- Holding an application across pages (Apply → new tab → sign up / log in → form) ----------------------------
  // What kind of page is this, for a held application?
  function applyPhase() {
    const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const pw = [...document.querySelectorAll('input[type="password"]')].filter(shown);
    if (pw.length) {
      // Look around the password box (its form, or a few levels up) and at the page title, not the whole page.
      const box = pw[0].closest('form') || (pw[0].parentElement && pw[0].parentElement.parentElement) || document.body;
      const around = `${document.title} ${(box.innerText || box.textContent || '').slice(0, 3000)}`;
      return pw.length >= 2 || /create (an |your )?account|sign ?up|register|new user|join now/i.test(around) ? 'signup' : 'login';
    }
    const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=search]), select, textarea')].filter(shown);
    if (document.querySelector('input[type="file"]') || fields.length >= 3) return 'form';
    return 'waiting';
  }
  // No job description on this page: if this tab holds an application, keep it on screen and follow the steps.
  async function holdIfApplying() {
    const r = await AJP.send('tabJob.get', { url: location.href });
    const job = r && r.ok !== false ? r.job : null;
    if (!job && r && r.expired) {
      heldLost(r.expired);
      return true;
    }
    if (!job) return false;
    const resumes = await AJP.store.get('resumes');
    const t = resumes.items.find((x) => x.enhancementId && x.job && x.job.url && AJP.tracker.jobKey(x.job.url) === job.jobKey);
    state.held = { ...job, tailored: t ? t.name : null };
    state.error = '';
    state.heldPhase = applyPhase();
    state.minimized = false;
    log.info('Application held across pages', { phase: state.heldPhase, host: location.hostname });
    render();
    return true;
  }

  // The hold ran out (over an hour without activity): tell the user, once; they can close it.
  function heldLost(job) {
    state.held = null;
    state.minimized = false;
    state.error = '';
    log.info('Held application lost (expired)');
    say(`⚠️ <b>Tracking of this job was lost</b>${job && job.title ? ` (${AJP.panel.esc(job.title)}${job.company ? ' · ' + AJP.panel.esc(job.company) : ''})` : ''}: more than an hour passed without activity. Open the job page again to track it. <a data-act="close">Close</a>`);
  }

  async function auto() {
    const settings = await AJP.store.get('settings');
    if (!settings.autoAnalyze) return;
    // Known job sites, plus company career sections you allowed when opening a job from Job Radar.
    if (!AJP.jd.isKnownJobSite() && !AJP.radar.detect.inScope(location.href, await AJP.store.get('radarSites'))) return;
    if (/linkedin\.com$/.test(location.hostname) && !location.pathname.startsWith('/jobs')) return;
    state.minimized = true;
    const a = await analyze();
    if (a) return;
    if (!(await holdIfApplying())) AJP.panel.remove(); // stay invisible when there's no JD and nothing held
  }

  // Apply buttons on a job page: remember the job for a tab that opens without a link back to this one.
  const APPLY_RE = /^\s*(easy apply|apply( now| for this (job|position|role))?|apply on (company|employer) (site|website)|start (your )?application|i'?m interested)\s*$/i;
  document.addEventListener('click', (e) => {
    const el = e.target instanceof Element && e.target.closest('a, button, [role="button"]');
    if (!el || !state.analysis || !APPLY_RE.test(el.textContent || '')) return;
    AJP.send('applyClicked', { job: { ...jobMeta(), ...trackRef(), score: state.analysis.score } });
  }, true);

  if (isTop) {
    window.addEventListener('error', (e) => {
      if (String(e.filename || '').includes('extension://')) log.error('Content error', { message: e.message, line: e.lineno });
    });
    setTimeout(auto, 1200);
    // SPA navigation (LinkedIn, Workday): re-run when the URL changes.
    setInterval(() => {
      // Workday: a multi-page application in one URL. After Autofill was used, offer it again on each new page.
      if (state.autofillUsed && AJP.workday && AJP.workday.applies()) {
        const step = AJP.workday.currentStep();
        if (step && state.wdStep && step !== state.wdStep) {
          state.wdStep = step;
          state.autofill = null;
          state.minimized = false;
          log.info('Workday page changed', { step });
          say(`New Workday page: <b>${AJP.panel.esc(step)}</b>. <a data-act="autofill">⚡ Autofill this page</a> <span class="muted">(you still review and click Save and Continue yourself)</span>`);
        }
      }
      // A held application: follow the steps (sign up → log in → form) as the page changes; drop it after an hour idle.
      if (state.held && !state.analysis && Date.now() - (state.held.at || Date.now()) >= 60 * 60 * 1000) heldLost(state.held);
      if (state.held && !state.analysis) {
        const ph = applyPhase();
        if (ph !== state.heldPhase) {
          state.heldPhase = ph;
          if (ph === 'form') state.minimized = false;
          log.info('Held application: next step', { phase: ph });
          render();
        }
      }
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      state.autofill = null;
      state.message = '';
      setTimeout(auto, 1200);
    }, 1000);
  }
  AJP.contentHooks = { holdIfApplying, applyPhase, state, checkRadar, render, resetRadar: () => (radarChecked = "") }; // for tests only
  log.debug('Content ready', { host: location.hostname, top: isTop });
})();
