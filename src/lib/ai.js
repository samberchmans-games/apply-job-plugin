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
    nvidia: { label: 'NVIDIA NIM (free API key)', defaultModel: 'meta/llama-3.3-70b-instruct', needsKey: true },
    mistral: { label: 'Mistral (free plan API key)', defaultModel: 'mistral-medium-latest', needsKey: true },
    // Not free: billed per use from the user's prepaid Anthropic API credit (a Claude.ai / Claude Code plan doesn't cover it).
    anthropic: { label: 'Anthropic Claude (paid API key, pay per use)', defaultModel: 'claude-opus-5-5', needsKey: true, paid: true },
  };

  // patienceMs: for resume tailoring, a free-tier rate limit ("try again in 20s") is waited out once, up to this long.
  // testTimeoutMs: "Test connection" asks for one word; a model that can't say OK in 30 s is not usable anyway.
  const CONFIG = { timeoutMs: 90000, testTimeoutMs: 30000, tries: 3, localMaxChars: 16000, patienceMs: 60000 }; // tests shorten these

  // Network goes through the shared standard (errors.js AJP.http): timeout, coded errors, retries for
  // temporary failures (server errors, network blips, short rate-limit waits). Timeouts are not retried
  // (each already waited CONFIG.timeoutMs).
  // "Free tier not available for this project / set up billing", "User location is not supported", or a quota of
  // "limit: 0" all mean the same to the user: this key can't be used for free. Say that, and point to Groq.
  const NO_FREE_TIER = /free tier is not available|set up billing|billing (account|is required|to upgrade)|enable billing|location is not supported|FAILED_PRECONDITION|limit:\s*0\b/i;
  // Anthropic: "Your credit balance is too low to access the Anthropic API" = the paid key has no credit left.
  const NO_CREDIT = /credit balance is too low/i;
  async function fetchJson(url, opts) {
    try {
      return await request(url, opts);
    } catch (e) {
      const x = AJP.toAppError(e);
      if (/^AJP-AI-(HTTP|401|429)$/.test(x.code) && NO_CREDIT.test(String((x.details && x.details.body) || ''))) {
        throw AJP.err('AI_CREDIT', { status: x.details.status, host: x.details.host }, e);
      }
      if (/^AJP-AI-(429|HTTP|401|404)$/.test(x.code) && NO_FREE_TIER.test(String((x.details && x.details.body) || ''))) {
        throw AJP.err('AI_BILLING', { status: x.details.status, host: x.details.host }, e);
      }
      throw e;
    }
  }
  function request(url, opts = {}) {
    const { timeoutMs, ...rest } = opts;
    return AJP.http(url, rest, {
      timeoutMs: timeoutMs || CONFIG.timeoutMs,
      tries: CONFIG.tries,
      statusKey: AJP.aiErrorForStatus,
      networkKey: 'AI_NETWORK',
      timeoutKey: 'AI_TIMEOUT',
      badJsonKey: 'AI_BAD_RESPONSE',
      label: 'ai request',
      log: AJP.logger('ai'),
    });
  }

  // jsonMode false: the provider/model may reject response_format, so JSON is asked for in the prompt only
  // (parseJsonLoose + the one JSON retry in complete() handle the rest).
  async function callOpenAICompatible(url, key, model, system, prompt, json, { headers: extraHeaders = {}, jsonMode = true, timeoutMs } = {}) {
    const body = {
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    };
    if (json && jsonMode) body.response_format = { type: 'json_object' };
    if (json && !jsonMode) body.messages[0].content += '\n\nReply with ONE valid JSON object only, no other text.';
    const data = await fetchJson(url, {
      timeoutMs,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...extraHeaders },
      body: JSON.stringify(body),
    });
    return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
  }

  const ANTHROPIC_FALLBACK = /^claude-(fable-5-[12]|opus-5(-5)?|sonnet-5-5)$/; // models with server-side refusal fallback
  const CALLERS = {
    async gemini(cfg, model, system, prompt, json) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, ...(json ? { responseMimeType: 'application/json' } : {}) },
      };
      const data = await fetchJson(url, {
        timeoutMs: cfg.timeoutMs,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.keys.gemini },
        body: JSON.stringify(body),
      });
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      return parts.map((p) => p.text || '').join('');
    },
    groq(cfg, model, system, prompt, json) {
      return callOpenAICompatible('https://api.groq.com/openai/v1/chat/completions', cfg.keys.groq, model, system, prompt, json, { timeoutMs: cfg.timeoutMs });
    },
    openrouter(cfg, model, system, prompt, json) {
      return callOpenAICompatible('https://openrouter.ai/api/v1/chat/completions', cfg.keys.openrouter, model, system, prompt, json, {
        headers: { 'X-Title': 'Apply Job Assistant' },
        timeoutMs: cfg.timeoutMs,
      });
    },
    nvidia(cfg, model, system, prompt, json) {
      return callOpenAICompatible('https://integrate.api.nvidia.com/v1/chat/completions', cfg.keys.nvidia, model, system, prompt, json, { jsonMode: false, timeoutMs: cfg.timeoutMs });
    },
    mistral(cfg, model, system, prompt, json) {
      return callOpenAICompatible('https://api.mistral.ai/v1/chat/completions', cfg.keys.mistral, model, system, prompt, json, { timeoutMs: cfg.timeoutMs });
    },
    // Anthropic Messages API. Raw HTTP through AJP.http (no build step, so no SDK bundle), from the background only.
    // Current models think adaptively; only the text blocks are the answer. A safety refusal (HTTP 200,
    // stop_reason "refusal") is a coded error; models that support it get Anthropic's server-side fallback.
    async anthropic(cfg, model, system, prompt, json) {
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': cfg.keys.anthropic,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true', // the call is made from the extension, with the user's own key
      };
      const body = {
        model,
        max_tokens: 16000,
        system: json ? system + '\n\nReply with ONE valid JSON object only, no other text.' : system,
        messages: [{ role: 'user', content: prompt }],
      };
      if (ANTHROPIC_FALLBACK.test(model)) {
        headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
        body.fallbacks = 'default';
      }
      const data = await fetchJson('https://api.anthropic.com/v1/messages', { timeoutMs: cfg.timeoutMs, method: 'POST', headers, body: JSON.stringify(body) });
      if (data.stop_reason === 'refusal') {
        throw AJP.err('AI_REFUSED', { provider: 'anthropic', category: (data.stop_details && data.stop_details.category) || null });
      }
      return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('');
    },
    async ollama(cfg, model, system, prompt, json) {
      const base = (cfg.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
      const data = await fetchJson(base + '/api/chat', {
        timeoutMs: cfg.timeoutMs,
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

  // ---- Model discovery: providers retire free models; when one answers "model not found", ask which models it offers
  // now, pick the best fit, remember it (settings.ai.resolvedModels) and retry. Preferences first, then any suitable model.
  const PREFER = {
    groq: [/^llama-3\.3-70b/, /^openai\/gpt-oss-120b/, /^meta-llama\/llama-4-maverick/, /^qwen\/qwen3-32b/, /^moonshotai\/kimi-k2/, /^meta-llama\/llama-4-scout/, /^openai\/gpt-oss-20b/, /^llama-3\.1-8b/],
    gemini: [/^gemini-2\.5-flash$/, /^gemini-flash-latest$/, /^gemini-[\d.]+-flash(-\d{3})?$/, /^gemini-2\.5-flash-lite$/, /^gemini-flash-lite-latest$/, /^gemini-[\d.]+-flash-lite(-\d{3})?$/,
      /^gemini-[\d.]+-flash-preview(-[\d-]+)?$/, /^gemini-pro-latest$/, /^gemini-[\d.]+-pro$/],
    // Capable free models first; small "flash/mini/nano" ones only as a last resort (they tailor poorly).
    openrouter: [/llama-3\.3-70b.*:free$/, /gpt-oss-120b:free$/, /deepseek-(chat|v3|r1)[^/]*:free$/, /qwen3-(235b|32b|30b|coder)[^/]*:free$/, /llama-4-maverick[^/]*:free$/,
      /gemma-3-27b[^/]*:free$/, /mistral-small[^/]*:free$/, /kimi-k2[^/]*:free$/, /gpt-oss-20b:free$/, /glm-4[^/]*:free$/, /^(?!.*(flash|mini|nano|lite|\b[1-8]b\b)).*:free$/i, /:free$/],
    nvidia: [/^meta\/llama-3\.3-70b-instruct$/, /^openai\/gpt-oss-120b$/, /^qwen\/qwen3/, /^deepseek-ai\/deepseek/, /^meta\/llama-4/, /^mistralai\/mistral-(medium|large)/, /instruct$/],
    mistral: [/^mistral-medium-latest$/, /^mistral-small-latest$/, /^mistral-large-latest$/, /^mistral-(medium|small|large)/],
    anthropic: [/^claude-opus-5-5$/, /^claude-sonnet-5-5$/, /^claude-opus-\d/, /^claude-sonnet-\d/, /^claude-haiku-\d/],
  };
  const UPSTREAM_BUSY = /rate-limited upstream|temporarily rate.?limited|provider returned error/i;
  const NOT_CHAT = /whisper|tts|guard|embed|vision-preview|playai|distil|compound|image|audio|aqa|learnlm|gemma-3n|ocr|moderation|rerank|retriever|safety|parakeet|clip|pixtral|voxtral/i;
  async function availableModels(cfg, provider) {
    if (provider === 'groq') {
      const d = await request('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${cfg.keys.groq}` } });
      return (d.data || []).filter((m) => m.active !== false).map((m) => m.id);
    }
    if (provider === 'gemini') {
      const d = await request('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': cfg.keys.gemini } });
      return (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, ''));
    }
    if (provider === 'openrouter') {
      const d = await request('https://openrouter.ai/api/v1/models', {});
      return (d.data || []).map((m) => m.id).filter((id) => /:free$/.test(id)); // never switch a free user to a paid model
    }
    if (provider === 'nvidia') {
      const d = await request('https://integrate.api.nvidia.com/v1/models', { headers: { Authorization: `Bearer ${cfg.keys.nvidia}` } });
      return (d.data || []).map((m) => m.id);
    }
    if (provider === 'mistral') {
      const d = await request('https://api.mistral.ai/v1/models', { headers: { Authorization: `Bearer ${cfg.keys.mistral}` } });
      return (d.data || []).filter((m) => !m.capabilities || m.capabilities.completion_chat !== false).map((m) => m.id);
    }
    if (provider === 'anthropic') {
      const d = await request('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': cfg.keys.anthropic, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      });
      return (d.data || []).map((m) => m.id);
    }
    return [];
  }
  // Slow or special-purpose models (agents, deep research, robotics, live audio, video/music) can't answer a resume prompt
  // in time: never picked, even as a last resort (that is how a key without gemini-2.5-flash ended in AJP-AI-TIME).
  const SLOW = /deep-?research|robotics|computer-use|live|native-audio|veo|lyria|imagen|nano-banana|-exp\b|-exp-|experimental|deep-?think/i;
  async function discoverModel(cfg, provider, failed) {
    const ids = (await availableModels(cfg, provider)).filter((id) => id !== failed && !NOT_CHAT.test(id) && !SLOW.test(id));
    for (const re of PREFER[provider] || []) {
      const hit = ids.find((id) => re.test(id));
      if (hit) return hit;
    }
    if (provider === 'gemini') return ids.find((id) => /^gemini-.*(flash|pro)/.test(id)) || null;
    return ids[0] || null;
  }

  // How long a rate-limited provider asked us to wait (Retry-After header, or "try again in 7.66s" in Groq's message).
  function waitAsked(x) {
    if (x.details && x.details.retryAfter) return x.details.retryAfter * 1000;
    const m = String((x.details && x.details.body) || '').match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*(ms|s)\b/i);
    if (!m) return null;
    return (m[1] ? +m[1] * 60000 : 0) + parseFloat(m[2]) * (m[3].toLowerCase() === 'ms' ? 1 : 1000);
  }

  // Every AI call is recorded (Admin → AI settings → Recent AI calls): which provider and model did the work, for what,
  // how long it took and whether it worked. Never the prompt or the answer.
  const LABEL = (provider, model) => `${(PROVIDERS[provider] || {}).label ? PROVIDERS[provider].label.replace(/\s*\(.*$/, '') : provider} · ${model}`;
  async function recordCall(entry) {
    AJP.ai.last = entry;
    try {
      await AJP.store.update('aiCalls', (l) => [entry, ...(Array.isArray(l) ? l : [])].slice(0, 30));
    } catch (e) {
      AJP.logger('ai').warn('AI call not recorded', { error: e.message });
    }
  }

  /*
   * group 'tailor' uses settings.ai.tailorProvider when set (e.g. Chrome built-in AI for everyday tasks, Gemini or Groq
   * for resume tailoring). patient: wait out one free-tier rate limit of up to CONFIG.patienceMs, then retry.
   */
  async function complete({ system, prompt, json = false, task = 'complete', tid, group = '', patient = false, timeoutMs }) {
    const settings = await AJP.store.get('settings');
    const cfg = { ...settings.ai, timeoutMs: timeoutMs || CONFIG.timeoutMs };
    const own = group === 'tailor' && cfg.tailorProvider && cfg.tailorProvider !== cfg.provider && PROVIDERS[cfg.tailorProvider] ? cfg.tailorProvider : null;
    const provider = own || cfg.provider;
    const p = PROVIDERS[provider];
    if (!p || provider === 'none') throw AJP.err('AI_OFF');
    if (p.needsKey && !cfg.keys[provider]) throw AJP.err('AI_NO_KEY', { provider });
    // The Model field belongs to the main provider, "Tailoring model" to the tailoring provider; a model found by
    // discovery (resolvedModels) replaces a retired default.
    const resolved = (cfg.resolvedModels || {})[provider];
    let model = own ? cfg.tailorModel || resolved || p.defaultModel : cfg.model || resolved || p.defaultModel;
    const tr = AJP.startTrace(`ai.${task}`, { mod: 'ai', tid, slowMs: 30000, data: { provider, model, promptChars: prompt.length } });
    const t0 = performance.now();
    let discovered = false;
    let switched = false;
    // Swap to another model the provider offers (retired, or busy upstream), remember it, retry once.
    const switchModel = async (why, text) => {
      let next = null;
      try {
        next = await discoverModel(cfg, provider, model);
      } catch (d) {
        tr.log.warn('Model list could not be read', { provider, code: AJP.toAppError(d).code });
      }
      if (!next) return null;
      tr.log.info(`ai.${task} model "${model}" ${why}; using "${next}"`, { provider, from: model, to: next });
      model = next;
      await AJP.store.update('settings', (s) => void (s.ai.resolvedModels = { ...(s.ai.resolvedModels || {}), [provider]: next }));
      return { out: await CALLERS[provider](cfg, model, system, text, json) };
    };
    const call = async (text) => {
      try {
        return await CALLERS[provider](cfg, model, system, text, json);
      } catch (e) {
        const x = AJP.toAppError(e);
        // "Model not found": the provider retired it. Find the one it offers now, remember it, retry once.
        if (x.code === 'AJP-AI-404' && !discovered && PREFER[provider]) {
          discovered = true;
          const r = await switchModel('not offered any more', text);
          if (r) return r.out;
        }
        // OpenRouter: one free model "temporarily rate-limited upstream" (its host is busy, not your limit) → another free model.
        if (x.code === 'AJP-AI-429' && provider === 'openrouter' && !switched && UPSTREAM_BUSY.test(String((x.details && x.details.body) || ''))) {
          switched = true;
          const r = await switchModel('is busy upstream', text);
          if (r) return r.out;
        }
        const wait = x.code === 'AJP-AI-429' && patient ? waitAsked(x) : null;
        if (wait == null || wait > CONFIG.patienceMs) throw e;
        tr.log.info(`ai.${task} free-tier limit reached; waiting ${Math.ceil(wait / 1000)}s, then retrying once`, { provider, waitMs: Math.round(wait) });
        await new Promise((r) => setTimeout(r, wait + 250));
        return CALLERS[provider](cfg, model, system, text, json);
      }
    };
    try {
      let out = await call(prompt);
      if (!out || !String(out).trim()) throw AJP.err('AI_BAD_RESPONSE', { reason: 'empty answer' });
      let result;
      if (json) {
        try {
          result = parseJsonLoose(out);
        } catch (e) {
          // Free models sometimes add prose or break JSON: retry once with a firm reminder.
          tr.log.warn(`ai.${task} invalid JSON, retrying once`, { reason: e.details && e.details.reason });
          out = await call(prompt + '\n\nIMPORTANT: Your previous reply was not valid JSON. Reply with ONE valid JSON object only, no other text.');
          result = parseJsonLoose(out);
        }
      } else result = out.trim();
      tr.end({ provider, model, outChars: out.length });
      await recordCall({ at: new Date().toISOString(), task, provider, model, label: LABEL(provider, model), ms: Math.round(performance.now() - t0), ok: true });
      return result;
    } catch (e) {
      const x = tr.fail(e, { provider, model });
      // An auto-picked model that is too slow is forgotten: the next call starts from the default again.
      if (x.code === 'AJP-AI-TIME' && (cfg.resolvedModels || {})[provider] === model) {
        await AJP.store.update('settings', (st) => void (st.ai.resolvedModels = { ...(st.ai.resolvedModels || {}), [provider]: '' }));
        tr.log.info(`ai.${task} auto-picked model "${model}" was too slow; forgotten`, { provider, model });
      }
      await recordCall({ at: new Date().toISOString(), task, provider, model, label: LABEL(provider, model), ms: Math.round(performance.now() - t0), ok: false, code: x.code });
      throw x;
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
    // A job that lists several skills has several requirements: a reply with fewer than 3 is asked again, once.
    async analyzeForResume({ jd, resumeText, tid }) {
      const p = AJP.resumeEngine.analyzePrompt({ jd, resumeText });
      const first = await complete({ task: 'resume.analyze', tid, json: true, group: 'tailor', patient: true, ...p });
      const n = Array.isArray(first && first.requirements) ? first.requirements.length : 0;
      const listed = AJP.matcher ? AJP.matcher.findSkills(jd).size : 0;
      if (n >= 3 || listed < 5) return first;
      AJP.logger('ai').info('Too few requirements from the AI; asking again once', { got: n, jobSkills: listed });
      const again = await complete({
        task: 'resume.analyze.retry', tid, json: true, group: 'tailor', patient: true, system: p.system,
        prompt: p.prompt + `\n\nIMPORTANT: Your previous answer listed only ${n} requirement${n === 1 ? '' : 's'}, but this job names at least ${listed} distinct skills or tools. ` +
          'List 6 to 15 SEPARATE requirements, one per skill, tool, responsibility or qualification. Split combined ones ("AWS, Glue and Snowflake" = three requirements).',
      });
      const m = Array.isArray(again && again.requirements) ? again.requirements.length : 0;
      return m > n ? again : first;
    },

    // Stage 3: targeted, evidence-backed edits (at most maxEdits: a light touch, not a rewrite).
    proposeResumeEdits({ doc, requirements, atsKeywords, skills, job, maxEdits, tid }) {
      return complete({ task: 'resume.edits', tid, json: true, group: 'tailor', patient: true, ...AJP.resumeEngine.editsPrompt({ doc, requirements, atsKeywords, skills, job, maxEdits }) });
    },

    // Skills the user CONFIRMED, each written into one line of the job they chose.
    weaveSkills({ picks, job, tid }) {
      return complete({ task: 'resume.weaveSkills', tid, json: true, group: 'tailor', patient: true, ...AJP.resumeEngine.weavePrompt({ picks, job }) });
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

    test({ tid, group = '' } = {}) {
      return complete({ task: 'test', tid, group, system: 'Reply with one word.', prompt: 'Say OK.', timeoutMs: CONFIG.testTimeoutMs });
    },
  };

  AJP.ai = { PROVIDERS, CONFIG, complete, tasks, parseJsonLoose, label: LABEL, last: null, local: { api: localApi, status: localStatus, download: localDownload, fitPrompt } };
})();
