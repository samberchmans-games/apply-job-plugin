/*
 * ai.js — pluggable AI providers (runs in the background context only, so API
 * keys never touch web pages). All providers below have a free tier or run locally.
 *
 *   gemini      Google AI Studio API key (free tier)        https://aistudio.google.com/apikey
 *   groq        Groq API key (free tier, very fast)          https://console.groq.com/keys
 *   openrouter  OpenRouter key, ":free" models               https://openrouter.ai/keys
 *   ollama      Local models, no key, nothing leaves the PC  https://ollama.com
 *   chrome      Chrome's built-in on-device model (Gemini Nano) through the Prompt API: no key, no account,
 *               nothing leaves the computer. Needs a recent desktop Chrome and a one-time model download
 *               (started from Admin, because the browser requires a click). Edge exposes the same API.
 *
 * Privacy: prompts only ever include resume text, skills and the job
 * description — never EEO answers (race, veteran, disability, gender).
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.ai) return;

  const PROVIDERS = {
    none: { label: 'Off (offline keyword matching only)' },
    chrome: { label: 'Chrome built-in AI (on-device, no key, private)', defaultModel: 'on-device', local: true },
    gemini: { label: 'Google Gemini (free tier API key)', defaultModel: 'gemini-2.5-flash', needsKey: true },
    groq: { label: 'Groq (free tier API key)', defaultModel: 'llama-3.3-70b-versatile', needsKey: true },
    openrouter: { label: 'OpenRouter (free models)', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free', needsKey: true },
    ollama: { label: 'Ollama (local, private)', defaultModel: 'llama3.1' },
  };

  const CONFIG = { timeoutMs: 90000, tries: 3, localMaxChars: 16000 }; // tests shorten these

  // Network goes through the shared standard (errors.js AJP.http): timeout, coded errors, retries for
  // temporary failures (server errors, network blips, short rate-limit waits). Timeouts are not retried
  // (each already waited CONFIG.timeoutMs).
  function fetchJson(url, opts) {
    return AJP.http(url, opts, {
      timeoutMs: CONFIG.timeoutMs,
      tries: CONFIG.tries,
      statusKey: AJP.aiErrorForStatus,
      networkKey: 'AI_NETWORK',
      timeoutKey: 'AI_TIMEOUT',
      badJsonKey: 'AI_BAD_RESPONSE',
      label: 'ai request',
      log: AJP.logger('ai'),
    });
  }

  async function callOpenAICompatible(url, key, model, system, prompt, json, extraHeaders = {}) {
    const body = {
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    };
    if (json) body.response_format = { type: 'json_object' };
    const data = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...extraHeaders },
      body: JSON.stringify(body),
    });
    return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
  }

  const CALLERS = {
    async gemini(cfg, model, system, prompt, json) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, ...(json ? { responseMimeType: 'application/json' } : {}) },
      };
      const data = await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.keys.gemini },
        body: JSON.stringify(body),
      });
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      return parts.map((p) => p.text || '').join('');
    },
    groq(cfg, model, system, prompt, json) {
      return callOpenAICompatible('https://api.groq.com/openai/v1/chat/completions', cfg.keys.groq, model, system, prompt, json);
    },
    openrouter(cfg, model, system, prompt, json) {
      return callOpenAICompatible('https://openrouter.ai/api/v1/chat/completions', cfg.keys.openrouter, model, system, prompt, json, {
        'X-Title': 'Apply Job Assistant',
      });
    },
    async ollama(cfg, model, system, prompt, json) {
      const base = (cfg.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
      const data = await fetchJson(base + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          ...(json ? { format: 'json' } : {}),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
      });
      return (data.message && data.message.content) || '';
    },
  };

  // ---- Chrome built-in AI (Prompt API) ------------------------------------------------------------
  // Current API: global LanguageModel (Chrome 138+, Edge). Older builds: ai.languageModel with capabilities().
  const LOCAL_OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
  function localApi() {
    const g = globalThis;
    if (g.LanguageModel && typeof g.LanguageModel.create === 'function') return { kind: 'LanguageModel', api: g.LanguageModel };
    if (g.ai && g.ai.languageModel && typeof g.ai.languageModel.create === 'function') return { kind: 'ai.languageModel', api: g.ai.languageModel };
    return null;
  }
  async function localAvailability(lm) {
    if (lm.kind === 'LanguageModel') return String(await lm.api.availability(LOCAL_OPTS));
    const c = await lm.api.capabilities();
    return { readily: 'available', 'after-download': 'downloadable', no: 'unavailable' }[c && c.available] || 'unavailable';
  }
  function localCreate(lm, system, { signal, onProgress } = {}) {
    const monitor = onProgress ? (m) => m.addEventListener('downloadprogress', (e) => onProgress(e.total ? e.loaded / e.total : e.loaded)) : undefined;
    if (lm.kind === 'LanguageModel') return lm.api.create({ ...LOCAL_OPTS, ...(system ? { initialPrompts: [{ role: 'system', content: system }] } : {}), ...(monitor ? { monitor } : {}), signal });
    return lm.api.create({ ...(system ? { systemPrompt: system } : {}), ...(monitor ? { monitor } : {}), signal });
  }

  // The on-device model has a small input window: shrink the long blocks (resume, job post) proportionally,
  // keep the short ones (instructions, rules) whole.
  function fitPrompt(prompt, maxChars) {
    const text = String(prompt || '');
    if (text.length <= maxChars) return text;
    const blocks = text.split('\n\n');
    const LONG = 600;
    const longTotal = blocks.reduce((n, b) => n + (b.length > LONG ? b.length : 0), 0);
    const excess = text.length - maxChars + blocks.filter((b) => b.length > LONG).length * 16;
    if (!longTotal) return text.slice(0, maxChars);
    return blocks.map((b) => (b.length > LONG ? b.slice(0, Math.max(200, Math.floor(b.length - (excess * b.length) / longTotal))) + '\n…[shortened]' : b)).join('\n\n');
  }

  function localError(e, reason) {
    if (e && typeof e.code === 'string' && e.code.startsWith('AJP-')) return e;
    const name = (e && e.name) || '';
    if (name === 'AbortError' || name === 'TimeoutError') return AJP.err('AI_TIMEOUT', { provider: 'chrome' }, e);
    if (name === 'QuotaExceededError') return AJP.err('AI_LOCAL_TOO_LONG', { reason: reason || 'input too long' }, e);
    if (name === 'NotAllowedError') return AJP.err('AI_LOCAL_DOWNLOAD', { reason: 'the browser needs a click to start the model', name }, e);
    return AJP.err('AI_LOCAL_UNAVAILABLE', { name, reason: (e && e.message ? String(e.message) : String(e)).slice(0, 160) }, e);
  }

  async function promptOnce(session, text, json, signal) {
    if (!json) return session.prompt(text, { signal });
    try {
      return await session.prompt(text, { signal, responseConstraint: { type: 'object' } });
    } catch (e) {
      // Older builds don't know responseConstraint: ask again without it (the prompt already says "JSON only").
      if (e && (e.name === 'NotSupportedError' || e.name === 'TypeError' || e instanceof TypeError)) return session.prompt(text, { signal });
      throw e;
    }
  }

  async function callLocal(cfg, model, system, prompt, json) {
    const lm = localApi();
    if (!lm) throw AJP.err('AI_LOCAL_UNSUPPORTED');
    let state;
    try {
      state = await localAvailability(lm);
    } catch (e) {
      throw localError(e);
    }
    if (state === 'unavailable') throw AJP.err('AI_LOCAL_UNAVAILABLE', { reason: 'this computer or browser cannot run the on-device model' });
    if (state !== 'available') throw AJP.err('AI_LOCAL_DOWNLOAD', { state });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CONFIG.timeoutMs);
    let session;
    try {
      session = await localCreate(lm, system, { signal: ctl.signal });
      let text = fitPrompt(prompt, CONFIG.localMaxChars);
      for (let attempt = 0; ; attempt++) {
        if (typeof session.measureInputUsage === 'function' && session.inputQuota) {
          const used = await session.measureInputUsage(text);
          const room = session.inputQuota - (session.inputUsage || 0);
          if (used > room) {
            if (attempt >= 3) throw AJP.err('AI_LOCAL_TOO_LONG', { used, room });
            text = fitPrompt(text, Math.floor(text.length * Math.max(0.3, (room / used) * 0.9)));
            continue;
          }
        }
        try {
          return await promptOnce(session, text, json, ctl.signal);
        } catch (e) {
          if (e && e.name === 'QuotaExceededError' && attempt < 3) {
            text = fitPrompt(text, Math.floor(text.length * 0.7));
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      throw localError(e);
    } finally {
      clearTimeout(timer);
      try {
        if (session && session.destroy) session.destroy();
      } catch (_) {
        /* the session is gone either way; destroying it is only to free memory */
      }
    }
  }
  CALLERS.chrome = callLocal;

  // Status for Admin / background: { state: available|downloadable|downloading|unavailable|unsupported, api }
  async function localStatus() {
    const lm = localApi();
    if (!lm) return { state: 'unsupported', api: null };
    try {
      return { state: await localAvailability(lm), api: lm.kind };
    } catch (e) {
      const x = localError(e);
      return { state: 'unavailable', api: lm.kind, code: x.code, error: x.message };
    }
  }
  // One-time model download: must run in a page, from a click (the browser requires a user gesture).
  async function localDownload(onProgress) {
    const lm = localApi();
    if (!lm) throw AJP.err('AI_LOCAL_UNSUPPORTED');
    let session;
    try {
      session = await localCreate(lm, '', { onProgress });
    } catch (e) {
      throw localError(e);
    } finally {
      try {
        if (session && session.destroy) session.destroy();
      } catch (_) {
        /* only freeing memory */
      }
    }
    return localStatus();
  }

  function parseJsonLoose(text) {
    const s = String(text || '').replace(/```(?:json)?/gi, '');
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b < a) throw AJP.err('AI_BAD_RESPONSE', { reason: 'no JSON in answer', sample: s.slice(0, 120) });
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch (e) {
      throw AJP.err('AI_BAD_RESPONSE', { reason: 'invalid JSON in answer', sample: s.slice(a, a + 120) }, e);
    }
  }

  async function complete({ system, prompt, json = false, task = 'complete', tid }) {
    const settings = await AJP.store.get('settings');
    const cfg = settings.ai;
    const p = PROVIDERS[cfg.provider];
    if (!p || cfg.provider === 'none') throw AJP.err('AI_OFF');
    if (p.needsKey && !cfg.keys[cfg.provider]) throw AJP.err('AI_NO_KEY', { provider: cfg.provider });
    const model = cfg.model || p.defaultModel;
    const tr = AJP.startTrace(`ai.${task}`, { mod: 'ai', tid, slowMs: 30000, data: { provider: cfg.provider, model, promptChars: prompt.length } });
    try {
      let out = await CALLERS[cfg.provider](cfg, model, system, prompt, json);
      if (!out || !String(out).trim()) throw AJP.err('AI_BAD_RESPONSE', { reason: 'empty answer' });
      let result;
      if (json) {
        try {
          result = parseJsonLoose(out);
        } catch (e) {
          // Free models sometimes add prose or break JSON: retry once with a firm reminder.
          tr.log.warn(`ai.${task} invalid JSON, retrying once`, { reason: e.details && e.details.reason });
          out = await CALLERS[cfg.provider](cfg, model, system, prompt + '\n\nIMPORTANT: Your previous reply was not valid JSON. Reply with ONE valid JSON object only, no other text.', json);
          result = parseJsonLoose(out);
        }
      } else result = out.trim();
      tr.end({ provider: cfg.provider, model, outChars: out.length });
      return result;
    } catch (e) {
      throw tr.fail(e, { provider: cfg.provider, model });
    }
  }

  const clip = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + '\n…[truncated]' : String(s || ''));

  function skillList(profile) {
    return (profile.skills || []).map((s) => (s.years ? `${s.name} (${s.years}y${s.level ? ', ' + s.level : ''})` : s.name)).join(', ');
  }

  // ---- Tasks ---------------------------------------------------------------
  const tasks = {
    extractSkills({ jd, tid }) {
      return complete({
        task: 'extractSkills',
        tid,
        json: true,
        system: 'You analyze job descriptions for a job seeker. Reply with strict JSON only.',
        prompt:
          'From the job description below, return JSON with this exact shape:\n' +
          '{"title":"","company":"","required_skills":[],"preferred_skills":[],"years_required":null,"seniority":"","summary":""}\n' +
          'Rules: skills are short canonical names (e.g. "Kubernetes", "Stakeholder management"), max 25 each, ' +
          'no duplicates, no generic filler like "team player". summary = 2 sentences.\n\nJOB DESCRIPTION:\n' +
          clip(jd, 14000),
      });
    },

    // Resume enhancement v2, stage 1: requirements + evidence (prompt lives in resume-engine.js).
    analyzeForResume({ jd, resumeText, tid }) {
      return complete({ task: 'resume.analyze', tid, json: true, ...AJP.resumeEngine.analyzePrompt({ jd, resumeText }) });
    },

    // Stage 3: targeted, evidence-backed edits.
    proposeResumeEdits({ doc, requirements, atsKeywords, skills, job, tid }) {
      return complete({ task: 'resume.edits', tid, json: true, ...AJP.resumeEngine.editsPrompt({ doc, requirements, atsKeywords, skills, job }) });
    },

    draftAnswer({ question, jd, resumeText, profile, job, maxWords, tid }) {
      const p = profile.personal || {};
      return complete({
        task: 'draftAnswer',
        tid,
        system:
          'You help a job seeker answer application questions in first person. Be specific, warm and concise. ' +
          'Use ONLY facts from the resume and profile. If a needed fact is missing, insert a short [bracketed placeholder] ' +
          'for the candidate to fill. Never invent facts. Output only the answer text.',
        prompt:
          `Application question: "${question}"\n` +
          `Length: ${maxWords ? 'at most ' + maxWords + ' words' : '80-180 words unless the question clearly wants a short answer'}.\n\n` +
          `Role: ${(job && job.title) || ''} ${job && job.company ? 'at ' + job.company : ''}\n` +
          `Candidate: ${[p.firstName, p.lastName].filter(Boolean).join(' ')}, ${p.currentTitle || ''} ${p.yearsExperience ? '(' + p.yearsExperience + ' yrs)' : ''}\n` +
          `Skills: ${skillList(profile)}\n\nRESUME:\n${clip(resumeText, 12000)}\n\nJOB DESCRIPTION:\n${clip(jd, 6000)}`,
      });
    },

    test({ tid } = {}) {
      return complete({ task: 'test', tid, system: 'Reply with one word.', prompt: 'Say OK.' });
    },
  };

  AJP.ai = { PROVIDERS, CONFIG, complete, tasks, parseJsonLoose, local: { api: localApi, status: localStatus, download: localDownload, fitPrompt } };
})();
