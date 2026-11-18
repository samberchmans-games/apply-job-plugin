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
    if (!keepAi || jdText !== job.text) {
      state.aiSkills = null;
      state.aiUsed = false;
    }
    // A different job (e.g. clicking the next job on LinkedIn) gets its own best track, not the last pick.
    if (jdText !== job.text) state.trackPicked = null;
    jdText = job.text;
    state.job = job;
    const [profile, resumes] = await Promise.all([AJP.store.get('profile'), AJP.store.get('resumes')]);
    // Score the job against every career track; keep the user's pick for this page, else the best track.
    const all = AJP.tracks.analyzeAll({ jdText, jobTitle: job.title, jobLocation: job.location, profile, resumes, aiSkills: state.aiSkills });
    state.tracks = all;
    if (!state.trackPicked || !all.results.some((r) => r.track.id === state.trackPicked)) state.trackPicked = null;
    state.trackId = state.trackPicked || all.bestId;
    state.analysis = selected().analysis;
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
    return s && !s.track.implicit ? { trackId: s.track.id, trackName: s.track.name } : {};
  };

  function jobMeta() {
    const j = state.job || {};
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

  const appPayload = (extra) => ({ app: { ...jobMeta(), ...trackRef(), score: state.analysis && state.analysis.score, snapshot: jdText ? snapshot() : undefined, ...extra } });

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
      state.aiUsed = true;
      if (x.company && state.job && !state.job.company) state.job.company = x.company;
      state.message = x.summary ? AJP.panel.esc(x.summary) + (x.years_required ? `<br><span class="muted">Years required: ${AJP.panel.esc(x.years_required)}</span>` : '') : '';
      await analyze({ text: state.job && state.job.source === 'selection' ? jdText : null, keepAi: true });
    },

    async tailor() {
      state.busy = 'tailor';
      say('Reading the job’s requirements and matching them to your resume — this takes ~20–40s…');
      const tr = AJP.startTrace('panel.enhanceResume', { mod: 'content', slowMs: 90000 });
      const r = await AJP.send('resume.enhance', { jd: jdText, job: jobMeta(), ...trackRef() }, tr);
      state.busy = '';
      if (!r.ok) {
        tr.fail(r);
        return fail(r);
      }
      const d = r.draft;
      const st = d.stats;
      const esc = AJP.panel.esc;
      tr.end({ requirements: st.requirements, edits: st.edits, blocked: st.blocked });
      say(
        `<b>${st.requirements} job requirements</b>: ${st.strong} strong, ${st.partial} partial, ${st.none} not in your resume.<br>` +
          `<b>${st.edits - st.blocked} suggested edits</b>${st.blocked ? ` (${st.blocked} blocked by safety checks)` : ''}` +
          `${st.needsMetric ? ` · ${st.needsMetric} could use your real numbers` : ''}.<br>` +
          (d.coverage.atsBefore != null ? `Job keywords in your resume: ${esc(d.coverage.atsBefore)}% → ${esc(d.coverage.atsAfter)}%.<br>` : '') +
          `<a data-act="openEnhance" data-arg="${esc(d.id)}">Review the changes &amp; create the resume →</a>`
      );
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
      state.busy = '';
      if (!r.ok) {
        tr.fail(r);
        return fail(r);
      }
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
      btn.textContent = '✓ Drafted — review & edit it in the form';
    },

    async applied() {
      const r = await AJP.send('recordApplication', appPayload({ status: 'applied', detectedBy: 'manual' }));
      if (r.ok) state.lastApp = r.app;
      if (!r.ok) return fail(r);
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

    async askYes() {
      const job = state.ask;
      state.ask = null;
      const r = await AJP.send('recordApplication', { app: { ...pickJob(job), status: 'applied', detectedBy: 'confirmed by you' } });
      if (r.ok) state.lastApp = r.app;
      if (!r.ok) return fail(r);
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
      analyze({ text: msg.jdText });
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
      const r = msg.report;
      const cur = state.autofill || { filled: [], learned: [], unknown: [], questions: [], skipped: [] };
      for (const k of ['filled', 'learned', 'unknown', 'questions', 'skipped']) cur[k] = cur[k].concat(r[k] || []);
      if (r.attached) cur.attached = r.attached;
      state.autofill = cur;
      state.message = '';
      render();
    } else if (msg.type === 'appliedDetected' && isTop) {
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
  async function auto() {
    const settings = await AJP.store.get('settings');
    if (!settings.autoAnalyze || !AJP.jd.isKnownJobSite()) return;
    if (/linkedin\.com$/.test(location.hostname) && !location.pathname.startsWith('/jobs')) return;
    state.minimized = true;
    const a = await analyze();
    if (!a) AJP.panel.remove(); // stay invisible when there's no JD
  }

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
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      state.autofill = null;
      state.message = '';
      setTimeout(auto, 1200);
    }, 1000);
  }
  log.debug('Content ready', { host: location.hostname, top: isTop });
})();
