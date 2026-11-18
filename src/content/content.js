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

  const state = { job: null, analysis: null, aiSkills: null, aiUsed: false, minimized: false, busy: '', message: '', messageErr: false, autofill: null, error: '' };
  let jdText = '';
  let lastUrl = location.href;

  AJP.store.get('settings').then((s) => AJP.setLogLevel(s.logLevel));

  const render = () => isTop && AJP.panel.render(state, callbacks);
  const say = (message, err = false) => {
    state.message = message;
    state.messageErr = err;
    render();
  };

  async function analyze({ text = null, keepAi = false } = {}) {
    const t0 = performance.now();
    let job;
    if (text) job = { title: document.title, company: '', location: '', text, url: location.href, source: 'selection' };
    else job = AJP.jd.extract();
    if (!job) {
      state.error = 'Could not find a job description on this page.';
      state.analysis = null;
      render();
      return null;
    }
    state.error = '';
    if (!keepAi || jdText !== job.text) {
      state.aiSkills = null;
      state.aiUsed = false;
    }
    jdText = job.text;
    state.job = job;
    const [profile, resume] = await Promise.all([AJP.store.get('profile'), AJP.store.activeResume()]);
    state.analysis = AJP.matcher.analyze({ jdText, profile, resumeText: resume ? resume.text : '', aiSkills: state.aiSkills, jobLocation: job.location });
    log.info('Analyzed job', { source: job.source, score: state.analysis.score, matched: state.analysis.matched.length, missing: state.analysis.missing.length, ms: Math.round(performance.now() - t0) });
    render();
    return state.analysis;
  }

  function jobMeta() {
    const j = state.job || {};
    return { title: j.title, company: j.company, url: j.url || location.href, location: j.location };
  }

  const callbacks = {
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
      const r = await AJP.send('ai.extractSkills', { jd: jdText });
      state.busy = '';
      if (!r.ok) return say(r.error, true);
      const x = r.result || {};
      state.aiSkills = { required: x.required_skills || [], preferred: x.preferred_skills || [] };
      state.aiUsed = true;
      if (x.company && state.job && !state.job.company) state.job.company = x.company;
      state.message = x.summary ? AJP.panel.esc(x.summary) + (x.years_required ? `<br><span class="muted">Years required: ${AJP.panel.esc(x.years_required)}</span>` : '') : '';
      await analyze({ text: state.job && state.job.source === 'selection' ? jdText : null, keepAi: true });
    },

    async tailor() {
      state.busy = 'tailor';
      say('Tailoring your resume to this job (only truthful changes)… this can take ~30s.');
      const missing = (state.analysis ? state.analysis.missing : []).map((m) => m.skill);
      const r = await AJP.send('ai.tailorResume', { jd: jdText, missing, job: jobMeta() });
      state.busy = '';
      if (!r.ok) return say(AJP.panel.esc(r.error), true);
      say(`Saved “${AJP.panel.esc(r.resume.name)}”. <a data-act="openResumes">Open in Admin → Resumes</a> to review, edit, export to PDF and make it active.`);
    },

    openResumes() {
      AJP.send('openAdmin', { hash: 'resumes' });
    },

    async autofill() {
      state.busy = 'autofill';
      state.autofill = { filled: [], learned: [], unknown: [], questions: [], skipped: [] };
      say('Filling the form…');
      const r = await AJP.send('autofillTab', {});
      state.busy = '';
      if (!r.ok) return say(AJP.panel.esc(r.error), true);
      AJP.send('recordApplication', { app: { ...jobMeta(), score: state.analysis && state.analysis.score, status: 'in progress' } });
    },

    async draft(ajpId, btn) {
      const q = state.autofill && state.autofill.questions.find((x) => x.ajpId === ajpId);
      if (!q) return;
      btn.disabled = true;
      btn.textContent = 'Drafting…';
      const maxWords = q.maxLength ? Math.max(20, Math.floor(q.maxLength / 7)) : null;
      const r = await AJP.send('ai.draftAnswer', { question: q.label, jd: jdText, job: jobMeta(), maxWords });
      if (!r.ok) return say(AJP.panel.esc(r.error), true);
      await AJP.send('fillQuestion', { ajpId, text: r.text });
      btn.textContent = '✓ Drafted — review & edit it in the form';
    },

    async applied() {
      const r = await AJP.send('recordApplication', { app: { ...jobMeta(), score: state.analysis && state.analysis.score, status: 'applied', appliedAt: new Date().toISOString() } });
      say(r.ok ? 'Marked as applied. See Admin → Applications.' : AJP.panel.esc(r.error), !r.ok);
    },
  };

  // ---- Messages from background ------------------------------------------------
  api.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'openPanel' && isTop) {
      state.minimized = false;
      analyze({ text: msg.jdText });
    } else if (msg.type === 'doAutofill') {
      (async () => {
        const [profile, answers, resume] = await Promise.all([AJP.store.get('profile'), AJP.store.get('answers'), AJP.store.activeResume()]);
        const report = await AJP.filler.fill({ profile, answers, resume });
        AJP.filler.startLearning();
        const total = report.filled.length + report.learned.length + report.questions.length + report.unknown.length;
        if (total || isTop) AJP.send('autofillReport', { report });
      })().catch((e) => log.error('Autofill crashed', { error: e.message, stack: e.stack }));
    } else if (msg.type === 'autofillReport' && isTop) {
      const r = msg.report;
      const cur = state.autofill || { filled: [], learned: [], unknown: [], questions: [], skipped: [] };
      for (const k of ['filled', 'learned', 'unknown', 'questions', 'skipped']) cur[k] = cur[k].concat(r[k] || []);
      state.autofill = cur;
      state.message = '';
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
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      state.autofill = null;
      state.message = '';
      setTimeout(auto, 1200);
    }, 1000);
  }
  log.debug('Content ready', { host: location.hostname, top: isTop });
})();
