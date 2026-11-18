/*
 * ai.js — pluggable AI providers (runs in the background context only, so API
 * keys never touch web pages). All providers below have a free tier or run locally.
 *
 *   gemini      Google AI Studio API key (free tier)        https://aistudio.google.com/apikey
 *   groq        Groq API key (free tier, very fast)          https://console.groq.com/keys
 *   openrouter  OpenRouter key, ":free" models               https://openrouter.ai/keys
 *   ollama      Local models, no key, nothing leaves the PC  https://ollama.com
 *
 * Privacy: prompts only ever include resume text, skills and the job
 * description — never EEO answers (race, veteran, disability, gender).
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.ai) return;
  const log = AJP.logger('ai');

  const PROVIDERS = {
    none: { label: 'Off (offline keyword matching only)' },
    gemini: { label: 'Google Gemini (free tier API key)', defaultModel: 'gemini-2.5-flash', needsKey: true },
    groq: { label: 'Groq (free tier API key)', defaultModel: 'llama-3.3-70b-versatile', needsKey: true },
    openrouter: { label: 'OpenRouter (free models)', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free', needsKey: true },
    ollama: { label: 'Ollama (local, private)', defaultModel: 'llama3.1' },
  };

  const CONFIG = { timeoutMs: 90000 }; // tests shorten this

  async function fetchJson(url, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      return JSON.parse(text);
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`AI request timed out after ${CONFIG.timeoutMs / 1000}s`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
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

  function parseJsonLoose(text) {
    const s = String(text || '').replace(/```(?:json)?/gi, '');
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('AI did not return JSON');
    return JSON.parse(s.slice(a, b + 1));
  }

  async function complete({ system, prompt, json = false, task = 'complete' }) {
    const settings = await AJP.store.get('settings');
    const cfg = settings.ai;
    const p = PROVIDERS[cfg.provider];
    if (!p || cfg.provider === 'none') throw new Error('AI is turned off. Pick a free provider in Admin → AI Settings.');
    if (p.needsKey && !cfg.keys[cfg.provider]) throw new Error(`No API key saved for ${p.label}. Add it in Admin → AI Settings.`);
    const model = cfg.model || p.defaultModel;
    const t0 = Date.now();
    log.info(`${task}: calling ${cfg.provider}/${model}`, { promptChars: prompt.length });
    try {
      const out = await CALLERS[cfg.provider](cfg, model, system, prompt, json);
      log.info(`${task}: ok in ${Date.now() - t0}ms`, { outChars: out.length });
      return json ? parseJsonLoose(out) : out.trim();
    } catch (e) {
      log.error(`${task}: failed after ${Date.now() - t0}ms`, { provider: cfg.provider, model, error: e.message });
      throw e;
    }
  }

  const clip = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + '\n…[truncated]' : String(s || ''));

  function skillList(profile) {
    return (profile.skills || []).map((s) => (s.years ? `${s.name} (${s.years}y${s.level ? ', ' + s.level : ''})` : s.name)).join(', ');
  }

  // ---- Tasks ---------------------------------------------------------------
  const tasks = {
    extractSkills({ jd }) {
      return complete({
        task: 'extractSkills',
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

    tailorResume({ jd, resumeText, profile, missing, job }) {
      return complete({
        task: 'tailorResume',
        system:
          'You are an honest, expert resume writer. You NEVER invent employers, job titles, dates, degrees, ' +
          'certifications, metrics or skills the candidate has no evidence for. You may reorder, rephrase, tighten, ' +
          'and emphasize truthful, transferable experience, and mirror the job\'s terminology where it is accurate.',
        prompt:
          `Tailor this resume for the role "${(job && job.title) || 'the target role'}"` +
          `${job && job.company ? ' at ' + job.company : ''}.\n\n` +
          'Output format:\n1) The full tailored resume in Markdown (# Name, contact line, ## Summary, ## Skills, ## Experience, ## Education ...).\n' +
          '2) Then a line containing exactly ---GAPS---\n' +
          '3) Then a bullet list: for each gap skill, either "covered: <where in resume it is now evidenced>" ' +
          'or "not covered: <honest suggestion — e.g. a short course, side project, or how to address it in an interview>".\n\n' +
          `GAP SKILLS (from the job, not found in the candidate profile): ${(missing || []).join(', ') || 'none'}\n\n` +
          `CANDIDATE SKILLS (self-reported): ${skillList(profile)}\n\n` +
          `CURRENT RESUME:\n${clip(resumeText, 15000)}\n\nJOB DESCRIPTION:\n${clip(jd, 10000)}`,
      });
    },

    draftAnswer({ question, jd, resumeText, profile, job, maxWords }) {
      const p = profile.personal || {};
      return complete({
        task: 'draftAnswer',
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

    async test() {
      const out = await complete({ task: 'test', system: 'Reply with one word.', prompt: 'Say OK.' });
      return out;
    },
  };

  AJP.ai = { PROVIDERS, CONFIG, complete, tasks, parseJsonLoose };
})();
